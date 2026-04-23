const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ObjectId } = require('mongodb');

const env = require('./config');
const { connect: connectDb, getDb } = require('./db');
const {
  hashPassword,
  verifyPassword,
  isBcryptHash,
  signToken,
  requireAuth,
} = require('./auth');
const { s3Enabled, buildUploader, signedUrlForKey } = require('./s3');
const {
  razorpayEnabled,
  createOrder: createRzpOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} = require('./payments');

const app = express();
app.set('trust proxy', 1); // trust ALB + CloudFront

// ─── Security & core middleware ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // pure JSON API
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const corsAllowAll = env.CORS_ORIGINS.length === 1 && env.CORS_ORIGINS[0] === '*';
app.use(cors({
  origin: corsAllowAll ? '*' : (origin, cb) => {
    if (!origin || env.CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Razorpay webhook (raw body BEFORE express.json) ───────────────────────
// Webhook signature = HMAC-SHA256 of the EXACT request bytes, so we must
// capture the raw body before any JSON parsing middleware runs.
app.post('/payments/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    try {
      const signature = req.headers['x-razorpay-signature'] || '';
      const rawBody   = req.body; // Buffer
      if (!verifyWebhookSignature(rawBody, signature)) {
        return res.status(400).json({ error: 'Invalid signature' });
      }

      const event = JSON.parse(rawBody.toString('utf8'));
      const payment = event?.payload?.payment?.entity;
      const orderId = payment?.order_id;

      if (event.event === 'payment.captured' && orderId) {
        // Idempotent: update by orderId; won't double-apply if webhook retries.
        await getDb().collection('leads').updateOne(
          { razorpayOrderId: orderId },
          {
            $set: {
              status:             'Paid',
              razorpayPaymentId:  payment.id,
              paidAt:             new Date(),
              paidAmount:         payment.amount / 100,
              paymentMethod:      payment.method,
              updatedAt:          new Date(),
            },
          },
        );
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[webhook]', e.message);
      res.status(500).json({ error: 'Webhook handler error' });
    }
  },
);

app.use(express.json({ limit: '1mb' }));

// ─── Rate limiters ──────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter   = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true });
const submitLimiter = rateLimit({ windowMs: 60 * 1000,      max: 5,  standardHeaders: true });

app.use(generalLimiter);

// ─── Helpers ────────────────────────────────────────────────────────────────
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRe = /^[0-9+\s\-()]{7,20}$/;
const trim = v => (typeof v === 'string' ? v.trim() : '');
const bad  = (res, msg, code = 400) => res.status(code).json({ error: msg });

const uploader = buildUploader();

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════════════════
// Lightweight endpoint for ALB target-group health checks (no DB).
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/', async (_req, res) => {
  try {
    const db = getDb();
    const [leads, users] = await Promise.all([
      db.collection('leads').countDocuments(),
      db.collection('users').countDocuments(),
    ]);
    res.json({ status: 'ResumeRight backend OK', leads, users, s3: s3Enabled, razorpay: razorpayEnabled });
  } catch (e) {
    res.status(503).json({ status: 'DB error', error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// LEAD CAPTURE (public)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/submit', submitLimiter, async (req, res, next) => {
  try {
    const name    = trim(req.body.name);
    const phone   = trim(req.body.phone);
    const email   = trim(req.body.email).toLowerCase();
    const service = trim(req.body.service) || trim(req.body.pkg) || 'Not specified';

    if (!name)                 return bad(res, 'Name is required');
    if (!phoneRe.test(phone))  return bad(res, 'Valid phone number is required');
    if (!emailRe.test(email))  return bad(res, 'Valid email is required');

    const lead = {
      name, phone, email, service,
      exp:     trim(req.body.exp),
      current: trim(req.body.current),
      target:  trim(req.body.target),
      message: trim(req.body.message).slice(0, 2000),
      utm:     req.body.utm && typeof req.body.utm === 'object' ? req.body.utm : null,
      status:  'New',
      createdAt: new Date(),
    };
    const { insertedId } = await getDb().collection('leads').insertOne(lead);
    res.json({ success: true, id: insertedId });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════════
// USER AUTH
// ═══════════════════════════════════════════════════════════════════════════
app.post('/register', authLimiter, async (req, res, next) => {
  try {
    const name     = trim(req.body.name);
    const email    = trim(req.body.email).toLowerCase();
    const password = req.body.password || '';

    if (!name)                 return bad(res, 'Name is required');
    if (!emailRe.test(email))  return bad(res, 'Valid email is required');
    if (password.length < 6)   return bad(res, 'Password must be at least 6 characters');

    const users = getDb().collection('users');
    if (await users.findOne({ email })) return bad(res, 'Email already registered', 409);

    const passwordHash = await hashPassword(password);
    const { insertedId } = await users.insertOne({
      name, email, passwordHash, createdAt: new Date(),
    });

    const token = signToken({ sub: insertedId.toString(), email, name, role: 'user' });
    res.json({ success: true, token, user: { id: insertedId, name, email } });
  } catch (e) { next(e); }
});

app.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email    = trim(req.body.email).toLowerCase();
    const password = req.body.password || '';
    if (!emailRe.test(email) || !password) return bad(res, 'Email and password required');

    const users = getDb().collection('users');
    const user = await users.findOne({ email });
    if (!user) return bad(res, 'Invalid email or password', 401);

    // Support legacy plaintext column `password` while migrating.
    const stored = user.passwordHash || user.password;
    const ok = await verifyPassword(password, stored);
    if (!ok) return bad(res, 'Invalid email or password', 401);

    // Upgrade legacy plaintext → bcrypt on successful login.
    if (!isBcryptHash(user.passwordHash)) {
      const passwordHash = await hashPassword(password);
      await users.updateOne(
        { _id: user._id },
        { $set: { passwordHash }, $unset: { password: '' } },
      );
    }

    const token = signToken({ sub: user._id.toString(), email, name: user.name, role: 'user' });
    res.json({ success: true, token, user: { id: user._id, name: user.name, email } });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════════
// RESUME UPLOAD — requires a logged-in user
// ═══════════════════════════════════════════════════════════════════════════
app.post('/upload', requireAuth('user'), (req, res, next) => {
  uploader.single('resume')(req, res, async err => {
    if (err) return bad(res, err.message);
    if (!req.file) return bad(res, 'No file uploaded');

    try {
      const f = req.file;
      const doc = {
        name:         req.user.name,
        email:        req.user.email,
        service:      'Resume Upload',
        status:       'Resume Uploaded',
        uploadedBy:   req.user.sub,
        originalName: f.originalname,
        s3Key:        s3Enabled ? f.key    : null,
        s3Bucket:     s3Enabled ? f.bucket : null,
        localPath:    s3Enabled ? null     : f.filename,
        sizeBytes:    f.size,
        mimeType:     f.mimetype,
        createdAt:    new Date(),
      };
      await getDb().collection('leads').insertOne(doc);
      res.json({ success: true });
    } catch (e) { next(e); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENTS — Razorpay
// Flow:
//   1. Frontend POSTs /payments/order with { packageName, amount, name, email, phone }
//   2. Backend creates Razorpay order + a 'Pending Payment' lead; returns
//      { keyId, orderId, amount, currency, leadId }
//   3. Frontend opens Razorpay Checkout with that orderId
//   4. On success, Razorpay calls frontend's handler → POST /payments/verify
//      with { orderId, paymentId, signature, leadId }
//   5. Backend verifies HMAC; on match, marks lead 'Paid'
//   6. (Server-to-server safety net) Razorpay webhook → /payments/webhook
//      also marks the lead 'Paid' (idempotent — safe if verify already ran)
// ═══════════════════════════════════════════════════════════════════════════
const paymentLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true });

app.post('/payments/order', paymentLimiter, async (req, res, next) => {
  try {
    if (!razorpayEnabled) return bad(res, 'Payments not configured', 503);

    const packageName = trim(req.body.packageName);
    // Accept either `amount` or `amountInr` for convenience
    const amount      = Number(req.body.amount ?? req.body.amountInr);
    const name        = trim(req.body.name);
    const email       = trim(req.body.email).toLowerCase();
    const phone       = trim(req.body.phone);

    if (!packageName)                   return bad(res, 'Package is required');
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
      return bad(res, 'Invalid amount');
    }
    if (name && !emailRe.test(email))   return bad(res, 'Valid email is required');

    // Pre-create a lead in 'Pending Payment' state so even abandoned checkouts
    // are visible in admin (great for re-targeting).
    const leadDoc = {
      name:    name  || 'Anonymous',
      email:   email || '',
      phone:   phone || '',
      service: packageName,
      status:  'Pending Payment',
      amount,
      source:  'razorpay-checkout',
      createdAt: new Date(),
    };
    const { insertedId: leadId } = await getDb().collection('leads').insertOne(leadDoc);

    const order = await createRzpOrder({
      amountInr: amount,
      receipt:   `rr_${leadId.toString().slice(-12)}`,
      notes:     { packageName, leadId: leadId.toString(), email, phone },
    });

    await getDb().collection('leads').updateOne(
      { _id: leadId },
      { $set: { razorpayOrderId: order.id, updatedAt: new Date() } },
    );

    res.json({
      keyId:    env.RAZORPAY_KEY_ID,
      orderId:  order.id,
      amount:   order.amount,     // in paise
      currency: order.currency,
      leadId:   leadId.toString(),
    });
  } catch (e) { next(e); }
});

app.post('/payments/verify', paymentLimiter, async (req, res, next) => {
  try {
    if (!razorpayEnabled) return bad(res, 'Payments not configured', 503);

    // Accept both camelCase and Razorpay's native snake_case keys.
    const orderId   = trim(req.body.orderId   || req.body.razorpay_order_id);
    const paymentId = trim(req.body.paymentId || req.body.razorpay_payment_id);
    const signature = trim(req.body.signature || req.body.razorpay_signature);
    const leadId    = trim(req.body.leadId);

    if (!orderId || !paymentId || !signature) {
      return bad(res, 'Missing payment fields');
    }

    const ok = verifyCheckoutSignature({ orderId, paymentId, signature });
    if (!ok) return bad(res, 'Signature verification failed', 400);

    // Match by orderId (authoritative) — leadId is a convenience hint.
    const filter = { razorpayOrderId: orderId };
    if (leadId && ObjectId.isValid(leadId)) filter._id = new ObjectId(leadId);

    await getDb().collection('leads').updateOne(filter, {
      $set: {
        status:            'Paid',
        razorpayPaymentId: paymentId,
        paidAt:            new Date(),
        updatedAt:         new Date(),
      },
    });

    res.json({ success: true });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN — key-to-JWT login, then JWT on every request
// ═══════════════════════════════════════════════════════════════════════════
app.post('/admin/login', authLimiter, (req, res) => {
  const key = trim(req.body.key);
  if (!key || key !== env.ADMIN_KEY) return bad(res, 'Invalid admin key', 401);
  const token = signToken({ sub: 'admin', role: 'admin' }, { expiresIn: '12h' });
  res.json({ success: true, token });
});

app.get('/admin/leads', requireAuth('admin'), async (_req, res, next) => {
  try {
    const leads = await getDb().collection('leads')
      .find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    res.json({
      leads: leads.map(l => ({ ...l, id: l._id.toString() })),
      total: leads.length,
    });
  } catch (e) { next(e); }
});

app.get('/admin/leads/:id', requireAuth('admin'), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return bad(res, 'Invalid id');
    const lead = await getDb().collection('leads').findOne({ _id: new ObjectId(req.params.id) });
    if (!lead) return bad(res, 'Not found', 404);
    const fileUrl = lead.s3Key ? await signedUrlForKey(lead.s3Key) : null;
    res.json({ lead: { ...lead, id: lead._id.toString(), fileUrl } });
  } catch (e) { next(e); }
});

app.patch('/admin/leads/:id', requireAuth('admin'), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return bad(res, 'Invalid id');
    const allowed = ['New', 'Resume Uploaded', 'In Progress', 'Pending Payment', 'Paid', 'Completed', 'Lost'];
    const status = trim(req.body.status);
    if (!allowed.includes(status)) return bad(res, 'Invalid status');
    await getDb().collection('leads').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date() } },
    );
    res.json({ success: true });
  } catch (e) { next(e); }
});

app.get('/admin/users', requireAuth('admin'), async (_req, res, next) => {
  try {
    const users = await getDb().collection('users')
      .find({}, { projection: { passwordHash: 0, password: 0 } })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    res.json({
      users: users.map(u => ({ ...u, id: u._id.toString() })),
      total: users.length,
    });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════════
// 404 + error handler (must be last)
// ═══════════════════════════════════════════════════════════════════════════
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error('[err]', err.message);
  const exposeDetail = env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({
    error: exposeDetail ? err.message : 'Server error',
  });
});

module.exports = { app, connectDb };
