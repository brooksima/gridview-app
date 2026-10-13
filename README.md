# GridView UAS Services: inspection app (MVP)

**Live:** https://brooksima.github.io/gridview-app/ · Supabase project `gridview` (ref `gxpxidiinkjhnmnlhase`, us-east-1, free plan)

Installable PWA for GridView drone distribution inspections. Pilots upload geotagged photos, and utility customers view them on a satellite map scoped to their company.

**Stack:** Vite + React + TypeScript PWA · Supabase (Auth, Postgres + RLS, Storage, Edge Functions) · Leaflet + Esri World Imagery + markercluster · exifr (GPS/time) · tus-js-client (resumable uploads) · Resend (email).
Everything runs on free tiers. The frontend is a static site.

```
src/                     React app (AuthScreens, MapView, UploadView, AccessRequests)
supabase/migrations/     SQL schema, RLS, storage bucket + policies, signup trigger
supabase/functions/notify-signup/   Edge Function: emails owner on sign-up, emails user on approval
supabase/webhook.sql     (alternative to the dashboard) creates the database webhook
tests/rls.test.mjs       Integration test for RLS/storage against local Supabase
```

## Roles and rules
| Role | Can do |
|---|---|
| **owner** | Everything. Approves or denies access requests, assigns customers to a company, creates companies, and sees all photos. Owners can also upload. |
| **pilot** | Upload photos for any company, see all photos, edit or delete their own photo rows. |
| **customer** | Read-only access to photos (and files) of **their assigned company**. |

New sign-ups start as `pending`. Pending and denied users can sign in but only see a waiting or not-approved message. The sign-up form can request `pilot` or `customer`. `owner` is never granted from the form.

---

## 1. Create the Supabase project (free)
1. Go to https://supabase.com, then **New project**. Name it `gridview`, choose a region near Michigan (e.g. *East US (N. Virginia)*), and save the DB password.
2. **Project Settings → API**: copy the **Project URL** and the **anon public** key. Treat the **service_role** key as a secret and never put it in the frontend.
3. **Authentication → URL Configuration**
   - Site URL: `https://app.gridviewuasservices.com`
   - Redirect URLs: add `https://app.gridviewuasservices.com/**` and `http://localhost:5173/**`
4. **Authentication → Sign In / Providers → Email**: keep **Confirm email** ON (recommended).
   *Optional:* Supabase's built-in mailer is rate-limited (a few emails/hour). For production, set **Authentication → Emails → SMTP Settings** to Resend SMTP (`smtp.resend.com`, port 465, user `resend`, password = your Resend API key, sender `no-reply@gridviewuasservices.com`).

## 2. Run the migration
**Option A: CLI (recommended)**
```bash
npm i                                  # installs the supabase CLI via npx on demand
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push                   # applies supabase/migrations/*.sql
```
**Option B: Dashboard.** Open **SQL Editor**, paste all of `supabase/migrations/20261013000000_init.sql`, and click **Run**.

This creates the enums, the `companies` table (seeded with DTE Energy, Consumers Energy, Toledo Edison (FirstEnergy), and Hancock-Wood Electric Co-op), `profiles`, `photos`, the RLS policies, the private `photos` storage bucket and its policies, and the trigger that creates a profile on each sign-up.

## 3. Make Matt the first owner
**Automatic:** migration `20261013180000_owner_bootstrap.sql` promotes `matt@gridviewuasservices.com` to owner + approved as soon as that address is **confirmed**, so nobody else can claim it. Just sign up and click the confirmation link.

Manual fallback, if needed:
1. Open the app (step 6, or `npm run dev`) and use **Request access**. Sign up with **matt@gridviewuasservices.com**, then confirm the email.
2. In the **SQL Editor**, run:
```sql
update public.profiles
set role = 'owner', status = 'approved', company_id = null
where email = 'matt@gridviewuasservices.com';
```
3. Sign in through **Pilot sign in**. The account menu (initials, top right) now shows **Access requests**.

## 4. Deploy the email Edge Function
1. Create a free Resend account at https://resend.com.
   - **Domains → Add domain** `gridviewuasservices.com` and add the DNS records it shows (SPF/DKIM). Until the domain is verified, Resend's test sender `onboarding@resend.dev` only delivers to the address that owns the Resend account.
   - **API Keys → Create**: this is your `RESEND_API_KEY`.
2. Set the secrets and deploy:
```bash
npx supabase secrets set \
  RESEND_API_KEY=re_xxxxxxxx \
  WEBHOOK_SECRET=$(openssl rand -hex 24) \
  OWNER_EMAIL=matt@gridviewuasservices.com \
  RESEND_FROM="GridView <notify@gridviewuasservices.com>" \
  APP_URL=https://app.gridviewuasservices.com
npx supabase functions deploy notify-signup --no-verify-jwt
npx supabase secrets list   # note the WEBHOOK_SECRET value you generated (keep a copy)
```
| Secret | Required | Purpose |
|---|---|---|
| `RESEND_API_KEY` | yes | Resend API key used to send the emails |
| `WEBHOOK_SECRET` | yes | Shared secret. The webhook must send it in the `x-webhook-secret` header, and other callers get a 401. |
| `OWNER_EMAIL` | no | Defaults to `matt@gridviewuasservices.com` |
| `RESEND_FROM` | no | Defaults to `GridView <onboarding@resend.dev>`. Use a sender on your verified domain. |
| `APP_URL` | no | Link included in the emails |

