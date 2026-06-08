# ResumeRight — Project Handoff for Claude Agents

You are a senior full-stack developer + startup advisor helping Praj (sole founder) build and scale **ResumeRight** — a paid resume-writing and career-services business (NOT a SaaS resume builder). Live in production at `https://resumeright.co.in` since 2026-04-24 on Razorpay live keys.

This document is your single source of truth for the entire system. Read it once before touching anything. After that, the code is the truth — verify before recommending changes.

---

## 1. Business model (don't get this wrong)

**This is a service business**, not a SaaS. Praj and his writers manually craft resumes / Naukri profiles / LinkedIn rewrites. Customers pay once per package (₹999–₹9,999). The whole tech stack is a **lead-capture + payment funnel** sitting in front of a manual fulfillment process tracked in `admin.html`.

- Sole proprietor: **Prajwal S Pattanshetti** trading as ResumeRight, BTM 2nd Stage Bangalore.
- Revenue target: **₹10K/month soon**, scaling from there.
- 7-day refund window. UPI/cards via Razorpay.
- Free top-of-funnel tools (ATS scan, video pitch) exist solely to capture warm leads with contact info that Praj WhatsApps to convert.

When suggesting features, optimize for **conversion + lead capture + ops efficiency**, not for SaaS metrics. Don't propose a resume builder UI, don't propose self-serve onboarding — every flow ends in "we contact you on WhatsApp."

---

## 2. Tech stack at a glance

| Layer | Tech |
|---|---|
| Backend | Node.js ≥20, Express 4, MongoDB Atlas (driver 6) |
| Frontend | Vanilla HTML + CSS + JS — **no framework, no build step** |
| Infra | AWS in `ap-south-1` — EC2 (Ubuntu 22) + pm2, S3 (frontend + uploads), CloudFront (two distributions), Route 53, ACM (us-east-1), SES, SSM Parameter Store |
| IaC | Terraform — single `terraform/main.tf` |
| CI/CD | GitHub Actions — single `.github/workflows/deploy.yml` |
| Payments | Razorpay live keys (key prefix `rzp_live_`) |
| Analytics | GA4 `G-VVQKL8EPZZ` + Microsoft Clarity `whenxtd4vc` (wired into 5 customer pages, NOT admin.html) |

Total LOC ≈ 6,200. Frontend `index.html` is 2,217 lines of intentional monolith — Praj wants no React/Vue/build-step churn.

---

## 3. Repo layout

```
resumeright/
├── backend/
│   ├── app.js              Express routes, middleware, all business logic (720 lines)
│   ├── server.js           Boot — connects DB, starts HTTP listener (40 lines)
│   ├── config.js           Env loader + validator, fails fast on boot
│   ├── db.js               MongoDB connect / getDb singleton
│   ├── auth.js             bcrypt + jsonwebtoken helpers + requireAuth middleware
│   ├── s3.js               multer-s3 uploader, buildVideoUploader, putBufferToS3, signedUrlForKey
│   ├── payments.js         Razorpay SDK wrapper + signature verifiers
│   ├── notify.js           SES email helpers (abandonment alerts)
│   ├── atsScore.js         Heuristic ATS resume scorer (deterministic, no LLM)
│   ├── ecosystem.config.js pm2 config
│   ├── package.json        Deps + node ≥20
│   └── package-lock.json   MUST stay in sync — deploy uses `npm ci --omit=dev`
│
├── frontend/
│   ├── index.html          Landing — hero, ATS scanner, video pitch, packages, FAQ, chat, etc.
│   ├── admin.html          Admin dashboard (login → leads table → detail drawer → WhatsApp templates)
│   ├── contact.html        Standalone contact form
│   ├── privacy.html        Razorpay-compliance doc
│   ├── terms.html          Razorpay-compliance doc
│   └── refund.html         Razorpay-compliance doc (7-day window)
│
├── terraform/
│   └── main.tf             Everything: VPC, EC2, S3 buckets, CloudFront x2, SSM params, IAM, Route 53 alias
│
├── .github/workflows/
│   └── deploy.yml          test → terraform-apply → deploy-backend (SSM RunCommand) → deploy-frontend (S3 sync + CF invalidation)
│
├── docs/
│   ├── RUNBOOK.md
│   └── PIPELINE_RECOVERY.md
│
└── README.md
```

---

## 4. Backend — every route

