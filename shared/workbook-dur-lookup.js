'use strict';

/**
 * Strict operational dur lookup: dur_windows.json workbook_windows only.
 * Selection rule: exactly one row with dur_start <= as_of <= dur_end (per city after normalization).
 * Next: following row in same city sorted by dur_start (ISO), then (year, dur_index).
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

/**
 * Whitespace, tatweel, and optional alef/alef-hamza unification for city KEY matching.
 * Does not modify meaning for unrelated letters.
 */
function normalizeWorkbookCityKey(value) {
  var s = nfcString(value);
  if (!s) return '';
  s = s.replace(/\u0640/g, ''); // tatweel
  s = s.replace(/\s+/g, ''); // join tokens so e.g. "أبو ظبي" matches "أبوظبي"
  // Unify common alef + hamza to plain alef (city name keys; conservative)
  s = s.replace(/[\u0623\u0625\u0622]/g, '\u0627');
  return s;
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

/**
 * @param {Array} workbookWindows
 * @returns {object} map: normalizedKey -> canonical city string (first occurrence in data)
 */
function buildWorkbookCityCatalog(workbookWindows) {
  var map = Object.create(null);
  if (!Array.isArray(workbookWindows)) return map;
  var i;
  for (i = 0; i < workbookWindows.length; i += 1) {
    var r = workbookWindows[i];
    if (!r || r.city == null) continue;
    var canon = nfcString(r.city);
    if (!canon) continue;
    var k = normalizeWorkbookCityKey(canon);
    if (!k) continue;
    if (map[k] == null) map[k] = canon;
  }
  return map;
}

/**
 * @param {object} station
 * @param {object} cityCatalog
 * @returns {{ ok: true, key: string, canonical: string } | { ok: false, code: string, input: string, key: string } }
 */
function resolveStationWorkbookCity(station, cityCatalog) {
  var name = getStationWorkbookCityName(station);
  if (!name) {
    return { ok: false, code: 'NO_WORKBOOK_CITY', input: '', key: '' };
  }
  var k = normalizeWorkbookCityKey(name);
  if (!k) {
    return { ok: false, code: 'WORKBOOK_CITY_EMPTY', input: name, key: '' };
  }
  if (cityCatalog[k] == null) {
    return { ok: false, code: 'WORKBOOK_CITY_UNMAPPED', input: name, key: k };
  }
  return { ok: true, key: k, canonical: cityCatalog[k] };
}

/**
 * @param {Array<object>} workbookWindows
 * @param {string} cityKey — normalized key (must match buildWorkbookCityCatalog)
 * @param {string} asOfIso
 * @returns
 *  | { ok: true, current: object, next: object|null, cityRows: object[] }
 *  | { ok: false, code: string, input?: string, count?: number, rows?: object[] }
 */
function findWorkbookCurrentNextStrict(workbookWindows, cityKey, asOfIso) {
  if (!Array.isArray(workbookWindows) || !asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) {
    return { ok: false, code: 'BAD_INPUT' };
  }
  if (!cityKey) {
    return { ok: false, code: 'NO_CITY' };
  }
  var same = workbookWindows.filter(function (r) {
    if (!r || r.city == null) return false;
    return normalizeWorkbookCityKey(r.city) === cityKey;
  });
  if (!same.length) {
    return { ok: false, code: 'NO_ROWS_FOR_CITY' };
  }
  same.sort(function (a, b) {
    var c = String(a.dur_start).localeCompare(String(b.dur_start));
    if (c !== 0) return c;
    c = Number(a.year) - Number(b.year);
    if (c !== 0) return c;
    return Number(a.dur_index) - Number(b.dur_index);
  });

  var containing = same.filter(function (r) {
    if (!r.dur_start || !r.dur_end) return false;
    return asOfIso >= r.dur_start && asOfIso <= r.dur_end;
  });
  if (containing.length === 0) {
    return { ok: false, code: 'NO_WINDOW_CONTAINS_DATE', as_of: asOfIso };
  }
  if (containing.length > 1) {
    return { ok: false, code: 'DUPLICATE_CONTAINING_ROWS', count: containing.length, rows: containing };
  }
  var current = containing[0];
  var idx = -1;
  var i;
  for (i = 0; i < same.length; i += 1) {
    if (rowIdentityEqual(same[i], current)) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    return { ok: false, code: 'CURRENT_NOT_IN_CITY_LIST' };
  }
  var nxt = idx + 1 < same.length ? same[idx + 1] : null;
  return { ok: true, current: current, next: nxt, cityRows: same };
}

function rowIdentityEqual(a, b) {
  if (!a || !b) return false;
  if (String(a.dur_start) !== String(b.dur_start)) return false;
  if (String(a.dur_end) !== String(b.dur_end)) return false;
  if (String(a.year) !== String(b.year)) return false;
  if (String(a.dur_index) !== String(b.dur_index)) return false;
  return true;
}

/**
 * @param {object} row
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
 * @returns {string} raw city string for catalog lookup (name preferred, else key)
 */
function getStationWorkbookCityName(station) {
  if (!station) return '';
  var n = normalizeString(station.workbook_city_name);
  if (n) return n;
  return normalizeString(station.workbook_city_key);
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
  normalizeWorkbookCityKey: normalizeWorkbookCityKey,
  buildWorkbookCityCatalog: buildWorkbookCityCatalog,
  resolveStationWorkbookCity: resolveStationWorkbookCity,
  findWorkbookCurrentNextStrict: findWorkbookCurrentNextStrict,
  getStationWorkbookCityName: getStationWorkbookCityName,
  computeDayMetricsForWorkbookRow: computeDayMetricsForWorkbookRow,
  buildResolvedSnapshotShapeFromWorkbookRow: buildResolvedSnapshotShapeFromWorkbookRow,
  parseIsoDateUtcMidnight: parseIsoDateUtcMidnight,
  toNumber: toNumber
};
