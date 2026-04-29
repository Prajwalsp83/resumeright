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

function randomKey(originalName, prefix = 'resumes') {
  const ext  = path.extname(originalName || '').toLowerCase();
  const rand = crypto.randomBytes(12).toString('hex');
  return `${prefix}/${Date.now()}-${rand}${ext}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Buffer uploader — for endpoints that parse a file in-memory (ats-score)
// and still need to persist it to S3 afterwards. Returns { key, bucket }
// or null when S3 isn't configured (dev). Never throws — fail-soft so a
// disk-write hiccup doesn't kill the user-facing scan response.
// ───────────────────────────────────────────────────────────────────────────
async function putBufferToS3({ buffer, originalName, contentType, prefix = 'resumes' }) {
  if (!s3Enabled || !buffer) return null;
  try {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: env.AWS_REGION });
    const key = randomKey(originalName, prefix);
    await s3.send(new PutObjectCommand({
      Bucket: env.S3_BUCKET_UPLOADS,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
      ServerSideEncryption: 'AES256',
    }));
    return { key, bucket: env.S3_BUCKET_UPLOADS };
  } catch (err) {
    console.error('[s3:put]', err.message || err);
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Video pitch uploader — separate from buildUploader() because:
// 1. larger size cap (50MB for short ~60s mobile clips),
// 2. different file-type allowlist (mp4/webm/mov/quicktime),
// 3. distinct S3 key prefix `video-pitches/` so admin can scope queries.
// ───────────────────────────────────────────────────────────────────────────
const VIDEO_EXT  = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogg']);
const VIDEO_MIME = new Set([
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
  'video/ogg', 'application/octet-stream', // MediaRecorder blobs sometimes lose mime
]);
const VIDEO_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

function buildVideoUploader() {
  function videoFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const ok = VIDEO_EXT.has(ext) || VIDEO_MIME.has(file.mimetype);
    if (!ok) return cb(new Error('Only MP4 / WebM / MOV videos are accepted'));
    cb(null, true);
  }

  if (s3Enabled) {
    const { S3Client } = require('@aws-sdk/client-s3');
    const multerS3 = require('multer-s3');
    const s3 = new S3Client({ region: env.AWS_REGION });

    return multer({
      fileFilter: videoFilter,
      limits: { fileSize: VIDEO_MAX_BYTES },
      storage: multerS3({
        s3,
        bucket: env.S3_BUCKET_UPLOADS,
        serverSideEncryption: 'AES256',
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: (_req, file, cb) => cb(null, randomKey(file.originalname, 'video-pitches')),
      }),
    });
  }

  const uploadDir = path.join(__dirname, 'uploads', 'videos');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  return multer({
    fileFilter: videoFilter,
    limits: { fileSize: VIDEO_MAX_BYTES },
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) => cb(null, randomKey(file.originalname, 'video-pitches').replace('video-pitches/', '')),
    }),
  });
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

module.exports = {
  s3Enabled,
  buildUploader,
  buildVideoUploader,
  putBufferToS3,
  signedUrlForKey,
};
