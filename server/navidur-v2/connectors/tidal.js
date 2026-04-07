'use strict';

const { fetchJson } = require('../http');

function buildUrl(lat, lon) {
  const endpoint = process.env.TIDAL_API_ENDPOINT;
  const token = process.env.TIDAL_API_TOKEN || '';
  if (!endpoint) return null;
  const query = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (token) query.set('token', token);
  return endpoint + '?' + query.toString();
}

async function fetchTidal(lat, lon) {
  const url = buildUrl(lat, lon);
  if (!url) {
    return { ok: false, reason: 'TIDAL_API_NOT_CONFIGURED' };
  }

  const json = await fetchJson(url, {
    timeoutMs: 9000,
    retries: 2,
    headers: { Accept: 'application/json' }
  });

  return {
    ok: true,
    source: 'ExternalTidalAPI',
    timestamp: json && json.timestamp,
    tidalScore: { value: json && json.tidal_score, unit: json && json.tidal_score_unit || 'normalized' },
    raw: json
  };
}

module.exports = {
  fetchTidal
};
