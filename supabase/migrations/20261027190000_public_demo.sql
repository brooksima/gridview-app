-- Public, no-login demo: the anon role may READ only the 'Demo' company's photos and files.
-- Scoped by the Demo company's fixed id (not its name, so renaming another company can't widen it).
-- No anon insert/update/delete policies exist anywhere, so anon writes stay denied.
-- Logged-in users are unaffected (these policies apply to anon only; customers never see Demo rows).

create or replace function public.demo_company_id() returns uuid
language sql immutable set search_path = public as $$
  select '8b3990cb-168e-48af-b62e-2b481da4ad7f'::uuid
$$;

drop policy if exists photos_read_demo_anon on public.photos;
create policy photos_read_demo_anon on public.photos for select to anon
  using (company_id = public.demo_company_id());

-- Files: object must sit under the Demo folder AND belong to a Demo photo row
-- (the subquery runs under anon RLS, so it can only ever see Demo rows).
drop policy if exists photos_obj_read_demo_anon on storage.objects;
create policy photos_obj_read_demo_anon on storage.objects for select to anon using (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = public.demo_company_id()::text
  and exists (
    select 1 from public.photos p
    where p.company_id = public.demo_company_id()
      and (p.storage_path = storage.objects.name or p.thumb_path = storage.objects.name))
);