Routes in `backend/app.js` (line numbers from current `main`):

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/payments/webhook` | HMAC | Razorpay event handler. **Raw body BEFORE express.json** — never move this. |
| GET  | `/healthz` | none | ALB health check |
| GET  | `/` | none | DB status + counts |
| POST | `/submit` | rate-limited | Legacy lead capture (long form on /contact.html) |
| POST | `/leads/abandon` | rate-limited | sendBeacon target — captures phone-filled-but-unsubmitted visitors |
| POST | `/register`, `/login` | rate-limited | User auth — JWT, bcrypt with legacy-plaintext upgrade |
| POST | `/upload` | user JWT | Logged-in resume upload to S3 (multer-s3) |
| POST | `/leads/:id/resume` | rate-limited + 10-min window | Public resume attach for quick-capture flow |
| POST | `/tools/ats-score` | rate-limited | **Free ATS scanner** — multipart PDF + name/phone/email required. Uploads PDF to S3 (`ats-scans/` prefix), parses with pdf-parse, scores via `atsScore.js`, creates lead with `status: 'ATS Scanned'`. |
| POST | `/tools/video-pitch` | rate-limited | **Free video coaching capture** — multipart video (mp4/webm/mov, 50MB cap). Uploads to S3 (`video-pitches/`), creates lead with `status: 'Video Submitted'`. |
| POST | `/payments/order` | rate-limited | Pre-creates 'Pending Payment' lead, creates Razorpay order |
| POST | `/payments/verify` | rate-limited | Verifies HMAC, marks lead 'Paid' (webhook is the safety net) |
| POST | `/admin/login` | rate-limited | Key → JWT (12h) |
| GET  | `/admin/leads` | admin JWT | List up to 500 leads sorted desc by `createdAt` |
| GET  | `/admin/leads/:id` | admin JWT | Single lead + 10-min signed URL for any S3 file |
| PATCH| `/admin/leads/:id` | admin JWT | Update status — enum below |
| GET  | `/admin/users` | admin JWT | List registered users |

**Allowed lead statuses** (in `PATCH /admin/leads/:id`):
`New, Resume Uploaded, ATS Scanned, Video Submitted, In Progress, Pending Payment, Paid, Completed, Lost, Abandoned`

**Rate limiters** (all use `express-rate-limit` v7):
- `generalLimiter` global, `authLimiter` 20/15min, `submitLimiter` 5/min, `leadResumeLimiter` 3/min, `abandonLimiter` 6/min (handler dedupes), `atsLimiter` 4/min, `videoLimiter` 3/min, `paymentLimiter` 10/min.

**Mongo collections:** `leads`, `users`. No migrations — Mongo, just add fields. Leads document has dozens of optional fields depending on source — always check existence.

---

## 5. Env vars (`backend/config.js`)

Hard-required (boot fails without them):
`MONGO_URI, ADMIN_KEY, JWT_SECRET` (JWT_SECRET ≥32 chars enforced).

Optional with sensible defaults:
`NODE_ENV=production, PORT=5000, DB_NAME=resumeright, JWT_EXPIRES_IN=7d, BCRYPT_ROUNDS=12, AWS_REGION=ap-south-1, S3_BUCKET_UPLOADS, CORS_ORIGINS (comma-sep), RATE_LIMIT_*, RAZORPAY_*, SES_FROM, SES_TO`.

In prod these come from **AWS SSM Parameter Store** (`/resumeright/{name}`), pulled in by `deploy.yml` and written to `.env` on the EC2 box before pm2 reload.

If `RAZORPAY_KEY_ID` is unset, payment endpoints return 503. If `S3_BUCKET_UPLOADS` is unset, uploads fall back to local disk `backend/uploads/`. If `SES_FROM` is unset, abandonment emails silently log instead of sending.

---

## 6. Infrastructure

**Region:** `ap-south-1` (Mumbai). ACM certs live in `us-east-1` (CloudFront requirement).

**AWS resources (declared in `terraform/main.tf`):**

| Resource | Notes |
|---|---|
| `aws_vpc.main` + 2 public subnets + IGW | basic VPC, no NAT |
| `aws_instance.app` | single EC2 (Ubuntu 22 t3.medium-ish), pm2 runs backend |
| `aws_eip.app` | static IP attached to EC2 |
| `aws_security_group.ec2` | SSH from anywhere (yes), 80/443 from CF only |
| `aws_iam_role.ec2` + SSM policy + inline (SES + S3 + SSM Parameter Store read) |
| `aws_s3_bucket.frontend` | static site host, public for CF, suffix-randomized |
| `aws_s3_bucket.uploads` | private, AES256, lifecycle rule expires non-current versions after 30d |
| `aws_cloudfront_distribution.frontend` | Id `E305VHWR6NUGX3` → `d2otdjz128ot83.cloudfront.net`, alias `resumeright.co.in` (LIVE) |
| `aws_cloudfront_distribution.api` | Id `E41UEH84SQBA3` → `d2jekem22n0os8.cloudfront.net`, alias `api.resumeright.co.in` (LIVE), forwards to EC2 EIP |
| `aws_route53_record.*` | A-record aliases to both CF distributions in zone `Z10060871T4YTZXLTLW94` |
| `aws_ssm_parameter.*` | SecureString for mongo_uri, admin_key, jwt_secret, razorpay creds |

**ACM cert (us-east-1):** `arn:aws:acm:us-east-1:848104065212:certificate/ad02ec60-491f-4070-9b55-e91cfdaaf6ac` — SAN covers `resumeright.co.in`, `www.resumeright.co.in`, `api.resumeright.co.in`. www is NOT yet wired with a Route 53 record.

**Pipeline:** `deploy.yml` has jobs: `test → terraform-apply → deploy-backend (SSM RunCommand to EC2) → deploy-frontend (S3 sync + CloudFront invalidation)`. Plus a destroy path gated on a `production` GitHub environment.

**Frontend `__API_URL__` injection:** deploy.yml replaces the placeholder in `index.html` and `admin.html` at deploy time with the `API_URL` GitHub secret (falling back to `terraform output api_url`). **Hardcoding a subdomain in deploy.yml is BANNED** — broke prod on 2026-04-26.

---

## 7. Frontend — landing page sections (`index.html`)

In document order:
1. **Urgency banner** — daily-reset countdown timer, dismissible.
2. **Hero** — "Don't Wait For Luck. Create Your Shot." CTAs to scanner + video pitch.
3. **#quickCapture** — Live ATS scanner: 3-step UI (input → scanning animation → score card with circle, breakdown bars, issues, strengths, CTA). All three contact fields required.
4. **#videoPitch** — Record-yourself coaching tool: tabbed UI (🎥 Record now via MediaRecorder, 📁 Upload clip). 90s cap. Webcam preview, REC badge, timer, retake. Falls back to upload-only when MediaRecorder unavailable.
5. **Pain section** — FOMO stats (75% ATS rejection, 7.4s scan, 250+ applicants, ₹12L delay cost).
6. **Trust bar** — pay-after-preview, UPI/GPay, 100% satisfaction etc.
7. **#services** — tabbed packages: Resume / Naukri / LinkedIn / Bundle. Pricing tiers visible: ₹999, ₹1,499, ₹1,999, ₹2,499, ₹3,499, ₹3,999, ₹4,999, ₹9,999. Razorpay Checkout integrated.
8. **#contact** — long-form lead capture.
9. **#uploadSection** — authenticated user upload.
10. **Video education section** — YouTube tile embeds.
11. **#reviews** — verified-badge testimonials.
12. **#faq** — accordion.
13. **Floating CTA** — "Free ATS Scan →" persistent button.
14. **Chat FAB** — keyword-bot replies (handcoded `BOT` dict — no LLM).
15. **Auth modal** — login/register.

**Design tokens** (declared as CSS vars at top):
- `--navy: #0B1628`, `--navy2: darker`, `--gold: #E8A020`, `--gold2: lighter gold`, `--white: #F8F5EE`
- Fonts: **Fraunces** (display serif) + **Plus Jakarta Sans** (body)
- Glassmorphic cards, mesh-gradient hero, scroll-reveal IntersectionObserver, animated CTAs.

