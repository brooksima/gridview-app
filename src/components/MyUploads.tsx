import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Company, Photo, Profile } from '../lib/types';
import { SEV_COLOR } from '../lib/types';
import { fmtTime } from '../lib/media';
import { useTagValues } from '../lib/tags';

/** List of the user's uploads (owner: all) with multi-select bulk edit of company / territory / circuit. */
export default function MyUploads({ profile, companies, preselect, onClose, onChanged }:
  { profile: Profile; companies: Company[]; preselect?: string[]; onClose: () => void; onChanged: () => void }) {
  const owner = profile.role === 'owner';
  const [rows, setRows] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set(preselect ?? []));
  const [onlySel, setOnlySel] = useState(!!preselect?.length);
  const [q, setQ] = useState('');
  const [co, setCo] = useState(''); const [terr, setTerr] = useState(''); const [cir, setCir] = useState('');
  const [setTerrOn, setSetTerrOn] = useState(false); const [setCirOn, setSetCirOn] = useState(false);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const tags = useTagValues(co || null);
  const coName = (id: string) => companies.find((c) => c.id === id)?.name ?? '—';

  const load = async () => {
    let qy = supabase.from('photos').select('*').order('created_at', { ascending: false }).limit(2000);
    if (!owner) qy = qy.eq('pilot_id', profile.id);
    const { data, error } = await qy;
    if (error) setErr(error.message);
    setRows((data ?? []) as Photo[]); setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((p) => (!onlySel || sel.has(p.id)) &&
      (!n || `${p.circuit ?? ''} ${p.territory ?? ''} ${p.original_name ?? ''} ${coName(p.company_id)}`.toLowerCase().includes(n)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, onlySel, sel]);
  const allShown = shown.length > 0 && shown.every((p) => sel.has(p.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const apply = async () => {
    setErr(''); setMsg('');
    const patch: Record<string, string | null> = {};
    if (co) patch.company_id = co;
    if (setTerrOn) patch.territory = terr.trim() || null;
    if (setCirOn) patch.circuit = cir.trim() || null;
    if (!Object.keys(patch).length) return setErr('Choose at least one field to change.');
    if (!sel.size) return setErr('Select at least one photo.');
    setBusy(true);
    const { data, error } = await supabase.from('photos').update(patch).in('id', [...sel]).select('id');
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg(`Updated ${data?.length ?? 0} photo(s).`);
    await load(); onChanged();
  };

  return <div className="ovl">
    <div className="mbar"><button className="back" onClick={onClose}>‹ Back</button>
      <b style={{ color: 'var(--txt)', fontSize: 15 }}>{owner ? 'All uploads' : 'My uploads'}</b>
      <span style={{ marginLeft: 'auto' }}>{sel.size} selected</span></div>
    <div className="mwrap">
      <div className="card">
        <div className="lbl" style={{ marginTop: 0 }}>Bulk edit selected photos</div>
        <div className="fld" style={{ marginTop: 0 }}><label>Power company</label>
          <select value={co} onChange={(e) => setCo(e.target.value)}><option value="">— leave unchanged —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="two">
          <div className="fld"><label><input type="checkbox" checked={setTerrOn} onChange={(e) => setSetTerrOn(e.target.checked)} /> Set territory</label>
            <input list="bTerr" value={terr} disabled={!setTerrOn} onChange={(e) => setTerr(e.target.value)} placeholder={setTerrOn ? 'blank = clear' : 'unchanged'} autoComplete="off" />
            <datalist id="bTerr">{tags.territory.map((v) => <option key={v} value={v} />)}</datalist></div>
          <div className="fld"><label><input type="checkbox" checked={setCirOn} onChange={(e) => setSetCirOn(e.target.checked)} /> Set circuit</label>
            <input list="bCir" value={cir} disabled={!setCirOn} onChange={(e) => setCir(e.target.value)} placeholder={setCirOn ? 'blank = clear' : 'unchanged'} autoComplete="off" />
            <datalist id="bCir">{tags.circuit.map((v) => <option key={v} value={v} />)}</datalist></div>
        </div>
        {err && <div className="aerr">{err}</div>}{msg && <div className="okmsg">{msg}</div>}
        <button className="ab gold" disabled={busy || !sel.size} onClick={apply}>{busy ? 'Saving…' : `Apply to ${sel.size} photo${sel.size === 1 ? '' : 's'}`}</button>
      </div>
      <div className="srch" style={{ marginTop: 12 }}><span style={{ color: 'var(--gold)' }}>🔍</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by circuit, territory, file, company" /></div>
      <div className="chips">
        <button className={'chip' + (allShown ? ' on' : '')} onClick={() => setSel((s) => { const n = new Set(s); shown.forEach((p) => (allShown ? n.delete(p.id) : n.add(p.id))); return n; })}>
          {allShown ? 'Unselect shown' : `Select shown (${shown.length})`}</button>
        <button className={'chip' + (onlySel ? ' on' : '')} onClick={() => setOnlySel(!onlySel)}>Only selected</button>
        {sel.size > 0 && <button className="chip" onClick={() => setSel(new Set())}>Clear</button>}
      </div>
      {loading && <p className="sub" style={{ marginTop: 10 }}>Loading…</p>}
      {!loading && shown.length === 0 && <p className="sub" style={{ marginTop: 10 }}>No uploads.</p>}
      <div style={{ marginTop: 8 }}>
        {shown.map((p) => <label key={p.id} className="rq urow" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, padding: 10, cursor: 'pointer', borderColor: sel.has(p.id) ? 'var(--gold)' : undefined }}>
          <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} style={{ width: 20, height: 20, accentColor: '#ebb54a' }} />
          <span className="dot" style={{ background: SEV_COLOR[p.severity] }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontSize: 14 }}>{[p.circuit, p.territory].filter(Boolean).join(' · ') || 'Untagged'}</b>
            <div className="m" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {coName(p.company_id)} · {p.original_name ?? ''} · {fmtTime(p.taken_at ?? p.created_at)}{p.has_gps ? '' : ' · ⌀ GPS'}</div>
          </div>
        </label>)}
      </div>
    </div>
  </div>;
}
