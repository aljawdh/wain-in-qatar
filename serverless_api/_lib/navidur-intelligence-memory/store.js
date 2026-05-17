'use strict';

var { Redis } = require('@upstash/redis');

var INTEL_PREFIX = 'navidur_intel_';
var _kvClient = null;
var _memory = new Map();

function getKvConfig() {
  var url = process.env.KV_REST_API_URL || process.env.KV_URL || '';
  var token = process.env.KV_REST_API_TOKEN || '';
  if (!url || !token) return null;
  return { url: url, token: token };
}

function getKv() {
  if (_kvClient) return _kvClient;
  var cfg = getKvConfig();
  if (!cfg) return null;
  _kvClient = new Redis({ url: cfg.url, token: cfg.token });
  return _kvClient;
}

function isKvConfigured() {
  return Boolean(getKvConfig());
}

function assertIntelKey(key) {
  var k = String(key || '');
  if (!k.startsWith(INTEL_PREFIX)) {
    throw new Error('intel_key_prefix_violation:' + k);
  }
  return k;
}

function parseStored(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_e) {
      return null;
    }
  }
  return raw;
}

async function intelGet(key) {
  var safeKey = assertIntelKey(key);
  var kv = getKv();
  if (kv) {
    return parseStored(await kv.get(safeKey));
  }
  return _memory.has(safeKey) ? parseStored(_memory.get(safeKey)) : null;
}

async function intelSet(key, value) {
  var safeKey = assertIntelKey(key);
  var payload = JSON.stringify(value);
  var kv = getKv();
  if (kv) {
    await kv.set(safeKey, payload);
    return safeKey;
  }
  _memory.set(safeKey, payload);
  return safeKey;
}

function keys() {
  return {
    snapshot: function (stationId, date, hour) {
      return INTEL_PREFIX + 'snapshot:' + stationId + ':' + date + ':' + hour;
    },
    latest: function (stationId) {
      return INTEL_PREFIX + 'latest:' + stationId;
    },
    dailyIndex: function (date) {
      return INTEL_PREFIX + 'daily_index:' + date;
    },
    stationIndex: function (stationId) {
      return INTEL_PREFIX + 'station_index:' + stationId;
    },
    run: function (runId) {
      return INTEL_PREFIX + 'run:' + runId;
    },
    runIndex: function () {
      return INTEL_PREFIX + 'run_index';
    },
    anomalies: function (date) {
      return INTEL_PREFIX + 'anomalies:' + date;
    },
    refRotation: function () {
      return INTEL_PREFIX + 'ref_rotation';
    },
    config: function () {
      return INTEL_PREFIX + 'config';
    },
    cronAllowlist: function () {
      return INTEL_PREFIX + 'cron_station_allowlist';
    },
    cronState: function () {
      return INTEL_PREFIX + 'cron_state';
    }
  };
}

module.exports = {
  INTEL_PREFIX: INTEL_PREFIX,
  isKvConfigured: isKvConfigured,
  intelGet: intelGet,
  intelSet: intelSet,
  keys: keys,
  assertIntelKey: assertIntelKey
};
