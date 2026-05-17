'use strict';

var { setNoCache, isAllowedOrigin, parseBody, rateLimit, cleanString } = require('./_lib/security');
var memory = require('./_lib/navidur-intelligence-memory');
var guards = require('./_lib/navidur-intelligence-memory/guards');
var cronConfig = require('./_lib/navidur-intelligence-memory/cron-config');

async function handleRun(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!rateLimit(req, 'run_intelligence_memory', 12, 60 * 1000)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  var auth = await guards.assertMemoryAuthorized(req, res);
  if (!auth) return;

  try {
    var body = req.method === 'POST' ? parseBody(req) : {};
    var query = req.query || {};
    var isCron = cronConfig.isCronRequest(query);
    var options;

    if (isCron && auth.mode === 'cron') {
      var config = await cronConfig.getConfig();
      if (!config.enabled) {
        return res.status(200).json({
          ok: true,
          skipped: true,
          reason: 'intelligence_cron_disabled',
          config_enabled: false,
          config_key: cronConfig.CONFIG_KEY
        });
      }
      options = cronConfig.optionsFromConfig(config, {});
      options.config_driven = true;
    } else {
      options = guards.parseRunOptions(query, body);
    }

    if (!guards.assertWritableRun(options, res)) return;
    var result = await memory.runHourlyMemory(options);
    if (result && result.ok === false) {
      var status = result.error === 'no_reference_stations_available' || result.error === 'station_not_reference'
        ? 404
        : 400;
      return res.status(status).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'run_intelligence_memory_failed',
      detail: String(err && err.message ? err.message : err)
    });
  }
}

async function handleLatest(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  var auth = await guards.assertMemoryAuthorized(req, res);
  if (!auth) return;

  var stationId = cleanString(req.query && req.query.station_id, 80);
  if (!stationId) {
    return res.status(400).json({ ok: false, error: 'station_id_required' });
  }

  try {
    var result = await memory.getLatestSnapshot(stationId);
    return res.status(200).json(result);
  } catch (err) {
    if (err && err.code === 'intel_latest_not_found') {
      return res.status(404).json({ ok: false, error: 'intel_latest_not_found', station_id: stationId });
    }
    return res.status(500).json({
      ok: false,
      error: 'intelligence_memory_latest_failed',
      detail: String(err && err.message ? err.message : err)
    });
  }
}

async function handleRuns(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  var auth = await guards.assertMemoryAuthorized(req, res);
  if (!auth) return;

  try {
    var limit = req.query && req.query.limit;
    var result = await memory.getRecentRuns(limit);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'intelligence_memory_runs_failed',
      detail: String(err && err.message ? err.message : err)
    });
  }
}

module.exports = async function handler(req, res) {
  setNoCache(res);
  res.setHeader('Content-Type', 'application/json');

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'forbidden_domain' });
  }

  var route = String(req.query && req.query._memory_route || req.query.route || '').toLowerCase();
  if (route === 'intelligence-memory-latest') return handleLatest(req, res);
  if (route === 'intelligence-memory-runs') return handleRuns(req, res);
  return handleRun(req, res);
};

module.exports.handleLatest = handleLatest;
module.exports.handleRuns = handleRuns;
module.exports.runHourlyMemoryInternal = memory.runHourlyMemory;
