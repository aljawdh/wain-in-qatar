'use strict';

/**
 * Maps shared/resolved-station-dur-snapshot.js to durInfo shape for analyzeLiveStation.
 * When this returns non-null, the engine must NOT call buildDurTimeline.
 */

var getResolvedLocalDurSnapshot = require('./resolved-station-dur-snapshot').getResolvedLocalDurSnapshot;

/**
 * @param {object} referenceData normalized (must include station_dur_windows, durur_reference)
 * @param {object} station normalized station with id
 * @param {Date} analysisDate UTC day (as_of = analysisDate.toISOString().slice(0, 10))
 * @returns {object | null}
 */
function buildResolvedLocalDurTimelineInfo(referenceData, station, analysisDate) {
  var asOfIso = analysisDate && analysisDate.toISOString
    ? analysisDate.toISOString().slice(0, 10)
    : '';
  var sid = (function (s) {
    return String(s == null ? '' : s).trim();
  })(station && station.id);
  if (!asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso) || !sid) return null;

  var snap = getResolvedLocalDurSnapshot({
    station_dur_windows: referenceData && referenceData.station_dur_windows,
    stationId: sid,
    asOfIso: asOfIso,
    durur_reference: referenceData && referenceData.durur_reference
  });
  if (!snap) return null;

  return {
    current: snap.current,
    next: snap.next,
    timeline: null,
    suhail_anchor: snap.suhail_anchor,
    cycle_start: snap.cycle_start,
    timing_source: 'resolved_local_station_windows',
    timing_source_label_ar: 'نوافذ الدور المحلية (المصنف التشغيلي)',
    timing_as_of: asOfIso,
    timing_from_resolved_local: true,
    calibration_reference_station: null,
    calibration_latitude_band_key: null,
    calibration_selection_reason: 'resolved_from_station_dur_windows',
    calibration_delta_days: 0,
    base_suhail_anchor: snap.base_suhail_anchor,
    resolved_window_snapshot: snap.resolved_window_snapshot
  };
}

module.exports = {
  buildResolvedLocalDurTimelineInfo: buildResolvedLocalDurTimelineInfo,
  getResolvedLocalDurSnapshot: getResolvedLocalDurSnapshot
};
