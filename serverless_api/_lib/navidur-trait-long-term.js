'use strict';

const { readJsonFile, writeJsonFile } = require('./data-store');
const traitCalib = require('../../shared/navidur-trait-calibration');

const WEIGHT_FORECAST = 0.6;
const WEIGHT_FIELD = 0.8;
const WEIGHT_BUOY = 0.95;

function normalizeString(v) {
  return String(v == null ? '' : v).trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveEvidenceMeta(body, fieldValidation) {
  var source = 'forecast';
  var w = WEIGHT_FORECAST;
  if (body && String(body.evidence_source || '').toLowerCase() === 'buoy') {
    source = 'buoy';
    w = WEIGHT_BUOY;
  } else if (body && String(body.evidence_source || '').toLowerCase() === 'field') {
    source = 'field';
    w = WEIGHT_FIELD;
  } else if (fieldValidation && (Array.isArray(fieldValidation.observed_traits) ? fieldValidation.observed_traits.length : 0) > 0) {
    source = 'field';
    w = WEIGHT_FIELD;
  }
  return { source: source, weight: w };
}

function extractYear4FromString(s) {
  var str = normalizeString(s);
  if (str.length >= 4 && /^\d{4}/.test(str)) return str.slice(0, 4);
  var m = str.match(/(\d{4})/);
  return m ? m[1] : null;
}

/**
 * Year for yearly_stats: environment.as_of → analysis_date → record.timestamp → now.
 * @param {object} record
 * @param {object} ctx
 */
function resolveStatsYear(record, ctx) {
  var c = ctx || {};
  var env = c.environment && typeof c.environment === 'object' ? c.environment : {};
  var y =
    extractYear4FromString(env.as_of) ||
    extractYear4FromString(c.analysis_date) ||
    extractYear4FromString(record && record.timestamp) ||
    String(new Date().getFullYear());
  return /^\d{4}$/.test(y) ? y : String(new Date().getFullYear());
}

function emptyYearlyEntry() {
  return {
    matched_count: 0,
    failed_count: 0,
    extra_count: 0,
    event_count: 0,
    confidence: 0,
    failure_rate: 0,
    first_seen_at: null,
    last_seen_at: null
  };
}

function recomputeYearlyMetrics(ys) {
  ys.event_count = (ys.matched_count || 0) + (ys.failed_count || 0) + (ys.extra_count || 0);
  if (ys.event_count > 0) {
    ys.confidence = (ys.matched_count + ys.extra_count) / ys.event_count;
    ys.failure_rate = ys.failed_count / ys.event_count;
  } else {
    ys.confidence = 0;
    ys.failure_rate = 0;
  }
}

function refreshCycleYearsFromYearly(st) {
  st.yearly_stats = st.yearly_stats && typeof st.yearly_stats === 'object' ? st.yearly_stats : {};
  var years = Object.keys(st.yearly_stats)
    .filter(function (k) {
      return /^\d{4}$/.test(k);
    })
    .sort();
  st.cycle_years = years.map(function (x) {
    return Number(x);
  });
  st.cycle_count = st.cycle_years.length;
}

function bumpYearlyStats(st, yearKey, kind, ts) {
  if (!st.yearly_stats) st.yearly_stats = {};
  if (!st.yearly_stats[yearKey]) st.yearly_stats[yearKey] = emptyYearlyEntry();
  var ys = st.yearly_stats[yearKey];
  if (kind === 'matched') ys.matched_count += 1;
  else if (kind === 'extra') ys.extra_count += 1;
  else if (kind === 'failed') ys.failed_count += 1;
  recomputeYearlyMetrics(ys);
  if (ts) {
    if (!ys.first_seen_at || ts < ys.first_seen_at) ys.first_seen_at = ts;
    if (!ys.last_seen_at || ts > ys.last_seen_at) ys.last_seen_at = ts;
  }
  refreshCycleYearsFromYearly(st);
  st.updated_at = new Date().toISOString();
}

function emptyTraitState() {
  return {
    cycle_year: null,
    cycle_number: 0,
    matched_count: 0,
    failed_count: 0,
    extra_count: 0,
    confidence: 0,
    status: '',
    positive_events: 0,
    failed_events: 0,
    last_seen_year: null,
    last_event_at: null,
    source_weights: { forecast: 0, field: 0, buoy: 0 },
    yearly_stats: {},
    cycle_years: [],
    cycle_count: 0,
    updated_at: null
  };
}

function deriveStatusFromCounts(st) {
  if (st.status === 'confirmed' || st.status === 'excluded') return st.status;
  var pos = st.positive_events || 0;
  var fev = st.failed_events || 0;
  if (fev >= 3 && pos === 0) return 'exclusion_candidate';
  if (pos >= 3) return 'stage_3_confirmed_candidate';
  if (pos === 2) return 'stage_2_supported';
  if (pos >= 1) return 'stage_1_review';
  if (fev >= 1) return 'stage_1_review';
  return '';
}

function recomputeConfidence(st) {
  var sw = st.source_weights || {};
  var sum = (sw.forecast || 0) * WEIGHT_FORECAST + (sw.field || 0) * WEIGHT_FIELD + (sw.buoy || 0) * WEIGHT_BUOY;
  var denom = (sw.forecast || 0) + (sw.field || 0) + (sw.buoy || 0) || 1;
  st.confidence = Math.min(0.99, Math.round((sum / denom) * 100) / 100);
}

var COMPARISON_LABELS = {
  no_previous_cycle: 'لا توجد دورة سابقة للمقارنة',
  improved: 'تحسن واضح',
  declined: 'تراجع واضح',
  stable: 'مستقر',
  insufficient_data: 'بيانات غير كافية'
};

function normalizeYearlyStatsBlock(y) {
  if (!y || typeof y !== 'object') {
    return {
      matched_count: 0,
      failed_count: 0,
      extra_count: 0,
      event_count: 0,
      confidence: 0,
      failure_rate: 0,
      first_seen_at: null,
      last_seen_at: null
    };
  }
  return {
    matched_count: y.matched_count != null ? Number(y.matched_count) : 0,
    failed_count: y.failed_count != null ? Number(y.failed_count) : 0,
    extra_count: y.extra_count != null ? Number(y.extra_count) : 0,
    event_count: y.event_count != null ? Number(y.event_count) : 0,
    confidence: y.confidence != null ? Number(y.confidence) : 0,
    failure_rate: y.failure_rate != null ? Number(y.failure_rate) : 0,
    first_seen_at: y.first_seen_at != null ? y.first_seen_at : null,
    last_seen_at: y.last_seen_at != null ? y.last_seen_at : null
  };
}

/**
 * @param {object} query — { compare_year, compare_previous_year, comparison_filter }
 */
function buildTraitYearlyComparisonRow(scopeMeta, traitName, traitState, query) {
  var q = query || {};
  var cy = parseInt(String(q.compare_year || ''), 10);
  var currentYear = Number.isFinite(cy) ? cy : new Date().getFullYear();
  var pyRaw = q.compare_previous_year;
  var previousYear = Number.isFinite(parseInt(String(pyRaw || ''), 10))
    ? parseInt(String(pyRaw), 10)
    : currentYear - 1;

  var ys = traitState && traitState.yearly_stats && typeof traitState.yearly_stats === 'object' ? traitState.yearly_stats : {};
  var curKey = String(currentYear);
  var prevKey = String(previousYear);
  var current_year_stats = normalizeYearlyStatsBlock(ys[curKey]);
  var previous_year_stats = normalizeYearlyStatsBlock(ys[prevKey]);

  var currConf = current_year_stats.event_count > 0 ? current_year_stats.confidence : null;
  var prevConf = previous_year_stats.event_count > 0 ? previous_year_stats.confidence : null;
  var currFail = current_year_stats.event_count > 0 ? current_year_stats.failure_rate : null;
  var prevFail = previous_year_stats.event_count > 0 ? previous_year_stats.failure_rate : null;

  var confidence_delta =
    currConf != null && prevConf != null ? Math.round((currConf - prevConf) * 100) / 100 : null;
  var failure_delta =
    currFail != null && prevFail != null ? Math.round((currFail - prevFail) * 100) / 100 : null;

  var comparison_status = 'stable';
  if (!current_year_stats.event_count || current_year_stats.event_count < 5) {
    comparison_status = 'insufficient_data';
  } else if (!previous_year_stats.event_count || previous_year_stats.event_count < 1) {
    comparison_status = 'no_previous_cycle';
  } else if (confidence_delta != null) {
    if (confidence_delta >= 0.15) comparison_status = 'improved';
    else if (confidence_delta <= -0.15) comparison_status = 'declined';
    else comparison_status = 'stable';
  }

  var cycleYears = Array.isArray(traitState && traitState.cycle_years) ? traitState.cycle_years.slice() : [];
  var cycleCount = traitState && traitState.cycle_count != null ? Number(traitState.cycle_count) : cycleYears.length;

  var row = {
    trait_name: traitName,
    reference_station_id: scopeMeta.reference_station_id,
    dur_name_ar: scopeMeta.dur_name_ar,
    phase_id: scopeMeta.phase_id,
    depth_mode: scopeMeta.depth_mode,

    matched_count: traitState.matched_count,
    failed_count: traitState.failed_count,
    extra_count: traitState.extra_count,
    cycle_number: traitState.cycle_number,
    last_seen_year: traitState.last_seen_year,
    confidence: traitState.confidence,
    status: traitState.status,
    positive_events: traitState.positive_events,
    failed_events: traitState.failed_events,
    supervisor_hold: !!traitState.supervisor_hold,
    candidate_label: String(traitState.status) === 'stage_3_confirmed_candidate' ? 'مرشحة للاعتماد' : '',

    yearly_stats: ys,
    cycle_count: cycleCount,
    cycle_years: cycleYears,

    current_year: currentYear,
    previous_year: previousYear,
    current_year_stats: current_year_stats,
    previous_year_stats: previous_year_stats,
    confidence_delta: confidence_delta,
    failure_delta: failure_delta,
    comparison_status: comparison_status,
    label_ar: COMPARISON_LABELS[comparison_status] || ''
  };

  try {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('NAVIDUR_TRAIT_YEARLY_COMPARISON', {
        reference_station_id: row.reference_station_id,
        dur_name_ar: row.dur_name_ar,
        phase_id: row.phase_id,
        depth_mode: row.depth_mode,
        trait_name: row.trait_name,
        current_year: row.current_year,
        previous_year: row.previous_year,
        current_year_stats: row.current_year_stats,
        previous_year_stats: row.previous_year_stats,
        confidence_delta: row.confidence_delta,
        failure_delta: row.failure_delta,
        comparison_status: row.comparison_status
      });
    }
  } catch (_e) { /* ignore */ }

  return row;
}