Do NOT propose a redesign — the visual language is already strong. Add features, don't repaint.

---

## 8. Admin dashboard (`admin.html`)

Login with `ADMIN_KEY` → JWT (12h) → leads table. Features:
- 7 stat tiles: Total, New, Abandoned, **ATS Scans**, In Progress, Completed, Paid. Click a tile to filter.
- Search + status dropdown + Refresh + Export CSV (filtered) + Export Fulfillment Queue (paid only).
- Lead row shows: name+contact, service badge (color-coded incl. svc-video/svc-ats), target/file, submitted timestamp, status dropdown (auto-PATCH), View button.
- ATS-scanned rows show **inline score** + color-coded grade.
- Detail drawer: full lead, inline resume PDF link (signed URL, 10-min TTL) OR inline `<video>` player + Open-in-new-tab + Download for video pitches. ATS row with score+grade+keyword%+top 3 issues.
- WhatsApp templates (intro, recover, onboard, deliver, review) — `wa.me/91...?text=...` deep links auto-personalised from lead data.
- Polls every 30s.

Admin login key → SSM param `/resumeright/admin_key` → set as GitHub secret `ADMIN_KEY`.

---

## 9. ATS Score engine (`backend/atsScore.js`)

Pure-function heuristic. Out of 100:

```
parseability(20) + sections(20) + contact(10) + impact[quantified+verbs](20)
  + length(10) + formatting(10) + keywords(10)
```

