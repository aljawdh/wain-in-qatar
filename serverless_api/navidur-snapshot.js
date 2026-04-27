'use strict';

const {
  appendStationSnapshot,
  appendDurValidationLog,
  createId,
  nowIso
} = require('./_lib/data-store');
const { isAllowedOrigin, parseBody, setNoCache, cleanString, rateLimit } = require('./_lib/security');
const { analyzeLiveStation } = require('../shared/navidur-analysis-engine');
const {
  normalizeRequestedStation,
  deriveWaterTraits,
  fetchWeatherAndMarineInputs,
  loadReferenceData
} = require('./_lib/navidur-analysis-runtime');
const {
  buildSnapshotRecord,
  buildValidationLogRecord
} = require('../shared/navidur-snapshot-validation');

async function captureSnapshotInternal(body, options) {
  var runtimeOptions = options || {};
  var referenceData = runtimeOptions.referenceData || await loadReferenceData();
  var station = normalizeRequestedStation(body, referenceData.stations);

  if (station.lat == null || station.lon == null) {
    throw new Error('station_coordinates_required');
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
    field_validation: fieldValidation
  });

  var timestamp = nowIso();
  var snapshot = buildSnapshotRecord({
    snapshot_id: createId('snapshot'),
    timestamp: timestamp,
    station: station,
    dto: dto
  });
  var validation = buildValidationLogRecord({
    validation_id: createId('validation'),
    timestamp: timestamp,
    station: station,
    dto: dto,
    field_validation: fieldValidation,
    notes: cleanString(body.notes, 800) || null
  });

  await appendStationSnapshot(snapshot);
  await appendDurValidationLog(validation);

  return {
    snapshot: snapshot,
    validation: validation,
    dto: dto
  };
}

async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!rateLimit(req, 'capture_snapshot', 60, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  try {
    var body = parseBody(req);
    var result = await captureSnapshotInternal(body);
    return res.status(200).json({
      ok: true,
      snapshot: result.snapshot,
      validation: result.validation,
      dto: result.dto
    });
  } catch (error) {
    return res.status(500).json({
      error: 'snapshot_capture_failed',
      detail: String(error && error.message ? error.message : error)
    });
  }
}

module.exports = handler;
module.exports.captureSnapshotInternal = captureSnapshotInternal;
