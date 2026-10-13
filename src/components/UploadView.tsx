import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Company, Profile, Severity } from '../lib/types';
import { ISSUE_PRESETS, SEV_COLOR } from '../lib/types';
import { makeThumb, readMeta, fmtTime } from '../lib/media';
import { uploadResumable, uploadSmall } from '../lib/upload';

interface Item {
  key: string; file: File; thumb: Blob | null; thumbUrl: string | null;
  lat: number | null; lng: number | null; takenAt: Date | null;
  progress: number; state: 'ready' | 'uploading' | 'done' | 'error'; error?: string;
}
const CONCURRENCY = 2;

export default function UploadView({ profile, companies, onUploaded }: { profile: Profile; companies: Company[]; onUploaded: () => void }) {
  const [company, setCompany] = useState('');
  const [territory, setTerritory] = useState(''); const [circuit, setCircuit] = useState('');
  const [issue, setIssue] = useState(''); const [severity, setSeverity] = useState<Severity>('none');
  const [items, setItems] = useState<Item[]>([]);
  const [reading, setReading] = useState(0);
  const [busy, setBusy] = useState(false); const [coErr, setCoErr] = useState(false);
  const [msg, setMsg] = useState('');
  const [tagVals, setTagVals] = useState<{ territory: string[]; circuit: string[] }>({ territory: [], circuit: [] });
  const fileRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items); itemsRef.current = items;

  useEffect(() => {
    supabase.rpc('photo_tag_values', { p_company: company || null }).then(({ data }) => {
      const rows = (data ?? []) as { kind: string; value: string }[];
      const pick = (k: string) => rows.filter((r) => r.kind === k).map((r) => r.value).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      setTagVals({ territory: pick('territory'), circuit: pick('circuit') });
    });
  }, [company]);

  // warn before closing the tab mid-upload
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [busy]);

  useEffect(() => () => itemsRef.current.forEach((i) => i.thumbUrl && URL.revokeObjectURL(i.thumbUrl)), []);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    setReading((r) => r + list.length); setMsg('');
    for (const file of list) {
      const [meta, thumb] = await Promise.all([readMeta(file), makeThumb(file)]);
      const it: Item = { key: crypto.randomUUID(), file, thumb, thumbUrl: thumb ? URL.createObjectURL(thumb) : null,
        lat: meta.lat, lng: meta.lng, takenAt: meta.takenAt, progress: 0, state: 'ready' };
      setItems((prev) => [...prev, it]); setReading((r) => r - 1);
    }
  };

  const patch = (key: string, p: Partial<Item>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const uploadOne = async (it: Item) => {
    patch(it.key, { state: 'uploading', progress: 0, error: undefined });
    const id = crypto.randomUUID();
    const ext = (it.file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${company}/${id}.${ext}`;
    const thumbPath = it.thumb ? `${company}/thumbs/${id}.jpg` : null;
    try {
      await uploadResumable(path, it.file, it.file.type || 'image/jpeg', (f) => patch(it.key, { progress: f * 0.95 }));
      if (it.thumb && thumbPath) await uploadSmall(thumbPath, it.thumb, 'image/jpeg');
      const { error } = await supabase.from('photos').insert({
        id, company_id: company, territory: territory.trim() || null, circuit: circuit.trim() || null,
        issue: issue.trim() || null, severity, storage_path: path, thumb_path: thumbPath, original_name: it.file.name,
        lat: it.lat, lng: it.lng, taken_at: it.takenAt?.toISOString() ?? null, pilot_id: profile.id,
      });
      if (error) throw error;
      patch(it.key, { state: 'done', progress: 1 });
    } catch (e) {
      patch(it.key, { state: 'error', error: (e as Error).message });
    }
  };

  const start = async () => {
    if (!company) { setCoErr(true); return; }
    const queue = itemsRef.current.filter((i) => i.state === 'ready' || i.state === 'error');
    if (!queue.length) return;
    setBusy(true); setMsg('');
    let lock: WakeLockSentinel | null = null;
    try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
    let idx = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (idx < queue.length) await uploadOne(queue[idx++]);
    }));
    lock?.release().catch(() => {});
    setBusy(false);
    const failed = itemsRef.current.filter((i) => i.state === 'error').length;
    setMsg(failed ? `${failed} photo(s) failed — tap Upload to retry.` : 'All photos uploaded.');
    onUploaded();
  };

  const stats = useMemo(() => {
    const total = items.length, done = items.filter((i) => i.state === 'done').length;
    const noGps = items.filter((i) => i.lat == null).length;
    const bytes = items.reduce((s, i) => s + i.file.size, 0);
    const sent = items.reduce((s, i) => s + i.file.size * i.progress, 0);
    return { total, done, noGps, pct: bytes ? Math.round((sent / bytes) * 100) : 0 };
  }, [items]);

  const clear = () => { items.forEach((i) => i.thumbUrl && URL.revokeObjectURL(i.thumbUrl)); setItems([]); setMsg(''); };
  const pending = items.filter((i) => i.state === 'ready' || i.state === 'error').length;

  return <div className="page on"><div className="inner">
    <div className="lbl">New upload · Tag these photos</div>
    <div className={'fld' + (coErr && !company ? ' err' : '')}>
      <label htmlFor="uCo">Power company <i>*</i></label>
      <select id="uCo" required value={company} onChange={(e) => { setCompany(e.target.value); setCoErr(false); }} disabled={busy}>
        <option value="" disabled>Select power company</option>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="emsg">Choose the power company before uploading.</div>
    </div>
    <div className="two">
      <div className="fld"><label htmlFor="uTerr">Territory <small>(optional)</small></label>
        <input id="uTerr" list="terrList" value={territory} onChange={(e) => setTerritory(e.target.value)} placeholder="e.g. Bedford Twp" autoComplete="off" disabled={busy} />
        <datalist id="terrList">{tagVals.territory.map((v) => <option key={v} value={v} />)}</datalist></div>
      <div className="fld"><label htmlFor="uCir">Circuit <small>(optional)</small></label>
        <input id="uCir" list="cirList" value={circuit} onChange={(e) => setCircuit(e.target.value)} placeholder="e.g. Cir. 12" autoComplete="off" disabled={busy} />
        <datalist id="cirList">{tagVals.circuit.map((v) => <option key={v} value={v} />)}</datalist></div>
    </div>
    <div className="lbl">Issue tag (optional, applies to this batch)</div>
    <div className="tags">
      <button className={'tg' + (!issue ? ' on' : '')} onClick={() => { setIssue(''); setSeverity('none'); }} disabled={busy}>None</button>
      {ISSUE_PRESETS.map((p) => <button key={p.issue} className={'tg' + (issue === p.issue ? ' on' : '')} disabled={busy}
        onClick={() => { setIssue(p.issue); setSeverity(p.severity); }}>{p.issue}</button>)}
    </div>
    <div className="two">
      <div className="fld"><label>Issue <small>(free text)</small></label><input value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="Describe issue" disabled={busy} /></div>
      <div className="fld"><label>Severity</label>
        <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} disabled={busy} style={{ color: severity === 'none' ? undefined : SEV_COLOR[severity] }}>
          <option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select></div>
    </div>

    <div className="lbl">Photos {items.length > 0 && !busy && <a onClick={clear}>Clear</a>}</div>
    <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
    <button className="ab line" style={{ marginTop: 0 }} onClick={() => fileRef.current?.click()} disabled={busy}>+ Add photos</button>
    {reading > 0 && <p className="sub" style={{ marginTop: 8 }}>Reading GPS from {reading} photo(s)…</p>}
    {items.length > 0 && <>
      <div className="cnt"><span>{stats.total}</span> photos{stats.done ? ` · ${stats.done} uploaded` : ''}</div>
      {stats.noGps > 0 && <div className="card note w" style={{ marginBottom: 8 }}><span className="i">⚠️</span>
        <div><b>{stats.noGps} photo(s) have no GPS</b> — they'll upload but won't appear on the map. Check the drone's location setting.</div></div>}
      <div className="grid">
        {items.map((i) => <div key={i.key} title={`${i.file.name}\n${i.takenAt ? fmtTime(i.takenAt.toISOString()) : 'No timestamp'}${i.error ? '\n' + i.error : ''}`}
          className={'th' + (i.lat == null ? ' ng' : '') + (i.state === 'done' ? ' ok' : '') + (i.state === 'error' ? ' err' : '')}
          style={{ backgroundImage: i.thumbUrl ? `url(${i.thumbUrl})` : undefined }}>
          {i.state === 'uploading' && <span className="tp" style={{ width: `${i.progress * 100}%` }} />}
        </div>)}
      </div>
      {(busy || stats.done > 0) && <div className="card" style={{ marginTop: 12 }}>
        <div className="pct"><b>{stats.pct}%</b><span>{stats.done} of {stats.total} done</span></div>
        <div className="bar"><i style={{ width: `${stats.pct}%` }} /></div>
        <div className="row"><span>Keep this screen open; interrupted uploads resume when you retry.</span></div>
      </div>}
    </>}
    {msg && <div className={msg.includes('failed') ? 'aerr' : 'okmsg'}>{msg}</div>}
    <div style={{ height: 90 }} />
    {pending > 0 && <button className="big" disabled={busy} onClick={start}>{busy ? `Uploading… ${stats.pct}%` : `Upload ${pending} photo${pending > 1 ? 's' : ''}`}</button>}
  </div></div>;
}