Returns `{ score, grade (A+/A/B/C/D/F), issues[], strengths[], stats, breakdown, keywordMatch? }`.

Important detection details:
- **Quantified achievements**: 7 dedup'd regex patterns (%, currency, units, time, counts, "team of N", any 3+ digit number).
- **Caps overuse**: only counts lines >30 chars to avoid penalizing section headings.
- **JD keyword match**: top-25 frequency-ranked keywords from JD, intersected with resume text.
- **Stopwords**: hand-tuned list excludes common resume noise.

**Strategy for the paid AI upsell** (not yet built): wrap this heuristic with an LLM call that takes the extracted text + heuristic result, returns enriched issues. Keep the heuristic as the gate — never lose the deterministic signal.

---

## 10. Lead lifecycle / sources

A `lead` doc in Mongo carries:
- Contact: `name, email, phone`
- Source: `source` ∈ `quick-capture | abandon-beacon | ats-tool | video-pitch-tool | razorpay-checkout | (legacy /submit)`
- Service: `service` (free string) + `targetRole`
- File: `s3Key, s3Bucket, originalName, mimeType, sizeBytes` (set when resume/video attached)
- Status: see enum above
- ATS-specific: `atsScore, atsGrade, atsIssues, atsBreakdown, atsStats, keywordMatch, hadJD`
- Razorpay: `amount, razorpayOrderId, razorpayPaymentId, paidAt, paidAmount`
- Tracking: `utm, pageUrl, userAgent, fieldsFilled`

Dedupe rule: `/leads/abandon` skips if same phone has a lead in last 24h.

---

## 11. Known footguns (read before touching)

1. **`pdf-parse`** — MUST `require('pdf-parse/lib/pdf-parse.js')`, not the bare module. Bare entry runs a debug harness that crashes when its bundled test PDF is missing.
2. **Razorpay SDK errors are plain objects** — `err.message` is undefined. Read `err.error?.description || err.statusCode` for logs (already handled in `payments/order` handler).
3. **Webhook raw body** — `app.post('/payments/webhook', express.raw(...))` MUST stay BEFORE `app.use(express.json())`. Signature verification depends on the exact request bytes.
4. **CloudFront alias drift** — Terraform now declares `aliases` + `viewer_certificate` conditionally on `var.frontend_domain` / `var.api_domain`. Setting these via GitHub secrets is the only way; never hand-edit the distribution.
5. **deploy.yml `__API_URL__` injection** uses `API_URL` secret with fallback to `terraform output api_url`. Never hardcode a subdomain in the env block — that broke login + upload on 2026-04-26.
6. **MediaRecorder codec preference** is now MP4 first → WebM fallback. Don't reorder. macOS Safari can't play webm in `<video>` tags; the admin drawer has an Open-in-new-tab escape hatch.
7. **CORS** — `CORS_ORIGINS` must be an explicit allowlist in prod (currently `https://resumeright.co.in,https://www.resumeright.co.in`). `*` in prod logs a warning at boot.
8. **JWT** — algorithm not pinned, just HS256 default. If you ever switch to RS256 update both sign + verify.
9. **Frontend pages are static files copied from `frontend/` to S3** — there's no SPA router. Every page is independent HTML. Don't accidentally introduce shared state.
10. **www subdomain** — cert covers it, Route 53 record NOT created. If wiring www, also extend TF aliases on frontend distribution.

---

## 12. Open work / suggested next features

