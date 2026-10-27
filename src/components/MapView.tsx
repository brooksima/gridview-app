import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase, BUCKET } from '../lib/supabase';
import type { Company, Photo, Profile, Severity } from '../lib/types';
import { SEV_COLOR, SEV_LABEL, SEV_RANK } from '../lib/types';
import { fmtTime } from '../lib/media';
import { canEditPhoto, deletePhoto } from '../lib/tags';
import EditPhoto from './EditPhoto';
import { groupPoles, pickMain, isNadir, type Pole } from '../lib/poles';

const PAGE = 1000;
const MAX_ROWS = 20000;

export default function MapView({ profile, companies, db = supabase, demo = false }: { profile: Profile; companies: Company[]; db?: SupabaseClient; demo?: boolean }) {
  const staff = !demo && profile.role !== 'customer';
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [fCo, setFCo] = useState(''); const [fTerr, setFTerr] = useState(''); const [fCir, setFCir] = useState('');
  const [fSev, setFSev] = useState<Severity | ''>(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [selId, setSelId] = useState<string | null>(null); // selected photo; its pole is derived
  const [editing, setEditing] = useState<Photo | null>(null);
  const [pilots, setPilots] = useState<Record<string, string>>({});
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const fittedRef = useRef(false);

  // load photos (RLS scopes customers to their company)
  useEffect(() => {
    let cancel = false;
    (async () => {
      const all: Photo[] = [];
      for (let off = 0; off < MAX_ROWS; off += PAGE) {
        const { data, error } = await db.from('photos').select('*').order('taken_at', { ascending: false, nullsFirst: false }).range(off, off + PAGE - 1);
        if (error) { if (!cancel) setErr(error.message); break; }
        all.push(...(data as Photo[]));
        if (!data || data.length < PAGE) break;
      }
      if (cancel) return;
      setPhotos(all); setLoading(false);
      const ids = [...new Set(all.map((p) => p.pilot_id))];
      if (ids.length && !demo) {
        const { data } = await db.rpc('pilot_names', { ids });
        if (!cancel && data) setPilots(Object.fromEntries((data as { id: string; full_name: string }[]).map((r) => [r.id, r.full_name])));
      }
    })();
    return () => { cancel = true; };
  }, [db, demo]);

  // init map
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true }).setView([41.78, -83.57], 10);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 20, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 50, spiderfyOnMaxZoom: true,
      iconCreateFunction: (c) => {
        const worst = c.getAllChildMarkers().reduce((w, m) => Math.max(w, SEV_RANK[(m.options as { sev?: Severity }).sev ?? 'none']), 0);
        const k = ['n', 'l', 'm', 'h'][worst];
        return L.divIcon({ className: '', html: `<div class="cl ${k}">${c.getChildCount()}</div>`, iconSize: [42, 42] });
      },
    });
    map.addLayer(cluster);
    mapRef.current = map; clusterRef.current = cluster;
    return () => { map.remove(); mapRef.current = null; clusterRef.current = null; };
  }, []);

  // options for filters (respect the company filter)
  const scoped = useMemo(() => photos.filter((p) => !fCo || p.company_id === fCo), [photos, fCo]);
  const terrOpts = useMemo(() => uniq(scoped.map((p) => p.territory)), [scoped]);
  const cirOpts = useMemo(() => uniq(scoped.filter((p) => !fTerr || p.territory === fTerr).map((p) => p.circuit)), [scoped, fTerr]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromT = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
    const toT = to ? new Date(to + 'T23:59:59').getTime() : Infinity;
    return scoped.filter((p) => {
      if (fTerr && p.territory !== fTerr) return false;
      if (fCir && p.circuit !== fCir) return false;
      if (fSev && p.severity !== fSev) return false;
      const t = new Date(p.taken_at ?? p.created_at).getTime();
      if (t < fromT || t > toT) return false;
      if (needle && !(`${p.circuit ?? ''} ${p.territory ?? ''}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [scoped, q, fTerr, fCir, fSev, from, to]);

  // group photos taken around the same pole (per company) into one marker
  const poles = useMemo(() => groupPoles(scoped), [scoped]);
  const poleOf = useMemo(() => { const m = new Map<string, Pole>(); poles.forEach((pl) => pl.photos.forEach((ph) => m.set(ph.id, pl))); return m; }, [poles]);
  const visible = useMemo(() => {
    const ok = new Set(filtered.map((p) => p.id));
    return poles.map((pl) => ({ pole: pl, hits: pl.photos.filter((ph) => ok.has(ph.id)) })).filter((v) => v.hits.length);
  }, [poles, filtered]);
  const selPole = selId ? poleOf.get(selId) ?? null : null;
  const sel = selPole?.photos.find((p) => p.id === selId) ?? null;

  // draw markers (one per pole)
  useEffect(() => {
    const cluster = clusterRef.current, map = mapRef.current;
    if (!cluster || !map) return;
    cluster.clearLayers();
    const markers = visible.map(({ pole, hits }) => {
      const sev = hits.reduce<Severity>((w, p) => (SEV_RANK[p.severity] > SEV_RANK[w] ? p.severity : w), 'none');
      const n = pole.photos.length;
      const m = L.marker([pole.lat, pole.lng], {
        sev, title: `${n} photo${n === 1 ? '' : 's'}`,
        icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 30],
          html: `<div class="pole" data-pole="${pole.id}" data-n="${n}" data-sev="${sev}"><div class="pin" style="background:${SEV_COLOR[sev]}"></div>${n > 1 ? `<span class="pc">${n}</span>` : ''}</div>` }),
      } as L.MarkerOptions);
      m.on('click', () => setSelId((hits.length === pole.photos.length ? pole.main : pickMain(hits)).id));
      return m;
    });
    cluster.addLayers(markers);
    if (markers.length && (!fittedRef.current || q || fTerr || fCir || fCo)) {
      map.fitBounds(cluster.getBounds(), { padding: [40, 40], maxZoom: 17 });
      fittedRef.current = true;
    }
  }, [visible, q, fTerr, fCir, fCo]);

  const coName = (id: string) => companies.find((c) => c.id === id)?.name ?? '—';
  const st = {
    poles: visible.length,
    issues: filtered.filter((p) => p.severity !== 'none').length,
    high: filtered.filter((p) => p.severity === 'high').length,
    noGps: filtered.filter((p) => !p.has_gps).length,
  };

  return <>
    <div ref={mapEl} id="map" />
    <div className="uov">
      <div className="srch"><span style={{ color: 'var(--gold)' }}>🔍</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search circuit or territory" aria-label="Search circuit or territory" />
        {q && <button className="clr" style={{ display: 'block' }} onClick={() => setQ('')} aria-label="Clear search">✕</button>}
      </div>
      <div className="chips">
        {staff && <select className={'fsel' + (fCo ? ' act' : '')} value={fCo} onChange={(e) => { setFCo(e.target.value); setFTerr(''); setFCir(''); }} aria-label="Company">
          <option value="">All companies</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        <select className={'fsel' + (fTerr ? ' act' : '')} value={fTerr} onChange={(e) => { setFTerr(e.target.value); setFCir(''); }} aria-label="Territory">
          <option value="">All territories</option>{terrOpts.map((v) => <option key={v}>{v}</option>)}</select>
        <select className={'fsel' + (fCir ? ' act' : '')} value={fCir} onChange={(e) => setFCir(e.target.value)} aria-label="Circuit">
          <option value="">All circuits</option>{cirOpts.map((v) => <option key={v}>{v}</option>)}</select>
        <select className={'fsel' + (fSev ? ' act' : '')} value={fSev} onChange={(e) => setFSev(e.target.value as Severity | '')} aria-label="Severity">
          <option value="">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="none">No issue</option></select>
        <input type="date" className={'fdate' + (from ? ' act' : '')} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input type="date" className={'fdate' + (to ? ' act' : '')} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>
      <div className="res">{loading ? 'Loading photos…' : err ? <span style={{ color: '#ff8a8a' }}>{err}</span>
        : <><b>{filtered.length}</b> photos{filtered.length !== photos.length ? ` (of ${photos.length})` : ''} · <b>{st.poles}</b> pole{st.poles === 1 ? '' : 's'}</>}</div>
    </div>
    <div className="stats">
      <div><b>{st.poles}</b><small>Poles</small></div>
      <div><b style={{ color: SEV_COLOR.medium }}>{st.issues}</b><small>Issues</small></div>
      <div><b style={{ color: SEV_COLOR.high }}>{st.high}</b><small>High</small></div>
      <div><b>{st.noGps}</b><small>No GPS</small></div>
    </div>
    {!loading && !err && photos.length === 0 && <div className="hint">{demo ? 'Demo data is unavailable right now — please try again shortly.' : staff ? 'No photos yet — use Upload to add some.' : 'No inspection photos yet.'}</div>}
    <Sheet db={db} pole={selPole} photo={sel} onPick={setSelId} onClose={() => setSelId(null)} company={sel ? coName(sel.company_id) : ''} pilot={demo ? 'GridView UAS crew' : sel ? pilots[sel.pilot_id] ?? '—' : ''}
      canEdit={!demo && !!sel && canEditPhoto(profile, sel)} onEdit={() => setEditing(sel)}
      onDeleted={(id) => {
        const rest = selPole?.photos.filter((x) => x.id !== id) ?? [];
        setPhotos((ps) => ps.filter((x) => x.id !== id)); setSelId(rest.length ? pickMain(rest).id : null);
      }} />
    {!demo && editing && <EditPhoto photo={editing} companies={companies} onClose={() => setEditing(null)}
      onSaved={(np) => { setPhotos((ps) => ps.map((x) => (x.id === np.id ? np : x))); setSelId(np.id); setEditing(null); }} />}
  </>;
}

function uniq(v: (string | null)[]) {
  return [...new Set(v.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function Sheet({ db, pole, photo, onPick, onClose, company, pilot, canEdit, onEdit, onDeleted }: { db: SupabaseClient; pole: Pole | null; photo: Photo | null;
  onPick: (id: string) => void; onClose: () => void; company: string; pilot: string;
  canEdit: boolean; onEdit: () => void; onDeleted: (id: string) => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({}); // storage path -> signed URL (cached per session)
  const urlsRef = useRef(urls); urlsRef.current = urls;
  const [fullOk, setFullOk] = useState<string | null>(null);   // id whose full-res image finished loading
  const [confirmDel, setConfirmDel] = useState(false);
  const [delErr, setDelErr] = useState(''); const [deleting, setDeleting] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  useEffect(() => { setConfirmDel(false); setDelErr(''); }, [photo?.id]);

  const sign = (paths: string[]) => {
    const need = [...new Set(paths)].filter((p) => !urlsRef.current[p]);
    if (!need.length) return;
    db.storage.from(BUCKET).createSignedUrls(need, 3600).then(({ data }) => {
      if (!data) return;
      setUrls((u) => ({ ...u, ...Object.fromEntries(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string])) }));
    });
  };
  // one batch for the whole pole's thumbnails + the selected photo's full image
  useEffect(() => { if (pole) sign(pole.photos.map((p) => p.thumb_path ?? p.storage_path)); }, [pole?.id, pole?.photos.length, db]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (photo) sign([photo.storage_path]); }, [photo?.id, db]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = pole?.photos ?? (photo ? [photo] : []);
  const idx = photo ? Math.max(0, list.findIndex((p) => p.id === photo.id)) : 0;
  const go = (d: number) => { if (list.length > 1) onPick(list[(idx + d + list.length) % list.length].id); };

  useEffect(() => { // keep the selected thumbnail in view
    stripRef.current?.querySelector<HTMLElement>('.th.on')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [photo?.id]);
  useEffect(() => {
    if (!photo) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const full = photo ? urls[photo.storage_path] ?? null : null;
  const thumb = photo ? urls[photo.thumb_path ?? photo.storage_path] ?? null : null;
  const s = photo?.severity ?? 'none';
  const n = list.length;
  return <div className={'sheet' + (photo ? ' open' : '')}>
    <div className="grab" /><button className="x" onClick={onClose} aria-label="Close">✕</button>
    {photo && <>
      <div className="photo tall main" onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const x0 = touchX.current; touchX.current = null; if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1); }}>
        <a href={full ?? undefined} target="_blank" rel="noreferrer" className="mainlink">
          {thumb || full ? <>
            {thumb && <img src={thumb} alt={photo.original_name ?? 'Inspection photo'} />}
            {full && <img key={photo.id} src={full} alt="" aria-hidden className={'hi' + (fullOk === photo.id ? ' on' : '')} onLoad={() => setFullOk(photo.id)} />}
          </> : 'Loading photo…'}
        </a>
        {s !== 'none' && <span className="bad" style={{ background: SEV_COLOR[s] }}>{SEV_LABEL[s].toUpperCase()}</span>}
        <span className="ptag">{isNadir(photo) ? 'Nadir · top-down' : photo.is_thermal ? 'Thermal' : 'Side view'}</span>
        {n > 1 && <>
          <button className="nav l" onClick={() => go(-1)} aria-label="Previous photo">‹</button>
          <button className="nav r" onClick={() => go(1)} aria-label="Next photo">›</button>
          <span className="pcnt">{idx + 1} / {n}</span>
        </>}
      </div>
      {n > 1 && <div className="strip" ref={stripRef} role="listbox" aria-label="Photos at this pole">
        {list.map((p) => { const u = urls[p.thumb_path ?? p.storage_path]; return (
          <button key={p.id} role="option" aria-selected={p.id === photo.id} className={'th' + (p.id === photo.id ? ' on' : '')} onClick={() => onPick(p.id)}
            title={(p.issue || (p.severity === 'none' ? 'No issue' : SEV_LABEL[p.severity])) + (isNadir(p) ? ' · nadir' : '')}>
            {u ? <img src={u} alt="" loading="lazy" /> : null}
            {p.severity !== 'none' && <i className="sv" style={{ background: SEV_COLOR[p.severity] }} />}
            {isNadir(p) ? <em>⬇</em> : p.is_thermal ? <em>IR</em> : null}
          </button>); })}
      </div>}
      <h3>{[photo.circuit, photo.territory].filter(Boolean).join(' · ') || 'Untagged location'}</h3>
      <div className="sub">{company}{n > 1 ? ` · Pole with ${n} photos` : ''}</div>
      <div className="issue" style={{ color: s === 'none' ? '#9fd0f0' : SEV_COLOR[s], border: `1px solid ${SEV_COLOR[s]}`, background: SEV_COLOR[s] + '22' }}>
        <span className="dot" style={{ background: SEV_COLOR[s], margin: 0 }} />
        {photo.issue || (s === 'none' ? 'No issue found' : 'Issue')}{s !== 'none' ? ` — ${SEV_LABEL[s]}` : ''}
      </div>
      <div className="g2">
        <div className="cell"><div className="l">Company</div><div className="v">{company}</div></div>
        <div className="cell"><div className="l">Territory</div><div className="v">{photo.territory ?? '—'}</div></div>
        <div className="cell"><div className="l">Circuit</div><div className="v">{photo.circuit ?? '—'}</div></div>
        <div className="cell"><div className="l">GPS</div><div className="v">{photo.has_gps ? `${photo.lat!.toFixed(5)}, ${photo.lng!.toFixed(5)}` : 'None'}</div></div>
        <div className="cell"><div className="l">Taken</div><div className="v">{fmtTime(photo.taken_at)}</div></div>
        <div className="cell"><div className="l">Pilot</div><div className="v">{pilot}</div></div>
      </div>
      <div className="btns">
        {full && <a className="btn p" href={full} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Full photo</a>}
        {photo.has_gps && <a className="btn s" style={{ textDecoration: 'none', color: 'inherit' }} target="_blank" rel="noreferrer"
          href={`https://www.google.com/maps/search/?api=1&query=${pole && isNadir(pole.main) ? `${pole.lat},${pole.lng}` : `${photo.lat},${photo.lng}`}`}>Directions</a>}
      </div>
      {canEdit && !confirmDel && <div className="btns">
        <button className="btn s" onClick={onEdit}>✏️ Edit</button>
        <button className="btn s" style={{ color: '#ff8a8a', borderColor: 'rgba(255,90,90,.5)' }} onClick={() => setConfirmDel(true)}>🗑 Delete photo</button>
      </div>}
      {canEdit && confirmDel && <div className="card" style={{ marginTop: 14, borderColor: 'rgba(255,90,90,.6)' }}>
        <b>Delete this photo?</b><div className="sub">The photo and its thumbnail are removed permanently. This can't be undone.</div>
        {delErr && <div className="aerr">{delErr}</div>}
        <div className="btns" style={{ marginTop: 10 }}>
          <button className="btn" style={{ background: '#ff3b3b', color: '#fff' }} disabled={deleting} onClick={async () => {
            setDeleting(true); setDelErr('');
            try { await deletePhoto(photo); onDeleted(photo.id); } catch (e) { setDelErr((e as Error).message); } finally { setDeleting(false); }
          }}>{deleting ? 'Deleting…' : 'Delete'}</button>
          <button className="btn s" onClick={() => setConfirmDel(false)}>Cancel</button>
        </div></div>}
    </>}
  </div>;
}
