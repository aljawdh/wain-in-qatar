'use strict';

const { Redis } = require('@upstash/redis');
const fs = require('fs/promises');
const path = require('path');

// Bundled seed data shipped with the deployment (read-only on Vercel).
// Used ONLY for one-time KV bootstrap and local development writes.
const DATA_SEED_DIR = path.join(__dirname, '..', '..', 'data');

const FILES = {
  users: 'users.json',
  stations: 'stations.json',
  fish_species: 'fish_species.json',
  feedback: 'feedback.json',
  audit: 'audit_logs.json',
  tracking: 'tracking.json',
  catch_logs: 'catch_logs.json',
  station_snapshots: 'station_snapshots.json',
  dur_validation_logs: 'dur_validation_logs.json',
  dur_intelligence_summary: 'dur_intelligence_summary.json',
  snapshot_run_logs: 'snapshot_run_logs.json',
  durur_overrides: 'durur_overrides.json',
  durur: 'durur.json',
  durur_reference_seed: 'durur_reference_seed.json',
  season_events: 'season_events.json',
  station_dur_profiles: 'station_dur_profiles.json',
  station_dur_overrides: 'station_dur_overrides.json',
  annual_comparisons: 'annual_comparisons.json',
  durur_master: 'durur_master.json',
  trait_dictionaries: 'trait_dictionaries.json',
  fish_season_tags: 'fish_season_tags.json',
  advice_basis_tags: 'advice_basis_tags.json',
  dur_sequence_map: 'dur_sequence_map.json',
  star_events: 'star_events.json',
  dur_generation_audit: 'dur_generation_audit.json',
  true_final_station_reference: 'true_final_station_reference.json'
};

// ─── KV keys for append-safe catch log storage ───────────────────────────────
const CATCH_INDEX_KEY = 'navidur_catch_index';   // Redis LIST of IDs (newest first)
const CATCH_RECORD_PREFIX = 'navidur_catch:';     // navidur_catch:{id} = JSON record
const CATCH_INDEX_MAX_SIZE = 10000;               // LTRIM guard — prevents unbounded growth
const SNAPSHOT_INDEX_KEY = 'navidur_station_snapshot_index';
const SNAPSHOT_RECORD_PREFIX = 'navidur_station_snapshot:';
const SNAPSHOT_INDEX_MAX_SIZE = 20000;
const VALIDATION_INDEX_KEY = 'navidur_dur_validation_index';
const VALIDATION_RECORD_PREFIX = 'navidur_dur_validation:';
const VALIDATION_INDEX_MAX_SIZE = 20000;
const SNAPSHOT_RUN_INDEX_KEY = 'navidur_snapshot_run_index';
const SNAPSHOT_RUN_RECORD_PREFIX = 'navidur_snapshot_run:';
const SNAPSHOT_RUN_INDEX_MAX_SIZE = 5000;
const DEDUP_PREFIX = 'navidur_dedup:';            // short-lived dedup keys
const RL_PREFIX = 'navidur_rl:';                  // rate-limit counters

let _kvClient = null;

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.KV_URL || '';
  const token = process.env.KV_REST_API_TOKEN || '';
  if (!url || !token) return null;
  return { url, token };
}

function getKv() {
  if (_kvClient) return _kvClient;
  const cfg = getKvConfig();
  if (!cfg) return null;
  _kvClient = new Redis({ url: cfg.url, token: cfg.token });
  return _kvClient;
}

function kvStoreKey(key) {
  if (!FILES[key]) throw new Error('unknown_store_key_' + key);
  return 'navidur_store_' + key;
}

