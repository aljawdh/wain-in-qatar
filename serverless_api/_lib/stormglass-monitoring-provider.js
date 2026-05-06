'use strict';

const BASE_URL = 'https://api.stormglass.io/v2';

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00Z';
  return s;
}

function getApiKey() {
  return String(process.env.STORMGLASS_API_KEY || '').trim();
}

function normalizePointSeries(hours) {
  if (!Array.isArray(hours)) return [];
  return hours.map(function (row) {
    const src = row && typeof row === 'object' ? row : {};
    const windSpeed = src.windSpeed || {};
    const windDirection = src.windDirection || {};
    const airTemperature = src.airTemperature || {};
    const waveHeight = src.waveHeight || {};
    const swellHeight = src.swellHeight || {};
    const swellDirection = src.swellDirection || {};
    const currentSpeed = src.currentSpeed || {};
    const currentDirection = src.currentDirection || {};
    const waterTemperature = src.waterTemperature || {};
    const seaLevel = src.seaLevel || {};
    return {
      time: src.time || null,
      windSpeed: num(windSpeed.sg != null ? windSpeed.sg : windSpeed.noaa),
      windDirection: num(windDirection.sg != null ? windDirection.sg : windDirection.noaa),
      airTemperature: num(airTemperature.sg != null ? airTemperature.sg : airTemperature.noaa),
      waveHeight: num(waveHeight.sg != null ? waveHeight.sg : waveHeight.noaa),
      swellHeight: num(swellHeight.sg != null ? swellHeight.sg : swellHeight.noaa),
      swellDirection: num(swellDirection.sg != null ? swellDirection.sg : swellDirection.noaa),
      currentSpeed: num(currentSpeed.sg != null ? currentSpeed.sg : currentSpeed.noaa),
      currentDirection: num(currentDirection.sg != null ? currentDirection.sg : currentDirection.noaa),
      waterTemperature: num(waterTemperature.sg != null ? waterTemperature.sg : waterTemperature.noaa),
      seaLevel: num(seaLevel.sg != null ? seaLevel.sg : seaLevel.noaa)
    };
  });
}

async function requestStormglass(path, lat, lng, start, end, params) {
  const key = getApiKey();
  if (!key) {
    return { ok: false, error: 'stormglass_api_key_missing' };
  }
  const url = new URL(BASE_URL + path);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  if (start) url.searchParams.set('start', iso(start));
  if (end) url.searchParams.set('end', iso(end));
  if (params) url.searchParams.set('params', params);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: key }
    });
    const text = await res.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_e) {
      payload = {};
    }
    if (!res.ok) {
      return { ok: false, error: 'stormglass_http_' + res.status, status: res.status };
    }
    return { ok: true, data: payload };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

async function getStormglassWeatherPoint(lat, lng, start, end) {
  const req = await requestStormglass('/weather/point', lat, lng, start, end, 'windSpeed,windDirection,airTemperature');
  if (!req.ok) return req;
  return { ok: true, hours: normalizePointSeries(req.data && req.data.hours) };
}

async function getStormglassMarinePoint(lat, lng, start, end) {
  const req = await requestStormglass('/weather/point', lat, lng, start, end, 'waveHeight,swellHeight,swellDirection,currentSpeed,currentDirection,waterTemperature');
  if (!req.ok) return req;
  return { ok: true, hours: normalizePointSeries(req.data && req.data.hours) };
}

async function getStormglassTideExtremes(lat, lng, start, end) {
  const req = await requestStormglass('/tide/extremes/point', lat, lng, start, end);
  if (!req.ok) return req;
  const data = Array.isArray(req.data && req.data.data) ? req.data.data : [];
  return {
    ok: true,
    extremes: data.map(function (row) {
      return {
        time: row && row.time ? String(row.time) : null,
        height: num(row && row.height),
        type: row && row.type ? String(row.type) : null
      };
    })
  };
}

async function getStormglassTideSeaLevel(lat, lng, start, end) {
  const req = await requestStormglass('/tide/sea-level/point', lat, lng, start, end);
  if (!req.ok) return req;
  const data = Array.isArray(req.data && req.data.data) ? req.data.data : [];
  return {
    ok: true,
    seaLevel: data.map(function (row) {
      return {
        time: row && row.time ? String(row.time) : null,
        seaLevel: num(row && row.sg)
      };
    })
  };
}

module.exports = {
  getStormglassWeatherPoint,
  getStormglassMarinePoint,
  getStormglassTideExtremes,
  getStormglassTideSeaLevel
};
