// Integration test for migrations + RLS + storage policies against a LOCAL Supabase (`supabase start`).
// Usage: SUPABASE_URL=http://127.0.0.1:54321 ANON_KEY=... SERVICE_KEY=... DB_URL=... node tests/rls.test.mjs
import { createClient } from '@supabase/supabase-js';
import { Upload } from 'tus-js-client';
import { execSync } from 'node:child_process';

const URL_ = process.env.SUPABASE_URL, ANON = process.env.ANON_KEY, DB = process.env.DB_URL;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sql = (q) => execSync(`psql "${DB}" -Atc ${JSON.stringify(q)}`).toString().trim();
const client = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const run = Date.now();
const em = (n) => `${n}-${run}@example.com`;

async function signup(name, meta) {
  const c = client();
  const { data, error } = await c.auth.signUp({ email: em(name), password: 'password123', options: { data: meta } });
  if (error) throw error;
  return { c, id: data.user.id };
}

console.log('Sign-up trigger');
const owner = await signup('matt', { full_name: 'Matt Brooks', requested_role: 'pilot', company: 'GridView UAS Services' });
const pilot = await signup('pilot', { full_name: 'Pat Pilot', requested_role: 'pilot', phone: '419-555-0100' });
const custA = await signup('dte', { full_name: 'Dana DTE', requested_role: 'customer', company: 'DTE Energy' });
const custB = await signup('cons', { full_name: 'Cory Consumers', requested_role: 'customer', company: 'Consumers Energy' });
const sneaky = await signup('sneaky', { full_name: 'Sneaky', requested_role: 'owner', company: 'Other Co' });
let { data: me } = await custA.c.from('profiles').select('*').single();
ok(me.status === 'pending' && me.role === 'customer' && me.requested_company === 'DTE Energy' && me.full_name === 'Dana DTE', 'profile created pending with metadata');
({ data: me } = await sneaky.c.from('profiles').select('*').single());
ok(me.role === 'customer', 'requesting role=owner at sign-up is downgraded to customer');
ok((await pilot.c.from('profiles').select('phone').single()).data.phone === '419-555-0100', 'phone stored');

console.log('Pending users');
const co = Object.fromEntries((await client().from('companies').select('id,name')).data.map((r) => [r.name, r.id]));
ok(Object.keys(co).length >= 4, 'anon can read company list');
let r = await pilot.c.from('photos').insert({ company_id: co['DTE Energy'], storage_path: 'x/pending.jpg', pilot_id: pilot.id });
ok(!!r.error, 'pending pilot cannot insert photo');
r = await pilot.c.storage.from('photos').upload(`${co['DTE Energy']}/pend.jpg`, new Blob(['x']), { contentType: 'image/jpeg' });
ok(!!r.error, 'pending pilot cannot upload to storage');
r = await custA.c.from('profiles').update({ status: 'approved', role: 'owner' }).eq('id', custA.id);
ok(!!r.error, 'user cannot self-approve / escalate role');
r = await custA.c.from('profiles').update({ full_name: 'Dana D.' }).eq('id', custA.id).select();
ok(!r.error && r.data[0]?.full_name === 'Dana D.', 'user can edit own name');
ok((await custA.c.from('profiles').select('id')).data.length === 1, 'pending customer sees only own profile');

console.log('Owner bootstrap (README SQL)');
sql(`update public.profiles set role='owner', status='approved' where email='${em('matt')}'`);
const O = owner.c;
ok((await O.from('profiles').select('id')).data.length >= 5, 'owner sees all profiles');
r = await O.from('profiles').update({ status: 'approved', role: 'customer' }).eq('id', custA.id);
ok(!!r.error, 'approving a customer without company is rejected (check constraint)');
r = await O.from('profiles').update({ status: 'approved', role: 'customer', company_id: co['DTE Energy'] }).eq('id', custA.id).select();
ok(!r.error && r.data[0].reviewed_by === owner.id && r.data[0].reviewed_at, 'owner approves customer A (DTE), reviewed_by set');
await O.from('profiles').update({ status: 'approved', role: 'customer', company_id: co['Consumers Energy'] }).eq('id', custB.id);
await O.from('profiles').update({ status: 'approved', role: 'pilot' }).eq('id', pilot.id);
r = await O.from('profiles').update({ status: 'denied' }).eq('id', sneaky.id);
ok(!r.error, 'owner denies a request');
r = await O.from('companies').insert({ name: 'Test Co ' + run }).select().single();
ok(!r.error, 'owner can create company');
r = await custA.c.from('companies').insert({ name: 'Hack ' + run });
ok(!!r.error, 'customer cannot create company');
r = await pilot.c.from('profiles').update({ role: 'owner' }).eq('id', pilot.id);
ok(!!r.error, 'approved pilot cannot self-promote');

