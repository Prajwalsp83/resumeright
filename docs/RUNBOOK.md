# ResumeRight — Ops Runbook

A single reference for secret rotation, first deploy, incident recovery, and teardown.

---

## 1. GitHub Actions secrets (configure once, before first push)

Settings → Secrets and variables → Actions → New repository secret:

| Name                         | Value                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `AWS_ACCESS_KEY_ID`          | IAM user with admin/power-user for the deployer                                                    |
| `AWS_SECRET_ACCESS_KEY`      | Matching secret                                                                                    |
| `TF_STATE_BUCKET`            | S3 bucket name holding `resumeright/terraform.tfstate` (must exist + versioned + SSE)              |
| `MONGO_URI`                  | `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/resumeright?retryWrites=true&w=majority`    |
| `ADMIN_KEY`                  | Long random string for the bootstrap `/admin/login`                                                |
| `JWT_SECRET`                 | 48+ byte random. Generate with the command below.                                                  |
| `RAZORPAY_KEY_ID`            | *(optional)* Razorpay Key ID — `rzp_test_*` or `rzp_live_*`. Leave blank to disable `/payments/*`. |
| `RAZORPAY_KEY_SECRET`        | *(optional)* Razorpay Key Secret, paired with the Key ID above                                     |
| `RAZORPAY_WEBHOOK_SECRET`    | *(optional)* Webhook secret, set when you create the webhook in Razorpay Dashboard                 |

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> Do **not** put `terraform.tfvars` in git. It is in `.gitignore` and was removed from the index.

---

## 2. First deploy (the green-path)

1. Verify locally:
   ```bash
   cd backend && npm ci && node --check server.js && cd ..
   ```
2. Commit + push to `main`:
   ```bash
   git add -A
   git commit -m "wire production pipeline"
   git push origin main
   ```
3. Watch the pipeline: GitHub → Actions → **ResumeRight CI/CD Pipeline**.
   - `test` → 1–2 min
   - `terraform-apply` → 8–12 min first time (CloudFront is slow)
   - `deploy-backend` → 3–5 min (waits for SSM agent)
   - `deploy-frontend` → 1 min
4. On success, grab `frontend_url` from the terraform-apply job log. Open it in a browser.

---

## 3. Rotating secrets

### 3a. JWT secret (invalidates all live sessions)

1. Generate a new value:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. Update the GitHub secret `JWT_SECRET` (Settings → Secrets and variables → Actions).
   - If you also keep a local `terraform/terraform.tfvars`, update `jwt_secret` there so hand-runs of terraform stay in sync. It's `.gitignore`d.
3. Push a no-op commit (or `workflow_dispatch` the pipeline) → Terraform updates SSM → deploy rewrites `.env` → pm2 reloads.
4. All existing user JWTs are invalidated; users must log in again. That is intentional after a rotation.

### 3b. MongoDB Atlas password

1. Atlas UI → Database Access → edit the `resumeright` user → **Edit Password** → autogenerate.
2. Compose the new URI:
   ```
   mongodb+srv://resumeright:<NEWPASS>@<cluster>.mongodb.net/resumeright?retryWrites=true&w=majority
   ```
3. Update the GitHub secret `MONGO_URI`. (Also update `terraform/terraform.tfvars` locally if you keep one.)
4. Trigger the pipeline (push or `workflow_dispatch`). Terraform updates SSM; deploy pulls new value; pm2 reloads. Existing connections are recycled on reload.

### 3c. Admin bootstrap key

Rotate by setting a fresh random value in GitHub secret `ADMIN_KEY`, then re-push. This invalidates any existing admin JWT on its next refresh (12h max).

### 3d. Razorpay keys

**When to rotate:** Key Secret leaked in logs/commits, laptop lost, staff offboarded, or scheduled hygiene (every 90 days).

1. Razorpay Dashboard → **Account & Settings → API Keys** → **Regenerate Test/Live Key**.
   - Razorpay immediately shows the *new* Key ID + Secret. The old pair stops working within minutes, so have the next steps ready.
2. Update GitHub secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
3. Trigger the pipeline (push or `workflow_dispatch`). Terraform updates SSM → deploy rewrites `.env` → pm2 reloads.
4. Verify `/` returns `"razorpay":true`. Test a ₹1 order in test mode end-to-end.

**Webhook secret rotation:**

1. Razorpay Dashboard → **Settings → Webhooks** → edit the webhook → **Regenerate secret**.
2. Copy the new secret, update GitHub `RAZORPAY_WEBHOOK_SECRET`, re-run pipeline.
3. Any in-flight webhooks signed with the old secret will fail verification for ~1–2 min until pm2 reloads — Razorpay retries automatically.

**If you're just setting them up for the first time** (as opposed to rotating): same flow, but also add a webhook in Razorpay Dashboard pointing at `https://<api-cloudfront>/payments/webhook`, subscribed to **`payment.captured`**. Copy the secret into GitHub before the first test payment.

### 3e. Revoking leaked secrets from git history (if a secret ever landed in a commit)

The values in `10df4cb` are public to anyone who ever had repo access. Rotation above makes them useless, but to also purge the history:

