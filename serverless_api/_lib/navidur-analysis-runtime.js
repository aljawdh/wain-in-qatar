'use strict';

const { readJsonFile, writeJsonFile } = require('./data-store');
const { cleanString, toNumber } = require('./security');
const stormglass = require('./stormglass-tide-provider');

/** Shown when sky/condition cannot be derived */
var WEATHER_UNAVAILABLE_AR = 'الحالة الجوية غير متاحة حالياً';

var DEFAULT_LIVE = {
  temp_c: 28,
  wind_speed_kmh: 12,
  wind_direction_deg: 200,
  wave_height_m: 0.6,
  current_speed_ms: 0.5
};

var TIDE_FLAT_DELTA_M = 0.02;

/* =========================
   FIX 1: هنا التعديل
========================= */
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
    station_id: station && station.id != null ? String(station.id) : ''
  });

  out.tide_series = tideData && tideData.ok
    ? {
        source: tideData.source,
        timeline: tideData.timeline,
        extremes: Array.isArray(tideData.extremes) ? tideData.extremes : []
      }
    : null;
}

/* =========================
   FIX 2: هنا التعديل
========================= */
async function fetchWeatherAndMarineInputs(station, body) {
  var liveInputs = body && body.live_inputs && typeof body.live_inputs === 'object'
    ? Object.assign({}, body.live_inputs)
    : {};

  var hasExplicitValues =
    liveInputs.temp_c != null ||
    liveInputs.wind_speed_kmh != null ||
    liveInputs.wave_height_m != null ||
    liveInputs.current_speed_ms != null;

  if (hasExplicitValues) {
    var tideSeriesExplicit = null;

    var la0 = toNumber(station && station.lat);
    var lo0 = toNumber(station && station.lon);

    if (la0 != null && lo0 != null) {
      var tideDate0 = new Date().toISOString().slice(0, 10);

      var tideData0 = await stormglass.getTideData({
        lat: la0,
        lng: lo0,
        date: tideDate0,
        station_id: station && station.id != null ? String(station.id) : ''
      });

      tideSeriesExplicit = tideData0 && tideData0.ok
        ? {
            source: tideData0.source,
            timeline: tideData0.timeline,
            extremes: Array.isArray(tideData0.extremes) ? tideData0.extremes : []
          }
        : null;
    }

    return {
      live_inputs: liveInputs,
      weather_meta: { from_request_body: true },
      tide_series: tideSeriesExplicit
    };
  }

  return {
    live_inputs: Object.assign({}, DEFAULT_LIVE),
    weather_meta: { from_defaults: true },
    tide_series: null
  };
}

/* =========================
   EXPORT
========================= */
module.exports = {
  attachWorldTidesSeries,
  fetchWeatherAndMarineInputs
};