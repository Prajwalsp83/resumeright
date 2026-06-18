// API client — talks to the SAME backend as the website. No backend changes:
// native requests send no Origin header, which the server's CORS already allows
// (`if (!origin || allowlist.includes(origin)) cb(null, true)`).
//
// Override at runtime with EXPO_PUBLIC_API_URL (e.g. http://192.168.x.x:5000
// when testing against a local backend on your LAN).
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.resumeright.co.in';

async function asJson(res) {
  let body = {};
  try { body = await res.json(); } catch (_e) { /* non-JSON */ }
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ── Free ATS scan (lead magnet) ──────────────────────────────────────────────
// file: { uri, name, mimeType } from expo-document-picker.
export async function atsScore({ file, name, email, phone, targetRole, jobDescription }) {
  const fd = new FormData();
  fd.append('resume', { uri: file.uri, name: file.name || 'resume.pdf', type: file.mimeType || 'application/pdf' });
  fd.append('name', name);
  fd.append('email', email);
  fd.append('phone', phone);
  if (targetRole)     fd.append('targetRole', targetRole);
  if (jobDescription) fd.append('jobDescription', jobDescription);
  // NOTE: don't set Content-Type manually — RN sets the multipart boundary.
  const res = await fetch(`${API_URL}/tools/ats-score`, { method: 'POST', body: fd });
  return asJson(res);
}

// ── Lead capture ─────────────────────────────────────────────────────────────
export async function submitLead({ name, email, phone, service, message }) {
  const res = await fetch(`${API_URL}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, phone, service, message }),
  });
  return asJson(res);
}

// ── Video pitch ──────────────────────────────────────────────────────────────
export async function videoPitch({ file, name, email, phone, targetRole }) {
  const fd = new FormData();
  fd.append('video', { uri: file.uri, name: file.fileName || 'pitch.mp4', type: file.mimeType || 'video/mp4' });
  fd.append('name', name);
  fd.append('email', email);
  fd.append('phone', phone);
  if (targetRole) fd.append('targetRole', targetRole);
  const res = await fetch(`${API_URL}/tools/video-pitch`, { method: 'POST', body: fd });
  return asJson(res);
}

// ── Payments (Razorpay) — server owns the price (send packageId only) ────────
export async function createOrder({ packageId, name, email, phone }) {
  const res = await fetch(`${API_URL}/payments/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packageId, name, email, phone }),
  });
  return asJson(res);
}

export async function verifyPayment({ orderId, paymentId, signature, leadId }) {
  const res = await fetch(`${API_URL}/payments/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      leadId,
    }),
  });
  return asJson(res);
}
