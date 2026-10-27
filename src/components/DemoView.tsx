import { useEffect, useState } from 'react';
import { BASE, LOGO, WEBSITE_URL } from '../lib/base';
import { demoClient } from '../lib/supabase';
import type { Company, Profile } from '../lib/types';
import { SEV_COLOR } from '../lib/types';
import MapView from './MapView';

// Read-only viewer identity for the shared map component (no edit/upload/admin paths are reachable).
const VIEWER: Profile = {
  id: 'demo-viewer', email: 'demo@gridviewuasservices.com', full_name: 'Demo viewer', phone: null,
  requested_role: 'customer', requested_company: null, role: 'customer', status: 'approved',
  company_id: null, reviewed_at: null, created_at: new Date(0).toISOString(),
};
const INTRO_KEY = 'gv_demo_intro_seen';

/** Public, no-login demo: anonymous client, Demo-company data only (enforced by RLS). */
export default function DemoView() {
  const db = demoClient();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [intro, setIntro] = useState(() => !sessionStorage.getItem(INTRO_KEY));

  useEffect(() => {
    document.title = 'GridView Live Demo · Pole inspection map';
    db.from('companies').select('id,name').then(({ data }) =>
      setCompanies((data ?? []).map((c) => (c.name === 'Demo' ? { ...c, name: 'Sample utility (demo data)' } : c))));
  }, [db]);

  const closeIntro = () => { sessionStorage.setItem(INTRO_KEY, '1'); setIntro(false); };

  return <div className="app demo">
    <header className="hdr dhdr">
      <div className="hrow">
        <a className="logo" href={WEBSITE_URL} title="GridView UAS Services website"><img src={LOGO} alt="GridView UAS Services LLC" /></a>
        <div className="tag">SEE IT BEFORE<br />IT FAILS.</div>
        <a className="dlogin" href={BASE}>Customer Login</a>
      </div>
      <div className="dbanner" role="status"><span className="livedot" />Live Demo: sample data<span className="dro">Read-only</span></div>
    </header>
    <div className="view on">
      <MapView profile={VIEWER} companies={companies} db={db} demo />
      {intro && <div className="dintro" role="dialog" aria-label="About this demo">
        <b>Welcome to the GridView live demo</b>
        <p>Real drone photos of distribution poles from a sample inspection. Tap a pin or cluster to see the photo and the finding.</p>
        <div className="dleg">
          {(['high', 'medium', 'low', 'none'] as const).map((k) => <span key={k}><i style={{ background: SEV_COLOR[k] }} />{k === 'none' ? 'No issue' : k[0].toUpperCase() + k.slice(1)}</span>)}
        </div>
        <button className="btn p" onClick={closeIntro}>Explore the map</button>
      </div>}
    </div>
  </div>;
}
