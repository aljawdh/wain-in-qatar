'use strict';

const { login, setAuthCookie } = require('./_lib/auth');
const { isAllowedOrigin, parseBody, setNoCache, rateLimit } = require('./_lib/security');

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!rateLimit(req, 'login', 20, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const body = parseBody(req);
  const out = await login(body.username, body.password);
  if (!out) return res.status(401).json({ error: 'invalid_credentials' });

  setAuthCookie(res, out.token);
  return res.status(200).json({ ok: true, token: out.token, user: out.user });
};
