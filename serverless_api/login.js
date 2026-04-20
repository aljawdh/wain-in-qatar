'use strict';

const { login, setAuthCookie } = require('./_lib/auth');
const { isAllowedOrigin, parseBody, setNoCache, rateLimit } = require('./_lib/security');

module.exports = async function handler(req, res) {
  setNoCache(res);
  res.setHeader('Content-Type', 'application/json');

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!rateLimit(req, 'login', 20, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const body = parseBody(req) || {};
  const safeUsername = String(body.username || '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]/g, '')
    .trim()
    .toLowerCase()
    .slice(0, 60);
  console.info('[auth] login request', {
    username: safeUsername,
    passwordProvided: !!String(body.password || '').trim()
  });
  const out = await login(body.username, body.password);
  if (!out) {
    console.info('[auth] login response', { status: 401, username: safeUsername });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  setAuthCookie(res, out.token, req);
  console.info('[auth] login response', { status: 200, username: safeUsername });
  return res.status(200).json({ ok: true, token: out.token, user: out.user });
};
