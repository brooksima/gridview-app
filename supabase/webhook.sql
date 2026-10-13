-- Database webhook: profiles INSERT / status UPDATE → notify-signup Edge Function (via pg_net).
-- Self-contained (doesn't need the dashboard's supabase_functions schema). Run ONCE in the SQL
-- editor after replacing the two placeholders. Not a migration because it contains your project
-- ref + secret. Payload matches Supabase's database-webhook format.
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_signup_webhook() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify-signup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', 'YOUR-WEBHOOK-SECRET'),
    body    := jsonb_build_object(
                 'type', tg_op, 'table', tg_table_name, 'schema', tg_table_schema,
                 'record', to_jsonb(new),
                 'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning 'notify_signup webhook failed: %', sqlerrm;  -- never block sign-up
  return new;
end $$;
revoke execute on function public.notify_signup_webhook() from public, anon, authenticated;

drop trigger if exists notify_signup on public.profiles;
create trigger notify_signup
  after insert or update of status on public.profiles
  for each row execute function public.notify_signup_webhook();
