import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { supabase } from '../lib/supabase';
import type { Company, Photo, Severity } from '../lib/types';
import { ISSUE_PRESETS, SEV_COLOR } from '../lib/types';
import { useTagValues } from '../lib/tags';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const pinIcon = (sev: Severity) => L.divIcon({ className: '', html: `<div class="pin" style="background:${SEV_COLOR[sev]}"></div>`, iconSize: [26, 26], iconAnchor: [13, 30] });

export default function EditPhoto({ photo, companies, onClose, onSaved }: { photo: Photo; companies: Company[]; onClose: () => void; onSaved: (p: Photo) => void }) {
  const [company, setCompany] = useState(photo.company_id);
  const [territory, setTerritory] = useState(photo.territory ?? '');
  const [circuit, setCircuit] = useState(photo.circuit ?? '');
  const [issue, setIssue] = useState(photo.issue ?? '');
  const [severity, setSeverity] = useState<Severity>(photo.severity);
  const [lat, setLat] = useState(photo.lat?.toFixed(6) ?? '');
  const [lng, setLng] = useState(photo.lng?.toFixed(6) ?? '');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const tags = useTagValues(company);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const place = (la: number, ln: number, pan = false) => {
    const map = mapRef.current; if (!map) return;
    if (!markerRef.current) {
      const m = L.marker([la, ln], { draggable: true, icon: pinIcon(severity) }).addTo(map);
      m.on('dragend', () => { const p = m.getLatLng(); setLat(p.lat.toFixed(6)); setLng(p.lng.toFixed(6)); });
      markerRef.current = m;
    } else markerRef.current.setLatLng([la, ln]);
    if (pan) map.setView([la, ln], Math.max(map.getZoom(), 17));
  };

  useEffect(() => {
    if (!mapEl.current) return;
    const has = photo.lat != null && photo.lng != null;
    const map = L.map(mapEl.current, { zoomControl: true }).setView(has ? [photo.lat!, photo.lng!] : [41.78, -83.57], has ? 18 : 10);
    L.tileLayer(ESRI, { maxZoom: 20, maxNativeZoom: 19, attribution: 'Imagery © Esri' }).addTo(map);
    mapRef.current = map;
    if (has) place(photo.lat!, photo.lng!);
    map.on('click', (e: L.LeafletMouseEvent) => { place(e.latlng.lat, e.latlng.lng); setLat(e.latlng.lat.toFixed(6)); setLng(e.latlng.lng.toFixed(6)); });
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { markerRef.current?.setIcon(pinIcon(severity)); }, [severity]);

  const typed = (la: string, ln: string) => {
    setLat(la); setLng(ln);
    const a = parseFloat(la), b = parseFloat(ln);
    if (isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) place(a, b, true);
  };

  const save = async () => {
    setErr('');
    const la = lat.trim() === '' ? null : parseFloat(lat), ln = lng.trim() === '' ? null : parseFloat(lng);
    if ((la == null) !== (ln == null)) return setErr('Enter both latitude and longitude, or clear both.');
    if (la != null && (!isFinite(la) || Math.abs(la) > 90)) return setErr('Latitude must be between -90 and 90.');
    if (ln != null && (!isFinite(ln) || Math.abs(ln) > 180)) return setErr('Longitude must be between -180 and 180.');
    setBusy(true);
    const { data, error } = await supabase.from('photos').update({
      company_id: company, territory: territory.trim() || null, circuit: circuit.trim() || null,
      issue: issue.trim() || null, severity, lat: la, lng: ln,
    }).eq('id', photo.id).select().single();
    setBusy(false);
    if (error) return setErr(error.message);
    onSaved(data as Photo);
  };

  return <div className="ovl" style={{ zIndex: 3300 }}>
    <div className="mbar"><button className="back" onClick={onClose}>‹ Cancel</button><b style={{ color: 'var(--txt)', fontSize: 15 }}>Edit photo</b>
      <span style={{ marginLeft: 'auto', fontSize: 11.5 }}>{photo.original_name}</span></div>
    <div className="mwrap">
      <div className="fld" style={{ marginTop: 0 }}><label htmlFor="eCo">Power company <i>*</i></label>
        <select id="eCo" value={company} onChange={(e) => setCompany(e.target.value)}>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="two">
        <div className="fld"><label htmlFor="eTerr">Territory</label><input id="eTerr" list="eTerrList" value={territory} onChange={(e) => setTerritory(e.target.value)} autoComplete="off" />
          <datalist id="eTerrList">{tags.territory.map((v) => <option key={v} value={v} />)}</datalist></div>
        <div className="fld"><label htmlFor="eCir">Circuit</label><input id="eCir" list="eCirList" value={circuit} onChange={(e) => setCircuit(e.target.value)} autoComplete="off" />
          <datalist id="eCirList">{tags.circuit.map((v) => <option key={v} value={v} />)}</datalist></div>
      </div>
      <div className="lbl">Issue tag</div>
      <div className="tags">
        <button className={'tg' + (!issue ? ' on' : '')} onClick={() => { setIssue(''); setSeverity('none'); }}>None</button>
        {ISSUE_PRESETS.map((p) => <button key={p.issue} className={'tg' + (issue === p.issue ? ' on' : '')} onClick={() => { setIssue(p.issue); setSeverity(p.severity); }}>{p.issue}</button>)}
      </div>
      <div className="two">
        <div className="fld"><label>Issue <small>(free text)</small></label><input value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="Describe issue" /></div>
        <div className="fld"><label>Severity</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} style={{ color: severity === 'none' ? undefined : SEV_COLOR[severity] }}>
            <option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      </div>
      <div className="lbl">Location <span style={{ textTransform: 'none', letterSpacing: 0 }}>drag the pin or tap the map</span></div>
      <div ref={mapEl} id="emap" style={{ height: 240, borderRadius: 14 }} />
      <div className="two">
        <div className="fld"><label htmlFor="eLat">Latitude</label><input id="eLat" inputMode="decimal" value={lat} onChange={(e) => typed(e.target.value, lng)} placeholder="41.77120" /></div>
        <div className="fld"><label htmlFor="eLng">Longitude</label><input id="eLng" inputMode="decimal" value={lng} onChange={(e) => typed(lat, e.target.value)} placeholder="-83.60010" /></div>
      </div>
      {err && <div className="aerr">{err}</div>}
      <button className="ab gold" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      <button className="ab line" onClick={onClose}>Cancel</button>
    </div>
  </div>;
}
