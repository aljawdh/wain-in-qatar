;(function (root) {
  'use strict';

  function toNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function getConfidenceMeta(score) {
    var n = Number(score || 0);
    if (n >= 75) return { label: 'High', cls: 'high' };
    if (n >= 50) return { label: 'Medium', cls: 'medium' };
    return { label: 'Low', cls: 'low' };
  }

  async function fetchHotspotByCoords(lat, lon) {
    var safeLat = toNumber(lat);
    var safeLon = toNumber(lon);
    if (safeLat == null || safeLon == null) throw new Error('station_coords_missing');
    var url = '/api?route=fishing-engine&lat=' + encodeURIComponent(safeLat) + '&lon=' + encodeURIComponent(safeLon) + '&debug=true';
    var response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw new Error('live_analysis_http_' + response.status);
    return response.json();
  }

  async function fetchSharedAnalysis(payload) {
    var response = await fetch('/api?route=analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    if (!response.ok) throw new Error('shared_analysis_http_' + response.status);
    return response.json();
  }

  async function getHotspotForStation(station) {
    if (!station || typeof station !== 'object') throw new Error('station_required');
    var lat = station.lat;
    var lon = station.lon != null ? station.lon : station.lng;
    return fetchHotspotByCoords(lat, lon);
  }

  async function getStationAnalysis(station, options) {
    if (!station || typeof station !== 'object') throw new Error('station_required');
    var opts = options || {};
    return fetchSharedAnalysis({
      station: station,
      station_id: station.id || null,
      datetime: opts.datetime || new Date().toISOString(),
      overrides: opts.overrides || null,
      live_inputs: opts.live_inputs || null,
      field_validation: opts.field_validation || null
    });
  }

  async function getPreviewAnalysis(point, options) {
    if (!point || typeof point !== 'object') throw new Error('point_required');
    var lat = toNumber(point.lat);
    var lon = toNumber(point.lon != null ? point.lon : point.lng);
    if (lat == null || lon == null) throw new Error('station_coords_missing');
    var opts = options || {};
    return fetchSharedAnalysis({
      station: {
        id: null,
        name: point.name || '',
        lat: lat,
        lon: lon,
        country: point.country || '',
        region: point.region || ''
      },
      datetime: opts.datetime || new Date().toISOString(),
      overrides: opts.overrides || null,
      live_inputs: opts.live_inputs || null,
      field_validation: opts.field_validation || null
    });
  }

  async function getStationLiveSummary(station, options) {
    return getStationAnalysis(station, options);
  }

  root.NavidurLiveAnalysis = {
    getHotspotForStation: getHotspotForStation,
    getStationAnalysis: getStationAnalysis,
    getPreviewAnalysis: getPreviewAnalysis,
    getStationLiveSummary: getStationLiveSummary,
    getConfidenceMeta: getConfidenceMeta
  };
})(typeof window !== 'undefined' ? window : globalThis);
