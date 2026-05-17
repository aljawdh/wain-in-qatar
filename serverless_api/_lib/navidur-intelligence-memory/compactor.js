'use strict';

var store = require('./store');

var MAX_RUN_INDEX = 100;

async function prependRunIndex(runId, summary) {
  var key = store.keys().runIndex();
  var current = await store.intelGet(key) || { runs: [] };
  if (!Array.isArray(current.runs)) current.runs = [];
  current.runs = [runId].concat(current.runs.filter(function (id) {
    return id !== runId;
  })).slice(0, MAX_RUN_INDEX);
  current.updated_at = new Date().toISOString();
  current.latest = {
    run_id: runId,
    finished_at: summary.finished_at,
    saved: summary.saved,
    failed: summary.failed
  };
  await store.intelSet(key, current);
  return key;
}

async function saveRunRecord(runId, summary) {
  var key = store.keys().run(runId);
  await store.intelSet(key, summary);
  await prependRunIndex(runId, summary);
  return key;
}

module.exports = {
  saveRunRecord: saveRunRecord,
  prependRunIndex: prependRunIndex,
  MAX_RUN_INDEX: MAX_RUN_INDEX
};
