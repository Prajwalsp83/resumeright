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
const {
  s3Enabled,
  buildUploader,
  buildVideoUploader,
  putBufferToS3,
  signedUrlForKey,
} = require('./s3');
const {
  razorpayEnabled,
  createOrder: createRzpOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} = require('./payments');
const { notifyAbandonedLead } = require('./notify');
const { scoreResume } = require('./atsScore');
const { emitActivity } = require('./activity');
// pdf-parse ships a debug harness that runs on bare `require('pdf-parse')`
// when the package's own test PDF isn't present (it isn't, in node_modules).
// Importing the inner module avoids that footgun.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const multer = require('multer');

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
// Public resume upload from the quick-capture form. Tighter than submit because
// each request streams a file to S3 — keep it cheap and abuse-resistant.
const leadResumeLimiter = rateLimit({ windowMs: 60 * 1000, max: 3, standardHeaders: true });
// Abandoned-lead beacon. Browsers may fire it twice (visibilitychange + pagehide),
// so allow a few hits per minute per IP — the dedupe is in the handler.
const abandonLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, standardHeaders: true });
// Free ATS scan — public lead magnet. Tighter than /submit because each request
// parses a PDF in-memory; cheap but easy to abuse with bursty traffic.
const atsLimiter = rateLimit({ windowMs: 60 * 1000, max: 4, standardHeaders: true });

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

