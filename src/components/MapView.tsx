import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { supabase, BUCKET } from '../lib/supabase';
import type { Company, Photo, Profile, Severity } from '../lib/types';
import { SEV_COLOR, SEV_LABEL, SEV_RANK } from '../lib/types';
import { fmtTime } from '../lib/media';

const PAGE = 1000;
const MAX_ROWS = 20000;

export default function MapView({ profile, companies }: { profile: Profile; companies: Company[] }) {
  const staff = profile.role !== 'customer';
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [fCo, setFCo] = useState(''); const [fTerr, setFTerr] = useState(''); const [fCir, setFCir] = useState('');
  const [fSev, setFSev] = useState<Severity | ''>(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [sel, setSel] = useState<Photo | null>(null);
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
        const { data, error } = await supabase.from('photos').select('*').order('taken_at', { ascending: false, nullsFirst: false }).range(off, off + PAGE - 1);
        if (error) { if (!cancel) setErr(error.message); break; }
        all.push(...(data as Photo[]));
        if (!data || data.length < PAGE) break;
      }
      if (cancel) return;
      setPhotos(all); setLoading(false);
      const ids = [...new Set(all.map((p) => p.pilot_id))];
      if (ids.length) {
        const { data } = await supabase.rpc('pilot_names', { ids });
        if (!cancel && data) setPilots(Object.fromEntries((data as { id: string; full_name: string }[]).map((r) => [r.id, r.full_name])));
      }
    })();
    return () => { cancel = true; };
  }, []);

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

  // draw markers
  useEffect(() => {
    const cluster = clusterRef.current, map = mapRef.current;
    if (!cluster || !map) return;
    cluster.clearLayers();
    const markers = filtered.filter((p) => p.has_gps).map((p) => {
      const m = L.marker([p.lat!, p.lng!], {
        sev: p.severity,
        icon: L.divIcon({ className: '', html: `<div class="pin" style="background:${SEV_COLOR[p.severity]}"></div>`, iconSize: [26, 26], iconAnchor: [13, 30] }),
      } as L.MarkerOptions);
      m.on('click', () => setSel(p));
      return m;
    });
    cluster.addLayers(markers);
    if (markers.length && (!fittedRef.current || q || fTerr || fCir || fCo)) {
      map.fitBounds(cluster.getBounds(), { padding: [40, 40], maxZoom: 17 });
      fittedRef.current = true;
    }
  }, [filtered, q, fTerr, fCir, fCo]);

  const coName = (id: string) => companies.find((c) => c.id === id)?.name ?? '—';
  const st = {
    pins: filtered.filter((p) => p.has_gps).length,
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
        : <><b>{filtered.length}</b> photos{filtered.length !== photos.length ? ` (of ${photos.length})` : ''}</>}</div>
    </div>
    <div className="stats">
      <div><b>{st.pins}</b><small>On map</small></div>
      <div><b style={{ color: SEV_COLOR.medium }}>{st.issues}</b><small>Issues</small></div>
      <div><b style={{ color: SEV_COLOR.high }}>{st.high}</b><small>High</small></div>
      <div><b>{st.noGps}</b><small>No GPS</small></div>
    </div>
    {!loading && !err && photos.length === 0 && <div className="hint">{staff ? 'No photos yet — use Upload to add some.' : 'No inspection photos yet.'}</div>}
    <Sheet photo={sel} onClose={() => setSel(null)} company={sel ? coName(sel.company_id) : ''} pilot={sel ? pilots[sel.pilot_id] ?? '—' : ''} />
  </>;
}

function uniq(v: (string | null)[]) {
  return [...new Set(v.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function Sheet({ photo, onClose, company, pilot }: { photo: Photo | null; onClose: () => void; company: string; pilot: string }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);
  useEffect(() => {
    setThumb(null); setFull(null);
    if (!photo) return;
    let cancel = false;
    const paths = [photo.storage_path, ...(photo.thumb_path ? [photo.thumb_path] : [])];
    supabase.storage.from(BUCKET).createSignedUrls(paths, 3600).then(({ data }) => {
      if (cancel || !data) return;
      setFull(data[0]?.signedUrl ?? null);
      setThumb(data[1]?.signedUrl ?? data[0]?.signedUrl ?? null);
    });
    return () => { cancel = true; };
  }, [photo]);
  const s = photo?.severity ?? 'none';
  return <div className={'sheet' + (photo ? ' open' : '')}>
    <div className="grab" /><button className="x" onClick={onClose} aria-label="Close">✕</button>
    {photo && <>
      <a className="photo tall" href={full ?? undefined} target="_blank" rel="noreferrer">
        {thumb ? <img src={thumb} alt={photo.original_name ?? 'Inspection photo'} /> : 'Loading photo…'}
        {s !== 'none' && <span className="bad" style={{ background: SEV_COLOR[s] }}>{SEV_LABEL[s].toUpperCase()}</span>}
      </a>
      <h3>{[photo.circuit, photo.territory].filter(Boolean).join(' · ') || 'Untagged location'}</h3>
      <div className="sub">{company}</div>
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
          href={`https://www.google.com/maps/search/?api=1&query=${photo.lat},${photo.lng}`}>Directions</a>}
      </div>
    </>}
  </div>;
}
