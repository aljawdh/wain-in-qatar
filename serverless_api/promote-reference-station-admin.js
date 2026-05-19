'use strict';

var { getAuthUser, ROLE_ORDER } = require('./_lib/auth');
var { setNoCache, isAllowedOrigin, parseBody, rateLimit, cleanString } = require('./_lib/security');
var service = require('./_lib/reference-station-promotion-service');

function isAdminActor(user) {
  if (!user || !ROLE_ORDER[user.role]) return false;
  return ROLE_ORDER[user.role] >= ROLE_ORDER.admin;
}

async function assertAdminOnly(req, res) {
  var user = await getAuthUser(req);
  if (isAdminActor(user)) {
    return { user: user };
  }
  res.status(401).json({ ok: false, error: 'admin_auth_required' });
  return null;
}

function actorLabel(user) {
  return (user && (user.username || user.id)) || 'admin';
}

module.exports = async function handler(req, res) {
  setNoCache(res);
  res.setHeader('Content-Type', 'application/json');

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'forbidden_domain' });
  }

  if (!rateLimit(req, 'promote_reference_station', 20, 60 * 1000)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  var auth = await assertAdminOnly(req, res);
  if (!auth) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    var body = parseBody(req) || {};
    var result = await service.promoteReferenceStation({
      station_id: body.station_id,
      source_reference_station_id: body.source_reference_station_id,
      calendar_generation_mode: body.calendar_generation_mode,
      reason: body.reason,
      actor: actorLabel(auth.user)
    });

    if (!result.ok) {
      if (result.error === 'station_not_found') {
        return res.status(404).json(result);
      }
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
};
