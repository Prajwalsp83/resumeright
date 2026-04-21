// Password hashing + JWT helpers + auth middleware.
// Supports a migration path from legacy plaintext passwords → bcrypt on
// successful login (see app.js /login).

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const env    = require('./config');

const BCRYPT_PREFIX = /^\$2[aby]\$/;

function isBcryptHash(s) {
  return typeof s === 'string' && BCRYPT_PREFIX.test(s);
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

async function verifyPassword(plain, stored) {
  if (!stored) return false;
  if (isBcryptHash(stored)) return bcrypt.compare(plain, stored);
  // Legacy plaintext fallback — only used once per user, then upgraded.
  return plain === stored;
}

function signToken(payload, opts = {}) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: opts.expiresIn || env.JWT_EXPIRES_IN,
  });
}

function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

/**
 * Express middleware: requires a valid Bearer JWT.
 *   requireAuth()         → any logged-in caller
 *   requireAuth('admin')  → role claim must match
 */
function requireAuth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    try {
      const payload = verifyToken(token);
      if (role && payload.role !== role) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  isBcryptHash,
  signToken,
  verifyToken,
  requireAuth,
};
