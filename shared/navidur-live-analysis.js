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
    var url = '/api/fishing-engine?lat=' + encodeURIComponent(safeLat) + '&lon=' + encodeURIComponent(safeLon) + '&debug=true';
    var response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw new Error('live_analysis_http_' + response.status);
    return response.json();
  }

  async function getHotspotForStation(station) {
    if (!station || typeof station !== 'object') throw new Error('station_required');
    var lat = station.lat;
    var lon = station.lon != null ? station.lon : station.lng;
    return fetchHotspotByCoords(lat, lon);
  }

  async function getStationLiveSummary(station) {
    var hotspot = await getHotspotForStation(station);
    var best = hotspot && hotspot.best_spot ? hotspot.best_spot : {};
    var data = hotspot && hotspot.data ? hotspot.data : {};
    var confidence = getConfidenceMeta(best.score != null ? best.score : 0);
    return {
      hotspot: hotspot,
      score: best.score != null ? best.score : null,
      zone: best.zone || '--',
      recommendation: best.recommendation || '--',
      confidence_label: confidence.label,
      confidence_class: confidence.cls,
      current: data.current != null ? data.current : null,
      temp: data.temp != null ? data.temp : null,
      wave: data.wave != null ? data.wave : null
    };
  }

  root.NavidurLiveAnalysis = {
    getHotspotForStation: getHotspotForStation,
    getStationLiveSummary: getStationLiveSummary
  };
})(typeof window !== 'undefined' ? window : globalThis);
