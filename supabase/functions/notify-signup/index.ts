// Supabase Edge Function: notify-signup
// Triggered by a Database Webhook on INSERT and UPDATE of public.profiles.
//  • INSERT → emails the owner about the new access request.
//  • UPDATE where status becomes 'approved' → emails the user that they can sign in.
//
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY   – required, from https://resend.com/api-keys
//   WEBHOOK_SECRET   – required, shared secret; the webhook must send header  x-webhook-secret: <value>
//   OWNER_EMAIL      – optional, default matt@gridviewuasservices.com
//   RESEND_FROM      – optional, default "GridView <onboarding@resend.dev>" (use a verified domain sender in production)
//   APP_URL          – optional, link to the app's Access requests screen

interface ProfileRecord {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  requested_role: string;
  requested_company: string | null;
  status: string;
  created_at: string;
}
interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: ProfileRecord | null;
  old_record: ProfileRecord | null;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = Deno.env.get('WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const apiKey = Deno.env.get('RESEND_API_KEY');

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  if (payload.table !== 'profiles' || !payload.record) return new Response('Ignored', { status: 200 });
  const r = payload.record;
  const owner = Deno.env.get('OWNER_EMAIL') ?? 'matt@gridviewuasservices.com';
  const from = Deno.env.get('RESEND_FROM') ?? 'GridView <onboarding@resend.dev>';
  const appUrl = Deno.env.get('APP_URL') ?? '';

  // UPDATE: tell the user when they've just been approved
  if (payload.type === 'UPDATE') {
    if (r.status !== 'approved' || payload.old_record?.status === 'approved' || !r.email) {
      return new Response('Ignored', { status: 200 });
    }
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;border:1px solid #e3e8ee;border-radius:12px;overflow:hidden">
      <div style="background:#053d63;padding:14px 16px;color:#ebb54a;font-weight:800;letter-spacing:.4px">GRIDVIEW UAS · ACCESS APPROVED</div>
      <div style="padding:16px;color:#1d2733;font-size:14px;line-height:1.5"><p>Hi ${esc(r.full_name || 'there')},</p>
      <p>Your GridView account has been approved. You can now sign in${appUrl ? ` at <a href="${esc(appUrl)}">${esc(appUrl)}</a>` : ''}.</p>
      <p style="color:#7a8592;font-size:12px">Questions? Reply to this email.</p></div></div>`;
    return await send(apiKey, { from, to: [r.email], reply_to: owner, subject: 'Your GridView access is approved', html });
  }
  if (payload.type !== 'INSERT') return new Response('Ignored', { status: 200 });
  const role = r.requested_role === 'pilot' ? 'Pilot' : 'Customer';

  const rows: [string, string][] = [
    ['Name', r.full_name],
    ['Role requested', role],
    ['Company', r.requested_company ?? '—'],
    ['Email', r.email],
    ['Phone', r.phone ?? '—'],
    ['Requested', new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET'],
  ];
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;border:1px solid #e3e8ee;border-radius:12px;overflow:hidden">
    <div style="background:#053d63;padding:14px 16px;color:#ebb54a;font-weight:800;letter-spacing:.4px">GRIDVIEW UAS · NEW ACCESS REQUEST</div>
    <div style="padding:16px;color:#1d2733;font-size:14px;line-height:1.5">
      <p><b>${esc(r.full_name)}</b> requested <b>${role}</b> access.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#6b7684;width:38%;border-bottom:1px solid #eef1f4">${esc(k)}</td><td style="padding:6px 0;border-bottom:1px solid #eef1f4">${esc(v)}</td></tr>`).join('')}
      </table>
      ${appUrl ? `<p style="margin-top:16px"><a href="${esc(appUrl)}" style="background:#ebb54a;color:#021f33;padding:11px 16px;border-radius:9px;font-weight:800;text-decoration:none;display:inline-block">Review in GridView</a></p>` : ''}
      <p style="color:#7a8592;font-size:12px">Approve or deny under Account → Access requests.</p>
    </div>
  </div>`;

  return await send(apiKey, {
    from,
    to: [owner],
    reply_to: r.email || undefined,
    subject: `GridView access request: ${r.full_name || r.email} (${role}${r.requested_company ? ', ' + r.requested_company : ''})`,
    html,
  });
});

async function send(apiKey: string | undefined, email: Record<string, unknown>): Promise<Response> {
  if (!apiKey) {
    // No Resend key yet: don't fail the webhook, just log what would have been sent.
    console.warn('RESEND_API_KEY not set; email skipped:', JSON.stringify({ to: email.to, subject: email.subject }));
    return new Response(JSON.stringify({ skipped: true, reason: 'RESEND_API_KEY not set' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(email),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error('Resend error', res.status, body);
    return new Response(`Resend error: ${body}`, { status: 502 });
  }
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}
