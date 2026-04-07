'use strict';

const { fetchJson } = require('../http');

function buildUrl(lat, lon) {
  const endpoint = process.env.NOAA_ENDPOINT;
  const token = process.env.NOAA_API_TOKEN || '';
  if (!endpoint) return null;

  const query = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    fields: 'current_speed,current_direction,wave_height,wave_direction,wind_speed,wind_direction'
  });

  if (token) query.set('token', token);
  return endpoint + '?' + query.toString();
}

async function fetchNOAA(lat, lon) {
  const url = buildUrl(lat, lon);
  if (!url) {
    return { ok: false, reason: 'NOAA_NOT_CONFIGURED' };
  }

  const json = await fetchJson(url, {
    timeoutMs: 9000,
    retries: 2,
    headers: { Accept: 'application/json' }
  });

  return {
    ok: true,
    source: 'NOAA',
    timestamp: json && json.timestamp,
    current: {
      speed: { value: json && json.current_speed, unit: json && json.current_speed_unit || 'm/s' },
      direction: { value: json && json.current_direction, unit: json && json.current_direction_unit || 'deg' }
    },
    wave: {
      height: { value: json && json.wave_height, unit: json && json.wave_height_unit || 'm' },
      direction: { value: json && json.wave_direction, unit: json && json.wave_direction_unit || 'deg' }
    },
    wind: {
      speed: { value: json && json.wind_speed, unit: json && json.wind_speed_unit || 'm/s' },
      direction: { value: json && json.wind_direction, unit: json && json.wind_direction_unit || 'deg' }
    },
    raw: json
  };
}

module.exports = {
  fetchNOAA
};
