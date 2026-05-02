'use strict';

const { isAllowedOrigin, parseBody, setNoCache, cleanString } = require('./_lib/security');
const { analyzeLiveStation } = require('../shared/navidur-analysis-engine');
const {
  normalizeRequestedStation,
  deriveWaterTraits,
  fetchWeatherAndMarineInputs,
  loadReferenceData
} = require('./_lib/navidur-analysis-runtime');
const fishingEngineHandler = require('./fishing-engine');

function resolveAnalysisRequestDate(body) {
  var b = body && typeof body === 'object' ? body : {};
  var fromAnalysisDate = cleanString(b.analysis_date, 20);
  var fromAsOf = cleanString(b.as_of_iso, 80);
  var fromDateTime = cleanString(b.datetime, 80);
  var dateOnly = '';
  if (fromAnalysisDate && /^\d{4}-\d{2}-\d{2}$/.test(fromAnalysisDate)) {
    dateOnly = fromAnalysisDate;
  } else if (fromAsOf && /^\d{4}-\d{2}-\d{2}/.test(fromAsOf)) {
    dateOnly = fromAsOf.slice(0, 10);
  } else if (fromDateTime && /^\d{4}-\d{2}-\d{2}/.test(fromDateTime)) {
    dateOnly = fromDateTime.slice(0, 10);
  } else {
    dateOnly = new Date().toISOString().slice(0, 10);
  }
  var dt = fromDateTime && /^\d{4}-\d{2}-\d{2}/.test(fromDateTime)
    ? fromDateTime
    : (dateOnly + 'T12:00:00Z');
  return {
    analysis_date: dateOnly,
    as_of_iso: fromAsOf && /^\d{4}-\d{2}-\d{2}/.test(fromAsOf) ? fromAsOf : dt,
    datetime: dt
  };
}

function buildDurSnapshotForEvaluatedPoints(dur) {
  if (!dur || typeof dur !== 'object') return null;
  return {
    period_id: dur.period_id != null ? dur.period_id : null,
    period_name: dur.period_name != null ? dur.period_name : null,
    day_in_period: dur.day_in_period != null ? dur.day_in_period : null,
    calibration_reference_station_id:
      dur.calibration_reference_station_id != null ? dur.calibration_reference_station_id : null
  };
}

function buildTideSnapshotForEvaluatedPoints(tide) {
  if (!tide || typeof tide !== 'object') return null;
  return {
    state: tide.state != null ? tide.state : null,
    current_speed_ms: tide.current_speed_ms != null ? tide.current_speed_ms : null
  };
}

/** Unified map point shape; score unchanged from computeHotspotForAnalysisContext. */
function normalizeEvaluatedPointsForUnifiedDto(rows, station, dto) {
  var list = Array.isArray(rows) ? rows : [];
  var refResolved = dto.reference_station_id != null ? dto.reference_station_id : station.reference_station_id;
  var sid = station.id != null ? station.id : null;
  var durSnap = buildDurSnapshotForEvaluatedPoints(dto.dur);
  var tideSnap = buildTideSnapshotForEvaluatedPoints(dto.tide);
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (!p || typeof p !== 'object') continue;
    var lngVal = p.lng != null ? p.lng : p.lon;
    out.push({
      lat: p.lat,
      lng: lngVal,
      lon: lngVal,
      score: p.score,
      water_status: p.water_status != null ? p.water_status : 'unknown',
      source_station_id: p.source_station_id != null ? p.source_station_id : sid,
      reference_station_id: p.reference_station_id != null ? p.reference_station_id : refResolved,
      dur: durSnap,
      tide: tideSnap
    });
  }
  return out;
}

/** Same numeric environment the DTO already exposes (no re-run of analyzeLiveStation). */
function liveEnvironmentFromAnalysisDto(dto) {
  var env = dto && dto.environment ? dto.environment : {};
  var t = dto && dto.tide ? dto.tide : {};
  return {
    temp_c: env.temp_c,
    wind_speed_kmh: env.wind_speed_kmh,
    wave_height_m: env.wave_height_m,
    wind_direction_deg: env.wind_direction_deg,
    current_speed_ms: t.current_speed_ms
  };
}

