'use strict';

const { fetchJson } = require('../http');

function buildUrl(lat, lon) {
  const endpoint = process.env.CMEMS_ENDPOINT;
  const key = process.env.CMEMS_API_KEY;
  if (!endpoint || !key) return null;

  const query = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    fields: 'temperature,salinity,dissolved_oxygen,chlorophyll',
    api_key: key
  });
  return endpoint + '?' + query.toString();
}

async function fetchCopernicus(lat, lon) {
  const url = buildUrl(lat, lon);
  if (!url) {
    return { ok: false, reason: 'CMEMS_NOT_CONFIGURED' };
  }

  const json = await fetchJson(url, {
    timeoutMs: 9000,
    retries: 2,
    headers: { Accept: 'application/json' }
  });

  return {
    ok: true,
    source: 'Copernicus',
    timestamp: json && json.timestamp,
    environment: {
      temperature: { value: json && json.temperature, unit: json && json.temperature_unit || 'celsius' },
      salinity: { value: json && json.salinity, unit: json && json.salinity_unit || 'psu' },
      oxygen: { value: json && json.dissolved_oxygen, unit: json && json.dissolved_oxygen_unit || 'mg/l' },
      chlorophyll: { value: json && json.chlorophyll, unit: json && json.chlorophyll_unit || 'mg/m3' }
    },
    raw: json
  };
}

module.exports = {
  fetchCopernicus
};
