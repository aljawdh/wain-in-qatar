'use strict';

var { setNoCache, isAllowedOrigin } = require('./_lib/security');
var { getAuthUser, ROLE_ORDER } = require('./_lib/auth');
var preview = require('./_lib/navidur-intelligence-preview');

function isAdminActor(user) {
  if (!user || !ROLE_ORDER[user.role]) return false;
  return ROLE_ORDER[user.role] >= ROLE_ORDER.admin;
}

module.exports = async function handler(req, res) {
  setNoCache(res);
  res.setHeader('Content-Type', 'application/json');

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'forbidden_domain' });
  }

  var actor = await getAuthUser(req);
  if (!isAdminActor(actor)) {
    return res.status(401).json({ ok: false, error: 'admin_auth_required' });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    var result = await preview.buildIntelligencePreview(req.query || {});
    return res.status(200).json(result);
  } catch (err) {
    var code = err && err.code ? String(err.code) : '';
    if (code === 'station_id_required') {
      return res.status(400).json({ ok: false, error: 'station_id_required' });
    }
    if (code === 'station_not_found') {
      return res.status(404).json({ ok: false, error: 'station_not_found' });
    }
    if (code === 'station_coordinates_required') {
      return res.status(400).json({ ok: false, error: 'station_coordinates_required' });
    }
    return res.status(500).json({
      ok: false,
      error: 'intelligence_preview_failed',
      detail: String(err && err.message ? err.message : err)
    });
  }
};
