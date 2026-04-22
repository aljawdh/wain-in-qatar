'use strict';

/**
 * Maps getResolvedLocalDurSnapshot (operational workbook only) to durInfo for analyzeLiveStation.
 * When non-null, engine must NOT call buildDurTimeline / resolveTimingCalibration.
 */

var getResolvedLocalDurSnapshot = require('./resolved-station-dur-snapshot').getResolvedLocalDurSnapshot;

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * @param {object} referenceData normalized
 * @param {object} station normalized
 * @param {Date} analysisDate UTC day
 * @returns {object | null}
 */
function buildResolvedLocalDurTimelineInfo(referenceData, station, analysisDate) {
  var asOfIso = analysisDate && analysisDate.toISOString
    ? analysisDate.toISOString().slice(0, 10)
    : '';
  if (!asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) return null;

  var snap = getResolvedLocalDurSnapshot({
    station: station,
    stationId: normalizeString(station && station.id),
    asOfIso: asOfIso,
    durur_reference: referenceData && referenceData.durur_reference,
    workbook_windows: (referenceData && referenceData.workbook_windows) || []
  });
  if (!snap) return null;

  return {
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
  };
}

module.exports = {
  buildResolvedLocalDurTimelineInfo: buildResolvedLocalDurTimelineInfo,
  getResolvedLocalDurSnapshot: getResolvedLocalDurSnapshot
};