// Read the bundled seed file. Used for:
//   1. One-time KV bootstrap on first deploy or after a KV flush.
//   2. All reads/writes in local development (data/ is writable).
async function readSeedFile(key, fallback) {
  const fname = FILES[key];
  if (!fname) return JSON.parse(JSON.stringify(fallback));
  try {
    const raw = await fs.readFile(path.join(DATA_SEED_DIR, fname), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return JSON.parse(JSON.stringify(fallback));
  }
}

// Write directly to data/ — only used in local development (not on Vercel).
async function writeToSeedFile(key, value) {
  await fs.mkdir(DATA_SEED_DIR, { recursive: true });
  const fname = FILES[key];
  if (!fname) throw new Error('unknown_store_key_' + key);
  const full = path.join(DATA_SEED_DIR, fname);
  const tmp = full + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, full);
}

// On Vercel without KV configured, throw a clear error so callers surface a
// meaningful 500 / 503 instead of silently returning stale or ephemeral data.
function assertPersistentStoreAvailable() {
  if (process.env.VERCEL && !getKv()) {
    throw new Error(
      'persistent_store_not_configured: ' +
      'Set KV_REST_API_URL and KV_REST_API_TOKEN (Upstash Redis) ' +
      'in Vercel project environment variables to enable persistent station storage.'
    );
  }
}

async function readJsonFile(key, fallback) {
  const kv = getKv();

  if (kv) {
    const storeKey = kvStoreKey(key);
    // Let KV errors propagate — callers should surface them, not swallow them.
    const raw = await kv.get(storeKey);
    if (raw != null) {
      if (typeof raw === 'string') return JSON.parse(raw);
      return raw;
    }
    // KV key absent — one-time bootstrap from bundled seed file.
    // This only happens on first deploy or after an explicit KV flush.
    // After this point the seed file is never consulted for reads again.
    const seeded = await readSeedFile(key, fallback);
    await kv.set(storeKey, JSON.stringify(seeded));
    return JSON.parse(JSON.stringify(seeded));
  }

  // No KV configured.
  assertPersistentStoreAvailable(); // throws on Vercel — keeps ephemeral storage out of the write path

  // Local development: read/write directly from data/
  return readSeedFile(key, fallback);
}

async function writeJsonFile(key, value) {
  const kv = getKv();

  if (kv) {
    await kv.set(kvStoreKey(key), JSON.stringify(value));
    return;
  }

  assertPersistentStoreAvailable(); // throws on Vercel

  // Local development only
  await writeToSeedFile(key, value);
}

// ─── Append-safe catch log storage (Tasks 1 + 2) ─────────────────────────────
// Each catch log is stored as an independent KV record (no full-list rewrite).
// A Redis LIST acts as an ordered index of IDs (newest first via LPUSH).

async function appendCatchLog(record) {
  const kv = getKv();
  if (!kv) {
    assertPersistentStoreAvailable();
    throw new Error('kv_not_available');
  }
  const id = String(record.id);
  // Store individual record — no read-modify-write, fully safe under concurrent writes
  await kv.set(CATCH_RECORD_PREFIX + id, JSON.stringify(record));
  // Push ID to front of list (atomic, newest first)
  await kv.lpush(CATCH_INDEX_KEY, id);
  // Trim index to guard against unbounded growth
  await kv.ltrim(CATCH_INDEX_KEY, 0, CATCH_INDEX_MAX_SIZE - 1);
}

async function getCatchLogs(stationId, limit) {
  const kv = getKv();
  if (!kv) {
    assertPersistentStoreAvailable();
    throw new Error('kv_not_available');
  }
  const safeLimit = (typeof limit === 'number' && limit > 0) ? limit : 100;
  // Fetch more IDs when filtering by station so we can return up to safeLimit after filter
  const fetchCount = stationId ? Math.min(500, CATCH_INDEX_MAX_SIZE) : safeLimit;

  const ids = await kv.lrange(CATCH_INDEX_KEY, 0, fetchCount - 1);
  if (!ids || !ids.length) return [];

  // Batch-fetch all records
  const keys = ids.map((id) => CATCH_RECORD_PREFIX + String(id));
  const rawRecords = await kv.mget(...keys);

  const records = rawRecords
    .map((r) => {
      if (r == null) return null;
      try { return typeof r === 'string' ? JSON.parse(r) : r; }
      catch (_) { return null; }
    })
    .filter(Boolean);

  if (stationId) {
    return records.filter((r) => r.station_id === stationId).slice(0, safeLimit);
  }
  return records.slice(0, safeLimit);
}

