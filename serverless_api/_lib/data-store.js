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
  true_final_station_reference: 'true_final_station_reference.json',
  manual_anchor: 'manual_anchor.json',
  gulf_fish_database: 'gulf_fish_database.json',
  live_weather_cache: 'live_weather_cache.json',
  navidur_learning_adjustments: 'navidur_learning_adjustments.json',
  navidur_learning_settings: 'navidur_learning_settings.json',
  field_session_reviews: 'field_session_reviews.json',
  trait_calibration: 'trait_calibration.json',
  trait_cycles: 'trait_cycles.json',
  trait_evidence: 'trait_evidence.json',
  navidur_system_events: 'navidur_system_events.json',
  navidur_monitoring_snapshots: 'navidur_monitoring_snapshots.json',
  durur_trait_framework: 'durur_trait_framework.json',
  navidur_seasonal_validation_history: 'navidur_seasonal_validation_history.json',
  navidur_seasonal_validation_records: 'navidur_seasonal_validation_records.json',
  field_station_schema: 'field_station_schema.json'
};

// ─── KV keys for append-safe catch log storage ───────────────────────────────
const CATCH_INDEX_KEY = 'navidur_catch_index';   // Redis LIST of IDs (newest first)
const CATCH_RECORD_PREFIX = 'navidur_catch:';     // navidur_catch:{id} = JSON record
const CATCH_INDEX_MAX_SIZE = 10000;               // LTRIM guard — prevents unbounded growth
const SNAPSHOT_INDEX_KEY = 'navidur_station_snapshot_index';
const SNAPSHOT_RECORD_PREFIX = 'navidur_station_snapshot:';
const VALIDATION_INDEX_KEY = 'navidur_dur_validation_index';
const VALIDATION_RECORD_PREFIX = 'navidur_dur_validation:';
const SEASONAL_HISTORY_INDEX_KEY = 'navidur_seasonal_validation_index';
const SEASONAL_HISTORY_RECORD_PREFIX = 'navidur_seasonal_validation:';
const INDEX_PAGE_SIZE = 500;
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

// Writes that require durable storage still need KV on Vercel (filesystem is not persistent).
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

  // No KV: always read bundled data/*.json (Git / deployment artifact). Never fail here.
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
  const retained = Number.isInteger(maxSize) && maxSize > 0 ? rows.slice(0, maxSize) : rows;
  await writeJsonFile(key, retained);
}

async function appendIndexedRecord(options, record) {
  const kv = getKv();
  if (!kv) {
    assertPersistentStoreAvailable();
    return appendIndexedRecordLocal(options.fileKey, record, options.maxSize);
  }
  return appendIndexedRecordToStorage(kv, options, record);
}

async function appendIndexedRecordToStorage(kv, options, record) {
  const id = String(record[options.idField] || '');
  if (!id) throw new Error('record_id_required');
  await kv.set(options.recordPrefix + id, JSON.stringify(record));
  await kv.lpush(options.indexKey, id);
  if (Number.isInteger(options.maxSize) && options.maxSize > 0) {
    await kv.ltrim(options.indexKey, 0, options.maxSize - 1);
  }
}

function recordMatchesStationIdFilter(record, stationId, includeReferenceAlias) {
  if (!stationId) return true;
  const sid = String(stationId);
  const recSid = String(record && record.station_id || '');
  if (recSid === sid) return true;
  if (includeReferenceAlias && String(record && record.reference_station_id || '') === sid) return true;
  return false;
}

function recordHasCategory(record, category) {
  if (!category || category === 'all') return true;
  const weather = record && record.observed_weather || {};
  const marine = record && record.observed_marine || {};
  const tide = record && record.observed_tide || {};
  if (category === 'meteorological') {
    return ['temp_c', 'wind_speed_kmh', 'wind_direction_deg'].some(function (key) { return weather[key] != null; });
  }
  if (category === 'marine') {
    return ['wave_height_m'].some(function (key) { return marine[key] != null; });
  }
  if (category === 'currents') return marine.current_speed_ms != null;
  if (category === 'tides') {
    return tide.height_m != null || tide.state != null || tide.state_ar != null || tide.current_speed_ms != null;
  }
  return false;
}

