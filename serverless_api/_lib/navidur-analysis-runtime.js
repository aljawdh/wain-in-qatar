'use strict';

const { readJsonFile, writeJsonFile } = require('./data-store');
const { cleanString, toNumber } = require('./security');
const stormglass = require('./stormglass-tide-provider');

/** Shown when sky/condition cannot be derived (UI only; analysis still uses numeric fallbacks). */
var WEATHER_UNAVAILABLE_AR = 'الحالة الجوية غير متاحة حالياً';

/** Mild defaults (non-null) when both API and cache miss — analysis still runs. Tide is never fabricated. */
var DEFAULT_LIVE = {
  temp_c: 28,
  wind_speed_kmh: 12,
  wind_direction_deg: 200,
  wave_height_m: 0.6,
  current_speed_ms: 0.5
};

/** ~2 cm MSL change across the prev→next window → treat as flat (خامل). */
var TIDE_FLAT_DELTA_M = 0.02;

function findMarineHourlyIndexForInstant(timeStrings, instantMs) {
  if (!Array.isArray(timeStrings) || !timeStrings.length) return -1;
  var best = -1;
  for (var i = 0; i < timeStrings.length; i += 1) {
    var ts = Date.parse(timeStrings[i]);
    if (Number.isNaN(ts)) continue;
    if (ts <= instantMs) best = i;
    else break;
  }
  if (best >= 0) return best;
  return 0;
}

function buildOperationalTideFromHourly(timeStrings, mslValues, instantMs) {
  var debug = {
    has_hourly: Array.isArray(mslValues) && mslValues.length > 0,
    values_sample: [],
    computed_state: '',
    trend: '',
    index: -1
  };
  var emptyTide = { state: null, height_m: null, trend: null };
  if (!Array.isArray(mslValues) || !mslValues.length) {
    return { tide: emptyTide, tide_debug: debug };
  }
  if (!Array.isArray(timeStrings) || timeStrings.length !== mslValues.length) {
    return { tide: emptyTide, tide_debug: debug };
  }

  var idx = findMarineHourlyIndexForInstant(timeStrings, instantMs);
  var prev = idx > 0 ? toNumber(mslValues[idx - 1]) : null;
  var cur = toNumber(mslValues[idx]);
  var next = idx < mslValues.length - 1 ? toNumber(mslValues[idx + 1]) : null;

  if (cur == null) return { tide: emptyTide, tide_debug: debug };

  var delta = prev != null && next != null
    ? next - prev
    : prev != null
      ? cur - prev
      : next != null
        ? next - cur
        : null;

  if (delta == null) return { tide: emptyTide, tide_debug: debug };

  var state, trend;

  if (!Number.isFinite(delta) || Math.abs(delta) < TIDE_FLAT_DELTA_M) {
    state = 'خامل';
    trend = 'stable';
  } else if (delta > 0) {
    state = 'سقي';
    trend = 'rising';
  } else {
    state = 'ثبر';
    trend = 'falling';
  }

  return {
    tide: {
      state,
      height_m: cur,
      trend,
      previous: prev,
      current: cur,
      next
    },
    tide_debug: debug
  };
}

async function attachWorldTidesSeries(out, station, asOfDate) {
  var la = toNumber(station && station.lat);
  var lo = toNumber(station && station.lon);

  if (la == null || lo == null) {
    out.tide_series = null;
    return;
  }

  var tideDateStr = (asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate)))
    ? String(asOfDate)
    : new Date().toISOString().slice(0, 10);

  var tideData = await stormglass.getTideData({
    lat: la,
    lng: lo,
    date: tideDateStr,
    station_id: station && station.id ? String(station.id) : ''
  });

  out.tide_series = tideData && tideData.ok
    ? {
      source: tideData.source,
      timeline: tideData.timeline,
      extremes: tideData.extremes || []
    }
    : null;
}

async function fetchWeatherAndMarineInputs(station, body) {

  var la = toNumber(station && station.lat);
  var lo = toNumber(station && station.lon);

  var tideSeriesExplicit = null;

  if (la != null && lo != null) {

    var tideData0 = await stormglass.getTideData({
      lat: la,
      lng: lo,
      date: new Date().toISOString().slice(0, 10),
      station_id: station && station.id ? String(station.id) : ''
    });

    tideSeriesExplicit = tideData0 && tideData0.ok
      ? {
        source: tideData0.source,
        timeline: tideData0.timeline,
        extremes: tideData0.extremes || []
      }
      : null;
  }

  return {
    live_inputs: {},
    weather_meta: {},
    tide_series: tideSeriesExplicit
  };
}

module.exports = {
  attachWorldTidesSeries,
  fetchWeatherAndMarineInputs
};