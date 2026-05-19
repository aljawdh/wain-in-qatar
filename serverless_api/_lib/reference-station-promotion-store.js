'use strict';

var { Redis } = require('@upstash/redis');
var { createId, nowIso } = require('./data-store');

var RECORD_PREFIX = 'navidur_reference_station_promotion_audit:';
var INDEX_KEY = 'navidur_reference_station_promotion_audit_index';
var BACKUP_PREFIX = 'navidur_reference_station_promotion_backup:';
var MAX_INDEX_SIZE = 5000;

var _kvClient = null;
var _memoryIndex = [];
var _memoryRecords = new Map();
var _memoryBackups = new Map();

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

function recordKey(id) {
  return RECORD_PREFIX + String(id);
}

async function appendAudit(record) {
  var id = String(record.id || createId('rsp'));
  record.id = id;
  if (!record.changed_at) record.changed_at = nowIso();
  var key = recordKey(id);
  var kv = getKv();
  if (kv) {
    await kv.set(key, JSON.stringify(record));
    await kv.lpush(INDEX_KEY, id);
    await kv.ltrim(INDEX_KEY, 0, MAX_INDEX_SIZE - 1);
    return record;
  }
  _memoryRecords.set(key, JSON.stringify(record));
  _memoryIndex.unshift(id);
  if (_memoryIndex.length > MAX_INDEX_SIZE) _memoryIndex.length = MAX_INDEX_SIZE;
  return record;
}

async function getAudit(id) {
  var key = recordKey(id);
  var kv = getKv();
  if (kv) {
    return parseStored(await kv.get(key));
  }
  return parseStored(_memoryRecords.get(key));
}

async function saveBackupSnapshot(payload) {
  var ts = Date.now();
  var key = BACKUP_PREFIX + ts;
  var doc = {
    saved_at: nowIso(),
    timestamp: ts,
    stations: payload.stations,
    true_final_station_reference: payload.true_final_station_reference
  };
  var kv = getKv();
  if (kv) {
    await kv.set(key, JSON.stringify(doc));
    return { key: key, timestamp: ts };
  }
  _memoryBackups.set(key, JSON.stringify(doc));
  return { key: key, timestamp: ts };
}

module.exports = {
  RECORD_PREFIX: RECORD_PREFIX,
  INDEX_KEY: INDEX_KEY,
  BACKUP_PREFIX: BACKUP_PREFIX,
  appendAudit: appendAudit,
  getAudit: getAudit,
  saveBackupSnapshot: saveBackupSnapshot
};