function recordMatchesQuery(record, query) {
  if (query.stationId && !recordMatchesStationIdFilter(record, query.stationId, query.stationIdMatchesReferenceBucket)) return false;
  if (query.durId && String(record && record.dur_id || '') !== query.durId) return false;
  const recordStatus = String(record && (record.verification_status || record.validation_status || record.status) || '');
  const statusAliases = {
    confirmed_mismatch: ['confirmed_mismatch', 'failed'],
    insufficient_evidence: ['insufficient_evidence', 'needs_review'],
    not_applicable: ['not_applicable', 'no_reference']
  };
  if (query.status) {
    const accepted = statusAliases[query.status] || [query.status];
    if (accepted.indexOf(recordStatus) < 0) return false;
  }
  const date = String(record && (record.analysis_date || record.date) || record && record.timestamp || '').slice(0, 10);
  const timestamp = Date.parse(String(record && record.timestamp || ''));
  if (query.since && (!Number.isFinite(timestamp) || timestamp < Date.parse(query.since))) return false;
  if (query.until && (!Number.isFinite(timestamp) || timestamp > Date.parse(query.until))) return false;
  if (query.startDate && (!date || date < query.startDate)) return false;
  if (query.endDate && (!date || date > query.endDate)) return false;
  if (query.month && Number(date.slice(5, 7)) !== query.month) return false;
  if (query.year && Number(date.slice(0, 4)) !== query.year) return false;
  if (query.region && String(record && (record.region_id || record.region) || '') !== query.region) return false;
  if (query.category && query.category !== 'all' && !recordHasCategory(record, query.category)) return false;
  if (query.trait) {
    const expected = record && record.expected_reference_summary && record.expected_reference_summary.expected_traits || [];
    const names = [].concat(
      Array.isArray(expected) ? expected : [],
      Array.isArray(record && record.expected_traits) ? record.expected_traits : [],
      Array.isArray(record && record.matched_traits) ? record.matched_traits : [],
      Array.isArray(record && record.failed_traits) ? record.failed_traits : []
    ).map(function (item) {
      return String(item && typeof item === 'object' ? item.trait_name || item.name || '' : item);
    });
    if (names.indexOf(query.trait) < 0) return false;
  }
  return true;
}

async function getIndexedRecordsLocal(key, options) {
  const rows = await readJsonFile(key, []);
  const q = options || {};
  const lim = typeof q.limit === 'number' && q.limit > 0 ? q.limit : 100;
  const offset = typeof q.offset === 'number' && q.offset > 0 ? q.offset : 0;
  return rows.filter(function (record) { return recordMatchesQuery(record, q); }).slice(offset, offset + lim);
}

async function getIndexedRecords(config, options) {
  const kv = getKv();
  const query = Object.assign({ stationId: '', durId: '', status: '', limit: 100, stationIdMatchesReferenceBucket: false }, options || {});
  if (!kv) {
    assertPersistentStoreAvailable();
    return getIndexedRecordsLocal(config.fileKey, query);
  }
  return (await getIndexedRecordsPageFromStorage(kv, Object.assign({ idField: 'id' }, config), query)).items;
}

