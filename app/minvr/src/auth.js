'use strict';
// 简单鉴权：管理员密码（sha256）比对，登录后下发内存态 token
const crypto = require('crypto');

const ADMIN_HASH = (() => {
  const p = process.env.ADMIN_PASSWORD || 'admin';
  return crypto.createHash('sha256').update(p).digest('hex');
})();

const tokens = new Set();

function issueToken() {
  const t = crypto.randomBytes(24).toString('hex');
  tokens.add(t);
  return t;
}

function verifyPassword(pwd) {
  const h = crypto.createHash('sha256').update(pwd || '').digest('hex');
  return h === ADMIN_HASH;
}

function validToken(t) {
  return !!t && tokens.has(t);
}

function revokeToken(t) {
  tokens.delete(t);
}

// 从请求中抽取 token
function extractToken(req) {
  const q = req.query && req.query.token;
  const h = req.headers && (req.headers['authorization'] || req.headers['x-token']);
  if (q) return q;
  if (h) {
    if (h.startsWith('Bearer ')) return h.slice(7);
    return h;
  }
  if (req.headers && req.headers.cookie) {
    const m = req.headers.cookie.match(/minvr_token=([a-f0-9]+)/);
    if (m) return m[1];
  }
  return null;
}

function requireAuth(req, res, next) {
  const t = extractToken(req);
  if (!validToken(t)) {
    return res.status(401).json({ error: '未登录或登录已失效' });
  }
  next();
}

module.exports = { issueToken, verifyPassword, validToken, revokeToken, requireAuth, extractToken };
