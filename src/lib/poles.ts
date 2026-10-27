import type { Photo, Severity } from './types';
import { SEV_RANK } from './types';

/** Photos within this distance of each other (chained) are treated as one pole. Poles are typically 35–60 m apart;
 *  the drone's own GPS for shots around one pole spreads ~0–13 m. */
export const POLE_RADIUS_M = 15;
/** Gimbal pitch at or below this is a nadir (straight-down) shot. DJI reports -90 for exactly nadir. */
export const NADIR_PITCH = -75;

export interface Pole {
  id: string; company_id: string; lat: number; lng: number;
  photos: Photo[];      // capture order
  worst: Severity;
  main: Photo;          // default photo for the panel
}

export const isNadir = (p: Photo) => p.gimbal_pitch != null && p.gimbal_pitch <= NADIR_PITCH;

/** Default photo: visual nadir → any nadir → worst finding → first visual photo → first photo. */
export function pickMain(ps: Photo[]): Photo {
  const vis = ps.filter((p) => !p.is_thermal);
  const nadir = ps.filter(isNadir).sort((a, b) => (a.gimbal_pitch! - b.gimbal_pitch!));
  const nadirVis = nadir.filter((p) => !p.is_thermal);
  if (nadirVis.length) return nadirVis[0];
  if (nadir.length) return nadir[0];
  const worst = [...ps].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])[0];
  if (worst && worst.severity !== 'none') return worst;
  return vis[0] ?? ps[0];
}

const time = (p: Photo) => new Date(p.taken_at ?? p.created_at).getTime();

/** Single-linkage grouping of GPS photos (per company) using a spatial grid, O(n). */
export function groupPoles(photos: Photo[], radius = POLE_RADIUS_M): Pole[] {
  const pts = photos.filter((p) => p.has_gps && p.lat != null && p.lng != null);
  const n = pts.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const M_LAT = 111320;
  const xy = pts.map((p) => [p.lng! * M_LAT * Math.cos((p.lat! * Math.PI) / 180), p.lat! * M_LAT]);
  const grid = new Map<string, number[]>();
  const cell = (x: number, y: number) => `${Math.floor(x / radius)},${Math.floor(y / radius)}`;
  pts.forEach((_, i) => { const k = cell(xy[i][0], xy[i][1]); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(xy[i][0] / radius), cy = Math.floor(xy[i][1] / radius);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (j <= i || pts[j].company_id !== pts[i].company_id) continue;
        if (Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]) <= radius) parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, Photo[]>();
  pts.forEach((p, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(p); });
  return [...groups.values()].map((ps) => {
    ps.sort((a, b) => time(a) - time(b));
    const main = pickMain(ps);
    // pin at the nadir shot if there is one (drone directly over the pole), else the group centroid
    const at = isNadir(main) ? main : null;
    return {
      id: ps.map((p) => p.id).sort()[0], company_id: ps[0].company_id, photos: ps, main,
      lat: at ? at.lat! : ps.reduce((s, p) => s + p.lat!, 0) / ps.length,
      lng: at ? at.lng! : ps.reduce((s, p) => s + p.lng!, 0) / ps.length,
      worst: ps.reduce<Severity>((w, p) => (SEV_RANK[p.severity] > SEV_RANK[w] ? p.severity : w), 'none'),
    };
  });
}
