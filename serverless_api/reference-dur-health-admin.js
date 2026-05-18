'use strict';

var { getAuthUser, ROLE_ORDER } = require('./_lib/auth');
var { setNoCache, isAllowedOrigin, parseBody, rateLimit, cleanString } = require('./_lib/security');
var service = require('./_lib/reference-dur-health-service');

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

  var route = String(req.query && req.query.route || '').toLowerCase();
  if (!rateLimit(req, 'reference_dur_health_' + route, 80, 60 * 1000)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  var auth = await assertAdminOnly(req, res);
  if (!auth) return;

  try {
    if (route === 'reference-dur-health') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      var asOf = cleanString(req.query.as_of_iso, 20);
      var list = await service.getReferenceDurHealthList(asOf || undefined);
      return res.status(200).json(list);
    }

    if (route === 'reference-dur-primary-save') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      var bodySave = parseBody(req);
      var saved = await service.savePrimaryReferenceDur(bodySave, actorLabel(auth.user));
      if (!saved.ok) {
        var code = saved.error === 'station_not_found' || saved.error === 'not_reference_station' ? 400 : 400;
        if (saved.error === 'kv_required_for_primary_save') code = 503;
        return res.status(code).json(saved);
      }
      return res.status(200).json(saved);
    }

    if (route === 'reference-dur-audit-list') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      var stationId = cleanString(req.query.station_id, 80);
      if (!stationId) {
        return res.status(400).json({ ok: false, error: 'station_id_required' });
      }
      var audits = await service.listAuditsForStation(stationId, 100);
      return res.status(200).json({ ok: true, station_id: stationId, audits: audits });
    }

    if (route === 'reference-dur-rollback') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      var bodyRb = parseBody(req);
      var rolled = await service.rollbackReferenceDur(bodyRb, actorLabel(auth.user));
      if (!rolled.ok) {
        return res.status(400).json(rolled);
      }
      return res.status(200).json(rolled);
    }

    return res.status(404).json({ ok: false, error: 'reference_dur_route_not_found' });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
};
