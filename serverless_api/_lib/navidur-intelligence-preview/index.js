'use strict';

var { readJsonFile, getStationSnapshots } = require('../data-store');
var { cleanString } = require('../security');
var { analyzeLiveStation } = require('../../../shared/navidur-analysis-engine');
var {
  normalizeRequestedStation,
  fetchWeatherAndMarineInputs,
  loadReferenceData
} = require('../navidur-analysis-runtime');

var C = require('./constants');
var classifier = require('./station-classifier');
var scoring = require('./scoring');
var comparison = require('./comparison');
var reportDto = require('./report-dto');

function resolvePreviewDate(query) {
  var q = query || {};
  var fromDate = cleanString(q.analysis_date, 20);
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

/**
 * Read-only live analysis — mirrors navidur-analysis without KV writes or hotspot.
 */
async function buildLiveDto(station, referenceData, dateCtx) {
  var body = {
    station_id: station.id,
    analysis_date: dateCtx.analysis_date,
    as_of_iso: dateCtx.as_of_iso,
    datetime: dateCtx.datetime
  };
  var weatherPack = await fetchWeatherAndMarineInputs(station, body);
  var traitCalibDoc = await readJsonFile('trait_calibration', { version: 1, scopes: {} });
  var dto = analyzeLiveStation({
    station: station,
    datetime: dateCtx.datetime,
    reference_data: referenceData,
    overrides: null,
    live_inputs: weatherPack.live_inputs,
    weather_meta: weatherPack.weather_meta || {},
    tide_debug: weatherPack.tide_debug && typeof weatherPack.tide_debug === 'object' ? weatherPack.tide_debug : null,
    debug_log: false,
    field_validation: null,
    trait_calibration: traitCalibDoc,
    request_depth_mode: cleanString(station.fishing_mode, 20) === 'deep' ? 'deep' : 'coastal'
  });
  dto.analysis_date = dateCtx.analysis_date;
  dto.as_of_iso = dateCtx.as_of_iso;
  return dto;
}

async function buildIntelligencePreviewForStation(station, referenceData, dateCtx) {
  var classification = classifier.classifyStationZone(station);
  var dto;
  try {
    dto = await buildLiveDto(station, referenceData, dateCtx);
  } catch (err) {
    return reportDto.buildReportPayload(
      station,
      classification,
      {
        marine_condition: { score: 0, label: 'unknown', reasons: ['analysis_failed'] },
        traditional_layer: { dur: '', dur_day: null, hamal_fasad: 'unknown', confidence: 0, reasons: ['analysis_failed'] },
        fish_activity_groups: emptyFishGroups('analysis_failed'),
        risk: { boating: 'unknown', shore_activity: 'unknown', diving: 'unknown', reasons: ['analysis_failed'] },
        comparison: { has_history: false, vs_previous: {}, vs_24h: {}, vs_7d: {}, trend: 'unknown' },
        anomalies: [{ type: 'analysis_error', message_ar: String(err && err.message ? err.message : err) }],
        summary_ar: 'تعذر توليد التحليل الحي لهذه المحطة.',
        confidence: 0
      },
      { score: 0, missing: ['live_analysis'], warnings: ['analysis_failed'] }
    );
  }

  var snapshots = [];
  try {
    snapshots = await getStationSnapshots({
      stationId: station.id,
      limit: 80,
      stationIdMatchesReferenceBucket: true
    });
  } catch (_snapErr) {
    snapshots = [];
  }

  var marineReasons = [];
  var marine = scoring.scoreMarineCondition(dto.environment, dto.tide, marineReasons);

  var tradReasons = [];
  var traditional = scoring.scoreTraditionalLayer(dto.dur, dto.tide, tradReasons);

  var fishReasons = [];
  var fishGroups = scoring.scoreFishActivityGroups(dto, classification.zone, fishReasons);

  var riskReasons = [];
  var risk = scoring.scoreRisk(dto.environment, dto.tide, riskReasons);

  var currentMetrics = {
    confidence: dto.fishing && dto.fishing.confidence_score != null ? Number(dto.fishing.confidence_score) : null,
    wave_height_m: dto.environment && dto.environment.wave_height_m != null ? Number(dto.environment.wave_height_m) : null,
    current_speed_ms: dto.tide && dto.tide.current_speed_ms != null ? Number(dto.tide.current_speed_ms) : null,
    tide_state: dto.tide && dto.tide.state != null ? String(dto.tide.state) : null
  };

  var cmp = comparison.buildComparison(currentMetrics, snapshots);
  var dataQuality = scoring.assessDataQuality(dto, station, snapshots);
  var overallConf = scoring.computeOverallConfidence(marine, traditional, dataQuality);
  var anomalies = scoring.buildAnomalies(dto, marine, traditional, dataQuality);
  var summaryAr = scoring.buildSummaryAr(station, marine, traditional, fishGroups, risk, cmp, overallConf);

  return reportDto.buildReportPayload(station, classification, {
    marine_condition: marine,
    traditional_layer: traditional,
    fish_activity_groups: fishGroups,
    risk: risk,
    comparison: {
      has_history: cmp.has_history,
      vs_previous: cmp.vs_previous,
      vs_24h: cmp.vs_24h,
      vs_7d: cmp.vs_7d,
      trend: cmp.trend
    },
    anomalies: anomalies,
    summary_ar: summaryAr,
    confidence: overallConf
  }, dataQuality);
}

function emptyFishGroups(reason) {
  var out = {};
  C.FISH_GROUPS.forEach(function (k) {
    out[k] = { score: 0, label: 'unknown', reasons: [reason] };
  });
  return out;
}

function isPreviewEligibleStation(station) {
  if (!station || !station.id) return false;
  if (station.lat == null || station.lon == null) return false;
  var status = String(station.status || 'active').toLowerCase();
  if (status === 'archived' || status === 'disabled') return false;
  return true;
}

function resolveBatchLimit(query) {
  var q = query || {};
  var raw = q.limit != null ? q.limit : q.batch_limit;
  var requested;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    requested = C.DEFAULT_ALL_LIMIT;
  } else {
    requested = Math.floor(Number(raw));
    if (!Number.isFinite(requested)) {
      requested = C.DEFAULT_ALL_LIMIT;
    }
  }
  var applied = requested;
  if (applied < 1) {
    applied = 1;
  }
  if (applied > C.MAX_ALL_LIMIT) {
    applied = C.MAX_ALL_LIMIT;
  }
  return { requested_limit: requested, applied_limit: applied };
}

