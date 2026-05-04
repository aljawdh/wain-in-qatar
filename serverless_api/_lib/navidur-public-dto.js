'use strict';

/**
 * Strips internal dur trait payloads from analysis DTOs returned to public clients.
 * Internal learning uses the same engine output server-side before sanitization.
 */

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function stripTraitArraysFromReferenceBlock(ref) {
  if (!ref || typeof ref !== 'object') return ref;
  var out = Object.assign({}, ref);
  delete out.general_traits;
  delete out.weather_traits;
  delete out.marine_traits;
  delete out.fish_traits;
  delete out.seasonal_traits;
  return out;
}

function stripDurTraitsForPublic(dur) {
  if (!dur || typeof dur !== 'object') return dur;
  var d = Object.assign({}, dur);
  delete d.unified_expected_traits;
  delete d.internal_trait_signals;
  if (d.reference) d.reference = stripTraitArraysFromReferenceBlock(d.reference);
  if (d.active_phase_reference) d.active_phase_reference = stripTraitArraysFromReferenceBlock(d.active_phase_reference);
  if (d.tf_reference) d.tf_reference = stripTraitArraysFromReferenceBlock(d.tf_reference);
  return d;
}

function buildPublicNavidurSummary(dto) {
  var env = dto && dto.environment ? dto.environment : {};
  var tide = dto && dto.tide ? dto.tide : {};
  var fish = dto && dto.fishing ? dto.fishing : {};
  var wave = env.wave_height_m != null ? Number(env.wave_height_m) : null;
  var wind = env.wind_speed_kmh != null ? Number(env.wind_speed_kmh) : null;
  var seaParts = [];
  if (wave != null) seaParts.push('ارتفاع الموج تقريباً ' + wave.toFixed(1) + ' م');
  if (wind != null) seaParts.push('الرياح تقريباً ' + Math.round(wind) + ' كم/س');
  var tideLabel = tide.state === 'LOAD' ? 'حمل' : tide.state === 'FASAD' ? 'فساد' : tide.state ? String(tide.state) : '';
  if (tideLabel) seaParts.push('المد: ' + tideLabel);
  var sea_state_ar = seaParts.length ? seaParts.join(' — ') : 'حالة البحر: غير مكتملة';
  var fishing_recommendation_ar = String(fish.advice_text || '').trim() || (fish.is_recommended ? 'يُنصح بالصيد بحذر وفق الحالة.' : 'الصيد غير مفضل حالياً.');
  var decision_brief_ar = fish.is_recommended ? 'الوضع الحالي يسمح بالصيد مع الالتزام بالسلامة.' : 'الوضع الحالي يتطلب الحذر أو التأجيل.';
  var alert_ar = '';
  if (env.no_marine_data_for_date) alert_ar = 'لا تتوفر بيانات بحرية كاملة لهذا التاريخ.';
  return {
    decision_brief_ar: decision_brief_ar,
    sea_state_ar: sea_state_ar,
    fishing_recommendation_ar: fishing_recommendation_ar,
    alert_ar: alert_ar,
    is_recommended: !!fish.is_recommended,
    confidence_score: fish.confidence_score != null ? Number(fish.confidence_score) : null
  };
}

function sanitizePublicNavidurDto(dto) {
  if (!dto || typeof dto !== 'object') return dto;
  var out = Object.assign({}, dto);
  out.dur = stripDurTraitsForPublic(out.dur);
  out.public_navidur_summary = buildPublicNavidurSummary(out);
  delete out.field_validation;
  delete out.internal_trait_signals;
  return out;
}

/** Server-side only (stripped before public JSON); built from engine unified traits + observed. */
function buildInternalTraitSignalsFromDto(dto) {
  try {
    if (typeof require === 'function') {
      var snapV = require('../../shared/navidur-snapshot-validation');
      var vr0 = snapV.buildValidationResult(dto, null, null);
      if (vr0 && vr0.comparison_mode === 'no_reference') {
        return [];
      }
    }
  } catch (_nr) { /* continue with unified path */ }
  var dur = dto && dto.dur ? dto.dur : {};
  var unified = toArray(dur.unified_expected_traits);
  var observed = [];
  try {
    if (typeof require === 'function') {
      var snap = require('../../shared/navidur-snapshot-validation');
      observed = toArray(snap.deriveObservedTraitsFromDto(dto));
    }
  } catch (_e) {
    observed = [];
  }
  var matched = unified.filter(function (t) {
    return observed.indexOf(t) >= 0;
  });
  var failed = unified.filter(function (t) {
    return observed.indexOf(t) < 0;
  });
  var extra = observed.filter(function (t) {
    return unified.indexOf(t) < 0;
  });
  var out = [];
  matched.forEach(function (name) {
    out.push({ trait_name: name, kind: 'matched', channel: 'internal_trait_signal' });
  });
  failed.forEach(function (name) {
    out.push({ trait_name: name, kind: 'failed', channel: 'internal_trait_signal' });
  });
  extra.forEach(function (name) {
    out.push({ trait_name: name, kind: 'extra', channel: 'internal_trait_signal' });
  });
  return out;
}

module.exports = {
  sanitizePublicNavidurDto: sanitizePublicNavidurDto,
  buildPublicNavidurSummary: buildPublicNavidurSummary,
  buildInternalTraitSignalsFromDto: buildInternalTraitSignalsFromDto
};
