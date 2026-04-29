'use strict';

const { isAllowedOrigin, parseBody, setNoCache, cleanString } = require('./_lib/security');
const { analyzeLiveStation } = require('../shared/navidur-analysis-engine');
const {
  normalizeRequestedStation,
  deriveWaterTraits,
  fetchWeatherAndMarineInputs,
  loadReferenceData
} = require('./_lib/navidur-analysis-runtime');

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    var body = req.method === 'POST' ? parseBody(req) : (req.query || {});
    var referenceData = await loadReferenceData();
    var station = normalizeRequestedStation(body, referenceData.stations);

    if (station.lat == null || station.lon == null) {
      return res.status(400).json({ error: 'station_coordinates_required' });
    }

    var weatherPack = await fetchWeatherAndMarineInputs(station, body);
    var liveInputs = weatherPack.live_inputs;
    var weatherMeta = weatherPack.weather_meta || {};
    var fieldValidation = body && body.field_validation && typeof body.field_validation === 'object'
      ? Object.assign({}, body.field_validation)
      : null;

    if (fieldValidation && !Array.isArray(fieldValidation.observed_traits)) {
      fieldValidation.observed_traits = deriveWaterTraits({
        temp_c: liveInputs.temp_c,
        wind_speed_kmh: liveInputs.wind_speed_kmh,
        wave_height_m: liveInputs.wave_height_m,
        current_speed_ms: liveInputs.current_speed_ms
      });
    }

    var dto = analyzeLiveStation({
      station: station,
      datetime: cleanString(body.datetime, 60) || new Date().toISOString(),
      reference_data: referenceData,
      overrides: body && body.overrides && typeof body.overrides === 'object' ? body.overrides : null,
      live_inputs: liveInputs,
      weather_meta: weatherMeta,
      tide_debug: weatherPack.tide_debug && typeof weatherPack.tide_debug === 'object' ? weatherPack.tide_debug : null,
      debug_log: !!(body && (body.debug_log === true || body.debug === true || body.debug_analysis === true)),
      field_validation: fieldValidation
    });

    return res.status(200).json(dto);
  } catch (error) {
    return res.status(500).json({
      error: 'navidur_analysis_failed',
      detail: String(error && error.message ? error.message : error)
    });
  }
};
