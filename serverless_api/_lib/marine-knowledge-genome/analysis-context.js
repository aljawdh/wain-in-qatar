'use strict';

var { readJsonFile } = require('../data-store');
var { cleanString } = require('../security');
var { analyzeLiveStation } = require('../../../shared/navidur-analysis-engine');
var {
  normalizeRequestedStation,
  fetchWeatherAndMarineInputs,
  buildNormalizedMarineInputs,
  loadReferenceData
} = require('../navidur-analysis-runtime');
var marineVars = require('../navidur-intelligence-preview/marine-variables');
var traitReviewStore = require('../trait-review-store');
var traitReviewService = require('../trait-review-service');

function resolveDateCtx(query) {
  var fromDate = cleanString(query && query.analysis_date, 20);
  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    return {
      analysis_date: fromDate,
      as_of_iso: fromDate + 'T12:00:00Z',
      datetime: fromDate + 'T12:00:00Z'
    };
  }
  var today = new Date().toISOString().slice(0, 10);
  return {
    analysis_date: today,
    as_of_iso: today + 'T12:00:00Z',
    datetime: today + 'T12:00:00Z'
  };
}

async function buildAnalysisContext(query) {
  var stationId = cleanString(query.station_id, 80);
  if (!stationId) {
    throw Object.assign(new Error('station_id_required'), { code: 400 });
  }
  var referenceData = await loadReferenceData();
  var stations = referenceData && referenceData.stations ? referenceData.stations : [];
  var normalized = normalizeRequestedStation({ station_id: stationId }, stations);
  if (!normalized || !normalized.id) {
    throw Object.assign(new Error('station_not_found'), { code: 404 });
  }
  var dateCtx = resolveDateCtx(query);
  var body = {
    station_id: normalized.id,
    analysis_date: dateCtx.analysis_date,
    as_of_iso: dateCtx.as_of_iso,
    datetime: dateCtx.datetime
  };
  var weatherPack = await fetchWeatherAndMarineInputs(normalized, body);
  var weatherMeta = Object.assign({}, weatherPack.weather_meta || {}, {
    normalized_marine: weatherPack.normalized_marine || buildNormalizedMarineInputs(
      weatherPack.live_inputs,
      weatherPack.weather_meta
    )
  });
  var traitCalibDoc = await readJsonFile('trait_calibration', { version: 1, scopes: {} });
  var dto = analyzeLiveStation({
    station: normalized,
    datetime: dateCtx.datetime,
    reference_data: referenceData,
    overrides: null,
    live_inputs: weatherPack.live_inputs,
    weather_meta: weatherPack.weather_meta || {},
    tide_debug: weatherPack.tide_debug && typeof weatherPack.tide_debug === 'object' ? weatherPack.tide_debug : null,
    debug_log: false,
    field_validation: null,
    trait_calibration: traitCalibDoc,
    request_depth_mode: cleanString(normalized.fishing_mode, 20) === 'deep' ? 'deep' : 'coastal'
  });
  var marineLayer = marineVars.extractFromDto(dto, weatherMeta);
  var dur = dto && dto.dur ? dto.dur : {};
  var durName = cleanString(query.dur_name, 120) || cleanString(dur.period_name, 120) || '';
  var reviews = await traitReviewStore.listReviews({
    station_id: stationId,
    reference_station_id: cleanString(query.reference_station_id, 80) || stationId,
    dur_name: durName,
    limit: 500
  });
  var humanMap = traitReviewService.latestReviewsByTrait(reviews);
  var humanReviews = {};
  Object.keys(humanMap).forEach(function (k) {
    var r = humanMap[k];
    humanReviews[k] = {
      observed_value: r.observed_value,
      match_status: r.match_status,
      confidence: r.manual_confidence != null ? r.manual_confidence : r.auto_confidence
    };
  });
  return {
    station_id: String(normalized.id),
    reference_station_id: cleanString(query.reference_station_id, 80) || String(dto.reference_station_id || normalized.id),
    dur_name: durName,
    dur_day: dur.day_in_period != null ? Number(dur.day_in_period) : null,
    analysis_date: dateCtx.analysis_date,
    marine_variables: marineLayer.marine_variables || {},
    marine_variables_quality: {
      missing_partial: !!(marineLayer.marine_variables_quality && marineLayer.marine_variables_quality.partial),
      missing_critical: !!(marineLayer.marine_variables_quality && marineLayer.marine_variables_quality.critical),
      has_memory_history: false
    },
    intelligence: {
      risk: dto && dto.fishing ? dto.fishing.risk_level : null,
      confidence_score: dto && dto.fishing ? dto.fishing.confidence_score : null
    },
    human_reviews: humanReviews,
    dto: dto
  };
}

module.exports = {
  buildAnalysisContext: buildAnalysisContext,
  resolveDateCtx: resolveDateCtx
};
