import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Company, Profile, Role, Status } from '../lib/types';
import { fmtTime } from '../lib/media';

const NEW = '__new__';

export default function AccessRequests({ companies, reloadCompanies, onClose }: { companies: Company[]; reloadCompanies: () => void; onClose: () => void }) {
  const [rows, setRows] = useState<Profile[]>([]);
  const [filter, setFilter] = useState<Status | 'all'>('pending');
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    let q = supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error } = await q;
    if (error) setErr(error.message);
    setRows((data ?? []) as Profile[]);
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  return <div className="ovl">
    <div className="mbar"><button className="back" onClick={onClose}>‹ Back</button><b style={{ color: 'var(--txt)', fontSize: 15 }}>Access requests</b></div>
    <div className="mwrap">
      <div className="chips" style={{ marginTop: 0, marginBottom: 12 }}>
        {(['pending', 'approved', 'denied', 'all'] as const).map((f) =>
          <button key={f} className={'chip' + (filter === f ? ' on' : '')} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
      </div>
      {err && <div className="aerr">{err}</div>}
      {rows.length === 0 && <p className="sub">No {filter === 'all' ? '' : filter} requests.</p>}
      {rows.map((p) => <Row key={p.id} p={p} companies={companies} reloadCompanies={reloadCompanies} onChanged={load} />)}
    </div>
  </div>;
}

function Row({ p, companies, reloadCompanies, onChanged }: { p: Profile; companies: Company[]; reloadCompanies: () => void; onChanged: () => void }) {
  const guess = companies.find((c) => c.name.toLowerCase() === (p.requested_company ?? '').toLowerCase());
  const [role, setRole] = useState<Role>(p.role);
  const [co, setCo] = useState<string>(p.company_id ?? guess?.id ?? (p.requested_company && p.requested_role === 'customer' ? NEW : ''));
  const [newName, setNewName] = useState(p.requested_company ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  const save = async (status: Status) => {
    setErr(''); setBusy(true);
    try {
      let companyId: string | null = co && co !== NEW ? co : null;
      if (status === 'approved' && role === 'customer') {
        if (co === NEW) {
          if (!newName.trim()) throw new Error('Enter the new company name.');
          const { data, error } = await supabase.from('companies').insert({ name: newName.trim() }).select('id').single();
          if (error) throw error;
          companyId = data.id; reloadCompanies();
        }
        if (!companyId) throw new Error('Assign a company before approving a customer.');
      }
      if (role !== 'customer') companyId = null;
      const { error } = await supabase.from('profiles').update({ status, role, company_id: companyId }).eq('id', p.id);
      if (error) throw error;
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return <div className="rq">
    <span className={'pill ' + p.status}>{p.status}</span>
    <h4>{p.full_name || '(no name)'}</h4>
    <div className="m">Requested <b>{p.requested_role}</b>{p.requested_company ? ` · ${p.requested_company}` : ''}<br />
      <a className="lnk" href={`mailto:${p.email}`}>{p.email}</a>{p.phone ? ` · ${p.phone}` : ''}<br />{fmtTime(p.created_at)}</div>
    <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
      <option value="customer">Customer</option><option value="pilot">Pilot</option><option value="owner">Owner</option>
    </select>
    {role === 'customer' && <>
      <select value={co} onChange={(e) => setCo(e.target.value)} aria-label="Company">
        <option value="">Assign company…</option>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value={NEW}>+ New company…</option>
      </select>
      {co === NEW && <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New company name" />}
    </>}
    {err && <div className="aerr">{err}</div>}
    <div className="ebtn">
      <button className="eap" disabled={busy} onClick={() => save('approved')}>{p.status === 'approved' ? 'Save' : 'Approve'}</button>
      <button className="edn" disabled={busy} onClick={() => save('denied')}>{p.status === 'approved' ? 'Revoke' : 'Deny'}</button>
    </div>
  </div>;
}