async function getIndexedRecordsPageFromStorage(kv, config, options) {
  const query = Object.assign({ stationId: '', durId: '', status: '', limit: 100, offset: 0, stationIdMatchesReferenceBucket: false }, options || {});
  const limit = Number.isInteger(query.limit) && query.limit > 0 ? query.limit : 100;
  const offset = Number.isInteger(query.offset) && query.offset > 0 ? query.offset : 0;
  const cursor = typeof query.cursor === 'string' && query.cursor ? query.cursor : '';
  let start = 0;
  let cursorFound = !cursor;
  let skippedMatches = 0;
  let exhausted = false;
  let firstPageIds = null;
  let pageRequests = 0;
  const items = [];
  const itemIds = new Set();
  const seenIndexIds = new Set();
  while (!exhausted && items.length <= limit) {
    const ids = await kv.lrange(config.indexKey, start, start + INDEX_PAGE_SIZE - 1);
    pageRequests += 1;
    if (!Array.isArray(ids)) throw new Error('indexed_record_index_response_invalid');
    if (start === 0) firstPageIds = ids.slice();
    if (!ids.length) {
      exhausted = true;
      break;
    }
    const selectedIds = [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = String(ids[i] == null ? '' : ids[i]);
      if (!id) throw new Error('indexed_record_index_entry_invalid');
      if (cursor && !cursorFound) {
        seenIndexIds.add(id);
        if (id === cursor) cursorFound = true;
        continue;
      }
      if (seenIndexIds.has(id)) continue;
      seenIndexIds.add(id);
      selectedIds.push(id);
    }
    if (selectedIds.length) {
      const rawRecords = await kv.mget.apply(kv, selectedIds.map(function (id) {
        return config.recordPrefix + id;
      }));
      if (!Array.isArray(rawRecords) || rawRecords.length !== selectedIds.length) {
        throw new Error('indexed_record_storage_response_invalid');
      }
      for (let i = 0; i < rawRecords.length && items.length <= limit; i += 1) {
        const record = parseStoredRecord(rawRecords[i]);
        if (!record) {
          const error = new Error('indexed_record_missing');
          error.code = 'indexed_record_missing';
          throw error;
        }
        if (!recordMatchesQuery(record, query)) continue;
        const id = String(record[config.idField] || record.id || selectedIds[i]);
        if (itemIds.has(id)) continue;
        if (!cursor && skippedMatches < offset) {
          skippedMatches += 1;
          continue;
        }
        itemIds.add(id);
        items.push(record);
      }
    }
    start += ids.length;
    if (ids.length < INDEX_PAGE_SIZE) exhausted = true;
  }
  if (!cursorFound) throw new Error('indexed_record_cursor_not_found');
  if (pageRequests > 1) {
    const verifyIds = await kv.lrange(config.indexKey, 0, Math.max(0, (firstPageIds || []).length - 1));
    if (!Array.isArray(verifyIds) || JSON.stringify(verifyIds) !== JSON.stringify(firstPageIds)) {
      throw new Error('indexed_record_index_changed_during_page');
    }
  }
  const hasMore = items.length > limit;
  if (hasMore) items.pop();
  return {
    items: items,
    has_more: hasMore,
    next_cursor: hasMore && items.length
      ? String(items[items.length - 1][config.idField] || items[items.length - 1].id || '')
      : null
  };
}

async function appendStationSnapshot(record) {
  return appendIndexedRecord({
    fileKey: 'station_snapshots',
    idField: 'snapshot_id',
    indexKey: SNAPSHOT_INDEX_KEY,
    recordPrefix: SNAPSHOT_RECORD_PREFIX,
  }, record);
}

async function getStationSnapshots(options) {
  return getIndexedRecords({
    fileKey: 'station_snapshots',
    indexKey: SNAPSHOT_INDEX_KEY,
    recordPrefix: SNAPSHOT_RECORD_PREFIX,
    idField: 'snapshot_id',
  }, options);
}

async function getStationSnapshotsPage(options) {
  return getIndexedRecordsPage({
    fileKey: 'station_snapshots',
    indexKey: SNAPSHOT_INDEX_KEY,
    recordPrefix: SNAPSHOT_RECORD_PREFIX,
    idField: 'snapshot_id'
  }, options);
}

