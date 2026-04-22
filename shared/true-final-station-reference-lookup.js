/**
 * Station-specific true-final reference: data/true_final_station_reference.json
 * (source: data/navidur_true_final_station_reference.xlsx). Used for timing when
 * the analysis engine selects the true-final path for reference stations.
 */
'use strict';

var wb = require('./workbook-dur-lookup');
var parseIsoYmd = wb.ymdFromIso;
var computeDayMetricsForWorkbookRow = wb.computeDayMetricsForWorkbookRow;

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

/** "14-04" day-month (DD-MM) → { d, m } */
function parseDayMonthToken(s) {
  var t = normalizeString(s);
  var m = t.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  var d = Number(m[1]);
  var mo = Number(m[2]);
  if (!d || !mo || mo > 12 || d > 31) return null;
  return { d: d, m: mo };
}

/**
 * Build ISO dur window from DD-MM range in year y. If the naive end is before the start, end is in y+1 (Dec→Jan, etc.)
 */
function windowIsoFromDayMonthRange(y, startMd, endMd) {
  var a = parseDayMonthToken(startMd);
  var b = parseDayMonthToken(endMd);
  if (!a || !b) return null;
  var sMs = Date.UTC(y, a.m - 1, a.d, 0, 0, 0, 0);
  var e0 = Date.UTC(y, b.m - 1, b.d, 0, 0, 0, 0);
  var endY = e0 < sMs ? y + 1 : y;
  return {
    dur_start: y + '-' + String(a.m).padStart(2, '0') + '-' + String(a.d).padStart(2, '0'),
    dur_end: endY + '-' + String(b.m).padStart(2, '0') + '-' + String(b.d).padStart(2, '0')
  };
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
 * @param {object} params — { station_name_ar, asOfIso: 'YYYY-MM-DD' }
 * @returns {object} ok snapshot or { ok: false, code, message }
 */
function getTrueFinalDurState(doc, params) {
  var stationNameAr = normalizeString(params && params.station_name_ar);
  var asOfIso = normalizeString(params && params.asOfIso);
  if (!stationNameAr || !asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) {
    return { ok: false, code: 'BAD_INPUT', message: 'station_name_ar and asOfIso (YYYY-MM-DD) required' };
  }
  var row = findStationRow(doc, stationNameAr);
  if (!row) {
    return { ok: false, code: 'STATION_NOT_FOUND', message: 'no row for station' };
  }
  var y = parseIsoYmd(asOfIso);
  if (!y) return { ok: false, code: 'BAD_DATE', message: 'invalid asOfIso' };
  var year = y.y;

  var win = windowIsoFromDayMonthRange(year, row.current_dur_start_md, row.current_dur_end_md);
  if (!win) {
    return { ok: false, code: 'INVALID_WINDOW', message: 'current_dur_start_md / current_dur_end_md not parseable' };
  }

  var syn = {
    dur_start: win.dur_start,
    dur_end: win.dur_end
  };
  var metrics = computeDayMetricsForWorkbookRow(syn, asOfIso);
  if (metrics.day_in_dur == null) {
    return {
      ok: false,
      code: 'AS_OF_OUTSIDE_SHEET_WINDOW',
      message: 'as_of is not in [current_dur_start, current_dur_end] for this year',
      window: win
    };
  }

  return {
    ok: true,
    station_name_ar: row.station_name_ar,
    as_of: asOfIso,
    current_dur_name_ar: row.current_dur_name_ar,
    current_dur_start: win.dur_start,
    current_dur_end: win.dur_end,
    day_in_dur: metrics.day_in_dur,
    days_remaining_in_dur: metrics.days_remaining_in_dur,
    next_dur_name_ar: normalizeString(row.next_dur_name_ar)
  };
}

module.exports = {
  getTrueFinalDurState: getTrueFinalDurState,
  findStationRow: findStationRow,
  windowIsoFromDayMonthRange: windowIsoFromDayMonthRange,
  parseDayMonthToken: parseDayMonthToken
};
