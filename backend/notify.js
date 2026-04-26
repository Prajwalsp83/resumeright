// Email notification helper — wraps AWS SES v2.
// Fail-soft: every send is wrapped in try/catch and never throws upstream.
// Callers should NOT await for correctness — fire-and-forget. We still return
// the promise so tests / metrics can observe it if needed.

const env = require('./config');

let sesClient = null;
let SendEmailCommand = null;
let sesEnabled = false;

try {
  // Lazy require — keeps the module optional. If the SDK isn't installed yet
  // (e.g. fresh checkout before npm i), the rest of the API still boots.
  const sdk = require('@aws-sdk/client-sesv2');
  sesClient = new sdk.SESv2Client({ region: env.AWS_REGION });
  SendEmailCommand = sdk.SendEmailCommand;
  sesEnabled = !!(env.SES_FROM && env.SES_TO);
  if (env.NODE_ENV === 'production' && !sesEnabled) {
    console.warn('⚠️  SES not configured — set SES_FROM and SES_TO to enable email alerts.');
  }
} catch (e) {
  console.warn('⚠️  @aws-sdk/client-sesv2 not installed — email alerts disabled.');
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendEmail({ subject, html, text }) {
  if (!sesEnabled) return { ok: false, reason: 'disabled' };
  try {
    await sesClient.send(new SendEmailCommand({
      FromEmailAddress: env.SES_FROM,
      Destination: { ToAddresses: [env.SES_TO] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: html ? { Data: html, Charset: 'UTF-8' } : undefined,
            Text: text ? { Data: text, Charset: 'UTF-8' } : undefined,
          },
        },
      },
    }));
    return { ok: true };
  } catch (e) {
    console.error('[ses:send]', e.message || e);
    return { ok: false, reason: e.message };
  }
}

// Convenience helper specifically for abandoned-lead alerts.
function notifyAbandonedLead(lead) {
  const name    = escapeHtml(lead.name    || '(no name)');
  const phone   = escapeHtml(lead.phone   || '(no phone)');
  const email   = escapeHtml(lead.email   || '(no email)');
  const service = escapeHtml(lead.service || '');
  const fields  = Array.isArray(lead.fieldsFilled) ? lead.fieldsFilled.join(', ') : '';

  const subject = `[ResumeRight] Abandoned lead — ${lead.name || lead.phone || 'unknown'}`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#111;">
      <h2 style="color:#E8A020;margin:0 0 6px;">⚠️ Abandoned lead</h2>
      <p style="color:#555;margin:0 0 18px;">A visitor filled the lead form but did not submit. Reach out fast.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 8px;background:#f6f6f6;width:120px;">Name</td><td style="padding:6px 8px;"><strong>${name}</strong></td></tr>
        <tr><td style="padding:6px 8px;background:#f6f6f6;">Phone</td><td style="padding:6px 8px;"><a href="tel:${phone}">${phone}</a> · <a href="https://wa.me/${phone.replace(/\D/g,'')}">WhatsApp</a></td></tr>
        <tr><td style="padding:6px 8px;background:#f6f6f6;">Email</td><td style="padding:6px 8px;"><a href="mailto:${email}">${email}</a></td></tr>
        <tr><td style="padding:6px 8px;background:#f6f6f6;">Interest</td><td style="padding:6px 8px;">${service || '—'}</td></tr>
        <tr><td style="padding:6px 8px;background:#f6f6f6;">Fields filled</td><td style="padding:6px 8px;">${escapeHtml(fields) || '—'}</td></tr>
        <tr><td style="padding:6px 8px;background:#f6f6f6;">When</td><td style="padding:6px 8px;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td></tr>
      </table>
      <p style="font-size:12px;color:#888;margin-top:18px;">Sent automatically by ResumeRight backend · Reply directly to the visitor — this inbox is not monitored.</p>
    </div>`;
  const text = `Abandoned lead\n\nName: ${lead.name}\nPhone: ${lead.phone}\nEmail: ${lead.email}\nInterest: ${lead.service}\nFields filled: ${fields}\n`;
  return sendEmail({ subject, html, text });
}

module.exports = { sesEnabled: () => sesEnabled, sendEmail, notifyAbandonedLead };
