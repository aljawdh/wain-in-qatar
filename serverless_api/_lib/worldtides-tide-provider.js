'use strict';

/**
 * WorldTides API v2 — extremes only (no heights).
 * Normalized for NAVIDUR tide_series (no sine, no wave proxy).
 */

const { readJsonFile, writeJsonFile } = require('./data-store');
const { cleanString, toNumber } = require('./security');

var CACHE_MS = 6 * 60 * 60 * 1000;
var CACHE_DOC_KEY = 'worldtides_tide_cache';

function cacheEntryKey(stationId, date) {
  var sid = cleanString(stationId, 120);
  if (!sid) sid = 'no_station';
  var d = cleanString(date, 20) || 'unknown';
  return sid + '|' + d;
}

/**
 * Maps data.extremes to NAVIDUR timeline.
 * Each point: time = Unix epoch in milliseconds (JS Date interop), height, type HIGH|LOW;
 * height_m mirrors height for existing UI consumers.
 */
function extremesToTimeline(data) {
  if (!data || typeof data !== 'object') return null;
  var arr = Array.isArray(data.extremes) ? data.extremes : [];
  var timeline = [];
  for (var i = 0; i < arr.length; i++) {
    var e = arr[i];
    if (!e || typeof e !== 'object') continue;
    var dtSec = toNumber(e.dt);
    var h = toNumber(e.height);
    if (dtSec == null || !Number.isFinite(dtSec) || h == null || !Number.isFinite(h)) continue;
    var typRaw = e.type != null ? String(e.type).trim().toLowerCase() : '';
    var typOut = typRaw === 'high' || typRaw === 'h' ? 'HIGH' : typRaw === 'low' || typRaw === 'l' ? 'LOW' : '';
    if (!typOut) continue;
    var heightNum = Number(h.toFixed(4));
    timeline.push({
      time: Math.round(dtSec * 1000),
      height: heightNum,
      type: typOut,
      height_m: heightNum
    });
  }
  if (!timeline.length) return null;
  timeline.sort(function (a, b) {
    return (a.time || 0) - (b.time || 0);
  });
  return timeline;
}

async function readTideCacheStore() {
  return readJsonFile(CACHE_DOC_KEY, { version: 1, entries: {} });
}

async function writeTideCacheEntry(key, payload) {
  var doc = await readTideCacheStore();
  doc.entries = doc.entries || {};
  doc.entries[key] = {
    saved_at: new Date().toISOString(),
    data: payload
  };
  try {
    await writeJsonFile(CACHE_DOC_KEY, doc);
  } catch (_e) {
    /* read-only store */
  }
}

/**
 * @param {{ lat: number, lng: number, date: string, station_id?: string|null }} opts
 * @returns {Promise<{ ok: boolean, cached?: boolean, source?: string, timeline?: array, copyright?: string, error?: string }>}
 */
async function getTideData(opts) {
  var lat = toNumber(opts && opts.lat);
  var lon = toNumber(opts && opts.lng);
  var dateRaw = cleanString(opts && opts.date, 20);
  var stationId = opts && opts.station_id != null ? String(opts.station_id) : '';

  var out = { ok: false, error: 'invalid_params' };
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return out;
  }

  var dateStr = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
    ? dateRaw
    : new Date().toISOString().slice(0, 10);

  var key = cacheEntryKey(stationId || ('ll:' + lat.toFixed(4) + ',' + lon.toFixed(4)), dateStr);
  var nowMs = Date.now();

  try {
    var doc = await readTideCacheStore();
    var ent = doc.entries && doc.entries[key];
    if (ent && ent.data && ent.saved_at) {
      var savedMs = Date.parse(String(ent.saved_at));
      if (!Number.isNaN(savedMs) && nowMs - savedMs < CACHE_MS) {
        var d0 = ent.data;
        return Object.assign({ ok: true, cached: true }, d0);
      }
    }
  } catch (_r) { /* miss */ }

  var apiKey = (process.env.WORLDTIDES_API_KEY != null ? String(process.env.WORLDTIDES_API_KEY) : '').trim();
  if (!apiKey) {
    try {
      console.warn('NAVIDUR_TIDE_FAILED');
    } catch (_w) { /* ignore */ }
    out.error = 'no_api_key';
    return out;
  }

  var url = `https://www.worldtides.info/api/v2?extremes&lat=${lat}&lon=${lon}&key=${apiKey}`;

  try {
    try {
      if (typeof console !== 'undefined' && console && typeof console.debug === 'function') {
        console.debug('NAVIDUR_TIDE_REQUEST', {
          lat: lat,
          lon: lon,
          key_present: !!(process.env.WORLDTIDES_API_KEY && String(process.env.WORLDTIDES_API_KEY).trim())
        });
      }
    } catch (_dbg0) { /* ignore */ }

    var res = await fetch(url, { method: 'GET' });
    var text = await res.text();
    var data;
    try {
      data = JSON.parse(text);
    } catch (_parse) {
      try {
        console.warn('NAVIDUR_TIDE_FAILED');
      } catch (_w2) { /* ignore */ }
      out.error = 'invalid_json';
      return out;
    }

    try {
      if (typeof console !== 'undefined' && console && typeof console.debug === 'function') {
        console.debug('NAVIDUR_TIDE_RESPONSE', data);
      }
    } catch (_dbg1) { /* ignore */ }

    if (!data || typeof data !== 'object') {
      try {
        console.warn('NAVIDUR_TIDE_FAILED');
      } catch (_w3) { /* ignore */ }
      out.error = 'empty_response';
      return out;
    }

    if (Number(data.status) !== 200) {
      try {
        console.warn('NAVIDUR_TIDE_FAILED');
      } catch (_w4) { /* ignore */ }
      out.error = cleanString(data.error, 200) || 'worldtides_http';
      return out;
    }

    var timeline = extremesToTimeline(data);
    if (!timeline) {
      try {
        console.warn('NAVIDUR_TIDE_FAILED');
      } catch (_w5) { /* ignore */ }
      out.error = 'empty_extremes';
      return out;
    }

    var normalized = {
      source: 'worldtides',
      timeline: timeline,
      copyright: cleanString(data.copyright, 4000) || ''
    };

    await writeTideCacheEntry(key, normalized);

    return Object.assign({ ok: true, cached: false }, normalized);
  } catch (e) {
    try {
      console.warn('NAVIDUR_TIDE_FAILED');
    } catch (_w6) { /* ignore */ }
    out.error = cleanString(e && e.message ? e.message : String(e), 200) || 'fetch_failed';
    return out;
  }
}

module.exports = {
  getTideData: getTideData,
  cacheEntryKey: cacheEntryKey
};
