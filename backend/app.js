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
    res.json({ status: 'ResumeRight backend OK', leads, users, s3: s3Enabled });
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
    const allowed = ['New', 'Resume Uploaded', 'In Progress', 'Completed', 'Paid', 'Lost'];
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
