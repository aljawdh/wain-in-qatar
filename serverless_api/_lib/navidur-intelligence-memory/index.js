'use strict';

var { loadReferenceData, normalizeRequestedStation } = require('../navidur-analysis-runtime');
var preview = require('../navidur-intelligence-preview');
var store = require('./store');
var guards = require('./guards');
var runContext = require('./run-context');
var dailySummary = require('./daily-summary');
var compactor = require('./compactor');

function emptyWrites() {
  return {
    snapshots: 0,
    latest: 0,
    daily_index: 0,
    station_index: 0,
    anomalies: 0,
    run_records: 0
  };
}

function mergeWrites(target, delta) {
  if (!delta) return target;
  Object.keys(delta).forEach(function (key) {
    target[key] = (target[key] || 0) + (delta[key] || 0);
  });
  return target;
}

async function persistStationSnapshot(snapshot, runId, keysWritten, writes) {
  var k = store.keys();
  var snapshotKey = k.snapshot(snapshot.station_id, snapshot.date, snapshot.hour);
  var latestKey = k.latest(snapshot.station_id);
  var existing = await store.intelGet(snapshotKey);
  var isDuplicate = Boolean(existing);

  await store.intelSet(snapshotKey, snapshot);
  await store.intelSet(latestKey, snapshot);
  keysWritten.push(snapshotKey, latestKey);
  writes.snapshots += 1;
  writes.latest += 1;

  if (isDuplicate) {
    return {
      snapshot_key: snapshotKey,
      latest_key: latestKey,
      skipped_duplicate: true,
      index_skipped: true
    };
  }

  var indexEntry = {
    station_id: snapshot.station_id,
    station_name: snapshot.station_name,
    date: snapshot.date,
    hour: snapshot.hour,
    snapshot_key: snapshotKey,
    run_id: runId,
    scores: snapshot.scores,
    labels: snapshot.labels
  };
  var dailyKey = await dailySummary.appendDailyIndex(snapshot.date, indexEntry);
  var stationKey = await dailySummary.appendStationIndex(snapshot.station_id, indexEntry);
  keysWritten.push(dailyKey, stationKey);
  writes.daily_index += 1;
  writes.station_index += 1;

  if (snapshot.anomalies && snapshot.anomalies.length) {
    var anomalyKey = await dailySummary.mergeDailyAnomalies(snapshot.date, snapshot.anomalies);
    if (anomalyKey) {
      keysWritten.push(anomalyKey);
      writes.anomalies += 1;
    }
  }

  return {
    snapshot_key: snapshotKey,
    latest_key: latestKey,
    skipped_duplicate: false,
    index_skipped: false
  };
}

async function processStation(station, referenceData, dateCtx, runId, dryRun, writes) {
  var previewPayload = await preview.buildIntelligencePreviewForStation(station, referenceData, dateCtx);
  var snapshot = runContext.buildSnapshotRecord(previewPayload, dateCtx);
  var keysWritten = [];
  var persist = null;

  if (!dryRun) {
    persist = await persistStationSnapshot(snapshot, runId, keysWritten, writes);
  } else {
    var snapshotKey = store.keys().snapshot(snapshot.station_id, snapshot.date, snapshot.hour);
    keysWritten.push(snapshotKey, store.keys().latest(snapshot.station_id));
  }

  return {
    station_id: snapshot.station_id,
    station_name: snapshot.station_name,
    ok: true,
    status: persist && persist.skipped_duplicate ? 'skipped_duplicate' : 'saved',
    snapshot_key: persist ? persist.snapshot_key : keysWritten[0],
    latest_key: persist ? persist.latest_key : keysWritten[1],
    skipped_duplicate: Boolean(persist && persist.skipped_duplicate),
    index_skipped: Boolean(persist && persist.index_skipped),
    score: snapshot.scores.marine_condition,
    confidence: snapshot.scores.confidence,
    keys_written: keysWritten
  };
}