3. Create the **database webhook** (profiles → function):
   - **Dashboard:** **Database → Webhooks → Enable**, then **Create a new hook**. Name `notify_signup`, table `public.profiles`, events **Insert** and **Update**, type **Supabase Edge Functions**, function `notify-signup`, method POST, timeout 5000. Add the HTTP header `x-webhook-secret: <your WEBHOOK_SECRET>`.
   - **or SQL (what the live project uses):** edit the two placeholders in `supabase/webhook.sql` and run it in the SQL Editor. It uses `pg_net` directly, and a webhook failure never blocks sign-up.

   Without `RESEND_API_KEY`, the function logs "email skipped" and returns 200, so sign-up works before Resend is set up. To enable email later, run `npx supabase secrets set RESEND_API_KEY=re_... RESEND_FROM="GridView <notify@gridviewuasservices.com>"`. No redeploy is needed.

   After that, each new sign-up emails Matt, and each approval emails the user. (The UPDATE event fires on status changes. The function ignores everything except a change to `approved`.)

## 5. Frontend env vars
```bash
cp .env.example .env
# edit .env:
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...   # anon public key (safe in the browser; RLS enforces access)
```

## 6. Build and deploy
```bash
npm ci
npm run typecheck
npm run build        # outputs dist/ (static files + service worker + manifest)
npm run preview      # local check at http://localhost:4173
```
**GitHub Pages (current):** `./deploy/deploy-gh-pages.sh` builds locally and force-pushes `dist/` to the `gh-pages` branch, which Pages serves. (An Actions version is in `deploy/github-pages-workflow.yml`. Move it to `.github/workflows/` once gh has the `workflow` scope; it builds on every push to `main` with `BASE_PATH=/gridview-app/`, using the repo **Variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. It copies `index.html` to `404.html` as the SPA fallback.
For a custom domain served at `/`, set `BASE_PATH=/`, add the domain under repo Settings → Pages, and update the Supabase Site URL and redirect URLs.

Host `dist/` on any static host and point `app.gridviewuasservices.com` at it with a CNAME. Configure an SPA fallback so unknown paths serve `index.html`. Free options:
- **Cloudflare Pages:** build command `npm run build`, output `dist`, env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Add a custom domain.
- **Netlify:** the same settings. **GitHub Pages:** also works; use a custom domain so the app is served at `/`.
HTTPS is required for PWA install, the service worker, and camera roll access.

After deploying, add the final URL to Supabase **Auth → URL Configuration** (step 1.3).

## Local development with a local Supabase (Docker)
```bash
npx supabase start                    # applies migrations into a local stack
npx supabase status -o env            # gives API_URL, ANON_KEY, DB_URL
echo "VITE_SUPABASE_URL=http://127.0.0.1:54321" >  .env.local
echo "VITE_SUPABASE_ANON_KEY=<ANON_KEY>"          >> .env.local
npm run dev
# RLS/storage integration tests (needs psql and Node 22+):
SUPABASE_URL=http://127.0.0.1:54321 ANON_KEY=... DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:rls
# Edge function locally:
npx supabase functions serve notify-signup --env-file ./supabase/.env.local
```

## Notes and limits
- **Uploads:** originals use Supabase's resumable (TUS, 6 MB chunk) endpoint with retries and a screen wake lock. Two files upload at a time. If the connection drops, uploads retry automatically. If the tab is closed, re-select the same files and press Upload: they resume from the last chunk via the stored fingerprint. Browsers do not keep uploading after the PWA is fully closed (iOS has no Background Fetch for web apps).
- **EXIF:** GPS and `DateTimeOriginal` are read on the device. Photos without GPS upload but are flagged and stay off the map. A (0,0) fix is treated as no GPS.
- **Thumbnails:** 480 px JPEGs are generated in the browser. HEIC/RAW files that the browser can't decode upload without a thumbnail, and the detail sheet then uses the original.
- **Storage limits:** the free tier includes 1 GB of storage. A drone photo is about 5–10 MB, so that is roughly 100–200 photos. Supabase Pro ($25/mo, 100 GB) is the next step. The bucket's per-file limit is 100 MB, and the project's global upload limit (Storage settings, default 50 MB on Free) also applies.
- **Map:** loads up to 20,000 photo rows client-side. Beyond that, add server-side filtering.
- **Paused projects:** free Supabase projects pause after 1 week with no activity.