async function getStationSnapshotById(id) {
  return getIndexedRecordById({
    fileKey: 'station_snapshots',
    idField: 'snapshot_id',
    recordPrefix: SNAPSHOT_RECORD_PREFIX
  }, id);
}

async function appendDurValidationLog(record) {
  return appendIndexedRecord({
    fileKey: 'dur_validation_logs',
    idField: 'validation_id',
    indexKey: VALIDATION_INDEX_KEY,
    recordPrefix: VALIDATION_RECORD_PREFIX,
  }, record);
}

async function getDurValidationLogs(options) {
  return getIndexedRecords({
    fileKey: 'dur_validation_logs',
    indexKey: VALIDATION_INDEX_KEY,
    recordPrefix: VALIDATION_RECORD_PREFIX,
    idField: 'validation_id',
  }, options);
}

async function getDurValidationLogsPage(options) {
  return getIndexedRecordsPage({
    fileKey: 'dur_validation_logs',
    indexKey: VALIDATION_INDEX_KEY,
    recordPrefix: VALIDATION_RECORD_PREFIX,
    idField: 'validation_id'
  }, options);
}

async function getDurValidationLogById(id) {
  return getIndexedRecordById({
    fileKey: 'dur_validation_logs',
    idField: 'validation_id',
    recordPrefix: VALIDATION_RECORD_PREFIX
  }, id);
}

async function getIndexedRecordById(config, id) {
  const recordId = String(id == null ? '' : id).trim();
  if (!recordId) return null;
  const kv = getKv();
  if (kv) return parseStoredRecord(await kv.get(config.recordPrefix + recordId));
  assertPersistentStoreAvailable();
  const records = await readJsonFile(config.fileKey, []);
  const record = (Array.isArray(records) ? records : []).find(function (item) {
    return String(item && (item[config.idField] || item.id) || '') === recordId;
  });
  return record || null;
}

async function getIndexedRecordsPage(config, options) {
  const kv = getKv();
  const query = Object.assign({ stationId: '', durId: '', status: '', limit: 100, offset: 0 }, options || {});
  if (!kv) {
    assertPersistentStoreAvailable();
    const allRows = await readJsonFile(config.fileKey, []);
    let rows = (Array.isArray(allRows) ? allRows : []).filter(function (record) {
      return recordMatchesQuery(record, query);
    });
    const offset = Number.isInteger(query.offset) && query.offset > 0 ? query.offset : 0;
    const limit = Number.isInteger(query.limit) && query.limit > 0 ? query.limit : 100;
    if (query.cursor) {
      const cursorIndex = rows.findIndex(function (record) {
        return String(record && (record[config.idField] || record.id) || '') === query.cursor;
      });
      if (cursorIndex < 0) throw new Error('indexed_record_cursor_not_found');
      rows = rows.slice(cursorIndex + 1);
    } else {
      rows = rows.slice(offset);
    }
    const items = rows.slice(0, limit);
    return {
      items: items,
      has_more: rows.length > limit,
      next_cursor: items.length ? String(items[items.length - 1][config.idField] || '') : null,
      next_offset: offset + items.length
    };
  }
  return getIndexedRecordsPageFromStorage(kv, config, query);
}

function seasonalHistoryRecordMatches(record, query) {
  if (!record) return false;
  if (query.stationId && String(record.station_id || '') !== query.stationId) return false;
  if (query.durId && String(record.dur_id || '') !== query.durId) return false;
  if (query.date && String(record.date || '') !== query.date) return false;
  if (query.region && record.region && String(record.region) !== query.region) return false;
  if (query.monthDay && String(record.date || '').slice(5, 10) !== query.monthDay) return false;
  if (query.ruleVersion && String(record.verification_rule_version || 'legacy') !== query.ruleVersion) return false;
  if (query.status) {
    const recordStatus = String(record.verification_status || record.validation_status || record.status || '');
    const statusAliases = {
      confirmed_mismatch: ['confirmed_mismatch', 'failed'],
      insufficient_evidence: ['insufficient_evidence', 'needs_review'],
      not_applicable: ['not_applicable', 'no_reference']
    };
    const accepted = statusAliases[query.status] || [query.status];
    if (accepted.indexOf(recordStatus) < 0) return false;
  }
  return true;
}

