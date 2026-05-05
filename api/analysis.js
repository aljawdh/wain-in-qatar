'use strict';

const {
  fetchWeatherAndMarineInputs,
  loadReferenceData
} = require('../serverless_api/navidur-analysis-runtime');

module.exports = async function handler(req, res) {
  try {
    console.log('NAVIDUR_RUNTIME_CHECK', {
      loadReferenceData: typeof loadReferenceData,
      fetchWeather: typeof fetchWeatherAndMarineInputs
    });
  } catch (_e) { /* ignore */ }

  if (typeof loadReferenceData !== 'function') {
    throw new Error('CRITICAL: loadReferenceData missing');
  }

  if (typeof fetchWeatherAndMarineInputs !== 'function') {
    throw new Error('CRITICAL: fetchWeatherAndMarineInputs missing');
  }

  try {
    var q = req && req.query ? req.query : {};
    var lat = q.lat != null ? Number(q.lat) : null;
    var lon = q.lon != null ? Number(q.lon) : (q.lng != null ? Number(q.lng) : null);
    if (lat == null || Number.isNaN(lat) || lon == null || Number.isNaN(lon)) {
      return res.status(400).json({ error: 'lat_lon_required' });
    }

    var refs = await loadReferenceData();
    var station = {
      id: '',
      name: 'api-analysis',
      lat: lat,
      lon: lon
    };
    if (refs && Array.isArray(refs.stations) && refs.stations.length) {
      var nearest = refs.stations.find(function (s) {
        return s && Number(s.lat) === lat && Number(s.lon) === lon;
      });
      if (nearest) {
        station.id = nearest.id != null ? String(nearest.id) : '';
        station.name = nearest.name || station.name;
      }
    }

    var weatherPack = await fetchWeatherAndMarineInputs(station, q);
    return res.status(200).json({
      live_inputs: weatherPack && weatherPack.live_inputs ? weatherPack.live_inputs : null,
      tide_series: weatherPack && weatherPack.tide_series ? weatherPack.tide_series : null,
      weather_meta: weatherPack && weatherPack.weather_meta ? weatherPack.weather_meta : {}
    });
  } catch (error) {
    return res.status(500).json({
      error: 'analysis_runtime_failed',
      detail: String(error && error.message ? error.message : error)
    });
  }
};
