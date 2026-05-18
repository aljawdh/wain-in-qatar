'use strict';

var { getAuthUser, ROLE_ORDER } = require('./_lib/auth');
var { setNoCache, isAllowedOrigin, parseBody, rateLimit, cleanString } = require('./_lib/security');
var { loadReferenceData } = require('./_lib/navidur-analysis-runtime');
var guards = require('./_lib/navidur-intelligence-memory/guards');
var refStations = require('./_lib/navidur-intelligence-memory/reference-stations');
var genomeReviewConfig = require('./_lib/genome-review-config');
var traitReviewStore = require('./_lib/trait-review-store');

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

async function latestGenomeReviewAt(stationId) {
  var reviews = await traitReviewStore.listReviews({
    station_id: stationId,
    limit: 400
  });
  var best = null;
  reviews.forEach(function (r) {
    if (String(r.source || '') !== 'marine_knowledge_genome') return;
    var sid = String(r.station_id || '');
    var rid = String(r.reference_station_id || '');
    if (sid !== stationId && rid !== stationId) return;
    var at = r.reviewed_at ? String(r.reviewed_at) : '';
    if (at && (!best || at > best)) best = at;
  });
  return best;
}

async function handleGetConfig(req, res) {
  var config = await genomeReviewConfig.getConfig();
  var referenceData = await loadReferenceData();
  var refs = refStations.listEligibleReferenceStations(referenceData, guards.isPreviewEligibleStation);
  return res.status(200).json({
    ok: true,
    config: config,
    config_key: genomeReviewConfig.CONFIG_KEY,
    reference_station_count: refs.length,
    selected_station_count: (config.selected_station_ids || []).length
  });
}

async function handlePutConfig(req, res, auth) {
  var body = parseBody(req);
  var allowed = {
    enabled: body.enabled,
    reference_only: body.reference_only,
    run_only_selected: body.run_only_selected,
    selected_station_ids: body.selected_station_ids,
    exclude_station_ids: body.exclude_station_ids,
    allow_bulk_save: body.allow_bulk_save
  };
  var current = await genomeReviewConfig.getConfig();
  Object.keys(allowed).forEach(function (k) {
    if (allowed[k] === undefined) delete allowed[k];
  });
  var merged = Object.assign({}, current, allowed);
  var actor = (auth.user && (auth.user.username || auth.user.id)) || 'admin';
  var saved = await genomeReviewConfig.saveConfig(merged, actor);
  return res.status(200).json({
    ok: true,
    config: saved,
    config_key: genomeReviewConfig.CONFIG_KEY
  });
}

async function handleGetStations(req, res) {
  var config = await genomeReviewConfig.getConfig();
  var referenceData = await loadReferenceData();
  var isEligible = guards.isPreviewEligibleStation;
  var refs = refStations.listEligibleReferenceStations(referenceData, isEligible);
  var selected = {};
  (config.selected_station_ids || []).forEach(function (id) {
    selected[String(id)] = true;
  });
  var excluded = {};
  (config.exclude_station_ids || []).forEach(function (id) {
    excluded[String(id)] = true;
  });

  var rows = [];
  for (var i = 0; i < refs.length; i += 1) {
    var st = refs[i];
    var sid = String(st.id);
    var latest = await latestGenomeReviewAt(sid);
    rows.push({
      station_id: sid,
      name: String(st.name_ar || st.name || sid),
      country: String(st.country || ''),
      region: String(st.region || ''),
      selected: selected[sid] === true,
      excluded: excluded[sid] === true,
      latest_genome_review_at: latest
    });
  }

  rows.sort(function (a, b) {
    return String(a.station_id).localeCompare(String(b.station_id));
  });

  return res.status(200).json({
    ok: true,
    reference_only: config.reference_only,
    reference_station_count: refs.length,
    stations: rows
  });
}

module.exports = async function handler(req, res) {
  setNoCache(res);
  res.setHeader('Content-Type', 'application/json');

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'forbidden_domain' });
  }

  var route = String(req.query && req.query.route || '').toLowerCase();
  if (!rateLimit(req, 'genome_review_config_' + route, 40, 60 * 1000)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  var auth = await assertAdminOnly(req, res);
  if (!auth) return;

  try {
    if (route === 'genome-review-config') {
      if (req.method === 'GET') return handleGetConfig(req, res);
      if (req.method === 'PUT' || req.method === 'POST') return handlePutConfig(req, res, auth);
      res.setHeader('Allow', 'GET, PUT, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }
    if (route === 'genome-review-stations') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      return handleGetStations(req, res);
    }
    return res.status(404).json({ ok: false, error: 'genome_review_route_not_found' });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'genome_review_config_failed',
      detail: String(err && err.message ? err.message : err)
    });
  }
};
