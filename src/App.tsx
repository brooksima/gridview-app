import { LOGO } from './lib/base';
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configured } from './lib/supabase';
import type { Company, Profile } from './lib/types';
import AuthScreens, { SENT_KEY } from './components/AuthScreens';
import MapView from './components/MapView';
import UploadView from './components/UploadView';
import AccessRequests from './components/AccessRequests';
import MyUploads from './components/MyUploads';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileErr, setProfileErr] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((ev, s) => {
      if (ev === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadCompanies = useCallback(async () => {
    const { data } = await supabase.from('companies').select('id,name').order('name');
    setCompanies(data ?? []);
  }, []);

  const loadProfile = useCallback(async () => {
    if (!session) { setProfile(null); return; }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (error) setProfileErr(error.message);
    setProfile(data as Profile | null);
  }, [session]);

  useEffect(() => { loadProfile(); loadCompanies(); }, [loadProfile, loadCompanies]);

  if (!configured) {
    return <div className="app"><div className="auth on"><div className="ascr on"><div className="wlogo"><img src={LOGO} alt="GridView" /></div>
      <div className="aerr">App not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see README).</div></div></div></div>;
  }
  if (!ready) return <div className="app"><div className="spin">Loading…</div></div>;

  if (recovery && session) return <div className="app"><NewPassword onDone={() => setRecovery(false)} /></div>;

  if (!session || sessionStorage.getItem(SENT_KEY)) return <div className="app"><AuthScreens /></div>;

  if (!profile) {
    return <div className="app"><div className="auth on"><div className="ascr on">
      <div className="pendI">⏳</div>
      <p className="pendT">{profileErr || 'Loading your account…'}</p>
      <button className="ab line" onClick={() => supabase.auth.signOut()}>Sign out</button></div></div></div>;
  }
  if (profile.status !== 'approved') {
    const denied = profile.status === 'denied';
    return <div className="app"><div className="auth on"><div className="ascr on">
      <div className="wlogo" style={{ marginTop: 20 }}><img src={LOGO} alt="GridView" style={{ height: 90 }} /></div>
      <div className="pendI">{denied ? '⛔' : '⏳'}</div>
      <h2 style={{ textAlign: 'center', fontSize: 23 }}>{denied ? 'Access not approved' : 'Awaiting approval'}</h2>
      <p className="pendT">{denied
        ? <>Your request for GridView access was not approved. If you think this is a mistake, contact <a className="lnk" href="mailto:matt@gridviewuasservices.com">matt@gridviewuasservices.com</a>.</>
        : <>Thanks, {profile.full_name || profile.email}. GridView will review your request and email you once you're approved.</>}</p>
      {!denied && <button className="ab line" onClick={loadProfile}>Check again</button>}
      <button className="ab line" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div></div></div>;
  }
  return <Main profile={profile} companies={companies} reloadCompanies={loadCompanies} />;
}

function NewPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return <div className="auth on"><form className="ascr on" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false); if (error) setErr(error.message); else onDone();
  }}>
    <div className="ahl"><img src={LOGO} alt="" /><div><h2>Set new password</h2></div></div>
    <div className="fld"><label>New password</label><input type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
    {err && <div className="aerr">{err}</div>}
    <button className="ab gold" disabled={busy}>Save password</button>
  </form></div>;
}

function Main({ profile, companies, reloadCompanies }: { profile: Profile; companies: Company[]; reloadCompanies: () => void }) {
  const staff = profile.role !== 'customer';
  const [tab, setTab] = useState<'map' | 'upload'>('map');
  const [menu, setMenu] = useState(false);
  const [requests, setRequests] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [mapKey, setMapKey] = useState(0);
  const [uploads, setUploads] = useState<string[] | null>(null);
  const myCo = companies.find((c) => c.id === profile.company_id);
  const initials = (profile.full_name || profile.email).split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  useEffect(() => {
    if (profile.role !== 'owner') return;
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      .then(({ count }) => setPendingCount(count ?? 0));
  }, [profile.role, requests]);

  return <div className="app">
    <header className="hdr">
      <div className="hrow">
        <div className="logo"><img src={LOGO} alt="GridView UAS Services LLC" /></div>
        <div className="tag">SEE IT BEFORE<br />IT FAILS.</div>
        <span className="role" style={{ marginLeft: 'auto' }}>{profile.role}</span>
        <button className="av" onClick={() => setMenu(!menu)} aria-label="Account menu">{initials}</button>
      </div>
      {!staff && myCo && <div className="orgrow"><div className="orgb">{myCo.name}</div></div>}
      {staff && <div className="seg">
        <button className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>Map</button>
        <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>Upload</button>
      </div>}
      <div className={'menu' + (menu ? ' on' : '')} style={{ top: 'calc(100% - 4px)' }}>
        <div className="mh"><b>{profile.full_name || profile.email}</b><small>{profile.email}</small></div>
        {profile.role === 'owner' && <button className="mi" onClick={() => { setRequests(true); setMenu(false); }}>
          Access requests {pendingCount > 0 && <span className="cntb">{pendingCount}</span>}</button>}
 {staff && <button className="mi" onClick={() => { setUploads([]); setMenu(false); }}>{profile.role === 'owner' ? 'All uploads (bulk edit)' : 'My uploads (bulk edit)'}</button>}
        <button className="mi so" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </header>
    <div className="view on" onClick={() => menu && setMenu(false)}>
      {tab === 'map' || !staff
        ? <MapView key={mapKey} profile={profile} companies={companies} />
        : <UploadView profile={profile} companies={companies} onUploaded={() => setMapKey((k) => k + 1)} onFixBatch={(ids) => setUploads(ids)} />}
    </div>
    {uploads && <MyUploads profile={profile} companies={companies} preselect={uploads} onClose={() => setUploads(null)} onChanged={() => setMapKey((k) => k + 1)} />}
    {requests && <AccessRequests companies={companies} reloadCompanies={reloadCompanies} onClose={() => setRequests(false)} />}
  </div>;
}
