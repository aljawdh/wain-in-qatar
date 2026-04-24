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

  function buildLiveInputsFromLastDto(dto) {
    if (!dto) return null;
    var e = dto.environment || {};
    var t = dto.tide || {};
    if (
      e.temp_c == null &&
      e.wind_speed_kmh == null &&
      e.wave_height_m == null &&
      t.current_speed_ms == null
    ) {
      return null;
    }
    return {
      temp_c: e.temp_c,
      wind_speed_kmh: e.wind_speed_kmh,
      wind_direction_deg: e.wind_direction_deg,
      wave_height_m: e.wave_height_m,
      current_speed_ms: t.current_speed_ms
    };
  }

  function liveCacheKeyForStation(station) {
    var sid = station && station.id != null && String(station.id).trim() !== '' ? String(station.id).trim() : null;
    return sid ? 'navidur_last_live_inputs:' + sid : null;
  }

  async function getStationAnalysis(station, options) {
    if (!station || typeof station !== 'object') throw new Error('station_required');
    var opts = options || {};
    var cacheKey = !opts.live_inputs ? liveCacheKeyForStation(station) : null;
    var body = {
      station: station,
      station_id: station.id || null,
      datetime: opts.datetime || new Date().toISOString(),
      overrides: opts.overrides || null,
      live_inputs: opts.live_inputs || null
    };
    if (opts.field_validation != null && typeof opts.field_validation === 'object') {
      body.field_validation = opts.field_validation;
    }
    var attemptFetch = function (b) {
      return fetchSharedAnalysis(b);
    };
    try {
      var dto = await attemptFetch(body);
      if (cacheKey && typeof localStorage !== 'undefined') {
        var li = buildLiveInputsFromLastDto(dto);
        if (li) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify(li));
          } catch (_se) { /* quota / private mode */ }
        }
      }
      return dto;
    } catch (err) {
      if (!cacheKey || typeof localStorage === 'undefined') throw err;
      var raw;
      try {
        raw = localStorage.getItem(cacheKey);
      } catch (_ge) {
        throw err;
      }
      if (!raw) throw err;
      var stored;
      try {
        stored = JSON.parse(raw);
      } catch (_pe) {
        throw err;
      }
      if (!stored || typeof stored !== 'object') throw err;
      return await attemptFetch(
        Object.assign({}, body, { live_inputs: Object.assign({}, stored, body.live_inputs || {}) })
      );
    }
  }

  async function getPreviewAnalysis(point, options) {
    if (!point || typeof point !== 'object') throw new Error('point_required');
    var lat = toNumber(point.lat);
    var lon = toNumber(point.lon != null ? point.lon : point.lng);
    if (lat == null || lon == null) throw new Error('station_coords_missing');
    var opts = options || {};
    var previewBody = {
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
      live_inputs: opts.live_inputs || null
    };
    if (opts.field_validation != null && typeof opts.field_validation === 'object') {
      previewBody.field_validation = opts.field_validation;
    }
    return fetchSharedAnalysis(previewBody);
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
