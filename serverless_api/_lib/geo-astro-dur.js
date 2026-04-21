'use strict';

/**
 * Phase 1 – read-only helpers for the geo-astronomical temporal layer.
 * No runtime coupling to the legacy engine; safe when data is incomplete.
 */

/**
 * @param {object} station
 * @returns {string|null}
 */
function getStationBandKey(station) {
  if (!station || typeof station !== 'object') return null;
  var k = station.latitude_band_key;
  if (k == null || k === '') return null;
  var s = String(k).trim();
  return s || null;
}

/**
 * @param {string} a - YYYY-MM-DD
 * @param {string} b - YYYY-MM-DD
 * @returns {number}
 */
function compareIsoDate(a, b) {
  return String(a).localeCompare(String(b));
}

/**
 * @param {object} windowRow
 * @param {string} isoDate
 * @returns {boolean}
 */
function isoDateInWindow(windowRow, isoDate) {
  if (!windowRow || !isoDate) return false;
  var sd = windowRow.start_date;
  var ed = windowRow.end_date;
  if (!sd || !ed) return false;
  return compareIsoDate(isoDate, sd) >= 0 && compareIsoDate(isoDate, ed) <= 0;
}

/**
 * Inspect pre-generated dur_windows for a band/year and resolve current window for a calendar day.
 *
 * @param {{ bands?: object }} durWindowsDoc – contents of dur_windows.json
 * @param {string} latitudeBandKey
 * @param {number|string} year
 * @param {string} isoDate – YYYY-MM-DD (typically “today” in chosen TZ at admin)
 * @returns {{ incomplete: boolean, reason?: string, active_window?: object|null, latitude_band_key: string|null, year: number|null }}
 */
function deriveCurrentDurStateFromWindows(durWindowsDoc, latitudeBandKey, year, isoDate) {
  var doc = durWindowsDoc && typeof durWindowsDoc === 'object' ? durWindowsDoc : {};
  if (doc.incomplete) {
    return {
      incomplete: true,
      reason: doc.incomplete_reason || 'dur_windows_incomplete_flag',
      active_window: null,
      latitude_band_key: latitudeBandKey || null,
      year: year != null ? Number(year) : null
    };
  }
  var bandKey = latitudeBandKey ? String(latitudeBandKey).trim() : '';
  var y = year != null ? Number(year) : NaN;
  if (!bandKey || !Number.isFinite(y)) {
    return {
      incomplete: true,
      reason: 'missing_band_or_year',
      active_window: null,
      latitude_band_key: bandKey || null,
      year: Number.isFinite(y) ? y : null
    };
  }

  var bandsRoot = doc.bands && typeof doc.bands === 'object' ? doc.bands : {};
  var bandPayload = bandsRoot[bandKey];
  if (!bandPayload || typeof bandPayload !== 'object') {
    return {
      incomplete: true,
      reason: 'unknown_band_or_not_generated',
      active_window: null,
      latitude_band_key: bandKey,
      year: y
    };
  }

  if (bandPayload.incomplete) {
    return {
      incomplete: true,
      reason: bandPayload.skip_reason || bandPayload.incomplete_reason || 'band_incomplete',
      active_window: null,
      latitude_band_key: bandKey,
      year: y
    };
  }

  var yearsMap = bandPayload.years && typeof bandPayload.years === 'object' ? bandPayload.years : {};
  var yearPayload = yearsMap[String(y)];
  if (!yearPayload || !Array.isArray(yearPayload.windows)) {
    return {
      incomplete: true,
      reason: 'year_not_generated',
      active_window: null,
      latitude_band_key: bandKey,
      year: y
    };
  }

  var windows = yearPayload.windows;
  var hit = windows.find(function (w) {
    return isoDateInWindow(w, isoDate);
  });

  return {
    incomplete: false,
    active_window: hit || null,
    latitude_band_key: bandKey,
    year: y
  };
}

module.exports = {
  getStationBandKey,
  deriveCurrentDurStateFromWindows,
  isoDateInWindow
};
