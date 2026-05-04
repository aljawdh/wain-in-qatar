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
    source_weights: { forecast: 0, field: 0, buoy: 0 }
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

/**
 * @param {object} record — dur validation log row
 * @param {object} ctx — { reference_bucket_id, dur_name_ar, phase_id, depth_mode, evidence_meta }
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
  var year = ts.length >= 4 ? ts.slice(0, 4) : String(new Date().getFullYear());

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

  function touchTrait(name, kind) {
    var key = normalizeString(name);
    if (!key) return;
    var st = Object.assign(emptyTraitState(), scope.traits[key] || {});
    st.last_event_at = ts || st.last_event_at;
    st.last_seen_year = year;
    st.cycle_year = year;
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
        cycle_count: sample.cycle_number != null ? sample.cycle_number : null,
        current_stage: sample.status || null,
        confidence: sample.confidence != null ? sample.confidence : null,
        source_weights: sample.source_weights || {}
      });
    }
  } catch (_e) { /* ignore */ }

  return doc;
}

module.exports = {
  bumpTraitCyclesFromValidationRecord: bumpTraitCyclesFromValidationRecord,
  resolveEvidenceMeta: resolveEvidenceMeta,
  WEIGHT_FORECAST: WEIGHT_FORECAST,
  WEIGHT_FIELD: WEIGHT_FIELD,
  WEIGHT_BUOY: WEIGHT_BUOY
};
