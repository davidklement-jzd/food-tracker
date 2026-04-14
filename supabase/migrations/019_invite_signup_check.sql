-- Replace the signup trigger to require a valid invite code.
-- Without a valid code, registration is blocked at the DB level.

create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_code text;
  v_invite record;
begin
  -- Read invite_code from signup metadata
  v_code := new.raw_user_meta_data->>'invite_code';

  -- Allow trainer accounts to be created without invite code (manual DB insert)
  -- For all other signups, require a valid invite code
  if v_code is null or v_code = '' then
    raise exception 'Registrace vyžaduje platný pozvánkový kód od trenéra.'
      using errcode = 'P0001';
  end if;

  -- Look up the invite code
  select * into v_invite
    from public.invite_codes
    where code = v_code
      and used_by is null
      and expires_at > now()
    for update;  -- lock the row to prevent race conditions

  if not found then
    raise exception 'Pozvánkový kód je neplatný, vypršel nebo už byl použit.'
      using errcode = 'P0001';
  end if;

  -- Create the profile
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    'client'
  );

  -- Mark the invite code as used
  update public.invite_codes
    set used_by = new.id,
        used_at = now()
    where id = v_invite.id;

  return new;
end;
$$ language plpgsql security definer;
