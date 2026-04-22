/**
 * Station-specific true-final reference: data/true_final_station_reference.json
 * Timing: month-day (MM-DD) only; Gregorian year is ignored for matching and day math.
 */
'use strict';

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function nfcString(value) {
  var raw = normalizeString(value);
  try {
    return raw.normalize ? raw.normalize('NFC') : raw;
  } catch (_e) {
    return raw;
  }
}

/**
 * @param {Date|number|string} date — if string, must parse to a Date (e.g. ISO date)
 * @returns {string} MM-DD
 */
function getMonthDayKey(date) {
  var d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return m + '-' + day;
}

/** "14-04" in sheet = DD-MM → { d, m } */
function parseDayMonthDdMm(s) {
  var t = normalizeString(s);
  var m = t.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  var day = Number(m[1]);
  var mo = Number(m[2]);
  if (!day || !mo || mo > 12 || day > 31) return null;
  return { d: day, m: mo };
}

/** DD-MM row → MM-DD string */
function rowDdMmToMmddString(ddmm) {
  var p = parseDayMonthDdMm(ddmm);
  if (!p) return '';
  return String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
}

/**
 * @param {number} sKey
 * @param {number} eKey
 * @param {number} aKey
 * @returns {boolean}
 */
function isAsOfInWindowKeys(sKey, eKey, aKey) {
  if (sKey == null || eKey == null || aKey == null) return false;
  if (sKey <= eKey) {
    return aKey >= sKey && aKey <= eKey;
  }
  return aKey >= sKey || aKey <= eKey;
}

/**
 * Fixed-year timeline (2000 / 2001) for day_in and days_remaining; no real calendar year.
 * @returns {{ startMs: number, endMs: number, asMs: number } | null}
 */
function syntheticTimelineMs(pStart, pEnd, asM, asD) {
  if (!pStart || !pEnd) return null;
  var sKey = pStart.m * 100 + pStart.d;
  var eKey = pEnd.m * 100 + pEnd.d;
  var aKey = asM * 100 + asD;
  var Y0 = 2000;
  var Y1 = 2001;
  var startMs = Date.UTC(Y0, pStart.m - 1, pStart.d, 0, 0, 0, 0);
  var wrap = sKey > eKey;

  if (!wrap) {
    var endMs = Date.UTC(Y0, pEnd.m - 1, pEnd.d, 0, 0, 0, 0);
    var asMs = Date.UTC(Y0, asM - 1, asD, 0, 0, 0, 0);
    if (aKey < sKey || aKey > eKey) return null;
    return { startMs: startMs, endMs: endMs, asMs: asMs };
  }

  var endMsW = Date.UTC(Y1, pEnd.m - 1, pEnd.d, 0, 0, 0, 0);
  if (!isAsOfInWindowKeys(sKey, eKey, aKey)) return null;

  var asMsW;
  if (aKey >= sKey) {
    asMsW = Date.UTC(Y0, asM - 1, asD, 0, 0, 0, 0);
  } else {
    asMsW = Date.UTC(Y1, asM - 1, asD, 0, 0, 0, 0);
  }
  return { startMs: startMs, endMs: endMsW, asMs: asMsW };
}

function findStationRow(doc, stationNameAr) {
  var want = nfcString(stationNameAr);
  var list = Array.isArray(doc && doc.stations) ? doc.stations : [];
  for (var i = 0; i < list.length; i += 1) {
    if (nfcString(list[i].station_name_ar) === want) return list[i];
  }
  return null;
}

/**
 * @param {object} doc — parsed true_final_station_reference.json
 * @param {object} params — { station_name_ar, asOfIso: 'YYYY-MM-DD' } (year in asOfIso is ignored for timing)
 * @returns {object} ok snapshot or { ok: false, code, message }
 */
function getTrueFinalDurState(doc, params) {
  var stationNameAr = normalizeString(params && params.station_name_ar);
  var asOfIso = normalizeString(params && params.asOfIso);
  if (!stationNameAr || !asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) {
    return { ok: false, code: 'BAD_INPUT', message: 'station_name_ar and asOfIso (calendar day) required' };
  }
  var row = findStationRow(doc, stationNameAr);
  if (!row) {
    return { ok: false, code: 'STATION_NOT_FOUND', message: 'no row for station' };
  }

  var pStart = parseDayMonthDdMm(row.current_dur_start_md);
  var pEnd = parseDayMonthDdMm(row.current_dur_end_md);
  if (!pStart || !pEnd) {
    return { ok: false, code: 'INVALID_WINDOW', message: 'current_dur_start_md / current_dur_end_md not parseable' };
  }

  var asDate = new Date(asOfIso + 'T12:00:00.000Z');
  if (Number.isNaN(asDate.getTime())) {
    return { ok: false, code: 'BAD_DATE', message: 'invalid asOfIso' };
  }
  var asM = asDate.getUTCMonth() + 1;
  var asD = asDate.getUTCDate();
  var aKey = asM * 100 + asD;
  var sKey = pStart.m * 100 + pStart.d;
  var eKey = pEnd.m * 100 + pEnd.d;

  if (!isAsOfInWindowKeys(sKey, eKey, aKey)) {
    return {
      ok: false,
      code: 'AS_OF_OUTSIDE_SHEET_WINDOW',
      message: 'as_of month-day is not in [current_dur_start, current_dur_end] (DD-MM, seasonal)'
    };
  }

  var tl = syntheticTimelineMs(pStart, pEnd, asM, asD);
  if (!tl) {
    return { ok: false, code: 'TIMELINE_FAILED', message: 'could not build synthetic day timeline' };
  }

  var totalDaysInclusive = Math.floor((tl.endMs - tl.startMs) / 86400000) + 1;
  var dayInDur = Math.floor((tl.asMs - tl.startMs) / 86400000) + 1;
  var daysRem = totalDaysInclusive - dayInDur;
  if (dayInDur < 1) {
    return { ok: false, code: 'DAY_METRICS_INVALID', message: 'day_in_dur < 1' };
  }
  if (daysRem < 0) daysRem = 0;

  var periodStartMmdd = rowDdMmToMmddString(row.current_dur_start_md);
  var periodEndMmdd = rowDdMmToMmddString(row.current_dur_end_md);
  var asOfMmddOnly = getMonthDayKey(asDate);

  return {
    ok: true,
    station_name_ar: row.station_name_ar,
    as_of_mmdd: asOfMmddOnly,
    current_dur_name_ar: row.current_dur_name_ar,
    period_start_mmdd: periodStartMmdd,
    period_end_mmdd: periodEndMmdd,
    day_in_dur: dayInDur,
    days_remaining_in_dur: daysRem,
    next_dur_name_ar: normalizeString(row.next_dur_name_ar),
    timing_mode: 'month_day_only',
    source: 'true_final_station_reference',
    _fishing_start: new Date(tl.startMs),
    _fishing_end: new Date(tl.endMs),
    _fishing_as_of: new Date(tl.asMs)
  };
}

module.exports = {
  getTrueFinalDurState: getTrueFinalDurState,
  getMonthDayKey: getMonthDayKey,
  findStationRow: findStationRow,
  parseDayMonthDdMm: parseDayMonthDdMm
};
