import { LOGO, APP_URL, WEBSITE_URL, WEBSITE_LABEL } from '../lib/base';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { SIGNUP_COMPANIES } from '../lib/types';

export const SENT_KEY = 'gv_signup_sent';
type Scr = 'welcome' | 'pilot' | 'customer' | 'signup' | 'sent' | 'forgot';

export default function AuthScreens() {
  const initialSent = sessionStorage.getItem(SENT_KEY) ?? '';
  const [scr, setScr] = useState<Scr>(initialSent ? 'sent' : 'welcome');
  const [sentTo, setSentTo] = useState(initialSent);
  return <div className="auth on">
    {scr === 'welcome' && <div className="ascr on">
      <a className="webback" href={WEBSITE_URL}>‹ Back to website</a>
      <a className="wlogo" href={WEBSITE_URL} title="GridView UAS Services website" style={{ display: 'block' }}><img src={LOGO} alt="GridView UAS Services LLC" /></a>
      <div className="wtag">See it before it fails.</div>
      <div className="wsub">Drone inspections for electric distribution · Temperance, MI</div>
      <button className="ab gold" onClick={() => setScr('pilot')}>Pilot sign in</button>
      <button className="ab line" onClick={() => setScr('customer')}>Customer sign in</button>
      <div className="asmall" style={{ marginTop: 14, fontSize: 13.5, color: 'var(--txt)' }}>
        New to GridView? <a href="#" className="lnk" onClick={(e) => { e.preventDefault(); setScr('signup'); }}>Request access / Sign up</a></div>
      <div className="asmall" style={{ marginTop: 18 }}><a className="lnk" href={WEBSITE_URL}>🌐 {WEBSITE_LABEL}</a></div>
      <div className="asmall">Customers are utilities — e.g. DTE, Consumers Energy, Toledo Edison and electric co-ops.</div>
    </div>}
    {(scr === 'pilot' || scr === 'customer') && <SignIn kind={scr} back={() => setScr('welcome')} forgot={() => setScr('forgot')} signup={() => setScr('signup')} />}
    {scr === 'forgot' && <Forgot back={() => setScr('welcome')} />}
    {scr === 'signup' && <SignUp back={() => setScr('welcome')} done={(em) => { setSentTo(em); setScr('sent'); }} />}
    {scr === 'sent' && <div className="ascr on">
      <div className="pendI">✅</div>
      <h2 style={{ textAlign: 'center', fontSize: 23 }}>Request sent</h2>
      <p className="pendT">GridView will review your request and email you once you're approved.</p>
      <p className="pendT">If asked, confirm your email using the link we sent to <b>{sentTo}</b>.</p>
      <button className="ab line" onClick={() => { sessionStorage.removeItem(SENT_KEY); setScr('welcome'); }}>Back to sign in</button>
    </div>}
  </div>;
}

function Head({ title, sub, back }: { title: string; sub: string; back: () => void }) {
  return <>
    <button type="button" className="back" onClick={back}>‹ Back</button>
    <div className="ahl"><img src={LOGO} alt="" /><div><h2>{title}</h2><small>{sub}</small></div></div>
  </>;
}

function SignIn({ kind, back, forgot, signup }: { kind: 'pilot' | 'customer'; back: () => void; forgot: () => void; signup: () => void }) {
  const [em, setEm] = useState(''); const [pw, setPw] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return <form className="ascr on" onSubmit={async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: em.trim(), password: pw });
    setBusy(false);
    if (error) setErr(error.message === 'Email not confirmed' ? 'Please confirm your email first — check your inbox for the link.' : 'Incorrect email or password.');
  }}>
    <Head title={kind === 'pilot' ? 'Pilot sign in' : 'Customer sign in'} sub={kind === 'pilot' ? 'GridView flight crew' : 'Utility inspection portal'} back={back} />
    <div className="fld"><label htmlFor="em">Email</label><input id="em" type="email" required value={em} onChange={(e) => setEm(e.target.value)}
      placeholder={kind === 'pilot' ? 'you@gridviewuasservices.com' : 'you@yourutility.com'} autoComplete="username" /></div>
    <div className="fld"><label htmlFor="pw">Password</label><input id="pw" type="password" required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoComplete="current-password" /></div>
    <div className="arow"><span /><a href="#" onClick={(e) => { e.preventDefault(); forgot(); }}>Forgot password?</a></div>
    {err && <div className="aerr">{err}</div>}
    <button className="ab gold" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    <div className="asmall">No account? <a href="#" className="lnk" onClick={(e) => { e.preventDefault(); signup(); }}>Request access</a></div>
  </form>;
}

