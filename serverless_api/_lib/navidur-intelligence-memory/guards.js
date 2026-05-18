'use strict';

var { getAuthUser, ROLE_ORDER } = require('../auth');
var { cleanString } = require('../security');
var preview = require('../navidur-intelligence-preview');

var DEFAULT_BATCH_SIZE = 5;
var DEFAULT_REAL_LIMIT = 1;
var DEFAULT_DRY_RUN_LIMIT = 3;
var MAX_STATIONS_CAP = 3;

function isAdminActor(user) {
  if (!user || !ROLE_ORDER[user.role]) return false;
  return ROLE_ORDER[user.role] >= ROLE_ORDER.admin;
}

function getCronSecret() {
  return String(process.env.CRON_SECRET || process.env.NAVIDUR_CRON_SECRET || '').trim();
}

function extractCronSecret(req) {
  var header = String(req.headers['x-cron-secret'] || req.headers['x-vercel-cron-secret'] || '').trim();
  if (header) return header;
  var auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  var q = req.query || {};
  return cleanString(q.cron_secret, 200);
}

/** Vercel Cron invocations send x-vercel-cron: 1 (and optionally Authorization: Bearer CRON_SECRET). */
function isVercelCronInvocation(req) {
  var h = req.headers || {};
  if (String(h['x-vercel-cron'] || '') === '1') return true;
  var ua = String(h['user-agent'] || '').toLowerCase();
  return ua.indexOf('vercel-cron') >= 0;
}

function isCronRouteRequest(req) {
  var q = req.query || {};
  if (String(q.cron || '') === '1' || String(q.cron || '').toLowerCase() === 'true') return true;
  var route = String(q.route || q._memory_route || '').toLowerCase();
  return route === 'run-intelligence-memory-cron';
}

async function assertMemoryAuthorized(req, res) {
  var expected = getCronSecret();
  var provided = extractCronSecret(req);
  var cronRoute = isCronRouteRequest(req);
  var vercelCron = isVercelCronInvocation(req);

  if (expected && provided && provided === expected) {
    return { mode: 'cron' };
  }

  if (cronRoute && vercelCron && process.env.VERCEL) {
    if (!expected || provided === expected) {
      return { mode: 'cron' };
    }
    res.status(401).json({ ok: false, error: 'cron_secret_invalid' });
    return null;
  }

  if (cronRoute && expected && provided && provided === expected) {
    return { mode: 'cron' };
  }

  var user = await getAuthUser(req);
  if (isAdminActor(user)) {
    return { mode: 'admin', user: user };
  }
  res.status(401).json({ ok: false, error: 'admin_auth_required' });
  return null;
}

function parseReferenceOnlyFlag(q) {
  return String(q.reference_only || q.reference || '') === '1'
    || String(q.reference_only || '').toLowerCase() === 'true';
}

function parseRunOptions(query, body) {
  var q = Object.assign({}, query || {}, body || {});
  var dryRun = String(q.dry_run || q.dry || '') === '1' || String(q.dry_run || '').toLowerCase() === 'true';
  var referenceOnly = parseReferenceOnlyFlag(q);
  var limitRaw = q.limit != null ? q.limit : q.max_stations;
  var hasExplicitLimit = limitRaw !== undefined && limitRaw !== null && String(limitRaw).trim() !== '';

  var requested;
  if (hasExplicitLimit) {
    requested = Math.floor(Number(limitRaw));
    if (!Number.isFinite(requested) || requested < 1) requested = 1;
  } else {
    requested = dryRun ? DEFAULT_DRY_RUN_LIMIT : DEFAULT_REAL_LIMIT;
  }

  var applied = requested;
  if (applied > MAX_STATIONS_CAP) applied = MAX_STATIONS_CAP;

  var batchSize = Math.floor(Number(q.batch_size));
  if (!Number.isFinite(batchSize) || batchSize < 1) batchSize = DEFAULT_BATCH_SIZE;

  var stationId = cleanString(q.station_id, 80);

  return {
    limit: applied,
    requested_limit: requested,
    applied_limit: applied,
    batch_size: batchSize,
    station_id: stationId,
    dry_run: dryRun,
    reference_only: referenceOnly,
    analysis_date: cleanString(q.analysis_date, 20),
    hour: cleanString(q.hour, 4)
  };
}

function applyExcludeList(stations, excludeIds) {
  if (!excludeIds || !excludeIds.length) return stations;
  var exclude = {};
  excludeIds.forEach(function (id) {
    exclude[String(id)] = true;
  });
  return stations.filter(function (s) {
    return !exclude[String(s.id)];
  });
}

