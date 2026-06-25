-- GroupSchedule — initial schema
-- Tables, RLS policies, signup trigger, and security-definer RPCs for the
-- public share flow (anonymous + authenticated responders).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Profile, 1:1 with auth.users. Auto-created on signup via trigger below.
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null,
  organisation  text,
  created_at    timestamptz not null default now()
);

-- A scheduling request created by an organizer.
create table if not exists public.events (
  id                       uuid primary key default gen_random_uuid(),
  owner_id                 uuid not null references auth.users (id) on delete cascade,
  share_slug               text not null unique
                             default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  title                    text not null,
  description              text,
  start_date               date not null,
  end_date                 date not null,
  day_start_minute         int  not null default 540,   -- 09:00, minutes from midnight (organizer tz)
  day_end_minute           int  not null default 1080,  -- 18:00
  snap_minutes             int  not null default 15,
  meeting_duration_minutes int  not null default 60,    -- guideline only
  organizer_timezone       text not null,               -- IANA, defines the canonical grid
  finalized_start          timestamptz,
  finalized_end            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint events_date_range_ck     check (end_date >= start_date),
  constraint events_day_window_ck     check (day_end_minute > day_start_minute),
  constraint events_day_bounds_ck     check (day_start_minute >= 0 and day_end_minute <= 1440)
);

-- One row per responder per event. user_id null => anonymous responder.
create table if not exists public.participants (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete cascade,
  display_name  text not null,
  timezone      text not null,
  edit_token    uuid not null default gen_random_uuid(),  -- secret: lets an anon responder edit later
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One logged-in user has at most one response per event.
create unique index if not exists participants_event_user_uniq
  on public.participants (event_id, user_id)
  where user_id is not null;

create index if not exists participants_event_idx on public.participants (event_id);

-- Free-form availability windows (continuous intervals), stored in UTC.
create table if not exists public.availability_blocks (
  id              uuid primary key default gen_random_uuid(),
  participant_id  uuid not null references public.participants (id) on delete cascade,
  block_start     timestamptz not null,
  block_end       timestamptz not null,
  constraint availability_blocks_order_ck check (block_end > block_start)
);

create index if not exists availability_blocks_participant_idx
  on public.availability_blocks (participant_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.events              enable row level security;
alter table public.participants        enable row level security;
alter table public.availability_blocks enable row level security;

-- profiles: a user manages only their own row.
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- events: full CRUD for the owner. Public share access goes through RPCs.
create policy "events_all_owner" on public.events
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- participants: owner of the event reads all; a logged-in responder reads own.
create policy "participants_select_owner" on public.participants
  for select using (
    exists (select 1 from public.events e
            where e.id = participants.event_id and e.owner_id = auth.uid())
  );
create policy "participants_select_own" on public.participants
  for select using (user_id = auth.uid());

-- availability_blocks: owner of the event reads all; a logged-in responder reads own.
create policy "availability_select_owner" on public.availability_blocks
  for select using (
    exists (
      select 1 from public.participants p
      join public.events e on e.id = p.event_id
      where p.id = availability_blocks.participant_id and e.owner_id = auth.uid()
    )
  );
create policy "availability_select_own" on public.availability_blocks
  for select using (
    exists (select 1 from public.participants p
            where p.id = availability_blocks.participant_id and p.user_id = auth.uid())
  );

-- Writes to participants / availability_blocks happen only via the
-- security-definer RPC below, so no write policies are granted directly.

-- ---------------------------------------------------------------------------
-- Signup trigger: create a profile row from auth metadata
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, organisation)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
             split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data->>'organisation'), '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPCs for the public share flow (callable by anon + authenticated)
-- ---------------------------------------------------------------------------

-- Safe event fields by slug (owner_id stripped).
create or replace function public.get_event_public(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(e) - 'owner_id'
  from public.events e
  where e.share_slug = p_slug;
$$;

-- All responses for an event (display name, timezone, blocks) — no edit_token.
create or replace function public.get_event_responses(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'participant_id', p.id,
      'display_name',   p.display_name,
      'timezone',       p.timezone,
      'blocks', (
        select coalesce(jsonb_agg(
          jsonb_build_object('start', b.block_start, 'end', b.block_end)
          order by b.block_start
        ), '[]'::jsonb)
        from public.availability_blocks b
        where b.participant_id = p.id
      )
    ) order by p.created_at
  ), '[]'::jsonb)
  from public.participants p
  join public.events e on e.id = p.event_id
  where e.share_slug = p_slug;
$$;

-- Create/update the caller's response and replace their availability blocks.
-- Logged-in callers are keyed by auth.uid(); anonymous callers by edit_token.
create or replace function public.upsert_my_availability(
  p_slug         text,
  p_display_name text,
  p_timezone     text,
  p_blocks       jsonb,
  p_edit_token   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id    uuid;
  v_uid         uuid := auth.uid();
  v_participant public.participants%rowtype;
  v_block       jsonb;
begin
  select id into v_event_id from public.events where share_slug = p_slug;
  if v_event_id is null then
    raise exception 'event not found' using errcode = 'no_data_found';
  end if;

  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'display_name is required';
  end if;

  -- Locate an existing response.
  if v_uid is not null then
    select * into v_participant
    from public.participants
    where event_id = v_event_id and user_id = v_uid;
  elsif p_edit_token is not null then
    select * into v_participant
    from public.participants
    where event_id = v_event_id and edit_token = p_edit_token;
  end if;

  if v_participant.id is null then
    insert into public.participants (event_id, user_id, display_name, timezone)
    values (v_event_id, v_uid, trim(p_display_name), p_timezone)
    returning * into v_participant;
  else
    update public.participants
    set display_name = trim(p_display_name),
        timezone     = p_timezone,
        updated_at   = now()
    where id = v_participant.id
    returning * into v_participant;
  end if;

  delete from public.availability_blocks where participant_id = v_participant.id;

  for v_block in
    select * from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb))
  loop
    if (v_block->>'start')::timestamptz < (v_block->>'end')::timestamptz then
      insert into public.availability_blocks (participant_id, block_start, block_end)
      values (
        v_participant.id,
        (v_block->>'start')::timestamptz,
        (v_block->>'end')::timestamptz
      );
    end if;
  end loop;

  return jsonb_build_object(
    'participant_id', v_participant.id,
    'edit_token',     v_participant.edit_token
  );
end;
$$;

grant execute on function public.get_event_public(text)       to anon, authenticated;
grant execute on function public.get_event_responses(text)    to anon, authenticated;
grant execute on function public.upsert_my_availability(text, text, text, jsonb, uuid)
  to anon, authenticated;
