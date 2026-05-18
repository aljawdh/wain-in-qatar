'use strict';

var { Redis } = require('@upstash/redis');
var { createId, nowIso } = require('./data-store');

var RECORD_PREFIX = 'navidur_reference_dur_audit:';
var INDEX_KEY = 'navidur_reference_dur_audit_index';
var BACKUP_PREFIX = 'navidur_reference_dur_backup:';
var MAX_INDEX_SIZE = 10000;

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
  var id = String(record.id || createId('rda'));
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

async function listAuditIds(limit) {
  var n = typeof limit === 'number' && limit > 0 ? limit : 2000;
  var kv = getKv();
  if (kv) {
    return (await kv.lrange(INDEX_KEY, 0, n - 1)) || [];
  }
  return _memoryIndex.slice(0, n);
}

async function listAuditsForStation(stationId, limit) {
  var ids = await listAuditIds(5000);
  var out = [];
  for (var i = 0; i < ids.length; i += 1) {
    var rec = await getAudit(ids[i]);
    if (!rec) continue;
    if (stationId && String(rec.station_id || '') !== String(stationId)) continue;
    out.push(rec);
    if (out.length >= (limit || 100)) break;
  }
  return out;
}

async function saveBackupSnapshot(doc) {
  var ts = Date.now();
  var key = BACKUP_PREFIX + ts;
  var payload = {
    saved_at: nowIso(),
    timestamp: ts,
    document: doc
  };
  var kv = getKv();
  if (kv) {
    await kv.set(key, JSON.stringify(payload));
    return { key: key, timestamp: ts };
  }
  _memoryBackups.set(key, JSON.stringify(payload));
  return { key: key, timestamp: ts };
}

async function getBackup(key) {
  var kv = getKv();
  if (kv) {
    return parseStored(await kv.get(key));
  }
  return parseStored(_memoryBackups.get(key));
}

module.exports = {
  RECORD_PREFIX: RECORD_PREFIX,
  INDEX_KEY: INDEX_KEY,
  BACKUP_PREFIX: BACKUP_PREFIX,
  appendAudit: appendAudit,
  getAudit: getAudit,
  listAuditsForStation: listAuditsForStation,
  saveBackupSnapshot: saveBackupSnapshot,
  getBackup: getBackup
};
