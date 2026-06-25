-- Google Meet scheduling + optional attendee emails.

alter table public.events add column if not exists meet_url text;
alter table public.events add column if not exists gcal_event_id text;
alter table public.participants add column if not exists email text;

-- Per-user Google refresh token, captured at OAuth callback, for server-side
-- Calendar API calls (free/busy reads and Meet event creation).
create table if not exists public.google_credentials (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);
alter table public.google_credentials enable row level security;
create policy "gc_select_own" on public.google_credentials
  for select using (user_id = auth.uid());
create policy "gc_insert_own" on public.google_credentials
  for insert with check (user_id = auth.uid());
create policy "gc_update_own" on public.google_credentials
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Extend the availability upsert with an optional email (for calendar invites).
drop function if exists public.upsert_my_availability(text, text, text, jsonb, uuid);
create or replace function public.upsert_my_availability(
  p_slug         text,
  p_display_name text,
  p_timezone     text,
  p_blocks       jsonb,
  p_edit_token   uuid default null,
  p_email        text default null
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

  if v_uid is not null then
    select * into v_participant from public.participants
    where event_id = v_event_id and user_id = v_uid;
  elsif p_edit_token is not null then
    select * into v_participant from public.participants
    where event_id = v_event_id and edit_token = p_edit_token;
  end if;

  if v_participant.id is null then
    insert into public.participants (event_id, user_id, display_name, timezone, email)
    values (v_event_id, v_uid, trim(p_display_name), p_timezone, nullif(trim(p_email), ''))
    returning * into v_participant;
  else
    update public.participants
    set display_name = trim(p_display_name),
        timezone     = p_timezone,
        email        = nullif(trim(p_email), ''),
        updated_at   = now()
    where id = v_participant.id
    returning * into v_participant;
  end if;

  delete from public.availability_blocks where participant_id = v_participant.id;
  for v_block in select * from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) loop
    if (v_block->>'start')::timestamptz < (v_block->>'end')::timestamptz then
      insert into public.availability_blocks (participant_id, block_start, block_end)
      values (v_participant.id, (v_block->>'start')::timestamptz, (v_block->>'end')::timestamptz);
    end if;
  end loop;

  return jsonb_build_object(
    'participant_id', v_participant.id,
    'edit_token', v_participant.edit_token
  );
end;
$$;

grant execute on function public.upsert_my_availability(text, text, text, jsonb, uuid, text)
  to anon, authenticated;
