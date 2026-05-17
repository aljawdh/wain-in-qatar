'use strict';

var store = require('./store');

var MAX_DAILY_ENTRIES = 500;
var MAX_STATION_ENTRIES = 744;

function upsertIndexEntry(doc, entry, maxEntries) {
  var base = doc && typeof doc === 'object' ? doc : { entries: [] };
  if (!Array.isArray(base.entries)) base.entries = [];
  var filtered = base.entries.filter(function (e) {
    return !(e && e.station_id === entry.station_id && e.hour === entry.hour && e.date === entry.date);
  });
  filtered.unshift(entry);
  base.entries = filtered.slice(0, maxEntries);
  base.updated_at = new Date().toISOString();
  return base;
}

async function appendDailyIndex(date, entry) {
  var key = store.keys().dailyIndex(date);
  var current = await store.intelGet(key);
  var next = upsertIndexEntry(current, entry, MAX_DAILY_ENTRIES);
  next.date = date;
  await store.intelSet(key, next);
  return key;
}

async function appendStationIndex(stationId, entry) {
  var key = store.keys().stationIndex(stationId);
  var current = await store.intelGet(key);
  var next = upsertIndexEntry(current, entry, MAX_STATION_ENTRIES);
  next.station_id = stationId;
  await store.intelSet(key, next);
  return key;
}

async function mergeDailyAnomalies(date, anomalies) {
  if (!anomalies || !anomalies.length) return null;
  var key = store.keys().anomalies(date);
  var current = await store.intelGet(key) || { date: date, items: [] };
  if (!Array.isArray(current.items)) current.items = [];
  anomalies.forEach(function (a) {
    current.items.push({
      at: new Date().toISOString(),
      type: a.type,
      message_ar: a.message_ar
    });
  });
  current.items = current.items.slice(0, 200);
  current.updated_at = new Date().toISOString();
  await store.intelSet(key, current);
  return key;
}

module.exports = {
  appendDailyIndex: appendDailyIndex,
  appendStationIndex: appendStationIndex,
  mergeDailyAnomalies: mergeDailyAnomalies
};
