'use strict';

/**
 * Maps getResolvedLocalDurSnapshot (operational workbook only) to durInfo for analyzeLiveStation.
 * When workbook city is set, legacy buildDurTimeline must NOT be used (success or explicit error only).
 */

var getResolvedLocalDurSnapshot = require('./resolved-station-dur-snapshot').getResolvedLocalDurSnapshot;

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function getStationWorkbookCityRaw(station) {
  var n = normalizeString(station && station.workbook_city_name);
  if (n) return n;
  return normalizeString(station && station.workbook_city_key);
}

/**
 * @param {object} referenceData normalized
 * @param {object} station normalized
 * @param {Date} analysisDate UTC day
 * @returns
 *  | null — no workbook_city_name: caller should use buildDurTimeline
 *  | { ok: true, durInfo: object }
 *  | { ok: false, error: object } — city set but lookup failed; no legacy
 */
function buildResolvedLocalDurTimelineInfo(referenceData, station, analysisDate) {
  var asOfIso = analysisDate && analysisDate.toISOString
    ? analysisDate.toISOString().slice(0, 10)
    : '';
  if (!asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) {
    if (!getStationWorkbookCityRaw(station)) return null;
    return { ok: false, error: { code: 'INVALID_AS_OF', message: 'invalid analysis date' } };
  }

  if (!getStationWorkbookCityRaw(station)) return null;

  var snap = getResolvedLocalDurSnapshot({
    station: station,
    stationId: normalizeString(station && station.id),
    asOfIso: asOfIso,
    durur_reference: (referenceData && referenceData.durur_reference) || [],
    workbook_windows: (referenceData && referenceData.workbook_windows) || []
  });

  if (snap && snap.error) {
    return { ok: false, error: snap.error };
  }
  if (!snap) {
    return { ok: false, error: { code: 'UNEXPECTED_NULL_SNAP', message: 'workbook path returned null' } };
  }

  return {
    ok: true,
    durInfo: {
      current: snap.current,
      next: snap.next,
      timeline: null,
      suhail_anchor: snap.suhail_anchor,
      cycle_start: snap.cycle_start,
      timing_source: 'operational_workbook',
      timing_source_label_ar: 'المصنف التشغيلي (dur_windows.json)',
      timing_as_of: asOfIso,
      timing_from_resolved_local: true,
      timing_from_operational_workbook: true,
      calibration_reference_station: null,
      calibration_latitude_band_key: null,
      calibration_selection_reason: 'operational_workbook_direct',
      calibration_delta_days: 0,
      base_suhail_anchor: snap.base_suhail_anchor,
      resolved_window_snapshot: snap.resolved_window_snapshot
    }
  };
}

module.exports = {
  buildResolvedLocalDurTimelineInfo: buildResolvedLocalDurTimelineInfo,
  getResolvedLocalDurSnapshot: getResolvedLocalDurSnapshot
};
