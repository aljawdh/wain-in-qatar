'use strict';

var { setNoCache, isAllowedOrigin, cleanString } = require('./_lib/security');
var guards = require('./_lib/navidur-intelligence-memory/guards');
var trends = require('./_lib/navidur-intelligence-trends');

function normalizeTrendRoute(req) {
  var q = req.query || {};
  var route = String(q._trends_route || q.route || '').trim().toLowerCase();
  if (route === 'intelligence-trends') return 'trends';
  if (route === 'intelligence-timeline') return 'timeline';
  if (route === 'intelligence-signature') return 'signature';
  return route;
}

module.exports = async function handler(req, res) {
  setNoCache(res);
  res.setHeader('Content-Type', 'application/json');

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'forbidden_domain' });
  }

  var auth = await guards.assertAdminOnly(req, res);
  if (!auth) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  var stationId = cleanString(req.query && req.query.station_id, 80);
  if (!stationId) {
    return res.status(400).json({ ok: false, error: 'station_id_required' });
  }

  var days = req.query && req.query.days != null ? req.query.days : 1;
  var sub = normalizeTrendRoute(req);

  try {
    if (sub === 'trends' || sub === 'intelligence-trends') {
      var trendResult = await trends.buildIntelligenceTrends(stationId, days);
      return res.status(200).json(trendResult);
    }
    if (sub === 'timeline' || sub === 'intelligence-timeline') {
      var timelineResult = await trends.buildIntelligenceTimeline(stationId, days);
      return res.status(200).json(timelineResult);
    }
    if (sub === 'signature' || sub === 'intelligence-signature') {
      var sigResult = await trends.buildIntelligenceSignature(stationId, days);
      return res.status(200).json(sigResult);
    }
    return res.status(400).json({ ok: false, error: 'trends_route_invalid' });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'intelligence_trends_failed',
      detail: String(err && err.message ? err.message : err)
    });
  }
};