// ───────────────────────────────────────────────────────────────────────────
// ABANDONED LEAD CAPTURE — fired by navigator.sendBeacon when a visitor fills
// the lead form (specifically the phone field) but leaves without submitting.
// Trigger is conservative: phone is required, plus at least one of email/name.
// We dedupe on phone within the last 24h so multiple beforeunload pings or a
// later /submit don't pile up — the goal is one row per real abandonment.
// Fires an email to the admin (fail-soft) so ops can re-target within minutes.
// ───────────────────────────────────────────────────────────────────────────
app.post('/leads/abandon', abandonLimiter, async (req, res, next) => {
  try {
    // sendBeacon delivers a Blob with type 'application/json'; express.json
    // already parses it. Body shape: { name, phone, email, service, fields, source }
    const name    = trim(req.body.name);
    const phone   = trim(req.body.phone);
    const email   = trim(req.body.email).toLowerCase();
    const service = trim(req.body.service) || 'Abandoned';
    const source  = trim(req.body.source) || 'abandon-beacon';
    const fields  = Array.isArray(req.body.fields)
      ? req.body.fields.filter(s => typeof s === 'string').slice(0, 12)
      : [];

    // Conservative gate — phone must look real, AND we need at least one other
    // identifier so we can actually reach the lead. Anything weaker is noise.
    if (!phoneRe.test(phone))                  return res.json({ ok: false, reason: 'no-phone' });
    if (!name && !emailRe.test(email))         return res.json({ ok: false, reason: 'no-id' });

    const leads = getDb().collection('leads');

    // Dedupe: if this phone already has a lead in the last 24h (in any state),
    // don't create a second one. Beacon spam, page reloads, or a successful
    // /submit immediately after should not produce a phantom abandonment row.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await leads.findOne(
      { phone, createdAt: { $gte: since } },
      { projection: { _id: 1, status: 1 } },
    );
    if (existing) return res.json({ ok: true, deduped: true });

    const lead = {
      name: name || '(unknown)',
      phone, email,
      service,
      fieldsFilled: fields,
      source,
      utm:       req.body.utm && typeof req.body.utm === 'object' ? req.body.utm : null,
      pageUrl:   trim(req.body.pageUrl).slice(0, 500),
      userAgent: trim(req.headers['user-agent']).slice(0, 300),
      status:    'Abandoned',
      createdAt: new Date(),
    };
    const { insertedId } = await leads.insertOne(lead);

    // Fire-and-forget admin email. Never block the response on it; if SES is
    // misconfigured the beacon still succeeds and the lead is in the DB.
    notifyAbandonedLead({ ...lead, _id: insertedId })
      .catch(err => console.error('[abandon:notify]', err.message || err));

    res.json({ ok: true, id: insertedId });
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

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC RESUME ATTACH — for the quick-capture / free-scan form.
// Flow: frontend POSTs /submit (creates a lead, returns id), then if the user
// attached a file it POSTs /leads/:id/resume with the file as multipart.
// Anti-abuse: rate-limited, only allowed within 10 minutes of lead creation,
// and only if the lead doesn't already have a resume attached.
// Does NOT touch /submit or /upload — completely additive.
// ───────────────────────────────────────────────────────────────────────────
app.post('/leads/:id/resume', leadResumeLimiter, (req, res, next) => {
  uploader.single('resume')(req, res, async err => {
    if (err) return bad(res, err.message);
    if (!req.file) return bad(res, 'No file uploaded');

    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return bad(res, 'Invalid lead id', 404);

      const leads = getDb().collection('leads');
      const lead = await leads.findOne({ _id: new ObjectId(id) });
      if (!lead) return bad(res, 'Lead not found', 404);

      // Anti-abuse: only allow attachment shortly after lead creation,
      // and only once. Anything else is suspicious.
      const ageMs = Date.now() - new Date(lead.createdAt || 0).getTime();
      if (ageMs > 10 * 60 * 1000) return bad(res, 'Lead too old for attachment', 410);
      if (lead.s3Key || lead.localPath) return bad(res, 'Resume already attached', 409);

      const f = req.file;
      await leads.updateOne(
        { _id: lead._id },
        {
          $set: {
            originalName: f.originalname,
            s3Key:        s3Enabled ? f.key    : null,
            s3Bucket:     s3Enabled ? f.bucket : null,
            localPath:    s3Enabled ? null     : f.filename,
            sizeBytes:    f.size,
            mimeType:     f.mimetype,
            status:       'Resume Attached',
            updatedAt:    new Date(),
          },
        },
      );
      res.json({ success: true });
    } catch (e) { next(e); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FREE ATS SCAN — public lead magnet
// Flow:
//   1. Frontend POSTs multipart: { resume (PDF), email, name?, phone?, targetRole?, jobDescription? }
//   2. Backend extracts text via pdf-parse, runs heuristic scoring, stores
//      a lead in 'ATS Scanned' state, returns the score breakdown.
// Why a lead first: the email gate captures intent BEFORE the user sees a
// score, so even if they bounce after seeing the result we have a re-target
// hook. Status = 'ATS Scanned' so admin can prioritize follow-up over /submit.
// ═══════════════════════════════════════════════════════════════════════════
const atsMemoryUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter(_req, file, cb) {
    const ok = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    cb(ok ? null : new Error('Only PDF files are accepted'), ok);
  },
});

app.post('/tools/ats-score', atsLimiter, (req, res, next) => {
  atsMemoryUpload.single('resume')(req, res, async err => {
    if (err) return bad(res, err.message);
    if (!req.file) return bad(res, 'Please attach a PDF resume');

    try {
      const email          = trim(req.body.email).toLowerCase();
      const name           = trim(req.body.name);
      const phone          = trim(req.body.phone);
      const targetRole     = trim(req.body.targetRole).slice(0, 200);
      const jobDescription = trim(req.body.jobDescription).slice(0, 6000);

      // Required fields — name + phone + email all needed so warm leads are
      // actually contactable. Without phone the conversion follow-up is dead.
      if (!name)                         return bad(res, 'Your name is required');
      if (!emailRe.test(email))          return bad(res, 'Valid email is required');
      if (!phoneRe.test(phone))          return bad(res, 'Valid phone number is required');

      // Extract text. pdf-parse occasionally throws on weird PDFs — catch and
      // surface a friendly message instead of a 500.
      let text = '';
      try {
        const parsed = await pdfParse(req.file.buffer);
        text = parsed?.text || '';
      } catch (parseErr) {
        console.error('[ats:parse]', parseErr.message);
        return bad(res, 'Could not read this PDF. Try re-saving it as a fresh PDF (not a scan).', 422);
      }

      const result = scoreResume({ text, jobDescription });

      // Persist the PDF to S3 so admin can review / forward to writers when
      // converting this lead to paid. Fail-soft — if S3 upload errors, the
      // score still ships back and the lead row is still created (just
      // without an s3Key).
      const uploaded = await putBufferToS3({
        buffer:       req.file.buffer,
        originalName: req.file.originalname,
        contentType:  req.file.mimetype || 'application/pdf',
        prefix:       'ats-scans',
      });

      const leadDoc = {
        name,
        email,
        phone,
        service:      'Free ATS Scan',
        targetRole,
        atsScore:     result.score,
        atsGrade:     result.grade,
        atsIssues:    result.issues,
        atsBreakdown: result.breakdown,
        atsStats:     result.stats,
        hadJD:        Boolean(jobDescription),
        keywordMatch: result.keywordMatch || null,
        originalName: req.file.originalname,
        s3Key:        uploaded ? uploaded.key    : null,
        s3Bucket:     uploaded ? uploaded.bucket : null,
        sizeBytes:    req.file.size,
        mimeType:     req.file.mimetype || 'application/pdf',
        utm:          req.body.utm && typeof req.body.utm === 'string'
                        ? safeJsonParse(req.body.utm) : null,
        status:       'ATS Scanned',
        source:       'ats-tool',
        createdAt:    new Date(),
      };
      const { insertedId } = await getDb().collection('leads').insertOne(leadDoc);

      // D3 — real-time ticker (anonymised: first name + score only, no phone).
      emitActivity({ type: 'ats_scan', firstName: (name || '').split(' ')[0] || 'Someone', score: result.score });

      res.json({
        success: true,
        id:      insertedId,
        score:        result.score,
        grade:        result.grade,
        issues:       result.issues,
        strengths:    result.strengths,
        breakdown:    result.breakdown,
        stats:        result.stats,
        keywordMatch: result.keywordMatch,
      });
    } catch (e) { next(e); }
  });
});

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// VIDEO PITCH — record-yourself coaching lead magnet
// User records a 30–90s self-introduction (browser MediaRecorder OR file
// upload). We persist to S3 and create a lead so coaches can review the
// clip + book a 1:1 interview-prep session. Status = 'Video Submitted'.
// ═══════════════════════════════════════════════════════════════════════════
const videoUploader = buildVideoUploader();
const videoLimiter  = rateLimit({ windowMs: 60 * 1000, max: 3, standardHeaders: true });

app.post('/tools/video-pitch', videoLimiter, (req, res, next) => {
  videoUploader.single('video')(req, res, async err => {
    if (err) return bad(res, err.message);
    if (!req.file) return bad(res, 'Please attach or record a video');

    try {
      const email      = trim(req.body.email).toLowerCase();
      const name       = trim(req.body.name);
      const phone      = trim(req.body.phone);
      const targetRole = trim(req.body.targetRole).slice(0, 200);
      const message    = trim(req.body.message).slice(0, 1000);

      if (!name)                 return bad(res, 'Your name is required');
      if (!emailRe.test(email))  return bad(res, 'Valid email is required');
      if (!phoneRe.test(phone))  return bad(res, 'Valid phone number is required');

      const f = req.file;
      const lead = {
        name, email, phone,
        service:      'Interview Coaching · Video Pitch',
        targetRole,
        message,
        originalName: f.originalname,
        s3Key:        s3Enabled ? f.key    : null,
        s3Bucket:     s3Enabled ? f.bucket : null,
        localPath:    s3Enabled ? null     : f.filename,
        sizeBytes:    f.size,
        mimeType:     f.mimetype || 'video/mp4',
        status:       'Video Submitted',
        source:       'video-pitch-tool',
        utm:          req.body.utm && typeof req.body.utm === 'string'
                        ? safeJsonParse(req.body.utm) : null,
        createdAt:    new Date(),
      };
      const { insertedId } = await getDb().collection('leads').insertOne(lead);

      // D3 — real-time ticker (anonymised: first name only, no phone).
      emitActivity({ type: 'video_pitch', firstName: (name || '').split(' ')[0] || 'Someone' });

      res.json({ success: true, id: insertedId });
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

    let order;
    try {
      order = await createRzpOrder({
        amountInr: amount,
        receipt:   `rr_${leadId.toString().slice(-12)}`,
        notes:     { packageName, leadId: leadId.toString(), email, phone },
      });
    } catch (rzpErr) {
      // Razorpay SDK throws plain objects, not Error instances — so err.message
      // is undefined. Extract the real cause so we can see it in pm2 logs.
      const detail = rzpErr?.error?.description
        || rzpErr?.message
        || JSON.stringify(rzpErr, Object.getOwnPropertyNames(rzpErr || {}));
      console.error('[rzp:order]', rzpErr?.statusCode || '', detail);
      const err = new Error(detail || 'Razorpay order failed');
      err.status = rzpErr?.statusCode || 502;
      throw err;
    }

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
    const allowed = ['New', 'Resume Uploaded', 'ATS Scanned', 'Video Submitted', 'In Progress', 'Pending Payment', 'Paid', 'Completed', 'Lost', 'Abandoned'];
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

app.use((err, req, res, _next) => {
  // Not all thrown values are Error instances — SDKs like Razorpay throw
  // plain objects. Extract the best-available string for logs.
  const detail = err?.message
    || err?.error?.description
    || (typeof err === 'string' ? err : '')
    || (() => { try { return JSON.stringify(err, Object.getOwnPropertyNames(err || {})).slice(0, 600); } catch { return '<unserialisable error>'; } })();
  console.error('[err]', req.method, req.path, '→', detail);
  const exposeDetail = env.NODE_ENV !== 'production';
  res.status(err?.status || err?.statusCode || 500).json({
    error: exposeDetail ? detail : 'Server error',
  });
});

module.exports = { app, connectDb };
