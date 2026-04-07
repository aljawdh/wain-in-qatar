'use strict';

const { clearAuthCookie } = require('./_lib/auth');
const { isAllowedOrigin, setNoCache } = require('./_lib/security');

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  clearAuthCookie(res);
  return res.status(200).json({ ok: true });
};
