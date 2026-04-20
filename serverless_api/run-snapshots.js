'use strict';

const { appendSnapshotRunLog, createId, nowIso } = require('./_lib/data-store');
const { isAllowedOrigin, parseBody, setNoCache, cleanString, rateLimit } = require('./_lib/security');
const { loadReferenceData } = require('./_lib/navidur-analysis-runtime');
const { recomputeGlobalSummary } = require('./_lib/dur-intelligence');
const snapshotHandler = require('./navidur-snapshot');

var DEFAULT_BATCH_SIZE = 5;

function isStationEligibleForSnapshots(station) {
  if (!station || typeof station !== 'object') return false;
  if (station.snapshot_enabled === false) return false;
  if (station.is_active === false) return false;
  var status = cleanString(station.status, 40).toLowerCase();
  if (status && status !== 'active') return false;
  return true;
}

function buildRunLog(runId, startedAt, finishedAt, totalStations, processedCount, successCount, failedCount, failedStationIds, errorSummary) {
  return {
    run_id: runId,
    started_at: startedAt,
    finished_at: finishedAt,
    total_stations: totalStations,
    processed_count: processedCount,
    success_count: successCount,
    failed_count: failedCount,
    failed_station_ids: failedStationIds,
    notes: failedCount
      ? ('processed with failures: ' + failedCount + ' station(s) failed')
      : 'all stations processed successfully',
    error_summary: errorSummary
  };
}

async function runSnapshotsInternal(options) {
  var params = options || {};
  var startedAt = nowIso();
  var runId = createId('snapshot_run');
  var referenceData = params.referenceData || await loadReferenceData();
  var stationIds = Array.isArray(params.station_ids)
    ? params.station_ids.map(function (value) { return cleanString(value, 80); }).filter(Boolean)
    : [];
  var stations = (referenceData.stations || []).filter(isStationEligibleForSnapshots);
  if (stationIds.length) {
    stations = stations.filter(function (station) {
      return stationIds.indexOf(String(station && station.id || '')) >= 0;
    });
  }
  if (Number(params.limit) > 0) {
    stations = stations.slice(0, Math.min(Number(params.limit), stations.length));
  }
  var batchSize = Math.max(1, Number(params.batch_size) || DEFAULT_BATCH_SIZE);
  var sharedDatetime = cleanString(params.datetime, 60) || startedAt;
  var processedCount = 0;
  var successCount = 0;
  var failedCount = 0;
  var failedStationIds = [];
  var errorSummary = [];

  for (var i = 0; i < stations.length; i += batchSize) {
    var batch = stations.slice(i, i + batchSize);
    var results = await Promise.allSettled(batch.map(function (station) {
      return snapshotHandler.captureSnapshotInternal({
        station_id: station.id,
        datetime: sharedDatetime,
        live_inputs: params.live_inputs || null
      }, {
        referenceData: referenceData
      });
    }));

    results.forEach(function (result, index) {
      var station = batch[index];
      processedCount += 1;
      if (result.status === 'fulfilled') {
        successCount += 1;
        return;
      }
      failedCount += 1;
      failedStationIds.push(String(station && station.id || 'unknown_station'));
      errorSummary.push({
        station_id: String(station && station.id || ''),
        error: String(result.reason && result.reason.message ? result.reason.message : result.reason || 'unknown_error')
      });
    });
  }

  var finishedAt = nowIso();
  var runLog = buildRunLog(
    runId,
    startedAt,
    finishedAt,
    stations.length,
    processedCount,
    successCount,
    failedCount,
    failedStationIds,
    errorSummary.slice(0, 50)
  );

  await appendSnapshotRunLog(runLog);
  await recomputeGlobalSummary();
  return runLog;
}

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!rateLimit(req, 'run_snapshots', 10, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  try {
    var body = req.method === 'POST' ? parseBody(req) : (req.query || {});
    var runLog = await runSnapshotsInternal(body);
    return res.status(200).json(Object.assign({ ok: true }, runLog));
  } catch (error) {
    return res.status(500).json({
      error: 'run_snapshots_failed',
      detail: String(error && error.message ? error.message : error)
    });
  }
};

module.exports.runSnapshotsInternal = runSnapshotsInternal;
