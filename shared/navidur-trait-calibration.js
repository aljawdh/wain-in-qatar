/**
 * Scoped trait calibration for NAVIDUR (KV-backed, never mutates durur_master).
 * Scope: reference_station_id + dur name + phase + depth_mode (operational stations inherit).
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.NavidurTraitCalibration = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizePart(v) {
    return String(v == null ? '' : v).trim();
  }

  /**
   * Stable key for one calibration document (navidur_store_trait_calibration.scopes).
   * reference_station_id only (no per-operational scope).
   */
  function buildTraitCalibrationScopeKey(parts) {
    var p = parts && typeof parts === 'object' ? parts : {};
    var rid = normalizePart(p.reference_station_id);
    var dur = normalizePart(p.dur_name_ar);
    var phase = normalizePart(p.phase_id);
    var depth = normalizePart(p.depth_mode) || 'coastal';
    return [rid, dur, phase, depth].join('|');
  }

  /** Pre–reference-only keys: station_id|reference_station_id|dur|phase|depth */
  function buildLegacyTraitCalibrationScopeKey(parts) {
    var p = parts && typeof parts === 'object' ? parts : {};
    var sid = normalizePart(p.station_id);
    var rid = normalizePart(p.reference_station_id);
    var dur = normalizePart(p.dur_name_ar);
    var phase = normalizePart(p.phase_id);
    var depth = normalizePart(p.depth_mode) || 'coastal';
    return [sid, rid, dur, phase, depth].join('|');
  }

  function uniqueStrings(list) {
    var out = [];
    var arr = Array.isArray(list) ? list : [];
    for (var i = 0; i < arr.length; i++) {
      var s = normalizePart(arr[i]);
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  }

  function traitNamesFromCalibrationEntries(entries) {
    var out = [];
    var arr = Array.isArray(entries) ? entries : [];
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      var n = e && e.trait_name != null ? normalizePart(e.trait_name) : '';
      if (n && out.indexOf(n) < 0) out.push(n);
    }
    return out;
  }

  /**
   * @param {string[]} unifiedTraits — from engine unified_expected_traits
   * @param {object|null} scopeDoc — one scopes[key] or null
   * @returns {string[]}
   */
  function applyCalibrationToUnified(unifiedTraits, scopeDoc) {
    var base = uniqueStrings(unifiedTraits);
    if (!scopeDoc || typeof scopeDoc !== 'object') return base;
    var excludedEntries = (scopeDoc.excluded_traits || []).filter(function (x) {
      return !x || !x.status || String(x.status || '').toLowerCase() === 'excluded';
    });
    var excluded = traitNamesFromCalibrationEntries(excludedEntries);
    var confirmed = (scopeDoc.confirmed_traits || []).filter(function (x) {
      return x && String(x.status || '').toLowerCase() === 'confirmed';
    });
    var confirmedNames = traitNamesFromCalibrationEntries(confirmed);
    var out = base.filter(function (t) {
      return excluded.indexOf(t) < 0;
    });
    for (var i = 0; i < confirmedNames.length; i++) {
      var c = confirmedNames[i];
      if (c && out.indexOf(c) < 0) out.push(c);
    }
    return uniqueStrings(out);
  }

  return {
    buildTraitCalibrationScopeKey: buildTraitCalibrationScopeKey,
    buildLegacyTraitCalibrationScopeKey: buildLegacyTraitCalibrationScopeKey,
    applyCalibrationToUnified: applyCalibrationToUnified,
    uniqueStrings: uniqueStrings
  };
});
