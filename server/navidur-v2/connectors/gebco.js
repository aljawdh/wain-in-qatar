'use strict';

const { fetchJson } = require('../http');

function buildUrl(lat, lon) {
  const endpoint = process.env.GEBCO_ENDPOINT;
  if (!endpoint) return null;
  const query = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  return endpoint + '?' + query.toString();
}

async function fetchGEBCO(lat, lon) {
  const url = buildUrl(lat, lon);
  if (!url) {
    return { ok: false, reason: 'GEBCO_NOT_CONFIGURED' };
  }

  const json = await fetchJson(url, {
    timeoutMs: 9000,
    retries: 2,
    headers: { Accept: 'application/json' }
  });

  return {
    ok: true,
    source: 'GEBCO',
    timestamp: json && json.timestamp,
    topography: {
      depth: { value: json && json.depth, unit: json && json.depth_unit || 'm' },
      slope: { value: json && json.slope, unit: json && json.slope_unit || 'deg' },
      seabedStructure: json && json.seabed_structure ? json.seabed_structure : null
    },
    raw: json
  };
}

module.exports = {
  fetchGEBCO
};