async function selectEligibleStations(referenceData, options) {
  var refStations = require('./reference-stations');
  var cronConfig = require('./cron-config');
  var store = require('./store');
  var opts = options || {};
  var isEligible = preview.isPreviewEligibleStation;
  var referenceTotal = refStations.listEligibleReferenceStations(referenceData, isEligible).length;

  var pool;
  var strategy = 'reference_rotation';

  if (opts.config_driven) {
    pool = cronConfig.buildStationPool(referenceData, {
      reference_only: opts.reference_only,
      exclude_station_ids: opts.exclude_station_ids || [],
      selected_station_ids: opts.selected_station_ids || [],
      run_only_selected: opts.run_only_selected
    }, isEligible);
    strategy = opts.run_only_selected ? 'selected_rotation' : (opts.reference_only ? 'reference_rotation' : 'pool_rotation');
  } else if (opts.reference_only) {
    pool = refStations.listEligibleReferenceStations(referenceData, isEligible);
    pool = applyExcludeList(pool, opts.exclude_station_ids);
    if (opts.run_only_selected && opts.selected_station_ids && opts.selected_station_ids.length) {
      var pick = {};
      opts.selected_station_ids.forEach(function (id) {
        pick[String(id)] = true;
      });
      pool = pool.filter(function (s) {
        return pick[String(s.id)];
      });
      strategy = 'selected_rotation';
    }
  } else {
    pool = (referenceData.stations || []).filter(isEligible);
    pool.sort(function (a, b) {
      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });
    pool = applyExcludeList(pool, opts.exclude_station_ids);
    if (opts.run_only_selected && opts.selected_station_ids && opts.selected_station_ids.length) {
      var pick2 = {};
      opts.selected_station_ids.forEach(function (id) {
        pick2[String(id)] = true;
      });
      pool = pool.filter(function (s) {
        return pick2[String(s.id)];
      });
      strategy = 'selected_rotation';
    } else {
      strategy = 'first_n';
    }
  }

  var stations = [];
  var selectedIndex = null;

  if (opts.station_id) {
    stations = pool.filter(function (s) {
      return String(s.id) === opts.station_id;
    });
    strategy = 'explicit_station';
    if (stations.length) {
      selectedIndex = pool.findIndex(function (s) {
        return String(s.id) === opts.station_id;
      });
    }
  } else if (opts.rotation_enabled !== false && pool.length) {
    var rotation = await refStations.selectReferenceRotationBatch(
      pool,
      opts,
      opts.limit,
      !opts.dry_run,
      {
        state_key: opts.config_driven ? store.keys().cronState() : store.keys().refRotation(),
        pool_key: refStations.poolKeyFromIds(pool.map(function (s) {
          return s.id;
        })),
        rotation_enabled: opts.rotation_enabled,
        strategy: strategy
      }
    );
    stations = rotation.stations;
    selectedIndex = rotation.selected_station_index;
    strategy = rotation.selected_station_strategy;
  } else {
    stations = pool.slice(0, opts.limit);
    selectedIndex = 0;
  }

  return {
    stations: stations.slice(0, opts.limit),
    eligible_total: pool.length,
    reference_only: Boolean(opts.reference_only),
    reference_total: referenceTotal,
    selected_station_strategy: strategy,
    selected_station_index: selectedIndex,
    pool_size: pool.length
  };
}

async function assertAdminOnly(req, res) {
  var user = await getAuthUser(req);
  if (isAdminActor(user)) {
    return { mode: 'admin', user: user };
  }
  res.status(401).json({ ok: false, error: 'admin_auth_required' });
  return null;
}

function assertWritableRun(options, res) {
  if (options.dry_run) return true;
  var store = require('./store');
  if (process.env.VERCEL && !store.isKvConfigured()) {
    res.status(503).json({
      ok: false,
      error: 'kv_not_configured',
      message: 'Hourly memory requires KV_REST_API_URL and KV_REST_API_TOKEN on Vercel.'
    });
    return false;
  }
  return true;
}

module.exports = {
  DEFAULT_BATCH_SIZE: DEFAULT_BATCH_SIZE,
  DEFAULT_REAL_LIMIT: DEFAULT_REAL_LIMIT,
  DEFAULT_DRY_RUN_LIMIT: DEFAULT_DRY_RUN_LIMIT,
  MAX_STATIONS_CAP: MAX_STATIONS_CAP,
  assertMemoryAuthorized: assertMemoryAuthorized,
  assertAdminOnly: assertAdminOnly,
  parseRunOptions: parseRunOptions,
  parseReferenceOnlyFlag: parseReferenceOnlyFlag,
  selectEligibleStations: selectEligibleStations,
  assertWritableRun: assertWritableRun,
  isPreviewEligibleStation: preview.isPreviewEligibleStation
};
