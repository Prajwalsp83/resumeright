# ResumeRight — Ops Runbook

A single reference for secret rotation, first deploy, incident recovery, and teardown.

---

## 1. GitHub Actions secrets (configure once, before first push)

Settings → Secrets and variables → Actions → New repository secret:

| Name                    | Value                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `AWS_ACCESS_KEY_ID`     | IAM user with admin/power-user for the deployer                                                    |
| `AWS_SECRET_ACCESS_KEY` | Matching secret                                                                                    |
| `MONGO_URI`             | `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/resumeright?retryWrites=true&w=majority`    |
| `ADMIN_KEY`             | Long random string for the bootstrap `/admin/login`                                                |
| `JWT_SECRET`            | **Must match** `terraform/terraform.tfvars`. Generate with the command below.                      |

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

### 3a. JWT secret (no downtime tolerated — do during low traffic)

1. Generate a new value:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. Update in **three** places (they must match):
   - GitHub secret `JWT_SECRET`
   - `terraform/terraform.tfvars` → `jwt_secret`
   - *(optional)* SSM `/resumeright/JWT_SECRET` directly, if you need instant rotation
3. Push a no-op commit (or `workflow_dispatch` the pipeline) → Actions re-applies Terraform → new SSM value → deploy rewrites `.env` → pm2 reloads.
4. All existing user JWTs are invalidated; users must log in again. That is intentional after a rotation.

### 3b. MongoDB Atlas password

The current password leaked in commit `10df4cb`. **Rotate now**.

1. Atlas UI → Database Access → edit the `resumeright` user → **Edit Password** → autogenerate.
2. Compose the new URI:
   ```
   mongodb+srv://resumeright:<NEWPASS>@<cluster>.mongodb.net/resumeright?retryWrites=true&w=majority
   ```
3. Update in **two** places:
   - GitHub secret `MONGO_URI`
   - `terraform/terraform.tfvars` → `mongo_uri`
4. Trigger the pipeline (push or `workflow_dispatch`). Terraform updates SSM; deploy pulls new value; pm2 reloads. Existing connections are recycled on reload.

### 3c. Admin bootstrap key

Also leaked in `10df4cb`. Rotate by setting a fresh random value in both `ADMIN_KEY` (GitHub) and `admin_key` (tfvars), then re-push.

### 3d. Revoking the leaked secrets from git history (optional but recommended)

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
| `deploy-backend` fails at "Wait for ASG instance to be healthy"   | Instance never passed EC2 health check (kernel / AMI / userdata broke)    | Check EC2 console → instance → System Log; re-run pipeline                                            |
| `deploy-backend` fails at "Wait for SSM agent to be online"       | Instance came up but SSM agent not reporting                              | Usually transient; re-run. If persistent, SG outbound blocks or IAM role missing `AmazonSSMManagedInstanceCore` |
| Health check fails at end of `deploy-backend`                     | pm2 crashed → `.env` issue or mongo unreachable                           | `aws ssm start-session --target <instance>`; `cd /home/ubuntu/app/backend && pm2 logs`                |
| `terraform-apply` fails on SSM parameter already exists           | You applied once by hand                                                  | `terraform import aws_ssm_parameter.mongo_uri /resumeright/MONGO_URI` etc.                            |
| Users report "Invalid or expired token" en masse                  | JWT secret was rotated                                                    | Expected for ~7 days after rotation; users re-login                                                   |
| 403 from CloudFront                                               | S3 object is missing or OAI policy mismatch                               | Check `deploy-frontend` job; `aws s3 ls s3://<bucket>/`                                               |

---

## 6. Quick reference — where things live

- **Backend code**: `/home/ubuntu/app/backend/` on the EC2 instance
- **Logs**: `pm2 logs resumeright` (as `ubuntu` user)
- **Secrets at rest**: SSM Parameter Store → `/resumeright/{MONGO_URI,ADMIN_KEY,JWT_SECRET}`
- **Uploaded resumes**: private S3 bucket `resumeright-uploads-<suffix>`; accessed via pre-signed URLs (600s TTL)
- **Frontend**: public S3 bucket `resumeright-website-<suffix>` fronted by CloudFront
- **State file**: GitHub Actions artifact `tfstate` (retention 30 days). For longer-term, migrate to an S3 backend.
