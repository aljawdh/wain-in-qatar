'use strict';

var store = require('./store');
var refStations = require('./reference-stations');
var preview = require('../navidur-intelligence-preview');

var CONFIG_KEY = 'navidur_intel_config';
var ALLOWLIST_KEY = 'navidur_intel_cron_station_allowlist';
var CRON_STATE_KEY = 'navidur_intel_cron_state';

function nowIso() {
  return new Date().toISOString();
}

function defaultConfig(updatedBy) {
  return {
    enabled: false,
    mode: 'hourly',
    reference_only: true,
    limit: 3,
    max_limit: 5,
    rotation_enabled: true,
    selected_station_ids: [],
    exclude_station_ids: [],
    run_only_selected: false,
    updated_at: nowIso(),
    updated_by: updatedBy || 'admin'
  };
}

function cleanIdList(raw, max) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  var seen = {};
  for (var i = 0; i < raw.length && out.length < (max || 200); i += 1) {
    var id = String(raw[i] || '').trim();
    if (!id || seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  return out;
}

function normalizeConfig(input, actor) {
  var base = defaultConfig(actor);
  var src = input && typeof input === 'object' ? input : {};
  var limit = Math.floor(Number(src.limit));
  if (!Number.isFinite(limit) || limit < 1) limit = base.limit;
  var maxLimit = Math.floor(Number(src.max_limit));
  if (!Number.isFinite(maxLimit) || maxLimit < 1) maxLimit = base.max_limit;
  if (maxLimit > 20) maxLimit = 20;
  if (limit > maxLimit) limit = maxLimit;

  var mode = String(src.mode || base.mode).toLowerCase();
  if (mode !== 'hourly' && mode !== 'daily') mode = 'hourly';

  return {
    enabled: src.enabled === true,
    mode: mode,
    reference_only: src.reference_only !== false,
    limit: limit,
    max_limit: maxLimit,
    rotation_enabled: src.rotation_enabled !== false,
    selected_station_ids: cleanIdList(src.selected_station_ids, 200),
    exclude_station_ids: cleanIdList(src.exclude_station_ids, 200),
    run_only_selected: src.run_only_selected === true,
    updated_at: nowIso(),
    updated_by: String(actor || src.updated_by || 'admin').slice(0, 80)
  };
}

async function getConfig() {
  var doc = await store.intelGet(CONFIG_KEY);
  if (!doc || typeof doc !== 'object') {
    return defaultConfig('system');
  }
  return normalizeConfig(doc, doc.updated_by || 'system');
}

async function saveConfig(input, actor) {
  var next = normalizeConfig(input, actor);
  await store.intelSet(CONFIG_KEY, next);
  return next;
}

function buildStationPool(referenceData, config, isEligibleFn) {
  var stations = (referenceData.stations || []).filter(isEligibleFn);
  if (config.reference_only) {
    stations = refStations.listEligibleReferenceStations({ stations: stations }, isEligibleFn);
  } else {
    stations = stations.slice().sort(function (a, b) {
      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });
  }

  var exclude = {};
  (config.exclude_station_ids || []).forEach(function (id) {
    exclude[String(id)] = true;
  });
  stations = stations.filter(function (s) {
    return !exclude[String(s.id)];
  });

  if (config.run_only_selected && config.selected_station_ids && config.selected_station_ids.length) {
    var pick = {};
    config.selected_station_ids.forEach(function (id) {
      pick[String(id)] = true;
    });
    stations = stations.filter(function (s) {
      return pick[String(s.id)];
    });
  }

  return stations;
}

async function syncAllowlist(referenceData, config) {
  var pool = buildStationPool(referenceData, config, preview.isPreviewEligibleStation);
  var doc = {
    station_ids: pool.map(function (s) {
      return String(s.id);
    }),
    reference_only: config.reference_only,
    run_only_selected: config.run_only_selected,
    updated_at: nowIso()
  };
  await store.intelSet(ALLOWLIST_KEY, doc);
  return doc;
}

function applyLimitFromConfig(config, requested) {
  var req = Math.floor(Number(requested));
  if (!Number.isFinite(req) || req < 1) req = config.limit;
  var applied = req;
  var max = Math.max(1, Math.floor(Number(config.max_limit) || 5));
  if (applied > max) applied = max;
  return { requested_limit: req, applied_limit: applied };
}

function optionsFromConfig(config, extra) {
  var ex = extra || {};
  var limits = applyLimitFromConfig(config, ex.limit != null ? ex.limit : config.limit);
  return {
    limit: limits.applied_limit,
    requested_limit: limits.requested_limit,
    applied_limit: limits.applied_limit,
    reference_only: ex.reference_only != null ? !!ex.reference_only : config.reference_only,
    rotation_enabled: ex.rotation_enabled != null ? !!ex.rotation_enabled : config.rotation_enabled,
    run_only_selected: config.run_only_selected,
    selected_station_ids: config.selected_station_ids || [],
    exclude_station_ids: config.exclude_station_ids || [],
    dry_run: !!ex.dry_run,
    station_id: ex.station_id || '',
    analysis_date: ex.analysis_date || '',
    hour: ex.hour || '',
    batch_size: ex.batch_size || 5,
    config_source: 'navidur_intel_config',
    cron_mode: config.mode
  };
}

function mergeAdminOverrides(config, query, body) {
  var q = Object.assign({}, query || {}, body || {});
  var opts = optionsFromConfig(config, {});
  if (q.limit != null || q.max_stations != null) {
    var lim = applyLimitFromConfig(config, q.limit != null ? q.limit : q.max_stations);
    opts.limit = lim.applied_limit;
    opts.requested_limit = lim.requested_limit;
    opts.applied_limit = lim.applied_limit;
  }
  if (q.reference_only != null || q.reference != null) {
    opts.reference_only = String(q.reference_only || q.reference) === '1'
      || String(q.reference_only || '').toLowerCase() === 'true';
  }
  if (q.dry_run != null || q.dry != null) {
    opts.dry_run = String(q.dry_run || q.dry) === '1' || String(q.dry_run || '').toLowerCase() === 'true';
  }
  if (q.station_id) opts.station_id = String(q.station_id).trim();
  if (q.analysis_date) opts.analysis_date = String(q.analysis_date).trim();
  if (q.hour) opts.hour = String(q.hour).trim();
  if (q.rotation_enabled != null) {
    opts.rotation_enabled = String(q.rotation_enabled) === '1' || String(q.rotation_enabled).toLowerCase() === 'true';
  }
  return opts;
}

function isCronRequest(query) {
  var q = query || {};
  return String(q.cron || '') === '1' || String(q.cron || '').toLowerCase() === 'true';
}

module.exports = {
  CONFIG_KEY: CONFIG_KEY,
  ALLOWLIST_KEY: ALLOWLIST_KEY,
  CRON_STATE_KEY: CRON_STATE_KEY,
  defaultConfig: defaultConfig,
  normalizeConfig: normalizeConfig,
  getConfig: getConfig,
  saveConfig: saveConfig,
  syncAllowlist: syncAllowlist,
  buildStationPool: buildStationPool,
  optionsFromConfig: optionsFromConfig,
  mergeAdminOverrides: mergeAdminOverrides,
  applyLimitFromConfig: applyLimitFromConfig,
  isCronRequest: isCronRequest
};
