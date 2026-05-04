'use strict';

const { isAllowedOrigin, parseBody, setNoCache, cleanString } = require('./_lib/security');
const { readJsonFile, appendDurValidationLog, createId, nowIso } = require('./_lib/data-store');
const { analyzeLiveStation } = require('../shared/navidur-analysis-engine');
const {
  normalizeRequestedStation,
  deriveWaterTraits,
  fetchWeatherAndMarineInputs,
  loadReferenceData
} = require('./_lib/navidur-analysis-runtime');
const fishingEngineHandler = require('./fishing-engine');
const navidurSnapshotValidation = require('../shared/navidur-snapshot-validation');
const publicNavidurDto = require('./_lib/navidur-public-dto');
const traitLongTerm = require('./_lib/navidur-trait-long-term');

/** آخر لقطة traits بين طلبات التحليل (نفس عملية Node فقط — للتشخيص التسلسلي A/B/C). */
var __navidurTraitsDiagPrev = null;

function uniqueTraitStringsForLog(list) {
  var out = [];
  var arr = Array.isArray(list) ? list : [];
  for (var i = 0; i < arr.length; i++) {
    var s = cleanString(arr[i], 120);
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

function buildPerTraitSourceLineage(predicted, observed) {
  var union = [];
  var j;
  for (j = 0; j < predicted.length; j++) {
    if (union.indexOf(predicted[j]) < 0) union.push(predicted[j]);
  }
  for (j = 0; j < observed.length; j++) {
    if (union.indexOf(observed[j]) < 0) union.push(observed[j]);
  }
  return union.map(function (trait) {
    var inP = predicted.indexOf(trait) >= 0;
    var inO = observed.indexOf(trait) >= 0;
    var source = inP && inO ? 'both' : inP ? 'predicted_only' : 'observed_only';
    return { trait: trait, source: source };
  });
}

/**
 * predicted_traits = dur.unified_expected_traits (مرجع الدر/المرحلة + موسم + سمك مجمّع في المحرك).
 * observed_traits = اشتقاق من بيئة التحليل الفعلية + المد (deriveObservedTraitsFromDto).
 * matched / failed / extra = مقارنة predicted مقابل observed بنفس أسماء السمات العربية.
 */
function computeNavidurTraitsDiagnosis(predicted_traits, observed_traits, extra_traits) {
  var prev = __navidurTraitsDiagPrev;
  var diagnosis = 'OK_VARIATION';
  if (prev) {
    if (JSON.stringify(observed_traits) === JSON.stringify(prev.observed_traits)) {
      diagnosis = 'OBSERVED_STATIC_BUG';
    } else if (JSON.stringify(predicted_traits) === JSON.stringify(prev.predicted_traits)) {
      diagnosis = 'PREDICTED_DUPLICATION';
    } else if (JSON.stringify(extra_traits) === JSON.stringify(prev.extra_traits)) {
      diagnosis = 'COMPARISON_OR_NORMALIZATION_BUG';
    }
  }
  __navidurTraitsDiagPrev = {
    observed_traits: observed_traits,
    predicted_traits: predicted_traits,
    extra_traits: extra_traits
  };
  return diagnosis;
}

function logNavidurTraitsValidation(dto, station, diagCtx) {
  try {
    if (typeof console === 'undefined' || !console || typeof console.debug !== 'function') return;
    if (!dto) return;
    if (dto.comparison_mode === 'no_reference' || (dto.validation && dto.validation.mode === 'no_reference')) {
      var obsNr = uniqueTraitStringsForLog(
        (dto.validation && dto.validation.observed_traits) || navidurSnapshotValidation.deriveObservedTraitsFromDto(dto) || []
      );
      console.debug('NAVIDUR_TRAITS_VALIDATION', {
        comparison_mode: 'no_reference',
        expected_traits: [],
        observed_traits: obsNr,
        matched_traits: [],
        failed_traits: [],
        extra_traits: []
      });
      return;
    }
    var st = station && typeof station === 'object' ? station : {};
    var ctx = diagCtx && typeof diagCtx === 'object' ? diagCtx : {};
    var env = dto.environment && typeof dto.environment === 'object' ? dto.environment : {};
    var tide = dto.tide && typeof dto.tide === 'object' ? dto.tide : {};
    var dur = dto.dur && typeof dto.dur === 'object' ? dto.dur : {};
    var predicted_traits = uniqueTraitStringsForLog(
      Array.isArray(dur.unified_expected_traits) ? dur.unified_expected_traits : []
    );
    var observed_traits = uniqueTraitStringsForLog(
      navidurSnapshotValidation.deriveObservedTraitsFromDto(dto) || []
    );
    var matched_traits = predicted_traits.filter(function (t) {
      return observed_traits.indexOf(t) >= 0;
    });
    var failed_traits = predicted_traits.filter(function (t) {
      return observed_traits.indexOf(t) < 0;
    });
    var extra_traits = observed_traits.filter(function (t) {
      return predicted_traits.indexOf(t) < 0;
    });
    var waterTemp =
      env.water_temp_c != null && !isNaN(Number(env.water_temp_c))
        ? Number(env.water_temp_c)
        : env.temp_c != null && !isNaN(Number(env.temp_c))
          ? Number(env.temp_c)
          : null;

    console.debug('NAVIDUR_TRAITS_VALIDATION', {
      predicted_traits: predicted_traits,
      observed_traits: observed_traits,
      matched_traits: matched_traits,
      failed_traits: failed_traits,
      extra_traits: extra_traits
    });
    console.debug('NAVIDUR_TRAIT_SOURCE_PER_ITEM', {
      per_trait_source: buildPerTraitSourceLineage(predicted_traits, observed_traits)
    });

    console.debug('NAVIDUR_TRAITS_ROOT_CHECK', {
      station: cleanString(st.name_ar, 200) || cleanString(st.name, 200) || null,
      station_id: st.id != null ? st.id : (dto.station_id != null ? dto.station_id : null),
      dur: cleanString(dur.period_name, 200) || null,
      phase: dur.active_phase_id != null ? dur.active_phase_id : dur.phase_id != null ? dur.phase_id : null,
      analysis_date: env.as_of != null && String(env.as_of).trim() !== '' ? cleanString(env.as_of, 80) : cleanString(ctx.analysis_date, 20) || null,
      cache_key: env.cache_key != null ? cleanString(env.cache_key, 200) : null,
      forecast_source: env.forecast_source != null ? cleanString(env.forecast_source, 120) : null,
      wind_speed: env.wind_speed_kmh != null ? Number(env.wind_speed_kmh) : null,
      wave_height: env.wave_height_m != null ? Number(env.wave_height_m) : null,
      current_speed: tide.current_speed_ms != null ? Number(tide.current_speed_ms) : null,
      temperature: waterTemp,
      predicted_count: predicted_traits.length,
      observed_count: observed_traits.length,
      predicted_sample: predicted_traits.slice(0, 5),
      observed_sample: observed_traits.slice(0, 5),
      matched_traits: matched_traits,
      failed_traits: failed_traits,
      extra_traits: extra_traits
    });

    console.debug('NAVIDUR_OBSERVED_SOURCE', {
      source: 'deriveObservedTraitsFromDto',
      from_environment: {
        wind: env.wind_speed_kmh != null ? Number(env.wind_speed_kmh) : null,
        wave: env.wave_height_m != null ? Number(env.wave_height_m) : null,
        current: tide.current_speed_ms != null ? Number(tide.current_speed_ms) : null,
        temp: env.temp_c != null ? Number(env.temp_c) : null,
        water_temp_c: env.water_temp_c != null ? Number(env.water_temp_c) : null
      }
    });

    var diagnosis = computeNavidurTraitsDiagnosis(predicted_traits, observed_traits, extra_traits);
    console.debug('NAVIDUR_TRAITS_DIAGNOSIS', { diagnosis: diagnosis });
  } catch (_e) { /* ignore */ }
}

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
    try {
      if (typeof console !== 'undefined' && console && typeof console.debug === 'function') {
        console.debug('NAVIDUR_CACHE_CHECK', {
          cache_key: weatherMeta.cache_key != null ? cleanString(weatherMeta.cache_key, 200) : null,
          station_id: station.id != null ? station.id : null,
          date: resolvedDate.analysis_date
        });
      }
    } catch (_cacheLogErr) { /* ignore */ }
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

    var traitCalibDoc = await readJsonFile('trait_calibration', { version: 1, scopes: {} });

    var dto = analyzeLiveStation({
      station: station,
      datetime: resolvedDate.datetime,
      reference_data: referenceData,
      overrides: body && body.overrides && typeof body.overrides === 'object' ? body.overrides : null,
      live_inputs: liveInputs,
      weather_meta: weatherMeta,
      tide_debug: weatherPack.tide_debug && typeof weatherPack.tide_debug === 'object' ? weatherPack.tide_debug : null,
      debug_log: !!(body && (body.debug_log === true || body.debug === true || body.debug_analysis === true)),
      field_validation: fieldValidation,
      trait_calibration: traitCalibDoc,
      request_depth_mode: cleanString(body.depth_mode, 20)
    });
    try {
      var valLayer = navidurSnapshotValidation.buildValidationResult(dto, fieldValidation, null);
      dto.validation = valLayer.validation;
      dto.comparison_mode = valLayer.comparison_mode;
    } catch (_valLayer) {
      dto.validation = { mode: 'reference', reason: null, observed_traits: [] };
      dto.comparison_mode = 'reference';
    }
    try {
      dto.internal_trait_signals = publicNavidurDto.buildInternalTraitSignalsFromDto(dto);
    } catch (_sig) {
      dto.internal_trait_signals = [];
    }

    logNavidurTraitsValidation(dto, station, { analysis_date: resolvedDate.analysis_date });

    try {
      var validationRec = navidurSnapshotValidation.buildValidationLogRecord({
        validation_id: createId('validation'),
        timestamp: nowIso(),
        station: station,
        dto: dto,
        field_validation: fieldValidation,
        notes: null,
        depth_mode: cleanString(body.depth_mode, 20) || 'coastal'
      });
      if (validationRec) {
        await appendDurValidationLog(validationRec);
        if (validationRec.comparison_mode !== 'no_reference') {
          try {
            await traitLongTerm.bumpTraitCyclesFromValidationRecord(validationRec, {
              reference_bucket_id: validationRec.station_id,
              dur_name_ar: validationRec.dur_name,
              phase_id: validationRec.phase_id || '',
              depth_mode: validationRec.depth_mode || cleanString(body.depth_mode, 20) || 'coastal',
              evidence_meta: traitLongTerm.resolveEvidenceMeta(body, fieldValidation),
              environment: dto.environment && typeof dto.environment === 'object' ? dto.environment : null,
              analysis_date: dto.analysis_date || resolvedDate.analysis_date || null,
              reference_station_name_ar: validationRec.reference_station_name_ar || null
            });
          } catch (_bumpErr) { /* ignore */ }
        }
      }
    } catch (_valLogErr) { /* never fail analysis on validation append */ }

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
    return res.status(200).json(publicNavidurDto.sanitizePublicNavidurDto(dto));
  } catch (error) {
    return res.status(500).json({
      error: 'navidur_analysis_failed',
      detail: String(error && error.message ? error.message : error)
    });
  }
};
