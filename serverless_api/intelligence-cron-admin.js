'use strict';

var { setNoCache, isAllowedOrigin, parseBody, rateLimit, cleanString } = require('./_lib/security');
var { loadReferenceData } = require('./_lib/navidur-analysis-runtime');
var guards = require('./_lib/navidur-intelligence-memory/guards');
var cronConfig = require('./_lib/navidur-intelligence-memory/cron-config');
var refStations = require('./_lib/navidur-intelligence-memory/reference-stations');
var store = require('./_lib/navidur-intelligence-memory/store');
var memory = require('./_lib/navidur-intelligence-memory');

async function handleGetConfig(req, res) {
  var config = await cronConfig.getConfig();
  var referenceData = await loadReferenceData();
  var refs = refStations.listEligibleReferenceStations(referenceData, guards.isPreviewEligibleStation);
  var selected = (config.selected_station_ids || []).length;
  return res.status(200).json({
    ok: true,
    config: config,
    config_key: cronConfig.CONFIG_KEY,
    reference_station_count: refs.length,
    selected_station_count: selected,
    allowlist_key: cronConfig.ALLOWLIST_KEY,
    cron_state_key: cronConfig.CRON_STATE_KEY
  });
}

async function handlePutConfig(req, res, auth) {
  var body = parseBody(req);
  var allowed = {
    enabled: body.enabled,
    mode: body.mode,
    reference_only: body.reference_only,
    limit: body.limit,
    max_limit: body.max_limit,
    rotation_enabled: body.rotation_enabled,
    selected_station_ids: body.selected_station_ids,
    exclude_station_ids: body.exclude_station_ids,
    run_only_selected: body.run_only_selected
  };
  var current = await cronConfig.getConfig();
  Object.keys(allowed).forEach(function (k) {
    if (allowed[k] === undefined) delete allowed[k];
  });
  var merged = Object.assign({}, current, allowed);
  var actor = (auth.user && (auth.user.username || auth.user.id)) || 'admin';
  var saved = await cronConfig.saveConfig(merged, actor);
  var referenceData = await loadReferenceData();
  var allowlist = await cronConfig.syncAllowlist(referenceData, saved);
  return res.status(200).json({
    ok: true,
    config: saved,
    allowlist: allowlist
  });
}

async function handleGetStations(req, res) {
  var config = await cronConfig.getConfig();
  var referenceData = await loadReferenceData();
  var isEligible = guards.isPreviewEligibleStation;
  var refs = refStations.listEligibleReferenceStations(referenceData, isEligible);
  var refIds = {};
  refs.forEach(function (s) {
    refIds[String(s.id)] = true;
  });
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
    var latest = await store.intelGet(store.keys().latest(sid));
    rows.push({
      station_id: sid,
      name: String(st.name_ar || st.name || sid),
      is_reference_station: refStations.isReferenceStation(st),
      reference_station_id: String(st.reference_station_id || ''),
      region: String(st.region || ''),
      country: String(st.country || ''),
      selected: selected[sid] === true,
      excluded: excluded[sid] === true,
      latest_snapshot_at: latest && latest.timestamp ? latest.timestamp : null
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

async function handleTestRun(req, res) {
  var q = req.query || {};
  var dryRun = String(q.dry_run || '1') === '1' || String(q.dry_run || '').toLowerCase() === 'true';
  var config = await cronConfig.getConfig();
  var options = cronConfig.optionsFromConfig(config, { dry_run: dryRun });
  options.config_driven = true;
  if (!guards.assertWritableRun(options, res)) return;
  var result = await memory.runHourlyMemory(options);
  if (result && result.ok === false) {
    var status = result.error === 'no_reference_stations_available' || result.error === 'station_not_reference'
      ? 404
      : 400;
    return res.status(status).json(result);
  }
  return res.status(200).json(Object.assign({ ok: true, trigger: 'admin_test_run' }, result));
}

module.exports = async function handler(req, res) {
  setNoCache(res);
  res.setHeader('Content-Type', 'application/json');

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'forbidden_domain' });
  }

  var route = String(req.query && req.query.route || req.query._cron_route || '').toLowerCase();
  if (!rateLimit(req, 'intelligence_cron_admin_' + route, 30, 60 * 1000)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  var auth = await guards.assertAdminOnly(req, res);
  if (!auth) return;

  try {
    if (route === 'intelligence-cron-config') {
      if (req.method === 'GET') return handleGetConfig(req, res);
      if (req.method === 'PUT' || req.method === 'POST') return handlePutConfig(req, res, auth);
      res.setHeader('Allow', 'GET, PUT, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }
    if (route === 'intelligence-cron-stations') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      return handleGetStations(req, res);
    }
    if (route === 'intelligence-cron-test-run') {
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      return handleTestRun(req, res);
    }
    return res.status(404).json({ ok: false, error: 'cron_route_not_found' });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'intelligence_cron_admin_failed',
      detail: String(err && err.message ? err.message : err)
    });
  }
};