/**
 * @param {object} opts — { scope, query }
 */
function buildTraitLongTermStateRows(opts) {
  var scope = opts && opts.scope ? opts.scope : {};
  var query = opts && opts.query ? opts.query : {};
  var traits = scope.traits && typeof scope.traits === 'object' ? scope.traits : {};
  var scopeMeta = {
    reference_station_id: normalizeString(scope.reference_station_id),
    dur_name_ar: normalizeString(scope.dur_name_ar),
    phase_id: normalizeString(scope.phase_id),
    depth_mode: normalizeString(scope.depth_mode) || 'coastal'
  };
  var filterKey = normalizeString(query.comparison_filter).toLowerCase();
  var rows = Object.keys(traits).map(function (name) {
    return buildTraitYearlyComparisonRow(scopeMeta, name, traits[name] || {}, query);
  });
  if (!filterKey || filterKey === 'all') return rows;
  return rows.filter(function (r) {
    return String(r.comparison_status) === filterKey;
  });
}

function yearCycleCountForSupervisor(row) {
  if (row && Array.isArray(row.cycle_years) && row.cycle_years.length) return row.cycle_years.length;
  if (row && row.cycle_count != null) return Number(row.cycle_count) || 0;
  return 0;
}

/**
 * @param {object} record — dur validation log row
 * @param {object} ctx — { reference_bucket_id, dur_name_ar, phase_id, depth_mode, evidence_meta, environment, analysis_date, reference_station_name_ar }
 */
