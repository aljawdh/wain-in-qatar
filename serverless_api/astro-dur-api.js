'use strict';

/**
 * Geo-astronomical / workbook monitoring (admin). `path=status` reports layer health
 * (legacy dur_windows workbook import paths remain removed — see 410 for preview routes).
 */
function applyCorsHeaders(res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function normalizePath(req) {
  var p = req.query && req.query.path;
  if (Array.isArray(p)) {
    return String(p[0] != null ? p[0] : '')
      .trim()
      .toLowerCase();
  }
  return String(p != null ? p : '')
    .trim()
    .toLowerCase();
}

module.exports = async function astroDurApiHandler(req, res) {
  applyCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  var subPath = normalizePath(req);
  if (subPath === 'status') {
    return res.status(200).json({
      ok: true,
      status: 'running',
    });
  }

  return res.status(410).json({
    ok: false,
    error: 'legacy_astro_dur_api_removed',
    message:
      'NAVIDUR uses data/true_final_station_reference.json for timing; dur_windows-based monitoring and preview were removed for paths other than status',
  });
};