function traitBundleFromAnalysisDto(dto) {
  var d = dto && dto.dur ? dto.dur : {};
  var f = dto && dto.fishing ? dto.fishing : {};
  return {
    unified_expected_traits: Array.isArray(d.unified_expected_traits) ? d.unified_expected_traits : [],
    fishing_confidence_score: f.confidence_score != null ? f.confidence_score : null
  };
}

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    var body = req.method === 'POST' ? parseBody(req) : (req.query || {});
    var resolvedDate = resolveAnalysisRequestDate(body);
    body.analysis_date = resolvedDate.analysis_date;
    body.as_of_iso = resolvedDate.as_of_iso;
    body.datetime = resolvedDate.datetime;
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
      datetime: resolvedDate.datetime,
      reference_data: referenceData,
      overrides: body && body.overrides && typeof body.overrides === 'object' ? body.overrides : null,
      live_inputs: liveInputs,
      weather_meta: weatherMeta,
      tide_debug: weatherPack.tide_debug && typeof weatherPack.tide_debug === 'object' ? weatherPack.tide_debug : null,
      debug_log: !!(body && (body.debug_log === true || body.debug === true || body.debug_analysis === true)),
      field_validation: fieldValidation
    });

    dto.confidence = dto.fishing && dto.fishing.confidence_score != null ? dto.fishing.confidence_score : null;
    dto.analysis_date = resolvedDate.analysis_date;
    dto.as_of_iso = resolvedDate.as_of_iso;

    var spatialErr = null;
    dto.evaluated_points = [];
    dto.hotspot = null;
    delete dto.analysis_error;

    try {
      if (typeof fishingEngineHandler.computeHotspotForAnalysisContext !== 'function') {
        spatialErr = 'computeHotspotForAnalysisContext_missing';
      } else {
        var liveEnvironment = liveEnvironmentFromAnalysisDto(dto);
        var traitBundle = traitBundleFromAnalysisDto(dto);
        var pack = await fishingEngineHandler.computeHotspotForAnalysisContext({
          station: station,
          liveEnvironment: liveEnvironment,
          tideState: dto.tide && dto.tide.state,
          currentDur: dto.dur,
          traitBundle: traitBundle
        });
        if (pack && Array.isArray(pack.evaluated_points) && pack.evaluated_points.length && pack.hotspot) {
          dto.evaluated_points = normalizeEvaluatedPointsForUnifiedDto(pack.evaluated_points, station, dto);
          dto.hotspot = pack.hotspot;
        } else {
          spatialErr = 'spatial_pack_invalid';
        }
      }
    } catch (e) {
      spatialErr = String(e && e.message ? e.message : e);
    }

    if (!dto.hotspot || !dto.evaluated_points.length) {
      dto.evaluated_points = [];
      dto.hotspot = null;
      dto.analysis_error = spatialErr || 'spatial_incomplete';
    } else {
      delete dto.analysis_error;
    }

    try {
      if (typeof console !== 'undefined' && console && typeof console.debug === 'function') {
        console.debug('NAVIDUR_ANALYSIS_DATE_FLOW', {
          selected_ui_date: cleanString(body.selected_ui_date, 20) || resolvedDate.analysis_date,
          request_date_sent: resolvedDate.analysis_date,
          server_analysis_date: resolvedDate.analysis_date,
          weather_fetch_date: dto && dto.environment ? (dto.environment.as_of || resolvedDate.analysis_date) : resolvedDate.analysis_date,
          cache_key: dto && dto.environment ? (dto.environment.cache_key || null) : null,
          forecast_source: dto && dto.environment ? (dto.environment.forecast_source || null) : null,
          values_changed: null
        });
      }
    } catch (_dbgErr) { /* ignore */ }
    return res.status(200).json(dto);
  } catch (error) {
    return res.status(500).json({
      error: 'navidur_analysis_failed',
      detail: String(error && error.message ? error.message : error)
    });
  }
};
