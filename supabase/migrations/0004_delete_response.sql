-- Let a responder remove their own response (logged-in by user_id, anonymous
-- by edit_token). Cascades to their availability blocks.
create or replace function public.delete_my_response(
  p_slug       text,
  p_edit_token uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_uid      uuid := auth.uid();
begin
  select id into v_event_id from public.events where share_slug = p_slug;
  if v_event_id is null then
    return;
  end if;

  if v_uid is not null then
    delete from public.participants
    where event_id = v_event_id and user_id = v_uid;
  elsif p_edit_token is not null then
    delete from public.participants
    where event_id = v_event_id and edit_token = p_edit_token;
  end if;
end;
$$;

grant execute on function public.delete_my_response(text, uuid) to anon, authenticated;