async function bumpTraitCyclesFromValidationRecord(record, ctx) {
  var refId = normalizeString(ctx && ctx.reference_bucket_id);
  var durAr = normalizeString(ctx && ctx.dur_name_ar);
  var phaseId = normalizeString(ctx && ctx.phase_id);
  var depth = normalizeString(ctx && ctx.depth_mode) || 'coastal';
  if (!refId || !durAr) return null;
  var meta = ctx.evidence_meta || { source: 'forecast', weight: WEIGHT_FORECAST };
  var scopeKey = traitCalib.buildTraitCalibrationScopeKey({
    reference_station_id: refId,
    dur_name_ar: durAr,
    phase_id: phaseId,
    depth_mode: depth
  });
  var ts = normalizeString(record && record.timestamp);
  var statsYear = resolveStatsYear(record, ctx);

  var doc = await readJsonFile('trait_cycles', { version: 1, scopes: {} });
  doc.version = 1;
  doc.scopes = doc.scopes && typeof doc.scopes === 'object' ? doc.scopes : {};
  if (!doc.scopes[scopeKey]) {
    doc.scopes[scopeKey] = {
      reference_station_id: refId,
      dur_name_ar: durAr,
      phase_id: phaseId,
      depth_mode: depth,
      traits: {},
      updated_at: ts || new Date().toISOString()
    };
  }
  var scope = doc.scopes[scopeKey];
  scope.traits = scope.traits && typeof scope.traits === 'object' ? scope.traits : {};

  var matched = toArray(record && record.matched_traits);
  var failed = toArray(record && record.failed_traits);
  var extra = toArray(record && record.extra_traits);

  var refNameAr = normalizeString(ctx && ctx.reference_station_name_ar) || normalizeString(record && record.reference_station_name_ar);

  function touchTrait(name, kind) {
    var key = normalizeString(name);
    if (!key) return;
    var st = Object.assign(emptyTraitState(), scope.traits[key] || {});
    st.reference_station_id = refId;
    if (refNameAr) st.reference_station_name_ar = refNameAr;
    st.dur_name_ar = durAr;
    st.phase_id = phaseId;
    st.depth_mode = depth;
    st.trait_name = key;
    st.last_event_at = ts || st.last_event_at;
    st.last_seen_year = statsYear;
    st.cycle_year = statsYear;
    if (!st.source_weights) st.source_weights = { forecast: 0, field: 0, buoy: 0 };
    if (meta.source === 'field') st.source_weights.field = (st.source_weights.field || 0) + 1;
    else if (meta.source === 'buoy') st.source_weights.buoy = (st.source_weights.buoy || 0) + 1;
    else st.source_weights.forecast = (st.source_weights.forecast || 0) + 1;

    if (kind === 'matched') {
      st.matched_count += 1;
      st.positive_events = (st.positive_events || 0) + 1;
      st.cycle_number = st.positive_events;
    } else if (kind === 'extra') {
      st.extra_count += 1;
      st.positive_events = (st.positive_events || 0) + 1;
      st.cycle_number = st.positive_events;
    } else if (kind === 'failed') {
      st.failed_count += 1;
      st.failed_events = (st.failed_events || 0) + 1;
      st.cycle_number = Math.max(st.cycle_number || 0, st.failed_events);
    }
    bumpYearlyStats(st, statsYear, kind, ts);
    recomputeConfidence(st);
    st.status = deriveStatusFromCounts(st);
    scope.traits[key] = st;
  }

  matched.forEach(function (t) {
    touchTrait(t, 'matched');
  });
  extra.forEach(function (t) {
    touchTrait(t, 'extra');
  });
  failed.forEach(function (t) {
    if (matched.indexOf(t) >= 0) return;
    touchTrait(t, 'failed');
  });

  scope.updated_at = new Date().toISOString();
  await writeJsonFile('trait_cycles', doc);

  try {
    if (typeof console !== 'undefined' && console.debug) {
      var sampleTrait = matched[0] || extra[0] || failed[0] || '';
      var sample = scope.traits[normalizeString(sampleTrait)] || {};
      console.debug('NAVIDUR_TRAIT_LONG_TERM_LEARNING', {
        reference_station_id: refId,
        dur_name_ar: durAr,
        phase_id: phaseId,
        depth_mode: depth,
        trait_name: sampleTrait || null,
        cycle_count: sample.cycle_count != null ? sample.cycle_count : null,
        current_stage: sample.status || null,
        confidence: sample.confidence != null ? sample.confidence : null,
        source_weights: sample.source_weights || {},
        stats_year: statsYear
      });
    }
  } catch (_e) { /* ignore */ }

  return doc;
}

module.exports = {
  bumpTraitCyclesFromValidationRecord: bumpTraitCyclesFromValidationRecord,
  resolveEvidenceMeta: resolveEvidenceMeta,
  resolveStatsYear: resolveStatsYear,
  buildTraitLongTermStateRows: buildTraitLongTermStateRows,
  buildTraitYearlyComparisonRow: buildTraitYearlyComparisonRow,
  yearCycleCountForSupervisor: yearCycleCountForSupervisor,
  WEIGHT_FORECAST: WEIGHT_FORECAST,
  WEIGHT_FIELD: WEIGHT_FIELD,
  WEIGHT_BUOY: WEIGHT_BUOY
};
