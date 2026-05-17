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

async function assertMemoryAuthorized(req, res) {
  var expected = getCronSecret();
  var provided = extractCronSecret(req);
  if (expected && provided && provided === expected) {
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

async function selectEligibleStations(referenceData, options) {
  var refStations = require('./reference-stations');
  var opts = options || {};
  var isEligible = preview.isPreviewEligibleStation;

  if (opts.reference_only) {
    var references = refStations.listEligibleReferenceStations(referenceData, isEligible);
    var referenceTotal = references.length;
    var selectedIndex = null;
    var strategy = 'reference_rotation';
    var stations = [];

    if (opts.station_id) {
      stations = references.filter(function (s) {
        return String(s.id) === opts.station_id;
      });
      strategy = 'explicit_reference_station';
      if (stations.length) {
        selectedIndex = references.findIndex(function (s) {
          return String(s.id) === opts.station_id;
        });
      }
    } else {
      var rotation = await refStations.selectReferenceRotationBatch(
        references,
        opts,
        opts.limit,
        !opts.dry_run
      );
      stations = rotation.stations;
      selectedIndex = rotation.selected_station_index;
      strategy = rotation.selected_station_strategy;
    }

    return {
      stations: stations.slice(0, opts.limit),
      eligible_total: referenceTotal,
      reference_only: true,
      reference_total: referenceTotal,
      selected_station_strategy: strategy,
      selected_station_index: selectedIndex
    };
  }

  var eligible = (referenceData.stations || []).filter(isEligible);
  eligible.sort(function (a, b) {
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  });
  if (opts.station_id) {
    eligible = eligible.filter(function (s) {
      return String(s.id) === opts.station_id;
    });
  }
  return {
    stations: eligible.slice(0, opts.limit),
    eligible_total: eligible.length,
    reference_only: false,
    reference_total: refStations.listEligibleReferenceStations(referenceData, isEligible).length,
    selected_station_strategy: opts.station_id ? 'explicit_station' : 'first_n',
    selected_station_index: null
  };
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
  parseRunOptions: parseRunOptions,
  parseReferenceOnlyFlag: parseReferenceOnlyFlag,
  selectEligibleStations: selectEligibleStations,
  assertWritableRun: assertWritableRun,
  isPreviewEligibleStation: preview.isPreviewEligibleStation
};
