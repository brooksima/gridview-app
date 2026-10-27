-- Camera metadata used to group photos into poles and pick the nadir (straight-down) shot.
-- gimbal_pitch: DJI XMP GimbalPitchDegree (-90 = nadir); null when unknown.
-- is_thermal:   DJI XMP ImageSource = InfraredCamera (or a *_T.JPG file).
-- No RLS changes: existing row policies already decide who can read each row (anon = Demo rows only).
alter table public.photos
  add column if not exists gimbal_pitch real check (gimbal_pitch between -180 and 180),
  add column if not exists is_thermal boolean not null default false;
