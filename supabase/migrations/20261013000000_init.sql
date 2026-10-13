-- GridView UAS Services — initial schema
-- Tables, enums, helper functions, RLS, storage bucket + policies, signup trigger.

create extension if not exists pgcrypto;

-- ───────────── Enums ─────────────
create type public.user_role   as enum ('owner', 'pilot', 'customer');
create type public.user_status as enum ('pending', 'approved', 'denied');
create type public.severity    as enum ('none', 'low', 'medium', 'high');

-- ───────────── Tables ─────────────
create table public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

insert into public.companies (name) values
  ('DTE Energy'),
  ('Consumers Energy'),
  ('Toledo Edison (FirstEnergy)'),
  ('Hancock-Wood Electric Co-op');

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text not null,
  full_name         text not null default '',
  phone             text,
  requested_role    public.user_role not null default 'customer',
  requested_company text,                       -- free text from sign-up form
  role              public.user_role not null default 'customer',
  status            public.user_status not null default 'pending',
  company_id        uuid references public.companies (id) on delete set null,
  reviewed_by       uuid references auth.users (id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  -- an approved customer must be tied to a company
  constraint customer_needs_company check (
    not (role = 'customer' and status = 'approved' and company_id is null)
  )
);
create index profiles_status_idx on public.profiles (status);

create table public.photos (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  territory     text,
  circuit       text,
  issue         text,
  severity      public.severity not null default 'none',
  storage_path  text not null unique,
  thumb_path    text,
  original_name text,
  lat           double precision check (lat between -90 and 90),
  lng           double precision check (lng between -180 and 180),
  has_gps       boolean generated always as (lat is not null and lng is not null) stored,
  taken_at      timestamptz,
  pilot_id      uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at    timestamptz not null default now()
);
create index photos_company_idx   on public.photos (company_id);
create index photos_territory_idx on public.photos (company_id, territory);
create index photos_circuit_idx   on public.photos (company_id, circuit);
create index photos_taken_idx     on public.photos (taken_at);

-- ───────────── Helper functions (security definer → no RLS recursion) ─────────────
create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'approved'
$$;

create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid() and status = 'approved'
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'owner', false)
$$;

create or replace function public.is_staff() returns boolean   -- owner or pilot, approved
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner', 'pilot'), false)
$$;

revoke execute on function public.my_role(), public.my_company(), public.is_owner(), public.is_staff() from anon;

-- ───────────── Signup trigger: create profile from auth metadata ─────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  req  public.user_role;
begin
  -- only pilot/customer can be requested; owner is granted manually
  req := case when meta->>'requested_role' = 'pilot' then 'pilot'::public.user_role
              else 'customer'::public.user_role end;
  insert into public.profiles (id, email, full_name, phone, requested_role, requested_company, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(meta->>'full_name', ''), 200),
    nullif(left(coalesce(meta->>'phone', ''), 40), ''),
    req,
    nullif(left(coalesce(meta->>'company', ''), 200), ''),
    req,
    'pending'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── Guard: non-owners can't change privileged profile columns ─────────────
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- service_role / SQL editor (no JWT user) may do anything
  if auth.uid() is null or public.is_owner() then
    if new.status is distinct from old.status and new.status <> 'pending' then
      new.reviewed_at := now();
      new.reviewed_by := auth.uid();
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.company_id is distinct from old.company_id
     or new.email is distinct from old.email
     or new.requested_role is distinct from old.requested_role
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'not allowed to change role/status/company' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ───────────── RLS ─────────────
alter table public.companies enable row level security;
alter table public.profiles  enable row level security;
alter table public.photos    enable row level security;

-- companies: anyone (incl. anon, for the sign-up form) may read names; owner manages
create policy companies_read   on public.companies for select to anon, authenticated using (true);
create policy companies_insert on public.companies for insert to authenticated with check (public.is_owner());
create policy companies_update on public.companies for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy companies_delete on public.companies for delete to authenticated using (public.is_owner());

-- profiles: you see yourself; staff see everyone (pilot names on pins); owner manages
create policy profiles_read_self  on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_read_staff on public.profiles for select to authenticated using (public.is_staff());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_owner on public.profiles for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy profiles_delete_owner on public.profiles for delete to authenticated using (public.is_owner());
-- no insert policy: rows are created only by the auth trigger

-- photos
create policy photos_read on public.photos for select to authenticated using (
  public.is_staff()
  or (public.my_role() = 'customer' and company_id = public.my_company())
);
create policy photos_insert on public.photos for insert to authenticated
  with check (public.is_staff() and pilot_id = auth.uid());
create policy photos_update on public.photos for update to authenticated
  using (public.is_owner() or (public.is_staff() and pilot_id = auth.uid()))
  with check (public.is_owner() or (public.is_staff() and pilot_id = auth.uid()));
create policy photos_delete on public.photos for delete to authenticated
  using (public.is_owner() or (public.is_staff() and pilot_id = auth.uid()));

-- Pilot names for customers' detail sheet without exposing other profile fields
create or replace function public.pilot_names(ids uuid[])
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name from public.profiles p
  where p.id = any(ids) and public.my_role() is not null
$$;
revoke execute on function public.pilot_names(uuid[]) from anon;

-- Distinct territory / circuit values for type-ahead (respects RLS: security invoker)
create or replace function public.photo_tag_values(p_company uuid default null)
returns table (kind text, value text)
language sql stable security invoker set search_path = public as $$
  select distinct 'territory', territory from public.photos
    where territory is not null and (p_company is null or company_id = p_company)
  union
  select distinct 'circuit', circuit from public.photos
    where circuit is not null and (p_company is null or company_id = p_company)
$$;

-- ───────────── Storage ─────────────
-- Private bucket. Object paths: <company_id>/<photo_id>.<ext>  and  <company_id>/thumbs/<photo_id>.jpg
insert into storage.buckets (id, name, public, file_size_limit)
values ('photos', 'photos', false, 104857600)  -- 100 MB per file
on conflict (id) do nothing;

create policy photos_obj_read on storage.objects for select to authenticated using (
  bucket_id = 'photos' and (
    public.is_staff()
    or (public.my_role() = 'customer' and (storage.foldername(name))[1] = public.my_company()::text)
  )
);
create policy photos_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_staff());
create policy photos_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_staff()) with check (bucket_id = 'photos' and public.is_staff());
create policy photos_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_owner());