async function buildIntelligencePreviewAll(referenceData, dateCtx, query) {
  var limits = resolveBatchLimit(query);
  var eligible = (referenceData.stations || []).filter(isPreviewEligibleStation);
  eligible.sort(function (a, b) {
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  });
  var eligibleTotal = eligible.length;
  var batch = eligible.slice(0, limits.applied_limit);
  var items = [];
  for (var i = 0; i < batch.length; i += 1) {
    items.push(await buildIntelligencePreviewForStation(batch[i], referenceData, dateCtx));
  }
  return reportDto.buildAllResponse(items, {
    eligible_total: eligibleTotal,
    requested_limit: limits.requested_limit,
    applied_limit: limits.applied_limit
  });
}

async function buildIntelligencePreview(query) {
  var q = query || {};
  var dateCtx = resolvePreviewDate(q);
  var referenceData = await loadReferenceData();
  var allFlag = String(q.all || q.all_stations || '') === '1' || String(q.all || '').toLowerCase() === 'true';

  if (allFlag) {
    return buildIntelligencePreviewAll(referenceData, dateCtx, q);
  }

  var stationId = cleanString(q.station_id, 80);
  if (!stationId) {
    var err = new Error('station_id_required');
    err.code = 'station_id_required';
    throw err;
  }

  var station = normalizeRequestedStation({ station_id: stationId }, referenceData.stations);
  if (!station || !station.id) {
    var nf = new Error('station_not_found');
    nf.code = 'station_not_found';
    throw nf;
  }
  if (station.lat == null || station.lon == null) {
    var nc = new Error('station_coordinates_required');
    nc.code = 'station_coordinates_required';
    throw nc;
  }

  return buildIntelligencePreviewForStation(station, referenceData, dateCtx);
}

module.exports = {
  buildIntelligencePreview: buildIntelligencePreview,
  buildIntelligencePreviewForStation: buildIntelligencePreviewForStation,
  resolveBatchLimit: resolveBatchLimit,
  isPreviewEligibleStation: isPreviewEligibleStation
};
