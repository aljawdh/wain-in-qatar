'use strict';

var C = require('./constants');

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

function hasText(v) {
  return String(v == null ? '' : v).trim().length > 0;
}

/**
 * Rule-based marine environment zone — no invented data.
 * @param {object} station
 * @returns {{ zone: string, confidence: number, reasons: string[] }}
 */
function classifyStationZone(station) {
  var reasons = [];
  if (!station || typeof station !== 'object') {
    return { zone: 'unknown', confidence: 0, reasons: ['no_station_object'] };
  }

  var lat = Number(station.lat);
  var lon = Number(station.lon != null ? station.lon : station.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { zone: 'unknown', confidence: 0, reasons: ['missing_coordinates'] };
  }

  var fishingMode = norm(station.fishing_mode);
  var depthProfile = norm(station.depth_profile);
  var seabed = norm(station.seabed_type);
  var localArea = norm(station.local_area);
  var tags = Array.isArray(station.tags) ? station.tags.map(norm) : [];
  var radius = Number(station.default_radius);
  var isRef = !!station.is_reference_station;

  if (fishingMode === 'deep') {
    reasons.push('fishing_mode_deep');
    return { zone: 'deep_future', confidence: 72, reasons: reasons };
  }

  if (seabed.indexOf('reef') >= 0 || seabed.indexOf('rock') >= 0 || seabed.indexOf('صخر') >= 0 || seabed.indexOf('شعاب') >= 0) {
    reasons.push('seabed_reef_or_rock');
    return { zone: 'reef_or_rock', confidence: 70, reasons: reasons };
  }

  if (localArea.indexOf('جزير') >= 0 || tags.indexOf('island') >= 0) {
    reasons.push('local_area_island');
    return { zone: 'island_coast', confidence: 65, reasons: reasons };
  }

  if (depthProfile.indexOf('deep') >= 0 || depthProfile.indexOf('عميق') >= 0) {
    reasons.push('depth_profile_deep');
    return { zone: 'open_water', confidence: 60, reasons: reasons };
  }

  if (depthProfile.indexOf('shallow') >= 0 || depthProfile.indexOf('ضحل') >= 0) {
    reasons.push('depth_profile_shallow');
    return { zone: 'shallow', confidence: 62, reasons: reasons };
  }

  if (Number.isFinite(radius) && radius <= 0.015) {
    reasons.push('tight_default_radius');
    return { zone: 'shallow', confidence: 55, reasons: reasons };
  }

  if (Number.isFinite(radius) && radius >= 0.04) {
    reasons.push('wide_default_radius');
    return { zone: 'open_water', confidence: 52, reasons: reasons };
  }

  if (fishingMode === 'coastal' || !hasText(fishingMode)) {
    reasons.push(isRef ? 'reference_coastal_default' : 'operational_coastal_default');
    return { zone: 'coast', confidence: hasText(fishingMode) ? 58 : 45, reasons: reasons };
  }

  reasons.push('insufficient_classification_signals');
  return { zone: 'unknown', confidence: 0, reasons: reasons };
}

module.exports = {
  classifyStationZone: classifyStationZone
};
