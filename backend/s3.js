// Upload backend: multer-s3 when S3_BUCKET_UPLOADS is configured, local disk
// otherwise (dev). Also exposes a signedUrlForKey() helper for admin downloads.
//
// AWS SDK is loaded lazily so dev machines without S3 credentials don't need
// to install the packages to run the app.

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const env    = require('./config');

const s3Enabled = Boolean(env.S3_BUCKET_UPLOADS);

const ALLOWED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt',
  '.png', '.jpg', '.jpeg',
]);

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return cb(new Error(`File type ${ext || '(none)'} not allowed`));
  }
  cb(null, true);
}

function randomKey(originalName) {
  const ext  = path.extname(originalName || '').toLowerCase();
  const rand = crypto.randomBytes(12).toString('hex');
  return `resumes/${Date.now()}-${rand}${ext}`;
}

function buildUploader() {
  if (s3Enabled) {
    // Lazy-require so we don't pay the AWS SDK import cost in dev.
    const { S3Client } = require('@aws-sdk/client-s3');
    const multerS3 = require('multer-s3');
    const s3 = new S3Client({ region: env.AWS_REGION });

    return multer({
      fileFilter,
      limits: { fileSize: MAX_BYTES },
      storage: multerS3({
        s3,
        bucket: env.S3_BUCKET_UPLOADS,
        serverSideEncryption: 'AES256',
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: (_req, file, cb) => cb(null, randomKey(file.originalname)),
      }),
    });
  }

  // Dev fallback — local disk
  const uploadDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  return multer({
    fileFilter,
    limits: { fileSize: MAX_BYTES },
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) => cb(null, randomKey(file.originalname).replace('resumes/', '')),
    }),
  });
}

/**
 * Pre-signed URL for a private S3 object. Defaults to 10-minute expiry.
 * Returns null when S3 is not configured.
 */
async function signedUrlForKey(key, expiresIn = 600) {
  if (!s3Enabled || !key) return null;
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const s3 = new S3Client({ region: env.AWS_REGION });
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.S3_BUCKET_UPLOADS, Key: key }),
    { expiresIn },
  );
}

module.exports = { s3Enabled, buildUploader, signedUrlForKey };
