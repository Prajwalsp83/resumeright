# ResumeRight — Career Services Platform

> Full-stack career services platform built with Node.js, MongoDB Atlas, AWS EC2, ALB, Auto Scaling, S3, CloudFront, and GitHub Actions CI/CD.

## Architecture

```
GitHub → GitHub Actions CI/CD → AWS EC2 (Auto Scaling Group)
                                         ↓
Users → CloudFront → S3 (Frontend)    ALB → EC2 instances
Users → CloudFront (API) → ALB → EC2 → MongoDB Atlas
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML/CSS/JS → S3 + CloudFront |
| Backend | Node.js + Express → EC2 (Auto Scaling) |
| Database | MongoDB Atlas (M0 Free) |
| CDN | AWS CloudFront |
| Load Balancer | AWS Application Load Balancer |
| Scaling | AWS Auto Scaling Group |
| CI/CD | GitHub Actions |
| Process Manager | PM2 |
| Secrets | AWS SSM Parameter Store |

## AWS Resources Used

- **EC2** — Application servers (t3.micro)
- **ALB** — Application Load Balancer with health checks
- **Auto Scaling Group** — Min 1, Max 3 instances
- **Launch Template** — EC2 configuration + bootstrap script
- **S3** — Frontend static hosting
- **CloudFront** — CDN for frontend and API (HTTPS)
- **SSM** — Secrets management + remote deployment
- **IAM** — Roles and policies
- **VPC** — Network isolation with public/private subnets
- **Security Groups** — Firewall rules

## GitHub Secrets Required

Set these in GitHub → Settings → Secrets → Actions:

```
AWS_ACCESS_KEY_ID        → IAM user access key
AWS_SECRET_ACCESS_KEY    → IAM user secret key
EC2_PUBLIC_IP            → Your EC2 instance IP
S3_BUCKET                → resumeright-website
CLOUDFRONT_DIST_ID       → Your website CloudFront distribution ID
```

## Services & Pricing

### ATS Resume Writing
- Basic: ₹999 | Professional: ₹1,999 | Premium: ₹3,499

### Naukri Profile Optimization
- One-time: ₹799 | Monthly: ₹1,499 | 3-Month: ₹3,999

### LinkedIn Branding
- Makeover: ₹999 | Growth: ₹2,499 | Monthly: ₹1,999

### Career Bundles
- Starter: ₹1,999 | Pro: ₹4,999 | Elite: ₹9,999

## Local Development

```bash
cd backend
npm install
npm start
```

## Deploy

Push to `main` branch → GitHub Actions automatically:
1. Runs tests
2. Deploys backend to EC2 via SSM
3. Deploys frontend to S3
4. Invalidates CloudFront cache

## Contact

WhatsApp: +91-97312-09180
