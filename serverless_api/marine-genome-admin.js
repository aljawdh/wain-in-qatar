'use strict';

var { getAuthUser, ROLE_ORDER } = require('./_lib/auth');
var { setNoCache, isAllowedOrigin, parseBody, rateLimit, cleanString } = require('./_lib/security');
var genome = require('./_lib/marine-knowledge-genome');
var traitReviewService = require('./_lib/trait-review-service');

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

module.exports = async function handler(req, res) {
  setNoCache(res);
  res.setHeader('Content-Type', 'application/json');

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'forbidden_domain' });
  }

  var route = String(req.query && req.query.route || '').toLowerCase();
  if (!rateLimit(req, 'marine_genome_admin_' + route, 60, 60 * 1000)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  var auth = await assertAdminOnly(req, res);
  if (!auth) return;

  try {
    if (route === 'marine-genome') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      return res.status(200).json(genome.dto.genomeDictionaryResponse(genome.getGenome()));
    }

    if (route === 'marine-genome-expected') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      var stationId = cleanString(req.query.station_id, 80);
      if (!stationId) {
        return res.status(400).json({ ok: false, error: 'station_id_required' });
      }
      var ctxExpected = {
        station_id: stationId,
        reference_station_id: cleanString(req.query.reference_station_id, 80) || stationId,
        dur_name: cleanString(req.query.dur_name, 120),
        dur_day: req.query.dur_day != null && req.query.dur_day !== '' ? Number(req.query.dur_day) : null
      };
      return res.status(200).json(genome.getExpectedTraitsForStation(ctxExpected));
    }

    if (route === 'marine-genome-match') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      var ctxMatch = await genome.analysisContext.buildAnalysisContext(req.query || {});
      var matrix = genome.buildMatchMatrix(ctxMatch);
      return res.status(200).json(matrix);
    }

    if (route === 'marine-genome-trait-review') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      var body = parseBody(req);
      var payload = genome.dto.reviewPayloadFromGenome(body, (auth.user && (auth.user.username || auth.user.id)) || 'admin');
      var actor = (auth.user && (auth.user.username || auth.user.id)) || 'admin';
      var saved = await traitReviewService.saveReview(payload, actor);
      return res.status(200).json({ ok: true, review: saved, genome_version: saved.genome_version || 'v1' });
    }

    return res.status(404).json({ ok: false, error: 'marine_genome_route_not_found' });
  } catch (err) {
    var code = err && (err.code === 400 || err.code === 404) ? err.code : 500;
    return res.status(code).json({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
};
