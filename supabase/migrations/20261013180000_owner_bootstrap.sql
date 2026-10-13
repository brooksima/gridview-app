-- Auto-promote the business owner. Applies ONLY to this exact email, and ONLY once the address
-- is confirmed (email_confirmed_at set), so nobody can claim owner by signing up with Matt's
-- address without access to his inbox. If email confirmation is disabled, Supabase sets
-- email_confirmed_at at sign-up, so promotion happens immediately.
create or replace function public.bootstrap_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) = 'matt@gridviewuasservices.com' and new.email_confirmed_at is not null then
    update public.profiles
       set role = 'owner', status = 'approved', company_id = null, reviewed_at = now()
     where id = new.id and (role <> 'owner' or status <> 'approved');
  end if;
  return new;
end $$;

-- AFTER INSERT runs after on_auth_user_created (alphabetical trigger order: "on_auth_user_created" < "zz_...")
create trigger zz_bootstrap_owner_insert
  after insert on auth.users
  for each row execute function public.bootstrap_owner();
create trigger zz_bootstrap_owner_confirm
  after update of email_confirmed_at on auth.users
  for each row execute function public.bootstrap_owner();