function Forgot({ back }: { back: () => void }) {
  const [em, setEm] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  return <form className="ascr on" onSubmit={async (e) => {
    e.preventDefault(); setErr('');
    const { error } = await supabase.auth.resetPasswordForEmail(em.trim(), { redirectTo: APP_URL });
    if (error) setErr(error.message); else setMsg('If that email has an account, a reset link is on its way.');
  }}>
    <Head title="Reset password" sub="We'll email you a link" back={back} />
    <div className="fld"><label>Email</label><input type="email" required value={em} onChange={(e) => setEm(e.target.value)} autoComplete="username" /></div>
    {err && <div className="aerr">{err}</div>}{msg && <div className="okmsg">{msg}</div>}
    <button className="ab gold">Send reset link</button>
  </form>;
}

function SignUp({ back, done }: { back: () => void; done: (email: string) => void }) {
  const [role, setRole] = useState<'pilot' | 'customer'>('customer');
  const [name, setName] = useState(''); const [co, setCo] = useState(''); const [coOther, setCoOther] = useState('');
  const [em, setEm] = useState(''); const [ph, setPh] = useState(''); const [pw, setPw] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return <form className="ascr on" onSubmit={async (e) => {
    e.preventDefault(); setErr('');
    const company = role === 'pilot' ? 'GridView UAS Services' : co === 'Other' ? coOther.trim() : co;
    if (!name.trim()) return setErr('Please enter your full name.');
    if (role === 'customer' && !company) return setErr('Please choose your company.');
    if (pw.length < 8) return setErr('Password must be at least 8 characters.');
    setBusy(true);
    // the "request sent" screen must survive the auth-state flicker if Supabase auto-signs-in
    sessionStorage.setItem(SENT_KEY, em.trim());
    const { data, error } = await supabase.auth.signUp({
      email: em.trim(), password: pw,
      options: { emailRedirectTo: APP_URL, data: { full_name: name.trim(), requested_role: role, company, phone: ph.trim() } },
    });
    setBusy(false);
    if (error) { sessionStorage.removeItem(SENT_KEY); return setErr(error.message); }
    // If email confirmation is off, Supabase signs the user in — sign out so they see the "request sent" message.
    if (data.session) await supabase.auth.signOut();
    done(em.trim());
  }}>
    <Head title="Request access" sub="GridView approves every account" back={back} />
    <div className="fld"><label>I am a <i>*</i></label>
      <div className="rolepick">
        <label><input type="radio" name="role" checked={role === 'customer'} onChange={() => setRole('customer')} /><span>Customer (utility)</span></label>
        <label><input type="radio" name="role" checked={role === 'pilot'} onChange={() => setRole('pilot')} /><span>Pilot</span></label>
      </div></div>
    <div className="fld"><label htmlFor="sName">Full name <i>*</i></label><input id="sName" required value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" autoComplete="name" /></div>
    {role === 'customer' && <div className="fld"><label htmlFor="sCo">Company <i>*</i></label>
      <select id="sCo" required value={co} onChange={(e) => setCo(e.target.value)}>
        <option value="" disabled>Select your company</option>
        {SIGNUP_COMPANIES.map((c) => <option key={c}>{c}</option>)}
      </select>
      {co === 'Other' && <input required style={{ marginTop: 8 }} value={coOther} onChange={(e) => setCoOther(e.target.value)} placeholder="Company name" />}
    </div>}
    <div className="fld"><label htmlFor="sEm">Work email <i>*</i></label><input id="sEm" type="email" required value={em} onChange={(e) => setEm(e.target.value)} placeholder="you@company.com" autoComplete="email" /></div>
    <div className="fld"><label htmlFor="sPh">Phone <small>(optional)</small></label><input id="sPh" type="tel" value={ph} onChange={(e) => setPh(e.target.value)} placeholder="(419) 555-0100" autoComplete="tel" /></div>
    <div className="fld"><label htmlFor="sPw">Password <i>*</i></label><input id="sPw" type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Create a password (8+ characters)" autoComplete="new-password" /></div>
    {err && <div className="aerr">{err}</div>}
    <button className="ab gold" disabled={busy}>{busy ? 'Sending…' : 'Request access'}</button>
    <div className="fine">Your request goes to GridView (matt@gridviewuasservices.com) for approval.</div>
  </form>;
}
