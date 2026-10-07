const crypto = require('crypto');

// Server-side admin auth. Set ADMIN_PIN (and ideally ADMIN_SESSION_SECRET)
// as environment variables. The PIN never reaches the browser.
const COOKIE = 'admin_session';
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours

function secret() {
  return process.env.ADMIN_SESSION_SECRET || ('pin:' + (process.env.ADMIN_PIN || ''));
}
function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function makeToken() {
  const exp = String(Date.now() + SESSION_MS);
  return exp + '.' + sign(exp);
}
function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function isAuthed(req) {
  if (!process.env.ADMIN_PIN) return false;
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}
function requireAdmin(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ success: false, message: 'Unauthorized' });
}

// Basic brute-force limit: 5 wrong PINs per IP per 10 minutes.
const attempts = new Map();
function login(req, res) {
  if (!process.env.ADMIN_PIN) {
    return res.status(500).json({ success: false, message: 'ADMIN_PIN is not configured on the server' });
  }
  const ip = req.ip;
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, first: now };
  if (now - rec.first > 10 * 60 * 1000) { rec.count = 0; rec.first = now; }
  if (rec.count >= 5) {
    return res.status(429).json({ success: false, message: 'Too many attempts. Try again in a few minutes.' });
  }
  if (!safeEqual(String((req.body && req.body.pin) || ''), process.env.ADMIN_PIN)) {
    rec.count++; attempts.set(ip, rec);
    return res.status(401).json({ success: false, message: 'Wrong PIN' });
  }
  attempts.delete(ip);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(makeToken())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  res.json({ success: true });
}
function me(req, res) { res.json({ authed: isAuthed(req) }); }

module.exports = { requireAdmin, login, me };
