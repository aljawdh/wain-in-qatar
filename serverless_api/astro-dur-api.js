'use strict';

/**
 * Legacy geo-astronomical monitoring API (dur_windows / operational workbook) — removed.
 * NAVIDUR timing: data/true_final_station_reference.json only.
 */
function applyCorsHeaders(res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

module.exports = async function astroDurApiHandler(req, res) {
  applyCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }
  return res.status(410).json({
    ok: false,
    error: 'legacy_astro_dur_api_removed',
    message: 'NAVIDUR uses data/true_final_station_reference.json for timing; dur_windows-based monitoring was removed'
  });
};