console.log('Pilot uploads');
const P = pilot.c;
const dtePath = `${co['DTE Energy']}/${crypto.randomUUID()}.jpg`;
const consPath = `${co['Consumers Energy']}/${crypto.randomUUID()}.jpg`;
r = await P.storage.from('photos').upload(dtePath, new Blob(['jpegbytes']), { contentType: 'image/jpeg' });
ok(!r.error, 'pilot standard upload ok ' + (r.error?.message ?? ''));
// resumable TUS upload, same as the app
const { data: sess } = await P.auth.getSession();
await new Promise((res) => {
  const up = new Upload(Buffer.from('consumers-photo-bytes'), {
    endpoint: `${URL_}/storage/v1/upload/resumable`, chunkSize: 6 * 1024 * 1024, uploadDataDuringCreation: true,
    headers: { authorization: `Bearer ${sess.session.access_token}`, apikey: ANON, 'x-upsert': 'true' },
    metadata: { bucketName: 'photos', objectName: consPath, contentType: 'image/jpeg' },
    onError: (e) => { ok(false, 'TUS resumable upload: ' + e.message); res(); },
    onSuccess: () => { ok(true, 'pilot TUS resumable upload ok'); res(); },
  });
  up.start();
});
r = await P.from('photos').insert([
  { company_id: co['DTE Energy'], storage_path: dtePath, territory: 'Bedford Twp', circuit: 'Cir. 12', issue: 'Cracked insulator', severity: 'medium', lat: 41.77, lng: -83.6, taken_at: new Date().toISOString(), pilot_id: pilot.id },
  { company_id: co['Consumers Energy'], storage_path: consPath, territory: 'Jackson', circuit: 'Cir. 3', severity: 'high', pilot_id: pilot.id },
]).select();
ok(!r.error && r.data.length === 2, 'pilot inserts photo rows');
ok(r.data?.[1]?.has_gps === false && r.data?.[0]?.has_gps === true, 'has_gps computed (no-GPS photo flagged)');
r = await P.from('photos').insert({ company_id: co['DTE Energy'], storage_path: 'z/' + run, pilot_id: owner.id });
ok(!!r.error, 'pilot cannot insert photo attributed to someone else');
r = await custA.c.from('photos').insert({ company_id: co['DTE Energy'], storage_path: 'y/' + run, pilot_id: custA.id });
ok(!!r.error, 'customer cannot insert photo');
r = await custA.c.storage.from('photos').upload(`${co['DTE Energy']}/c.jpg`, new Blob(['x']));
ok(!!r.error, 'customer cannot upload to storage');

console.log('Customer scoping');
let rows = (await custA.c.from('photos').select('*')).data;
ok(rows.length >= 1 && rows.every((p) => p.company_id === co['DTE Energy']), `customer A sees only DTE photos (${rows.length})`);
rows = (await custB.c.from('photos').select('*')).data;
ok(rows.length >= 1 && rows.every((p) => p.company_id === co['Consumers Energy']), `customer B sees only Consumers photos (${rows.length})`);
r = await custA.c.storage.from('photos').createSignedUrl(dtePath, 60);
ok(!r.error, 'customer A can sign URL for own company photo');
r = await custA.c.storage.from('photos').createSignedUrl(consPath, 60);
ok(!!r.error, 'customer A cannot sign URL for other company photo');
r = await custA.c.storage.from('photos').download(consPath);
ok(!!r.error, 'customer A cannot download other company photo');
const tv = (await custA.c.rpc('photo_tag_values', { p_company: null })).data;
ok(tv.every((t) => t.value !== 'Jackson'), 'type-ahead values scoped by RLS');
const pn = (await custA.c.rpc('pilot_names', { ids: [pilot.id] })).data;
ok(pn?.[0]?.full_name === 'Pat Pilot', 'customer can see pilot name for pin sheet');
ok((await custA.c.from('profiles').select('id')).data.length === 1, 'customer cannot list other profiles');
ok((await sneaky.c.from('photos').select('id')).data.length === 0, 'denied user sees no photos');
ok((await client().from('photos').select('id')).data?.length === 0, 'anon sees no photos');
rows = (await P.from('photos').select('id')).data;
ok(rows.length >= 2, 'pilot sees all companies');

