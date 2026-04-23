// Razorpay integration — order creation + signature verification.
// The SDK is loaded lazily so dev boxes without Razorpay credentials can still
// boot. When keys are missing, `razorpayEnabled` is false and the /payments/*
// endpoints return 503 instead of crashing.

const crypto = require('crypto');
const env    = require('./config');

const razorpayEnabled = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

let _client = null;
function client() {
  if (!razorpayEnabled) return null;
  if (_client) return _client;
  // Lazy require — only pay SDK cost if keys are configured.
  const Razorpay = require('razorpay');
  _client = new Razorpay({
    key_id:     env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
  return _client;
}

/**
 * Create an order on Razorpay's servers. Amount is in paise (₹1 = 100 paise).
 * Returns the full order object — frontend needs `id` + `amount` + `currency`.
 */
async function createOrder({ amountInr, receipt, notes }) {
  if (!razorpayEnabled) throw new Error('Razorpay not configured');
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    throw new Error('Invalid amount');
  }
  return client().orders.create({
    amount:   Math.round(amountInr * 100), // paise
    currency: 'INR',
    receipt:  receipt ? String(receipt).slice(0, 40) : undefined,
    notes:    notes || {},
    payment_capture: 1, // auto-capture
  });
}

/**
 * Verify the HMAC signature returned by Razorpay Checkout after payment.
 * Signature = HMAC-SHA256(order_id + "|" + payment_id, key_secret).
 */
function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!razorpayEnabled) return false;
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  // Constant-time compare to avoid timing leaks
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Verify a webhook payload using RAZORPAY_WEBHOOK_SECRET.
 * rawBody MUST be the exact request body as bytes (before JSON parsing).
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  razorpayEnabled,
  createOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
};