async function appendSeasonalValidationRecord(record) {
  return appendIndexedRecord({
    fileKey: 'navidur_seasonal_validation_records',
    idField: 'validation_id',
    indexKey: SEASONAL_HISTORY_INDEX_KEY,
    recordPrefix: SEASONAL_HISTORY_RECORD_PREFIX
  }, record);
}

async function getSeasonalValidationHistoryPage(options, dependencies) {
  const query = Object.assign({ offset: 0, limit: 100 }, options || {});
  const deps = dependencies || {};
  const cursor = typeof query.cursor === 'string' ? query.cursor : '';
  const onRecord = typeof query.onRecord === 'function' ? query.onRecord : null;
  const offset = cursor ? 0 : (Number.isInteger(query.offset) && query.offset > 0 ? query.offset : 0);
  const limit = Number.isInteger(query.limit) && query.limit > 0 ? query.limit : 100;
  const kv = Object.prototype.hasOwnProperty.call(deps, 'kv') ? deps.kv : getKv();
  const legacyDoc = query.includeLegacy === false
    ? { version: 1, entries: [] }
    : (deps.legacyDoc || await readJsonFile('navidur_seasonal_validation_history', { version: 1, entries: [] }));
  const legacyEntries = Array.isArray(legacyDoc && legacyDoc.entries) ? legacyDoc.entries : [];
  const items = [];
  const cursors = [];
  const years = new Set();
  let total = 0;
  let visibleCount = 0;
  let indexOffset = 0;
  let exhausted = false;
  let cursorFound = !cursor;
  let firstIndexPage = null;
  let indexPageCount = 0;
  const seenIndexIds = new Set();
  const seenRecordIds = new Set();

  if (kv) {
    while (!exhausted) {
      const ids = await kv.lrange(SEASONAL_HISTORY_INDEX_KEY, indexOffset, indexOffset + INDEX_PAGE_SIZE - 1);
      indexPageCount += 1;
      if (!Array.isArray(ids)) throw new Error('seasonal_history_index_response_invalid');
      if (indexOffset === 0) firstIndexPage = ids.slice();
      if (!ids.length) break;
      const normalizedIds = ids.map(function (id) {
        const value = String(id == null ? '' : id);
        if (!value) throw new Error('seasonal_history_index_entry_invalid');
        return value;
      });
      const rawRecords = await kv.mget.apply(kv, normalizedIds.map(function (id) {
        return SEASONAL_HISTORY_RECORD_PREFIX + id;
      }));
      if (!Array.isArray(rawRecords) || rawRecords.length !== normalizedIds.length) {
        throw new Error('seasonal_history_storage_response_invalid');
      }
      rawRecords.map(parseStoredRecord).forEach(function (record, index) {
        const recordId = normalizedIds[index];
        if (!record) {
          const error = new Error('seasonal_history_record_missing');
          error.code = 'seasonal_history_record_missing';
          throw error;
        }
        if (seenIndexIds.has(recordId)) return;
        seenIndexIds.add(recordId);
        const recordIdentity = String(record.validation_id || record.id || recordId);
        const beforeCursor = cursor && !cursorFound;
        if (beforeCursor && recordId === cursor) cursorFound = true;
        if (seenRecordIds.has(recordIdentity)) return;
        seenRecordIds.add(recordIdentity);
        if (seasonalHistoryRecordMatches(record, query)) {
          total += 1;
          const year = Number(record.year);
          if (Number.isInteger(year) && year > 0) years.add(year);
        }
        if (beforeCursor) return;
        if (!seasonalHistoryRecordMatches(record, query)) return;
        if (onRecord) onRecord(record);
        else if (visibleCount >= offset && items.length <= limit) {
          items.push(record);
          cursors.push(normalizedIds[index]);
        }
        visibleCount += 1;
      });
      indexOffset += ids.length;
      if (ids.length < INDEX_PAGE_SIZE) exhausted = true;
    }
    if (indexPageCount > 1) {
      const currentFirstPage = await kv.lrange(SEASONAL_HISTORY_INDEX_KEY, 0, Math.max(0, firstIndexPage.length - 1));
      if (!Array.isArray(currentFirstPage) || JSON.stringify(currentFirstPage) !== JSON.stringify(firstIndexPage)) {
        throw new Error('seasonal_history_index_changed_during_page');
      }
    }
  } else {
    if (!Object.prototype.hasOwnProperty.call(deps, 'kv')) assertPersistentStoreAvailable();
    const records = deps.localRecords || await readJsonFile('navidur_seasonal_validation_records', []);
    const localRecords = Array.isArray(records) ? records : [];
    localRecords.forEach(function (record) {
      const recordIdentity = String(record && (record.validation_id || record.id) || '');
      if (recordIdentity && seenRecordIds.has(recordIdentity)) return;
      if (recordIdentity) seenRecordIds.add(recordIdentity);
      if (seasonalHistoryRecordMatches(record, query)) {
        total += 1;
        const year = Number(record && record.year);
        if (Number.isInteger(year) && year > 0) years.add(year);
      }
      if (cursor && !cursorFound) {
        if (String(record && record.validation_id || '') === cursor) cursorFound = true;
        return;
      }
      if (!seasonalHistoryRecordMatches(record, query)) return;
      if (onRecord) onRecord(record);
      else if (visibleCount >= offset && items.length <= limit) {
        items.push(record);
        cursors.push(String(record.validation_id || ''));
      }
      visibleCount += 1;
    });
  }

  legacyEntries.forEach(function (record, index) {
    const legacyCursor = 'legacy:' + String(record && record.validation_id || index);
    const recordIdentity = String(record && (record.validation_id || record.id) || legacyCursor);
    const beforeCursor = cursor && !cursorFound;
    if (beforeCursor && legacyCursor === cursor) cursorFound = true;
    if (seenRecordIds.has(recordIdentity)) return;
    seenRecordIds.add(recordIdentity);
    if (seasonalHistoryRecordMatches(record, query)) {
      total += 1;
      const year = Number(record && record.year);
      if (Number.isInteger(year) && year > 0) years.add(year);
    }
    if (beforeCursor) return;
    if (!seasonalHistoryRecordMatches(record, query)) return;
    if (onRecord) onRecord(record);
    else if (visibleCount >= offset && items.length <= limit) {
      items.push(record);
      cursors.push(legacyCursor);
    }
    visibleCount += 1;
  });
  if (cursor && !cursorFound) throw new Error('seasonal_history_cursor_not_found');
  const hasMore = visibleCount > offset + limit;
  return {
    items: items.slice(0, limit),
    total: total,
    offset: offset,
    limit: limit,
    has_more: hasMore,
    next_offset: hasMore && !cursor ? offset + limit : null,
    next_cursor: hasMore ? cursors[Math.min(limit, items.length) - 1] || null : null,
    is_partial: !!cursor || offset > 0 || hasMore,
    years: Array.from(years).sort(function (a, b) { return a - b; })
  };
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
  getStationSnapshotsPage,
  getStationSnapshotById,
  appendDurValidationLog,
  getDurValidationLogs,
  getDurValidationLogsPage,
  getDurValidationLogById,
  getIndexedRecordsPageFromStorage,
  appendIndexedRecordToStorage,
  appendSeasonalValidationRecord,
  getSeasonalValidationHistoryPage,
  appendSnapshotRunLog,
  getSnapshotRunLogs,
  recordMatchesQuery,
  rateLimitKv,
  checkAndSetDedup,
  checkStorageHealth
};