function parseStoredRecord(raw) {
  if (raw == null) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

async function appendIndexedRecordLocal(key, record, maxSize) {
  const rows = await readJsonFile(key, []);
  rows.unshift(record);
  await writeJsonFile(key, rows.slice(0, maxSize));
}

async function appendIndexedRecord(options, record) {
  const kv = getKv();
  if (!kv) {
    assertPersistentStoreAvailable();
    return appendIndexedRecordLocal(options.fileKey, record, options.maxSize);
  }
  const id = String(record[options.idField] || '');
  if (!id) throw new Error('record_id_required');
  await kv.set(options.recordPrefix + id, JSON.stringify(record));
  await kv.lpush(options.indexKey, id);
  await kv.ltrim(options.indexKey, 0, options.maxSize - 1);
}

async function getIndexedRecordsLocal(key, options) {
  const rows = await readJsonFile(key, []);
  return rows.filter(function (record) {
    if (options.stationId && String(record && record.station_id || '') !== options.stationId) return false;
    if (options.durId && String(record && record.dur_id || '') !== options.durId) return false;
    if (options.status && String(record && record.validation_status || '') !== options.status) return false;
    return true;
  }).slice(0, options.limit);
}

async function getIndexedRecords(config, options) {
  const kv = getKv();
  const query = Object.assign({ stationId: '', durId: '', status: '', limit: 100 }, options || {});
  if (!kv) {
    assertPersistentStoreAvailable();
    return getIndexedRecordsLocal(config.fileKey, query);
  }
  const safeLimit = (typeof query.limit === 'number' && query.limit > 0) ? query.limit : 100;
  const fetchCount = query.stationId || query.durId || query.status ? Math.min(config.maxSize, Math.max(safeLimit * 5, 500)) : safeLimit;
  const ids = await kv.lrange(config.indexKey, 0, fetchCount - 1);
  if (!ids || !ids.length) return [];
  const keys = ids.map(function (id) { return config.recordPrefix + String(id); });
  const rawRecords = await kv.mget(...keys);
  const records = rawRecords.map(parseStoredRecord).filter(Boolean);
  return records.filter(function (record) {
    if (query.stationId && String(record.station_id || '') !== query.stationId) return false;
    if (query.durId && String(record.dur_id || '') !== query.durId) return false;
    if (query.status && String(record.validation_status || '') !== query.status) return false;
    return true;
  }).slice(0, safeLimit);
}

async function appendStationSnapshot(record) {
  return appendIndexedRecord({
    fileKey: 'station_snapshots',
    idField: 'snapshot_id',
    indexKey: SNAPSHOT_INDEX_KEY,
    recordPrefix: SNAPSHOT_RECORD_PREFIX,
    maxSize: SNAPSHOT_INDEX_MAX_SIZE
  }, record);
}

async function getStationSnapshots(options) {
  return getIndexedRecords({
    fileKey: 'station_snapshots',
    indexKey: SNAPSHOT_INDEX_KEY,
    recordPrefix: SNAPSHOT_RECORD_PREFIX,
    maxSize: SNAPSHOT_INDEX_MAX_SIZE
  }, options);
}

async function appendDurValidationLog(record) {
  return appendIndexedRecord({
    fileKey: 'dur_validation_logs',
    idField: 'validation_id',
    indexKey: VALIDATION_INDEX_KEY,
    recordPrefix: VALIDATION_RECORD_PREFIX,
    maxSize: VALIDATION_INDEX_MAX_SIZE
  }, record);
}

async function getDurValidationLogs(options) {
  return getIndexedRecords({
    fileKey: 'dur_validation_logs',
    indexKey: VALIDATION_INDEX_KEY,
    recordPrefix: VALIDATION_RECORD_PREFIX,
    maxSize: VALIDATION_INDEX_MAX_SIZE
  }, options);
}

async function appendSnapshotRunLog(record) {
  return appendIndexedRecord({
    fileKey: 'snapshot_run_logs',
    idField: 'run_id',
    indexKey: SNAPSHOT_RUN_INDEX_KEY,
    recordPrefix: SNAPSHOT_RUN_RECORD_PREFIX,
    maxSize: SNAPSHOT_RUN_INDEX_MAX_SIZE
  }, record);
}

async function getSnapshotRunLogs(options) {
  return getIndexedRecords({
    fileKey: 'snapshot_run_logs',
    indexKey: SNAPSHOT_RUN_INDEX_KEY,
    recordPrefix: SNAPSHOT_RUN_RECORD_PREFIX,
    maxSize: SNAPSHOT_RUN_INDEX_MAX_SIZE
  }, options);
}

// ─── Upstash-backed rate limiting (Task 3) ────────────────────────────────────
// Uses Redis INCR + EXPIRE for cross-instance, persistent rate limiting.
// Falls back to allowing the request if KV is unavailable.

async function rateLimitKv(prefix, ip, maxRequests, windowSec) {
  const kv = getKv();
  if (!kv) return true; // no KV — allow (in-memory fallback handled by caller)
  try {
    const key = RL_PREFIX + prefix + ':' + String(ip).slice(0, 100);
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, windowSec);
    return count <= maxRequests;
  } catch (_) {
    return true; // never block on KV error
  }
}