async function runHourlyMemory(options) {
  var opts = options || {};
  var startedAt = new Date();
  var runId = runContext.createRunId();
  var dateCtx = runContext.resolveMemoryDateCtx(opts);
  var referenceData = await loadReferenceData();
  var selection = await guards.selectEligibleStations(referenceData, opts);
  if (opts.reference_only && opts.station_id && selection.stations.length === 0) {
    return {
      ok: false,
      error: 'station_not_reference',
      station_id: opts.station_id,
      reference_only: true,
      reference_total: selection.reference_total,
      requested_limit: opts.requested_limit,
      applied_limit: opts.applied_limit
    };
  }
  if (opts.reference_only && selection.reference_total === 0) {
    return {
      ok: false,
      error: 'no_reference_stations_available',
      reference_only: true,
      reference_total: 0,
      selected_station_strategy: 'reference_rotation',
      selected_station_index: null,
      requested_limit: opts.requested_limit,
      applied_limit: opts.applied_limit
    };
  }
  var stations = selection.stations;
  var eligibleTotal = selection.eligible_total;
  var items = [];
  var errors = [];
  var keysWrittenAll = [];
  var writes = emptyWrites();
  var saved = 0;
  var skippedDuplicates = 0;
  var failed = 0;
  var batchSize = opts.batch_size || guards.DEFAULT_BATCH_SIZE;

  for (var i = 0; i < stations.length; i += batchSize) {
    var batch = stations.slice(i, i + batchSize);
    for (var j = 0; j < batch.length; j += 1) {
      var station = batch[j];
      try {
        var normalized = normalizeRequestedStation({ station_id: station.id }, referenceData.stations);
        if (!normalized || !normalized.id) {
          throw new Error('station_not_found');
        }
        var refMeta = require('./reference-stations');
        var item = await processStation(normalized, referenceData, dateCtx, runId, opts.dry_run, writes);
        item.is_reference_station = refMeta.isReferenceStation(normalized);
        item.is_operational_station = refMeta.isOperationalStation(normalized);
        items.push(item);
        if (!opts.dry_run) {
          if (item.skipped_duplicate) {
            skippedDuplicates += 1;
          } else {
            saved += 1;
          }
        }
        if (item.keys_written) {
          item.keys_written.forEach(function (k) {
            if (keysWrittenAll.indexOf(k) < 0) keysWrittenAll.push(k);
          });
        }
      } catch (err) {
        failed += 1;
        errors.push({
          station_id: String(station && station.id || ''),
          error: String(err && err.message ? err.message : err)
        });
        items.push({
          station_id: String(station && station.id || ''),
          station_name: String(station && (station.name_ar || station.name) || ''),
          ok: false,
          error: String(err && err.message ? err.message : err)
        });
      }
    }
  }

  var finishedAt = new Date();
  var summary = {
    ok: true,
    mode: 'hourly_memory',
    dry_run: Boolean(opts.dry_run),
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    requested_limit: opts.requested_limit,
    applied_limit: opts.applied_limit,
    reference_only: Boolean(opts.reference_only),
    selected_station_strategy: selection.selected_station_strategy || null,
    selected_station_index: selection.selected_station_index,
    reference_total: selection.reference_total != null ? selection.reference_total : null,
    eligible_total: eligibleTotal,
    processed: items.length,
    saved: saved,
    skipped_duplicates: skippedDuplicates,
    failed: failed,
    date: dateCtx.analysis_date,
    hour: dateCtx.hour,
    storage: opts.dry_run ? (store.isKvConfigured() ? 'kv-dry-run' : 'memory-dry-run') : (store.isKvConfigured() ? 'upstash-kv' : 'memory-fallback'),
    writes: writes,
    items: items,
    errors: errors,
    keys_written: keysWrittenAll
  };

  if (!opts.dry_run) {
    var runKey = await compactor.saveRunRecord(runId, summary);
    summary.run_key = runKey;
    writes.run_records += 1;
    summary.writes = writes;
  }

  return summary;
}

async function getLatestSnapshot(stationId) {
  var key = store.keys().latest(stationId);
  var doc = await store.intelGet(key);
  if (!doc) {
    var err = new Error('intel_latest_not_found');
    err.code = 'intel_latest_not_found';
    throw err;
  }
  return { ok: true, station_id: stationId, latest_key: key, snapshot: doc };
}

async function getRecentRuns(limit) {
  var max = Math.min(Math.max(Number(limit) || 20, 1), 50);
  var index = await store.intelGet(store.keys().runIndex()) || { runs: [] };
  var ids = Array.isArray(index.runs) ? index.runs.slice(0, max) : [];
  var runs = [];
  for (var i = 0; i < ids.length; i += 1) {
    var doc = await store.intelGet(store.keys().run(ids[i]));
    if (doc) runs.push(doc);
  }
  return {
    ok: true,
    total: runs.length,
    run_index_key: store.keys().runIndex(),
    runs: runs
  };
}

module.exports = {
  runHourlyMemory: runHourlyMemory,
  getLatestSnapshot: getLatestSnapshot,
  getRecentRuns: getRecentRuns
};
