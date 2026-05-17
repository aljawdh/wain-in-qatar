'use strict';

var { Redis } = require('@upstash/redis');

var PREFIX = 'navidur_trait_review_';
var INDEX_KEY = PREFIX + 'index';
var RECORD_PREFIX = PREFIX;
var MAX_INDEX_SIZE = 50000;
var _kvClient = null;
var _memoryIndex = [];
var _memoryRecords = new Map();

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

function assertReviewKey(key) {
  var k = String(key || '');
  if (!k.startsWith(PREFIX)) {
    throw new Error('trait_review_key_prefix_violation:' + k);
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

function recordKey(id) {
  return assertReviewKey(RECORD_PREFIX + String(id));
}

async function appendReview(record) {
  var id = String(record.id || '');
  if (!id) throw new Error('trait_review_id_required');
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

async function listReviewIds(limit) {
  var n = typeof limit === 'number' && limit > 0 ? limit : 5000;
  var kv = getKv();
  if (kv) {
    return (await kv.lrange(INDEX_KEY, 0, n - 1)) || [];
  }
  return _memoryIndex.slice(0, n);
}

async function getReviewById(id) {
  var key = recordKey(id);
  var kv = getKv();
  if (kv) {
    return parseStored(await kv.get(key));
  }
  return _memoryRecords.has(key) ? parseStored(_memoryRecords.get(key)) : null;
}

async function listReviews(options) {
  var q = options || {};
  var lim = typeof q.limit === 'number' && q.limit > 0 ? q.limit : 500;
  var fetchN = Math.min(MAX_INDEX_SIZE, Math.max(lim * 8, 800));
  var ids = await listReviewIds(fetchN);
  if (!ids.length) return [];
  var kv = getKv();
  var records = [];
  if (kv) {
    var keys = ids.map(function (id) { return recordKey(id); });
    var raw = await kv.mget(...keys);
    records = (raw || []).map(parseStored).filter(Boolean);
  } else {
    records = ids.map(function (id) {
      return parseStored(_memoryRecords.get(recordKey(id)));
    }).filter(Boolean);
  }
  var stationId = String(q.station_id || '').trim();
  var refId = String(q.reference_station_id || '').trim();
  var durName = String(q.dur_name || '').trim();
  return records.filter(function (r) {
    if (stationId) {
      var sid = String(r.station_id || '');
      var rid = String(r.reference_station_id || '');
      if (sid !== stationId && rid !== stationId && sid !== refId) return false;
    }
    if (refId && String(r.reference_station_id || '') !== refId && String(r.station_id || '') !== refId) {
      if (stationId) { /* already checked */ }
      else if (String(r.reference_station_id || '') !== refId) return false;
    }
    if (durName && String(r.dur_name || '').trim() !== durName) return false;
    return true;
  }).slice(0, lim);
}

module.exports = {
  PREFIX: PREFIX,
  INDEX_KEY: INDEX_KEY,
  RECORD_PREFIX: RECORD_PREFIX,
  isKvConfigured: isKvConfigured,
  appendReview: appendReview,
  listReviews: listReviews,
  getReviewById: getReviewById
};
