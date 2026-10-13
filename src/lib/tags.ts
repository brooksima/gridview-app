import { useEffect, useState } from 'react';
import { supabase, BUCKET } from './supabase';
import type { Photo, Profile } from './types';

/** Existing territory / circuit values for type-ahead (scoped by company when given). */
export function useTagValues(company: string | null) {
  const [vals, setVals] = useState<{ territory: string[]; circuit: string[] }>({ territory: [], circuit: [] });
  useEffect(() => {
    supabase.rpc('photo_tag_values', { p_company: company || null }).then(({ data }) => {
      const rows = (data ?? []) as { kind: string; value: string }[];
      const pick = (k: string) => rows.filter((r) => r.kind === k).map((r) => r.value).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      setVals({ territory: pick('territory'), circuit: pick('circuit') });
    });
  }, [company]);
  return vals;
}

export const canEditPhoto = (profile: Profile, p: Photo) =>
  profile.status === 'approved' && (profile.role === 'owner' || (profile.role === 'pilot' && p.pilot_id === profile.id));

/** Delete files first (policy needs the row for nothing, but the row is the index), then the row. */
export async function deletePhoto(p: Photo) {
  const paths = [p.storage_path, ...(p.thumb_path ? [p.thumb_path] : [])];
  const { error: se } = await supabase.storage.from(BUCKET).remove(paths);
  if (se) throw se;
  const { error } = await supabase.from('photos').delete().eq('id', p.id);
  if (error) throw error;
}
