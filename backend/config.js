// Central env loader + validator.
// Fails fast on boot if anything critical is missing or weak — so we never
// ship a half-configured instance to prod.

require('dotenv').config();

function required(key) {
  const v = process.env[key];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v.trim();
}

function optional(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

const env = {
  NODE_ENV:   optional('NODE_ENV', 'production'),
  PORT:       parseInt(optional('PORT', '5000'), 10),

  MONGO_URI:  required('MONGO_URI'),
  DB_NAME:    optional('DB_NAME', 'resumeright'),

  ADMIN_KEY:  required('ADMIN_KEY'),
  JWT_SECRET: required('JWT_SECRET'),
  JWT_EXPIRES_IN: optional('JWT_EXPIRES_IN', '7d'),
  BCRYPT_ROUNDS:  parseInt(optional('BCRYPT_ROUNDS', '12'), 10),

  AWS_REGION:         optional('AWS_REGION', 'ap-south-1'),
  S3_BUCKET_UPLOADS:  optional('S3_BUCKET_UPLOADS', ''),

  CORS_ORIGINS: optional('CORS_ORIGINS', '*')
    .split(',').map(s => s.trim()).filter(Boolean),

  RATE_LIMIT_WINDOW_MS: parseInt(optional('RATE_LIMIT_WINDOW_MS', '900000'), 10),
  RATE_LIMIT_MAX:       parseInt(optional('RATE_LIMIT_MAX', '100'), 10),

  // Razorpay — optional. If missing, /payments/* endpoints are disabled (503).
  // Test keys start with `rzp_test_`, live keys with `rzp_live_`.
  RAZORPAY_KEY_ID:         optional('RAZORPAY_KEY_ID', ''),
  RAZORPAY_KEY_SECRET:     optional('RAZORPAY_KEY_SECRET', ''),
  RAZORPAY_WEBHOOK_SECRET: optional('RAZORPAY_WEBHOOK_SECRET', ''),

  // SES — optional. If missing, abandonment alerts won't email (still logged + saved).
  // SES_FROM must be verified in SES; SES_TO is who gets the alert (admin inbox).
  SES_FROM: optional('SES_FROM', ''),
  SES_TO:   optional('SES_TO', ''),
};

if (env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters (generate with `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"`)');
}

if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.length === 1 && env.CORS_ORIGINS[0] === '*') {
  console.warn('⚠️  CORS_ORIGINS=* in production — set an explicit allowlist.');
}

if (env.NODE_ENV === 'production' && !env.RAZORPAY_KEY_ID) {
  console.warn('⚠️  RAZORPAY_KEY_ID not set — /payments/* endpoints will return 503.');
}

module.exports = env;
