'use strict';

const { isAllowedOrigin, setNoCache } = require('./_lib/security');
const { requireRole } = require('./_lib/auth');
const { runSystemIntegrityScan } = require('./_lib/system-integrity-center');

module.exports = async function handler(req, res) {
  setNoCache(res);
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  const actor = await requireRole('admin')(req, res);
  if (!actor) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const report = await runSystemIntegrityScan();
    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({
      status: 'critical',
      generated_at: new Date().toISOString(),
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
      runtime_version: process.version,
      checks: {},
      metrics: {},
      summary: { critical: 1, warnings: 0, ok: 0 },
      error: String(err && err.message ? err.message : err)
    });
  }
};
