'use strict';

var store = require('../navidur-intelligence-memory/store');

var DEFAULT_DAYS = 1;
var MAX_DAYS = 7;
var SNAPSHOTS_PER_DAY = 24;

function clampDays(days) {
  var d = Math.floor(Number(days));
  if (!Number.isFinite(d) || d < 1) d = DEFAULT_DAYS;
  if (d > MAX_DAYS) d = MAX_DAYS;
  return d;
}

function entrySortKey(entry) {
  if (!entry) return '';
  var date = String(entry.date || '');
  var hour = String(entry.hour || '00').padStart(2, '0');
  return date + 'T' + hour;
}

function snapshotSortKey(snap) {
  if (!snap) return '';
  if (snap.timestamp) return String(snap.timestamp);
  return entrySortKey(snap);
}

async function fetchSnapshotByKey(key) {
  if (!key) return null;
  return store.intelGet(key);
}

async function loadStationSnapshots(stationId, days) {
  var appliedDays = clampDays(days);
  var maxSnapshots = appliedDays * SNAPSHOTS_PER_DAY;
  var indexDoc = await store.intelGet(store.keys().stationIndex(stationId));
  var entries = indexDoc && Array.isArray(indexDoc.entries) ? indexDoc.entries.slice() : [];

  entries.sort(function (a, b) {
    return entrySortKey(b).localeCompare(entrySortKey(a));
  });

  var selected = entries.slice(0, maxSnapshots);
  selected.reverse();

  var snapshots = [];
  for (var i = 0; i < selected.length; i += 1) {
    var entry = selected[i];
    var key = entry && entry.snapshot_key ? entry.snapshot_key : store.keys().snapshot(
      stationId,
      entry.date,
      entry.hour
    );
    var snap = await fetchSnapshotByKey(key);
    if (snap && typeof snap === 'object') {
      snapshots.push(snap);
    }
  }

  snapshots.sort(function (a, b) {
    return snapshotSortKey(a).localeCompare(snapshotSortKey(b));
  });

  return {
    station_id: stationId,
    days: appliedDays,
    max_snapshots: maxSnapshots,
    index_entries: entries.length,
    snapshots: snapshots
  };
}

module.exports = {
  DEFAULT_DAYS: DEFAULT_DAYS,
  MAX_DAYS: MAX_DAYS,
  SNAPSHOTS_PER_DAY: SNAPSHOTS_PER_DAY,
  clampDays: clampDays,
  loadStationSnapshots: loadStationSnapshots
};
