-- Teach the signup trigger to populate display_name from Google OAuth metadata.
-- Google returns the name under 'full_name' / 'name' (not 'display_name'), so
-- fall through those before defaulting to the email local-part.

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
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      split_part(new.email, '@', 1)
    ),
    nullif(trim(new.raw_user_meta_data->>'organisation'), '')
  );
  return new;
end;
$$;
