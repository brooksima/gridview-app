-- Simulates owner / DTE customer / Consumers customer / pending user / anon against LIVE RLS.
-- Creates temp users, then raises an exception so everything is rolled back. Read the RESULT line.
do $$
declare
  dte uuid := '9ec651a7-e4a7-460a-8905-2eee5bbe7d57'; cons uuid := 'b371859e-cae6-4c7f-a7af-2cc698dfca96';
  demo uuid := '8b3990cb-168e-48af-b62e-2b481da4ad7f'; owner uuid := '780eaa05-354e-4d3b-8745-7810f5025a42';
  u_dte uuid := gen_random_uuid(); u_cons uuid := gen_random_uuid(); u_pend uuid := gen_random_uuid();
  out text := ''; r record; who record;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (u_dte, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','rlssim-dte@example.invalid','{"requested_role":"customer"}',now(),now()),
         (u_cons,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','rlssim-cons@example.invalid','{"requested_role":"customer"}',now(),now()),
         (u_pend,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','rlssim-pend@example.invalid','{"requested_role":"customer"}',now(),now());
  update public.profiles set role='customer', status='approved', company_id=dte  where id=u_dte;
  update public.profiles set role='customer', status='approved', company_id=cons where id=u_cons;
  for who in select * from (values ('owner', owner::text, 'authenticated'), ('dte_customer', u_dte::text, 'authenticated'),
                                   ('consumers_customer', u_cons::text, 'authenticated'), ('pending_user', u_pend::text, 'authenticated'),
                                   ('anon', null, 'anon')) v(label, uid, rl) loop
    perform set_config('request.jwt.claims', coalesce(json_build_object('sub', who.uid, 'role', who.rl)::text, '{"role":"anon"}'), true);
    execute format('set local role %I', who.rl);
    select count(*) total, count(*) filter (where company_id=dte) dte_rows, count(*) filter (where company_id=demo) demo_rows,
           count(*) filter (where company_id=cons) cons_rows,
           (select count(*) from storage.objects o where o.bucket_id='photos') objs,
           (select count(*) from storage.objects o where o.bucket_id='photos' and o.name like dte::text||'/%') dte_objs,
           (select count(*) from public.profiles) profiles
      into r from public.photos;
    out := out || format('%s: photos=%s (dte=%s demo=%s consumers=%s) objects=%s (dte=%s) profiles=%s | ', who.label, r.total, r.dte_rows, r.demo_rows, r.cons_rows, r.objs, r.dte_objs, r.profiles);
    reset role;
  end loop;
  raise exception 'RESULT %', out;  -- aborts => everything above (temp users) rolled back
end $$;