console.log('Photo editing');
const pilot2 = await signup('pilot2', { full_name: 'Pia Pilot', requested_role: 'pilot' });
await O.from('profiles').update({ status: 'approved', role: 'pilot' }).eq('id', pilot2.id);
const P2 = pilot2.c;
const dteRow = (await P.from('photos').select('*').eq('storage_path', dtePath).single()).data;
r = await P.from('photos').update({ circuit: 'Cir. 99', lat: 41.8, lng: -83.5 }).eq('id', dteRow.id).select();
ok(!r.error && r.data[0]?.circuit === 'Cir. 99' && r.data[0]?.has_gps, 'pilot edits own photo (circuit + GPS)');
r = await P2.from('photos').update({ circuit: 'hack' }).eq('id', dteRow.id).select();
ok(!r.error && r.data.length === 0, "pilot cannot edit another pilot's photo");
r = await custA.c.from('photos').update({ circuit: 'hack' }).eq('id', dteRow.id).select();
ok(!r.error && r.data.length === 0, 'customer cannot edit photos');
r = await P.from('photos').update({ pilot_id: pilot2.id }).eq('id', dteRow.id);
ok(!!r.error, 'uploader (pilot_id) is immutable');
r = await P.from('photos').update({ created_at: '2020-01-01T00:00:00Z' }).eq('id', dteRow.id);
ok(!!r.error, 'created_at is immutable');
r = await O.from('photos').update({ storage_path: 'x/y.jpg' }).eq('id', dteRow.id);
ok(!!r.error, 'storage_path immutable even for owner');
r = await O.from('photos').update({ severity: 'high' }).eq('id', dteRow.id).select();
ok(!r.error && r.data[0]?.severity === 'high', 'owner edits any photo');
// bulk move to another company → access follows the row
r = await P.from('photos').update({ company_id: co['Consumers Energy'], territory: 'Moved' }).in('id', [dteRow.id]).select('id');
ok(!r.error && r.data.length === 1, 'pilot bulk-moves own photo to another company');
ok((await custA.c.storage.from('photos').createSignedUrl(dtePath, 60)).error, 'old company customer loses file access after move');
ok(!(await custB.c.storage.from('photos').createSignedUrl(dtePath, 60)).error, 'new company customer gains file access after move');
ok((await custB.c.from('photos').select('id').eq('id', dteRow.id)).data.length === 1, 'new company customer sees moved row');
// deletes
r = await P2.storage.from('photos').remove([dtePath]);
ok(r.data?.length === 0, "pilot cannot delete another pilot's file");
r = await P2.from('photos').delete().eq('id', dteRow.id).select();
ok(r.data?.length === 0, "pilot cannot delete another pilot's row");
r = await custB.c.from('photos').delete().eq('id', dteRow.id).select();
ok(r.data?.length === 0, 'customer cannot delete photos');
r = await P.storage.from('photos').remove([dtePath]);
ok(r.data?.length === 1, 'pilot deletes own file');
r = await P.from('photos').delete().eq('id', dteRow.id).select();
ok(r.data?.length === 1, 'pilot deletes own row');
const consRow = (await O.from('photos').select('*').eq('storage_path', consPath).single()).data;
r = await O.storage.from('photos').remove([consPath]);
ok(r.data?.length === 1, "owner deletes another pilot's file");
r = await O.from('photos').delete().eq('id', consRow.id).select();
ok(r.data?.length === 1, "owner deletes another pilot's row");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
