'use strict';

const { readJsonFile } = require('./_lib/data-store');
const { isAllowedOrigin, setNoCache } = require('./_lib/security');

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const all = await readJsonFile('stations', []);
  const active = all
    .filter((s) => s && s.status !== 'archived' && s.status !== 'disabled')
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  return res.status(200).json({
    ok: true,
    total: active.length,
    stations: active
  });
};
