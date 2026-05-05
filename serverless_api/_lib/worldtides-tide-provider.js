'use strict';

/**
 * Stormglass tide provider (extremes endpoint).
 * Normalized for NAVIDUR tide_series.
 */

const { readJsonFile, writeJsonFile } = require('./data-store');
const { cleanString, toNumber } = require('./security');

var CACHE_MS = 6 * 60 * 60 * 1000;
var CACHE_DOC_KEY = 'stormglass_tide_cache_v1';

function cacheEntryKey(stationId, date) {
  var sid = cleanString(stationId, 120);
  if (!sid) sid = 'no_station';
  var d = cleanString(date, 20) || 'unknown';
  return sid + '|' + d;
}

function normalizeStormglassType(value) {
  var v = String(value || '').toLowerCase();
  if (v === 'high' || v === 'high_tide') return 'مد';
  if (v === 'low' || v === 'low_tide') return 'جزر';
  return v.indexOf('high') >= 0 ? 'مد' : 'جزر';
}

/**
 * Maps Stormglass tide extremes -> NAVIDUR timeline.
 */
function mapStormglassExtremesToTimeline(extremesArr) {
  if (!Array.isArray(extremesArr) || !extremesArr.length) return null;

  var timeline = extremesArr.map(function (e) {
    var rawTime = e && (e.time || e.date || e.datetime);
    var ts = rawTime != null ? Date.parse(String(rawTime)) : NaN;

    var h = toNumber(e && (e.height != null ? e.height : e.height_m));

    return {
      ts: Number.isNaN(ts) ? null : ts,
      time: rawTime ? String(rawTime) : null,
      height_m: h,
      height: h,
      type: normalizeStormglassType(e && e.type)
    };
  }).filter(function (pt) {
    return pt.ts != null && Number.isFinite(Number(pt.ts));
  });

  if (!timeline.length) return null;

  timeline.sort(function (a, b) {
    return Number(a.ts) - Number(b.ts);
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
 * @returns {Promise<{ ok: boolean, cached?: boolean, source?: string, timeline?: array, extremes?: array, error?: string }>}
 */
async function getTideData(opts) {
  var lat = toNumber(opts && opts.lat);
  var lon = toNumber(opts && opts.lng);
  var dateRaw = cleanString(opts && opts.date, 20);
  var stationId = opts && opts.station_id != null ? String(opts.station_id) : '';

  var out = { ok: false, error: 'invalid_params' };

  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    console.warn('NAVIDUR_TIDE_FAILED', {
      reason: 'invalid_params',
      lat: lat,
      lon: lon
    });
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
        console.debug('NAVIDUR_TIDE_CACHE_HIT', {
          key: key,
          source: ent.data.source,
          timeline_count: ent.data.timeline && ent.data.timeline.length,
          extremes_count: ent.data.extremes && ent.data.extremes.length
        });

        return Object.assign({ ok: true, cached: true }, ent.data);
      }
    }
  } catch (_r) {
    /* cache miss */
  }

  var apiKey = (process.env.STORMGLASS_API_KEY != null ? String(process.env.STORMGLASS_API_KEY) : '').trim();

  if (!apiKey) {
    console.warn('NAVIDUR_TIDE_FAILED', {
      reason: 'no_api_key',
      key_present: false
    });

    out.error = 'no_api_key';
    return out;
  }

  var url = 'https://api.stormglass.io/v2/tide/extremes'
    + '?lat=' + encodeURIComponent(String(lat))
    + '&lng=' + encodeURIComponent(String(lon));

  try {
    console.debug('NAVIDUR_TIDE_REQUEST', {
      source: 'stormglass',
      url: url,
      lat: lat,
      lon: lon,
      key_present: !!apiKey
    });

    var res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: apiKey
      }
    });

    var text = await res.text();
    var data;

    try {
      data = JSON.parse(text);
    } catch (_parse) {
      console.warn('NAVIDUR_TIDE_FAILED', {
        reason: 'invalid_json',
        status: res.status,
        body_sample: cleanString(text, 500)
      });

      out.error = 'invalid_json';
      return out;
    }

    console.debug('NAVIDUR_TIDE_RESPONSE', {
      status: res.status,
      ok: res.ok,
      has_data_array: Array.isArray(data && data.data),
      data_count: Array.isArray(data && data.data) ? data.data.length : 0,
      message: data && data.message ? data.message : null,
      errors: data && data.errors ? data.errors : null
    });

    if (!res.ok) {
      console.warn('NAVIDUR_TIDE_FAILED', {
        reason: 'http_error',
        status: res.status,
        message: cleanString(data && data.message, 300),
        errors: data && data.errors ? data.errors : null
      });

      out.error = cleanString(data && data.message, 200) || ('stormglass_http_' + String(res.status));
      return out;
    }

    var rawExtremes = Array.isArray(data && data.data) ? data.data : [];
    var timeline = mapStormglassExtremesToTimeline(rawExtremes);

    if (!timeline) {
      console.warn('NAVIDUR_TIDE_FAILED', {
        reason: 'empty_extremes',
        data_count: rawExtremes.length,
        sample: rawExtremes.slice(0, 3)
      });

      out.error = 'empty_extremes';
      return out;
    }

    var normalized = {
      source: 'stormglass',
      timeline: timeline,
      extremes: rawExtremes
    };

    console.debug('NAVIDUR_TIDE_SERIES_READY', {
      source: normalized.source,
      timeline_count: normalized.timeline.length,
      extremes_count: normalized.extremes.length
    });

    await writeTideCacheEntry(key, normalized);

    return Object.assign({ ok: true, cached: false }, normalized);
  } catch (e) {
    console.warn('NAVIDUR_TIDE_FAILED', {
      reason: 'fetch_failed',
      error: cleanString(e && e.message ? e.message : String(e), 300)
    });

    out.error = cleanString(e && e.message ? e.message : String(e), 200) || 'fetch_failed';
    return out;
  }
}

module.exports = {
  getTideData: getTideData,
  cacheEntryKey: cacheEntryKey
};