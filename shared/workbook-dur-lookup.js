'use strict';

/**
 * Operational dur lookup: dur_windows.json workbook_windows only.
 * City: strict key match.
 * Containment: MM-DD only (year-agnostic) with wrap for windows that cross year.
 * Next: next distinct seasonal window for the same city (circular, year not used in ordering).
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

function normalizeWorkbookCityKey(value) {
  var s = nfcString(value);
  if (!s) return '';
  s = s.replace(/\u0640/g, '');
  s = s.replace(/\s+/g, '');
  s = s.replace(/[\u0623\u0625\u0622]/g, '\u0627');
  return s;
}

function toNumber(value) {
  var n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseIsoYmd(iso) {
  var m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function parseIsoDateUtcMidnight(iso) {
  var p = parseIsoYmd(iso);
  if (!p) return null;
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0, 0));
}

/** Month and day to sort key; use monotonic within calendar (not for wrap). */
function monthDayKey(m, d) {
  return m * 100 + d;
}

/**
 * Fixed leap year 2004 for day-of-year so Feb 29 exists.
 * @returns {number} 1..366
 */
function dayOfYear2004(m, d) {
  return (
    Math.floor(
      (Date.UTC(2004, m - 1, d, 0, 0, 0, 0) - Date.UTC(2004, 0, 1, 0, 0, 0, 0)) / 86400000
    ) + 1
  );
}

function ymdFromIso(iso) {
  var p = parseIsoYmd(iso);
  if (!p) return null;
  return p;
}

/**
 * as_of (month,day) in [dur_start, dur_end] on seasonal calendar, ignoring years on bounds.
 * Supports ranges that cross calendar year (e.g. Nov 1 → Mar 15).
 */
function isMonthDayInSeasonalWindow(asM, asD, startIso, endIso) {
  if (!asM || !asD) return false;
  var s = ymdFromIso(startIso);
  var e = ymdFromIso(endIso);
  if (!s || !e) return false;
  var vk = monthDayKey(asM, asD);
  var sk = monthDayKey(s.m, s.d);
  var ek = monthDayKey(e.m, e.d);
  if (sk <= ek) {
    return vk >= sk && vk <= ek;
  }
  return vk >= sk || vk <= ek;
}

/**
 * Fingerprint of seasonal window + name (ignores year on row).
 */
function seasonalRowFingerprint(r) {
  if (!r || !r.dur_start || !r.dur_end) return '';
  var a = ymdFromIso(r.dur_start);
  var b = ymdFromIso(r.dur_end);
  if (!a || !b) return '';
  return [a.m, a.d, b.m, b.d, normalizeString(r.dur_name_ar)].join(':');
}

/**
 * @returns { day_in_dur: number|null, days_remaining_in_dur: number|null }
 * Uses only MM-DD; span uses leap reference for length.
 */
function computeDayMetricsForWorkbookRow(row, asOfIso) {
  if (!row || !asOfIso) return { day_in_dur: null, days_remaining_in_dur: null };
  var a = ymdFromIso(asOfIso);
  var s = ymdFromIso(row.dur_start);
  var e = ymdFromIso(row.dur_end);
  if (!a || !s || !e) return { day_in_dur: null, days_remaining_in_dur: null };
  if (!isMonthDayInSeasonalWindow(a.m, a.d, row.dur_start, row.dur_end)) {
    return { day_in_dur: null, days_remaining_in_dur: null };
  }
  var S = dayOfYear2004(s.m, s.d);
  var A = dayOfYear2004(a.m, a.d);
  var E = dayOfYear2004(e.m, e.d);
  var dayIn;
  var daysRem;
  if (S <= E) {
    dayIn = A - S + 1;
    daysRem = E - A;
  } else {
    if (A >= S) {
      dayIn = A - S + 1;
      daysRem = 366 - A + E;
    } else if (A <= E) {
      dayIn = 366 - S + 1 + (A - 1);
      daysRem = E - A;
    } else {
      return { day_in_dur: null, days_remaining_in_dur: null };
    }
  }
  if (dayIn < 1) return { day_in_dur: null, days_remaining_in_dur: null };
  if (daysRem < 0) daysRem = 0;
  return { day_in_dur: dayIn, days_remaining_in_dur: daysRem };
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
 * @param {string} cityKey
 * @param {string} asOfIso YYYY-MM-DD (Gregorian; only MM-DD used for match)
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
  var asParts = ymdFromIso(asOfIso);
  if (!asParts) {
    return { ok: false, code: 'BAD_INPUT' };
  }
  var asY = asParts.y;
  var asM = asParts.m;
  var asD = asParts.d;

  var same = workbookWindows.filter(function (r) {
    if (!r || r.city == null) return false;
    return normalizeWorkbookCityKey(r.city) === cityKey;
  });
  if (!same.length) {
    return { ok: false, code: 'NO_ROWS_FOR_CITY' };
  }

  var containing = same.filter(function (r) {
    if (!r.dur_start || !r.dur_end) return false;
    return isMonthDayInSeasonalWindow(asM, asD, r.dur_start, r.dur_end);
  });
  if (containing.length === 0) {
    return { ok: false, code: 'NO_WINDOW_CONTAINS_DATE', as_of: asOfIso };
  }
  if (containing.length > 1) {
    containing.sort(function (a, b) {
      var ya = toNumber(a.year) || 0;
      var yb = toNumber(b.year) || 0;
      if (asY) {
        var pa = Math.abs(ya - asY);
        var pb = Math.abs(yb - asY);
        if (pa !== pb) return pa - pb;
      }
      return yb - ya;
    });
  }
  var current = containing[0];

  var seen = Object.create(null);
  var uniques = [];
  var u;
  for (u = 0; u < same.length; u += 1) {
    var row = same[u];
    if (!row || !row.dur_start) continue;
    var fp = seasonalRowFingerprint(row);
    if (!fp || seen[fp]) continue;
    var candidates = same.filter(function (r2) {
      return seasonalRowFingerprint(r2) === fp;
    });
    var pick = candidates[0];
    var cj;
    for (cj = 0; cj < candidates.length; cj += 1) {
      if ((toNumber(candidates[cj].year) || 0) === asY) {
        pick = candidates[cj];
        break;
      }
    }
    seen[fp] = true;
    uniques.push(pick);
  }
  uniques.sort(function (a, b) {
    var ap = ymdFromIso(a.dur_start);
    var bp = ymdFromIso(b.dur_start);
    if (!ap || !bp) return 0;
    return dayOfYear2004(ap.m, ap.d) - dayOfYear2004(bp.m, bp.d);
  });

  if (!uniques.length) {
    return { ok: false, code: 'CURRENT_NOT_IN_CITY_LIST' };
  }
  var curFp = seasonalRowFingerprint(current);
  var uidx = -1;
  for (var ui = 0; ui < uniques.length; ui += 1) {
    if (seasonalRowFingerprint(uniques[ui]) === curFp) {
      uidx = ui;
      break;
    }
  }
  if (uidx < 0) {
    uidx = 0;
  }
  var nxt = null;
  if (uniques.length > 1) {
    nxt = uniques[(uidx + 1) % uniques.length];
  }

  return { ok: true, current: current, next: nxt, cityRows: same };
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
  toNumber: toNumber,
  isMonthDayInSeasonalWindow: isMonthDayInSeasonalWindow,
  ymdFromIso: ymdFromIso,
  dayOfYear2004: dayOfYear2004
};
