'use strict';

var { Redis } = require('@upstash/redis');

var CONFIG_KEY = 'navidur_genome_review_config';
var _kvClient = null;
var _memoryConfig = null;

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

function nowIso() {
  return new Date().toISOString();
}

function defaultConfig(updatedBy) {
  return {
    enabled: false,
    reference_only: true,
    run_only_selected: true,
    selected_station_ids: [],
    exclude_station_ids: [],
    allow_bulk_save: false,
    updated_at: nowIso(),
    updated_by: updatedBy || 'admin'
  };
}

function cleanIdList(raw, max) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  var seen = {};
  for (var i = 0; i < raw.length && out.length < (max || 200); i += 1) {
    var id = String(raw[i] || '').trim();
    if (!id || seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  return out;
}

function normalizeConfig(input, actor) {
  var base = defaultConfig(actor);
  var src = input && typeof input === 'object' ? input : {};
  return {
    enabled: src.enabled === true,
    reference_only: src.reference_only !== false,
    run_only_selected: src.run_only_selected !== false,
    selected_station_ids: cleanIdList(src.selected_station_ids, 200),
    exclude_station_ids: cleanIdList(src.exclude_station_ids, 200),
    allow_bulk_save: src.allow_bulk_save === true,
    updated_at: nowIso(),
    updated_by: String(actor || src.updated_by || 'admin').slice(0, 80)
  };
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

async function getConfig() {
  var kv = getKv();
  var doc = null;
  if (kv) {
    doc = parseStored(await kv.get(CONFIG_KEY));
  } else if (_memoryConfig != null) {
    doc = parseStored(_memoryConfig);
  }
  if (!doc || typeof doc !== 'object') {
    return defaultConfig('system');
  }
  return normalizeConfig(doc, doc.updated_by || 'system');
}

async function saveConfig(input, actor) {
  var next = normalizeConfig(input, actor);
  var kv = getKv();
  var payload = JSON.stringify(next);
  if (kv) {
    await kv.set(CONFIG_KEY, payload);
  } else {
    _memoryConfig = payload;
  }
  return next;
}

function stationInList(list, stationId, referenceStationId) {
  var sid = String(stationId || '').trim();
  var rid = String(referenceStationId || sid).trim();
  var ids = {};
  (list || []).forEach(function (id) {
    ids[String(id)] = true;
  });
  return ids[sid] === true || (rid && ids[rid] === true);
}

function assertSaveAllowed(config, opts) {
  var cfg = config || defaultConfig('system');
  var o = opts || {};
  if (cfg.enabled !== true) {
    return { ok: false, error: 'genome_review_disabled' };
  }
  if (o.bulk === true && cfg.allow_bulk_save !== true) {
    return { ok: false, error: 'bulk_save_disabled' };
  }
  var stationId = String(o.station_id || '').trim();
  var referenceStationId = String(o.reference_station_id || stationId).trim();
  if (!stationId) {
    return { ok: false, error: 'station_id_required' };
  }
  if (stationInList(cfg.exclude_station_ids, stationId, referenceStationId)) {
    return { ok: false, error: 'station_excluded_from_genome_review' };
  }
  if (cfg.run_only_selected === true) {
    if (!stationInList(cfg.selected_station_ids, stationId, referenceStationId)) {
      return { ok: false, error: 'station_not_enabled_for_genome_review' };
    }
  }
  return { ok: true };
}

module.exports = {
  CONFIG_KEY: CONFIG_KEY,
  defaultConfig: defaultConfig,
  normalizeConfig: normalizeConfig,
  getConfig: getConfig,
  saveConfig: saveConfig,
  assertSaveAllowed: assertSaveAllowed,
  stationInList: stationInList
};
