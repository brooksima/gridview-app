-- Photo editing: owner edits/deletes any photo, a pilot only their own, customers never.
-- Immutable: id, pilot_id (uploader), created_at, storage_path, thumb_path, original_name.

drop policy if exists photos_update on public.photos;
drop policy if exists photos_delete on public.photos;
create policy photos_update on public.photos for update to authenticated
  using (public.is_owner() or (public.my_role() = 'pilot' and pilot_id = auth.uid()))
  with check (public.is_owner() or (public.my_role() = 'pilot' and pilot_id = auth.uid()));
create policy photos_delete on public.photos for delete to authenticated
  using (public.is_owner() or (public.my_role() = 'pilot' and pilot_id = auth.uid()));

create or replace function public.guard_photo_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.id is distinct from old.id
     or new.pilot_id is distinct from old.pilot_id
     or new.created_at is distinct from old.created_at
     or new.storage_path is distinct from old.storage_path
     or new.thumb_path is distinct from old.thumb_path
     or new.original_name is distinct from old.original_name then
    raise exception 'uploader, created and file fields cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists photos_guard on public.photos;
create trigger photos_guard before update on public.photos
  for each row execute function public.guard_photo_update();

-- Storage read access now follows the photos ROW (not the folder name), so moving a photo to
-- another company works without moving files: the new company's customers can read it and the old one's can't.
drop policy if exists photos_obj_read on storage.objects;
create policy photos_obj_read on storage.objects for select to authenticated using (
  bucket_id = 'photos' and (
    public.is_staff()
    or (public.my_role() = 'customer' and exists (
      select 1 from public.photos p
      where p.company_id = public.my_company()
        and (p.storage_path = storage.objects.name or p.thumb_path = storage.objects.name)))
  )
);

-- Delete files: owner any; pilot only objects they uploaded.
drop policy if exists photos_obj_delete on storage.objects;
create policy photos_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'photos' and (public.is_owner() or (public.my_role() = 'pilot' and owner_id = auth.uid()::text))
);