In rough priority order (Praj's growth + revenue focus):

1. **AI-augmented ATS deep scan** for paying users — wrap `atsScore.js` with an LLM call. Sold as ₹199 add-on or bundled.
2. **Server-side video transcoding** — ffmpeg webm→mp4 on `/tools/video-pitch` upload so admin inline player always works.
3. **Razorpay one-click upsell** after free ATS scan / video pitch — pre-fill order with email+phone, drop user into Checkout.
4. **WhatsApp Business API** integration so admin templates actually send (currently they open `wa.me/...` in a new tab).
5. **Instagram + ad pixel wiring** — Meta Pixel events for `ats_scan_complete` and `video_pitch_submit` (already firing GA4 + Clarity).
6. **Email sequence** for ATS-Scanned leads with score < 60 → AWS SES drip campaign.
7. **Referral code system** — `FRIEND15` is already in WhatsApp templates; wire a real redemption endpoint.
8. **www subdomain** alias + Route 53 record.
9. **Cleanup 3 orphan CloudFront distributions**: E26ULFX0H02C4F, E2ELAPUTP5KIZN, E3HUGLKM69WMGP.
10. **Update Razorpay webhook URL** to `api.resumeright.co.in/payments/webhook` (was the old CF subdomain).

---

## 13. House rules (from Praj)

- **No theory dumps.** Production-grade code, clean naming, only the comments that earn their keep.
- **Analyze existing code first.** Read before recommending. Especially the actual file at line N — don't trust your prior memory of it.
- **Push back when the user is wrong.** Suggest better architecture instead of following blindly. Think like a CTO.
- **Optimize for revenue + retention.** Every UX suggestion should answer "does this help Praj hit ₹10K/month?"
- **Indian growth context.** Pricing is INR, payments are UPI-first, audience is bilingual but UI is English. The market is "Indians applying to Indian + global jobs."
- **No frameworks introduced casually.** The vanilla HTML/JS is a deliberate choice. Bringing in React/Next would force a build-step rewrite of `index.html` (2,200 lines) and `admin.html` — not worth it without strong justification.
- **Direct, terse responses.** Show file paths, show diffs, ship the code.

---

## 14. Local dev quickstart

```bash
# Backend
cd backend
cp .env.example .env   # fill in MONGO_URI, ADMIN_KEY, JWT_SECRET at minimum
npm install
npm run dev            # node --watch server.js, listens on PORT (default 5000)

# Frontend — no build, just serve statically
cd frontend
# Open index.html in a browser, OR
python3 -m http.server 8000

# Replace __API_URL__ for local dev:
sed -i '' "s|__API_URL__|http://localhost:5000|" index.html admin.html
# (Don't commit that change. CI re-injects on every deploy.)
```

To smoke-test the ATS scanner: hit `POST http://localhost:5000/tools/ats-score` with multipart `resume=@some.pdf`, `email`, `name`, `phone`. Check the response shape matches the frontend renderer in `runAtsScan() → renderAtsResult()`.

To smoke-test admin: `POST /admin/login` with `{ key: $ADMIN_KEY }` → bearer-token the other `/admin/*` calls.

---

## 15. Production access cheat-sheet

- **EC2:** tagged `Name=resumeright-app`. SSH via SSM Session Manager (no key needed if you have AWS creds).
- **pm2 process:** `pm2 list` shows `resumeright-api`; logs at `pm2 logs resumeright-api`.
- **Code on EC2:** `/opt/resumeright/backend` (env in `.env` next to it).
- **SSM params:** `/resumeright/mongo_uri`, `/resumeright/admin_key`, `/resumeright/jwt_secret`, `/resumeright/razorpay_*`.
- **Frontend bucket:** `aws s3 ls s3://<frontend-bucket>/` (name has random suffix — check TF output).
- **CloudFront invalidation:** `aws cloudfront create-invalidation --distribution-id E305VHWR6NUGX3 --paths "/*"` (deploy.yml does this automatically).
- **MongoDB Atlas:** db name `resumeright`, two collections `leads` + `users`.

---

## 16. Recent shipping log (newest first)

```
7ae3124 fix(admin): inline video player + prefer mp4 over webm in MediaRecorder
c90ef48 feat: persist ATS PDF to S3 + tighten contact fields + new video pitch coaching tool
4ac223c feat: live ATS scanner replaces manual lead
4cd45ce deploy: flip frontend to api.resumeright.co.in
fb00be4 fix(deploy): use api_url fallback to unbreak login; wire api subdomain in TF
f9d3dca infra(cloudfront): pin resumeright.co.in alias + ACM cert in TF so deploys stop reverting it
327b91b feat(abandonment): capture phone-filled-but-unsubmitted leads + SES alert + admin tile
ec97002 analytics: wire Clarity + GA4 into customer pages
5d578ef compliance: add Privacy/Terms/Refund/Contact pages for Razorpay liveness
```

`git log --oneline` for the full picture.

---

**Your job, agent**: read this once. Then for every task — open the actual file, read the actual code, propose a clean diff. Don't break the lead funnel, don't introduce dependencies casually, don't redesign what isn't broken. Ship code that helps Praj hit ₹10K/month.
