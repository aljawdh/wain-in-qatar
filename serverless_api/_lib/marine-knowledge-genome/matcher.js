'use strict';

var expectedTraits = require('./expected-traits');
var store = require('./genome-store');

function toNum(v) {
  var n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getByPath(root, pathStr) {
  var parts = String(pathStr || '').split('.');
  var cur = root;
  for (var i = 0; i < parts.length; i++) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function formatObserved(value, rule) {
  if (value == null || value === '') return null;
  if (rule && rule.unit) return String(value) + ' ' + rule.unit;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function evalRule(value, rule) {
  if (!rule) return null;
  var op = String(rule.operator || '').toLowerCase();
  var target = rule.value;
  if (op === 'exists') {
    return value != null && value !== '' && value !== 'unknown';
  }
  if (op === 'eq') {
    return String(value) === String(target);
  }
  var n = toNum(value);
  if (n == null) return false;
  if (op === '<=') return n <= toNum(target);
  if (op === '>=') return n >= toNum(target);
  if (op === '<') return n < toNum(target);
  if (op === '>') return n > toNum(target);
  if (op === 'between' && Array.isArray(target) && target.length >= 2) {
    var lo = toNum(target[0]);
    var hi = toNum(target[1]);
    if (lo == null || hi == null) return false;
    return n >= lo && n <= hi;
  }
  return null;
}

function deriveDataQualityFlags(marineVars, quality) {
  var keys = ['sea_surface_temperature', 'wave_height', 'wave_period', 'current_speed', 'wind_speed', 'tide_state'];
  var present = 0;
  keys.forEach(function (k) {
    if (marineVars && marineVars[k] != null && marineVars[k] !== '') present += 1;
  });
  var q = quality && typeof quality === 'object' ? quality : {};
  return {
    data_complete: present >= keys.length - 1,
    data_missing_partial: present > 0 && present < keys.length - 1,
    data_missing_critical: present === 0,
    source_confidence_high: !q.missing_critical,
    source_confidence_medium: !!q.missing_partial,
    source_confidence_low: !!q.missing_critical,
    enough_history_available: !!(quality && quality.has_memory_history),
    insufficient_history: !(quality && quality.has_memory_history),
    manual_review_needed: !!q.missing_critical
  };
}

function matchTrait(trait, ctx) {
  var expectedStatus = expectedTraits.resolveExpectedStatus(trait, ctx);
  var marineVars = (ctx && ctx.marine_variables) || {};
  var quality = (ctx && ctx.marine_variables_quality) || {};
  var intel = (ctx && ctx.intelligence) || {};
  var memory = (ctx && ctx.memory_trends) || {};
  var humanReviews = (ctx && ctx.human_reviews) || {};
  var rule = trait.validation_rule;
  var sources = [];

  if (trait.requires_field_station) {
    return {
      trait_key: trait.trait_key,
      label_ar: trait.label_ar,
      category: trait.category,
      expected_status: expectedStatus,
      observed_value: null,
      match_status: 'needs_field_station',
      confidence: 0,
      reason_ar: 'تحتاج محطة ميدانية — غير قابلة للقياس من المصدر الحالي.',
      source_used: ['field_station']
    };
  }
  if (trait.requires_human_review || !trait.observable_now) {
    var review = humanReviews[trait.trait_key];
    if (review && review.observed_value != null) {
      sources.push('human_review');
      return {
        trait_key: trait.trait_key,
        label_ar: trait.label_ar,
        category: trait.category,
        expected_status: expectedStatus,
        observed_value: review.observed_value,
        match_status: review.match_status || 'partial',
        confidence: review.confidence != null ? review.confidence : Math.round((trait.confidence_weight || 0.5) * 100),
        reason_ar: 'مرصود من مراجعة بشرية محفوظة.',
        source_used: sources
      };
    }
    if (trait.requires_human_review) {
      return {
        trait_key: trait.trait_key,
        label_ar: trait.label_ar,
        category: trait.category,
        expected_status: expectedStatus,
        observed_value: null,
        match_status: 'needs_human_review',
        confidence: 0,
        reason_ar: 'تحتاج مراجعة بشرية — غير متوفرة من المصدر الحالي.',
        source_used: ['human_review']
      };
    }
  }

  var dq = deriveDataQualityFlags(marineVars, quality);
  if (trait.category === 'data_quality' && dq[trait.trait_key] != null) {
    var boolVal = dq[trait.trait_key];
    sources.push('open_meteo_marine', 'navidur_memory');
    return {
      trait_key: trait.trait_key,
      label_ar: trait.label_ar,
      category: trait.category,
      expected_status: expectedStatus,
      observed_value: boolVal,
      match_status: boolVal ? 'matched' : 'mismatch',
      confidence: Math.round((trait.confidence_weight || 0.7) * 100),
      reason_ar: boolVal ? 'جودة البيانات تدعم هذه السمة.' : 'البيانات لا تدعم هذه السمة حالياً.',
      source_used: sources
    };
  }

  if (rule && rule.variable) {
    var raw = getByPath({ marine_variables: marineVars, intelligence: intel, memory_trends: memory }, rule.variable);
    if (raw == null || raw === '' || raw === 'unknown') {
      sources.push(trait.primary_source || 'open_meteo_marine');
      return {
        trait_key: trait.trait_key,
        label_ar: trait.label_ar,
        category: trait.category,
        expected_status: expectedStatus,
        observed_value: null,
        match_status: 'unavailable',
        confidence: 0,
        reason_ar: 'غير متوفرة من المصدر الحالي.',
        source_used: sources
      };
    }
    var pass = evalRule(raw, rule);
    sources.push('open_meteo_marine');
    if (intel && Object.keys(intel).length) sources.push('navidur_intelligence');
    return {
      trait_key: trait.trait_key,
      label_ar: trait.label_ar,
      category: trait.category,
      expected_status: expectedStatus,
      observed_value: formatObserved(raw, rule),
      match_status: pass ? 'matched' : 'mismatch',
      confidence: Math.round((trait.confidence_weight || 0.7) * (pass ? 100 : 35)),
      reason_ar: pass ? 'القيمة المرصودة تطابق قاعدة التحقق.' : 'القيمة المرصودة لا تطابق المتوقع.',
      source_used: sources
    };
  }

  if (trait.match_logic === 'manual') {
    return {
      trait_key: trait.trait_key,
      label_ar: trait.label_ar,
      category: trait.category,
      expected_status: expectedStatus,
      observed_value: null,
      match_status: trait.observable_now ? 'unavailable' : 'needs_human_review',
      confidence: 0,
      reason_ar: trait.observable_now
        ? 'غير متوفرة من المصدر الحالي — تحقق يدوي.'
        : 'تحتاج رصد ميداني أو مراجعة بشرية.',
      source_used: [trait.primary_source || 'human_review']
    };
  }

  return {
    trait_key: trait.trait_key,
    label_ar: trait.label_ar,
    category: trait.category,
    expected_status: expectedStatus,
    observed_value: null,
    match_status: 'unavailable',
    confidence: 0,
    reason_ar: 'غير متوفرة من المصدر الحالي.',
    source_used: []
  };
}

function buildMatchMatrix(ctx) {
  var traits = store.listTraits();
  var rows = traits.map(function (trait) {
    return matchTrait(trait, ctx);
  });
  var summary = {
    total: rows.length,
    matched: rows.filter(function (r) { return r.match_status === 'matched'; }).length,
    partial: rows.filter(function (r) { return r.match_status === 'partial'; }).length,
    mismatch: rows.filter(function (r) { return r.match_status === 'mismatch'; }).length,
    unavailable: rows.filter(function (r) { return r.match_status === 'unavailable'; }).length,
    needs_human_review: rows.filter(function (r) { return r.match_status === 'needs_human_review'; }).length,
    needs_field_station: rows.filter(function (r) { return r.match_status === 'needs_field_station'; }).length
  };
  return {
    ok: true,
    version: store.getGenome().version,
    station_id: ctx.station_id || null,
    reference_station_id: ctx.reference_station_id || null,
    dur_name: ctx.dur_name || null,
    dur_day: ctx.dur_day != null ? ctx.dur_day : null,
    analysis_date: ctx.analysis_date || null,
    summary: summary,
    matrix: rows
  };
}

module.exports = {
  matchTrait: matchTrait,
  buildMatchMatrix: buildMatchMatrix,
  evalRule: evalRule,
  getByPath: getByPath
};