```bash
# Install BFG (one-time): brew install bfg
bfg --replace-text <(cat <<'PAT'
<old-mongo-password>==>REDACTED
<old-admin-key>==>REDACTED
PAT
) .
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force
```

> Force-push rewrites shared history. Coordinate with collaborators if any.

---

## 4. Tearing down infrastructure (manual approval required)

1. GitHub → Actions → **ResumeRight CI/CD Pipeline** → **Run workflow** →
   - Branch: `main`
   - Destroy input: type `DESTROY` exactly
2. Job `Waiting for Destroy Approval` pauses at the `production` environment gate.
3. Go to the run → **Review deployments** → approve.
4. `terraform destroy` runs. ~5–8 min.
5. Only AWS resources are deleted. MongoDB Atlas free cluster is untouched.

To keep the option of redeploying, do **not** delete:
- The Atlas cluster
- The GitHub repository secrets
- `terraform/terraform.tfvars` on your laptop

---

## 5. Common failure modes

| Symptom                                                           | Diagnosis                                                                 | Fix                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `deploy-backend` fails at "Wait for SSM agent to be online"       | Instance came up but SSM agent not reporting (typically within 2min)      | Usually transient; re-run. If persistent, SG outbound blocks or IAM role missing `AmazonSSMManagedInstanceCore` |
| `deploy-backend` "SSM deploy failed" with pm2 error in stderr     | `.env` issue, missing dep, or bad MONGO_URI — `pm2 logs` in step output has the real cause | Read the inline `pm2 logs resumeright --lines 80` dump; fix secret or code; re-push                   |
| `DB connectivity check` fails after `Backend process is healthy`  | App is up but can't reach Mongo → Atlas allowlist is blocking the EIP     | Add the Elastic IP from the `Capture outputs` step to **Atlas → Network Access**. EIP is stable across deploys. |
| `terraform-apply` fails on "ParameterAlreadyExists"               | SSM param created outside Terraform                                       | `terraform import aws_ssm_parameter.<name> /resumeright/<NAME>`                                       |
| `/payments/order` returns 503 "Payments not configured"           | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` not in SSM                      | Add both to GitHub secrets, re-deploy. Verify `/` response has `"razorpay":true`.                     |
| `/payments/webhook` keeps returning 400 "Invalid signature"       | `RAZORPAY_WEBHOOK_SECRET` in SSM doesn't match the one in Razorpay Dashboard | Regenerate in Razorpay Dashboard → Webhooks; copy new secret to GitHub; re-deploy.                   |
| Users report "Invalid or expired token" en masse                  | JWT secret was rotated                                                    | Expected — users re-login. Normal within 7 days of rotation.                                          |
| 403 from CloudFront                                               | S3 object missing or public-read bucket policy not applied                | Check `deploy-frontend` job; `aws s3 ls s3://<frontend-bucket>/`; re-push to rebuild                  |
| Frontend loads but `const API = '__API_URL__'` (unreplaced)       | The "Inject API URL" step failed or the terraform output was empty        | Check `terraform-apply` output `api_url` — if empty, CloudFront distro failed; re-apply               |

---

## 6. Quick reference — where things live

- **Infra:** single `t3.micro` EC2 + Elastic IP (no ALB, no ASG). Two CloudFront distros (frontend / API). Two S3 buckets (frontend public, uploads private).
- **Backend code**: `/home/ubuntu/app/backend/` on the EC2 instance
- **Logs**: `sudo -u ubuntu pm2 logs resumeright` (shell in via `aws ssm start-session --target <instance-id>`)
- **Secrets at rest**: SSM Parameter Store → `/resumeright/*`
  - `MONGO_URI`, `ADMIN_KEY`, `JWT_SECRET` (required)
  - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (optional — payments gracefully disable if missing)
- **Uploaded resumes**: private S3 bucket `resumeright-uploads-<suffix>`; accessed via pre-signed URLs (600s TTL, 180-day lifecycle expiry on unprocessed objects)
- **Frontend**: public S3 bucket `resumeright-website-<suffix>` fronted by CloudFront; `__API_URL__` placeholder in HTML is `sed`-replaced at deploy time with `terraform output api_url`
- **Terraform state**: S3 backend — bucket `$TF_STATE_BUCKET`, key `resumeright/terraform.tfstate`, encrypted. Every pipeline run reads/writes the same state.
- **Admin access**: `https://<frontend-cloudfront>/admin.html` → paste `ADMIN_KEY` → backend swaps it for a 12h JWT stored in sessionStorage.

---

## 7. Health checks to run after any deploy

```bash
# 1. Process is up (no DB)
curl https://<api-cloudfront>/healthz
# → {"ok":true}

# 2. DB is reachable + razorpay flag
curl https://<api-cloudfront>/
# → {"status":"ResumeRight backend OK","leads":<n>,"users":<n>,"s3":true,"razorpay":true}

# 3. Frontend was injected with the right API URL
curl -s https://<frontend-cloudfront>/index.html | grep "const API"
# → should show the api_url, NOT __API_URL__

# 4. Admin login still works
curl -X POST https://<api-cloudfront>/admin/login \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$ADMIN_KEY\"}"
# → {"success":true,"token":"eyJ..."}
```

If any of those fail, jump to **Section 5 — Common failure modes**.