// ─── Deduplication (Task 6) ──────────────────────────────────────────────────
// Returns true when the fingerprint already exists (= duplicate, reject).
// Uses SET NX (set only if not exists) + EX (auto-expire).

async function checkAndSetDedup(fingerprint, ttlSec) {
  const kv = getKv();
  if (!kv) return false; // no KV — allow through
  try {
    const key = DEDUP_PREFIX + String(fingerprint).slice(0, 200);
    // 'OK' = newly set (not a dup). null = key existed already (= dup).
    const result = await kv.set(key, '1', { nx: true, ex: ttlSec });
    return result === null; // true means duplicate
  } catch (_) {
    return false; // never block on KV error
  }
}

// ─── Storage health check (Task 2) ───────────────────────────────────────────
async function checkStorageHealth() {
  const hasConfig = !!(process.env.KV_REST_API_URL || process.env.KV_URL) &&
                    !!(process.env.KV_REST_API_TOKEN);
  const kv = getKv();
  if (!kv) {
    return { ok: false, storage: 'upstash-kv', configured: false, writable: false, readable: false, error: 'kv_not_configured' };
  }
  const testKey = 'navidur_health_' + Date.now();
  let writable = false;
  let readable = false;
  try {
    await kv.set(testKey, 'ok', { ex: 30 });
    writable = true;
    const val = await kv.get(testKey);
    readable = val === 'ok';
    return { ok: writable && readable, storage: 'upstash-kv', configured: hasConfig, writable, readable };
  } catch (err) {
    return { ok: false, storage: 'upstash-kv', configured: hasConfig, writable, readable, error: String(err.message || err) };
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  return prefix + '_' + Date.now().toString(36) + rand;
}

module.exports = {
  readJsonFile,
  writeJsonFile,
  nowIso,
  createId,
  getKv,
  kvStoreKey,
  appendCatchLog,
  getCatchLogs,
  appendStationSnapshot,
  getStationSnapshots,
  appendDurValidationLog,
  getDurValidationLogs,
  appendSnapshotRunLog,
  getSnapshotRunLogs,
  rateLimitKv,
  checkAndSetDedup,
  checkStorageHealth
};
