'use strict';

/**
 * Direct operational dur window lookup from dur_windows.json workbook_windows
 * (imported from data/navidur_operational_durur_2025_2026.xlsx sheet نوافذ_الدرور).
 * No recomputation, no station_dur_windows generation — row truth only.
 */

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function nfcString(value) {
  var raw = normalizeString(value);
  try {
    return raw.normalize ? raw.normalize('NFC') : raw;
  } catch (_err) {
    return raw;
  }
}

function toNumber(value) {
  var n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseIsoDateUtcMidnight(iso) {
  var m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0));
}

function getDaysBetweenInclusiveUtc(startIso, endIso) {
  var a = parseIsoDateUtcMidnight(startIso);
  var b = parseIsoDateUtcMidnight(endIso);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

/**
 * @param {Array<object>} workbookWindows
 * @param {string} cityName Arabic city name (must match catalog row.city)
 * @param {string} asOfIso YYYY-MM-DD
 * @returns {{ current: object, next: object|null, cityRows: object[] } | null}
 */
function findWorkbookCurrentNext(workbookWindows, cityName, asOfIso) {
  if (!Array.isArray(workbookWindows) || !asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) return null;
  var cTarget = nfcString(cityName);
  if (!cTarget) return null;
  var same = workbookWindows.filter(function (r) {
    return r && nfcString(r.city) === cTarget;
  });
  if (!same.length) return null;
  same.sort(function (a, b) {
    return String(a.dur_start).localeCompare(String(b.dur_start));
  });
  var i;
  for (i = 0; i < same.length; i += 1) {
    var row = same[i];
    if (!row.dur_start || !row.dur_end) continue;
    if (asOfIso >= row.dur_start && asOfIso <= row.dur_end) {
      var nxt = i + 1 < same.length ? same[i + 1] : null;
      return { current: row, next: nxt, cityRows: same };
    }
  }
  return null;
}

/**
 * @param {object} row — workbook_windows row
 * @param {string} asOfIso
 */
function computeDayMetricsForWorkbookRow(row, asOfIso) {
  if (!row || !asOfIso) return { day_in_dur: null, days_remaining_in_dur: null };
  var s = row.dur_start;
  var e = row.dur_end;
  if (!s || !e) return { day_in_dur: null, days_remaining_in_dur: null };
  var asMs = parseIsoDateUtcMidnight(asOfIso);
  var sMs = parseIsoDateUtcMidnight(s);
  var eMs = parseIsoDateUtcMidnight(e);
  if (!asMs || !sMs || !eMs) return { day_in_dur: null, days_remaining_in_dur: null };
  var dayIn = Math.floor((asMs.getTime() - sMs.getTime()) / 86400000) + 1;
  var daysRem = Math.max(0, Math.round((eMs.getTime() - asMs.getTime()) / 86400000));
  return { day_in_dur: dayIn, days_remaining_in_dur: daysRem };
}

/**
 * @param {object} station
 * @returns {string} city name for workbook match
 */
function getStationWorkbookCityName(station) {
  if (!station) return '';
  var name = normalizeString(station.workbook_city_name);
  if (name) return name;
  return '';
}

function buildResolvedSnapshotShapeFromWorkbookRow(currentRow, nextRow, asOfIso, metrics) {
  var nextName = nextRow ? normalizeString(nextRow.dur_name_ar) : null;
  var nextId = nextRow && nextRow.dur_index != null ? 'wb_' + String(nextRow.year) + '_' + String(nextRow.dur_index) : null;
  return {
    dur_id: currentRow.dur_index != null ? 'wb_' + String(currentRow.year) + '_' + String(currentRow.dur_index) : null,
    dur_name_ar: normalizeString(currentRow.dur_name_ar),
    day_in_dur: metrics.day_in_dur,
    start_date: currentRow.dur_start,
    end_date: currentRow.dur_end,
    days_remaining_in_dur: metrics.days_remaining_in_dur,
    next_dur_id: nextId,
    next_dur_name_ar: nextName
  };
}

module.exports = {
  findWorkbookCurrentNext: findWorkbookCurrentNext,
  getStationWorkbookCityName: getStationWorkbookCityName,
  computeDayMetricsForWorkbookRow: computeDayMetricsForWorkbookRow,
  buildResolvedSnapshotShapeFromWorkbookRow: buildResolvedSnapshotShapeFromWorkbookRow,
  parseIsoDateUtcMidnight: parseIsoDateUtcMidnight,
  getDaysBetweenInclusiveUtc: getDaysBetweenInclusiveUtc,
  toNumber: toNumber
};
