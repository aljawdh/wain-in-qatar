'use strict';

/**
 * Derive Gregorian dur preview from imported workbook_windows rows (admin-only).
 */

var MS_PER_DAY = 86400000;

function parseIsoToUtcNoon(iso) {
  var m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var d = Number(m[3]);
  var t = Date.UTC(y, mo - 1, d, 12, 0, 0);
  if (Number.isNaN(t)) return null;
  return t;
}

function diffDaysInclusive(startIso, endIso) {
  var a = parseIsoToUtcNoon(startIso);
  var b = parseIsoToUtcNoon(endIso);
  if (a == null || b == null || b < a) return null;
  return Math.floor((b - a) / MS_PER_DAY) + 1;
}

/**
 * @param {object[]} allRows — full workbook_windows array
 * @param {string} cityName — display or key-matching name
 * @param {number} year
 * @returns {object[]}
 */
function filterWindowsForCityYear(allRows, cityName, year) {
  var norm = String(cityName || '').trim().normalize('NFC');
  var y = Number(year);
  if (!norm || !Number.isFinite(y)) return [];
  return allRows.filter(function (w) {
    if (!w) return false;
    return (
      String(w.city || '').trim().normalize('NFC') === norm &&
      Number(w.year) === y
    );
  }).sort(function (a, b) {
    return Number(a.dur_index) - Number(b.dur_index);
  });
}

/**
 * @param {object[]} yearRows — 28 rows for one city/year
 * @param {string} isoDate — YYYY-MM-DD
 */
function deriveWorkbookDurPreviewForDate(yearRows, isoDate) {
  if (!yearRows.length) {
    return {
      ok: false,
      reason: 'no_windows_for_city_year',
      source: 'workbook_import',
      active: null,
      next: null,
      day_in_dur: null
    };
  }

  var t = parseIsoToUtcNoon(isoDate);
  if (t == null) {
    return {
      ok: false,
      reason: 'bad_iso_date',
      source: 'workbook_import',
      active: null,
      next: null,
      day_in_dur: null
    };
  }

  var sorted = yearRows.slice().sort(function (a, b) {
    return Number(a.dur_index) - Number(b.dur_index);
  });

  /** @type {object|null} */
  var active = null;
  var dayIn = null;

  for (var i = 0; i < sorted.length; i++) {
    var w = sorted[i];
    var s = parseIsoToUtcNoon(w.dur_start);
    var e = parseIsoToUtcNoon(w.dur_end);
    if (s == null || e == null) continue;
    if (t >= s && t <= e) {
      active = w;
      dayIn = diffDaysInclusive(w.dur_start, isoDate);
      break;
    }
  }

  /** @type {object|null} */
  var next = null;
  if (active) {
    next =
      sorted.find(function (w) {
        return Number(w.dur_index) === Number(active.dur_index) + 1;
      }) || null;
  }

  return {
    ok: !!active,
    reason: active ? null : 'date_outside_workbook_windows',
    source: 'workbook_import',
    active: active,
    next: next,
    day_in_dur: dayIn,
    iso_date: isoDate
  };
}

module.exports = {
  filterWindowsForCityYear,
  deriveWorkbookDurPreviewForDate,
  parseIsoToUtcNoon
};
