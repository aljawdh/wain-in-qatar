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

function normalizeArabicName(value) {
  var t = nfcString(value);
  if (!t) return '';
  t = t.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
  t = t.replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627');
  t = t.replace(/\u0624/g, '\u0648');
  t = t.replace(/\u0626/g, '\u064A');
  return t.replace(/\s+/g, ' ').trim();
}

function parseMonthDayFlexible(s) {
  var ddmm = parseDayMonthDdMm(s);
  if (ddmm) return ddmm;
  var t = normalizeString(s);
  var m = t.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  var mo = Number(m[1]);
  var day = Number(m[2]);
  if (!day || !mo || mo > 12 || day > 31) return null;
  return { d: day, m: mo };
}

function toDdMmString(md) {
  if (!md || md.d == null || md.m == null) return '';
  return String(md.d).padStart(2, '0') + '-' + String(md.m).padStart(2, '0');
}

function annualRowsList(doc) {
  return Array.isArray(doc && doc.annual_flat_rows) ? doc.annual_flat_rows : [];
}

function matchAnnualRowsForStation(doc, stationNameAr) {
  var rows = annualRowsList(doc);
  var wantExact = nfcString(stationNameAr);
  var wantNorm = normalizeArabicName(stationNameAr);
  var out = [];
  var i;
  for (i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    if (!row) continue;
    var exact = nfcString(row.station_name_ar);
    if (wantExact && exact === wantExact) {
      out.push(row);
      continue;
    }
    if (wantNorm && normalizeArabicName(row.station_name_ar) === wantNorm) {
      out.push(row);
    }
  }
  return out;
}

function chooseAnnualCurrentRow(rows, asM, asD) {
  var aKey = asM * 100 + asD;
  var i;
  for (i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    if (!row) continue;
    var pStart = parseMonthDayFlexible(row.start_md);
    var pEnd = parseMonthDayFlexible(row.end_md);
    if (!pStart || !pEnd) continue;
    var sKey = pStart.m * 100 + pStart.d;
    var eKey = pEnd.m * 100 + pEnd.d;
    if (isAsOfInWindowKeys(sKey, eKey, aKey)) {
      return { row: row, idx: i, start: pStart, end: pEnd };
    }
  }
  return null;
}

function logNavidurTrueFinalForceAnnual(payload) {
  try {
    console.log('NAVIDUR_TRUE_FINAL_FORCE_ANNUAL', payload);
  } catch (_e) {}
}

function findStationRow(doc, stationNameAr) {
  var wantExact = nfcString(stationNameAr);
  var wantNorm = normalizeArabicName(stationNameAr);
  var list = Array.isArray(doc && doc.stations) ? doc.stations : [];
  var i;
  for (i = 0; i < list.length; i += 1) {
    if (nfcString(list[i].station_name_ar) === wantExact) return list[i];
  }
  if (wantNorm) {
    for (i = 0; i < list.length; i += 1) {
      if (normalizeArabicName(list[i].station_name_ar) === wantNorm) return list[i];
    }
  }
  return null;
}

/**
 * Normalized Arabic names (for matching stations to workbook rows when is_reference_station is unset).
 * @param {object} doc — true_final_station_reference root
 * @returns {Set<string>}
 */
function buildTrueFinalStationNameNormSet(doc) {
  var set = new Set();
  var list = Array.isArray(doc && doc.stations) ? doc.stations : [];
  for (var i = 0; i < list.length; i += 1) {
    var n = normalizeArabicName(list[i].station_name_ar);
    if (n) set.add(n);
  }
  var annual = annualRowsList(doc);
  for (var j = 0; j < annual.length; j += 1) {
    var n2 = normalizeArabicName(annual[j] && annual[j].station_name_ar);
    if (n2) set.add(n2);
  }
  return set;
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

  var asDate = new Date(asOfIso + 'T12:00:00.000Z');
  if (Number.isNaN(asDate.getTime())) {
    return { ok: false, code: 'BAD_DATE', message: 'invalid asOfIso' };
  }
  var asM = asDate.getUTCMonth() + 1;
  var asD = asDate.getUTCDate();

  var annualList = annualRowsList(doc);
  if (!annualList.length) {
    logNavidurTrueFinalForceAnnual({
      has_annual: false,
      annual_rows_count: 0,
      matched_rows_count: 0,
      station_name: stationNameAr,
      lookup_mode: null
    });
    return {
      ok: false,
      code: 'TRUE_FINAL_ANNUAL_NOT_AVAILABLE',
      message: 'annual_flat_rows missing or empty in true_final_station_reference'
    };
  }

  var stationAnnualRows = matchAnnualRowsForStation(doc, stationNameAr);
  logNavidurTrueFinalForceAnnual({
    has_annual: true,
    annual_rows_count: annualList.length,
    matched_rows_count: stationAnnualRows.length,
    station_name: stationNameAr,
    lookup_mode: 'annual_flat_forced'
  });

  if (!stationAnnualRows.length) {
    return {
      ok: false,
      code: 'STATION_NOT_FOUND_IN_ANNUAL',
      message: 'no matching row in annual_flat_rows for station_name_ar',
      attempted_station_name_ar: stationNameAr,
      normalized_lookup_key: normalizeArabicName(stationNameAr),
      lookup_mode: 'annual_flat_forced'
    };
  }

  var matchedAnnual = chooseAnnualCurrentRow(stationAnnualRows, asM, asD);
  if (!matchedAnnual) {
    return {
      ok: false,
      code: 'NO_DUR_WINDOW_FOR_DATE',
      message: 'station found in annual_flat_rows but no matching dur window for as_of date',
      lookup_mode: 'annual_flat_forced'
    };
  }

  var tlA = syntheticTimelineMs(matchedAnnual.start, matchedAnnual.end, asM, asD);
  if (!tlA) {
    return {
      ok: false,
      code: 'TIMELINE_FAILED',
      message: 'could not build synthetic day timeline',
      lookup_mode: 'annual_flat_forced'
    };
  }

  var totalDaysInclusiveA = Math.floor((tlA.endMs - tlA.startMs) / 86400000) + 1;
  var dayInDurA = Math.floor((tlA.asMs - tlA.startMs) / 86400000) + 1;
  var daysRemA = totalDaysInclusiveA - dayInDurA;
  if (dayInDurA < 1) {
    return {
      ok: false,
      code: 'DAY_METRICS_INVALID',
      message: 'day_in_dur < 1',
      lookup_mode: 'annual_flat_forced'
    };
  }
  if (daysRemA < 0) daysRemA = 0;

  var curRow = matchedAnnual.row;
  var nextIdx = (matchedAnnual.idx + 1) % stationAnnualRows.length;
  var nextRow = stationAnnualRows[nextIdx] || null;
  var currentDurName = normalizeString(curRow.dur_name_ar);
  var nextDurName = normalizeString(nextRow && nextRow.dur_name_ar);
  var currentStartDdMm = toDdMmString(matchedAnnual.start);
  var currentEndDdMm = toDdMmString(matchedAnnual.end);

  return {
    ok: true,
    station_name_ar: normalizeString(curRow.station_name_ar) || stationNameAr,
    as_of_mmdd: getMonthDayKey(asDate),
    current_dur: currentDurName,
    current_dur_name_ar: currentDurName,
    current_dur_day: dayInDurA,
    day_in_dur: dayInDurA,
    remaining_days: daysRemA,
    days_remaining_in_dur: daysRemA,
    next_dur: nextDurName,
    next_dur_name_ar: nextDurName,
    current_dur_start_md: currentStartDdMm,
    current_dur_end_md: currentEndDdMm,
    period_start_mmdd: rowDdMmToMmddString(currentStartDdMm),
    period_end_mmdd: rowDdMmToMmddString(currentEndDdMm),
    timing_mode: 'month_day_only',
    source: 'true_final_station_reference',
    lookup_mode: 'annual_flat_forced',
    _fishing_start: new Date(tlA.startMs),
    _fishing_end: new Date(tlA.endMs),
    _fishing_as_of: new Date(tlA.asMs)
  };
}

/**
 * KV manual anchor override — same timing envelope shape as getTrueFinalDurState success.
 * @param {object} manual — { current_dur_name_ar, next_dur_name_ar?, start_md, end_md, day_index?, station_name_ar? }
 * @param {string} asOfIso — YYYY-MM-DD
 */
function buildManualAnchorDurState(manual, asOfIso) {
  var cur = normalizeString(manual && manual.current_dur_name_ar);
  if (!cur) {
    return { ok: false, code: 'BAD_MANUAL_INPUT', message: 'current_dur_name_ar required' };
  }
  var pStart = parseDayMonthDdMm(manual && manual.start_md);
  var pEnd = parseDayMonthDdMm(manual && manual.end_md);
  if (!pStart || !pEnd) {
    return { ok: false, code: 'BAD_MANUAL_WINDOW', message: 'invalid start_md/end_md (use DD-MM)' };
  }
  if (!asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(String(asOfIso).trim())) {
    return { ok: false, code: 'BAD_INPUT', message: 'asOfIso required' };
  }
  var asDate = new Date(String(asOfIso).trim() + 'T12:00:00.000Z');
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
      code: 'MANUAL_ANCHOR_AS_OF_OUTSIDE_WINDOW',
      message: 'as_of outside manual start_md/end_md window'
    };
  }
  var tl = syntheticTimelineMs(pStart, pEnd, asM, asD);
  if (!tl) {
    return { ok: false, code: 'TIMELINE_FAILED', message: 'could not build synthetic day timeline' };
  }
  var totalDaysInclusive = Math.floor((tl.endMs - tl.startMs) / 86400000) + 1;
  var dayInFromTimeline = Math.floor((tl.asMs - tl.startMs) / 86400000) + 1;
  var dayIdxRaw = manual && manual.day_index != null ? Number(manual.day_index) : NaN;
  var dayInDur = Number.isFinite(dayIdxRaw) && dayIdxRaw >= 1
    ? Math.min(Math.max(1, Math.round(dayIdxRaw)), totalDaysInclusive)
    : dayInFromTimeline;
  var daysRem = totalDaysInclusive - dayInDur;
  if (dayInDur < 1) {
    return { ok: false, code: 'DAY_METRICS_INVALID', message: 'day_in_dur < 1' };
  }
  if (daysRem < 0) daysRem = 0;
  var nx = normalizeString(manual && manual.next_dur_name_ar);
  if (!nx) nx = cur;
  var startDd = toDdMmString(pStart);
  var endDd = toDdMmString(pEnd);
  return {
    ok: true,
    station_name_ar: normalizeString(manual && manual.station_name_ar),
    as_of_mmdd: getMonthDayKey(asDate),
    current_dur: cur,
    current_dur_name_ar: cur,
    current_dur_day: dayInDur,
    day_in_dur: dayInDur,
    remaining_days: daysRem,
    days_remaining_in_dur: daysRem,
    next_dur: nx,
    next_dur_name_ar: nx,
    current_dur_start_md: startDd,
    current_dur_end_md: endDd,
    period_start_mmdd: rowDdMmToMmddString(startDd),
    period_end_mmdd: rowDdMmToMmddString(endDd),
    timing_mode: 'month_day_only',
    source: 'manual_anchor',
    lookup_mode: 'manual_override',
    _fishing_start: new Date(tl.startMs),
    _fishing_end: new Date(tl.endMs),
    _fishing_as_of: new Date(tl.asMs)
  };
}

module.exports = {
  getTrueFinalDurState: getTrueFinalDurState,
  buildManualAnchorDurState: buildManualAnchorDurState,
  getMonthDayKey: getMonthDayKey,
  findStationRow: findStationRow,
  parseDayMonthDdMm: parseDayMonthDdMm,
  normalizeArabicName: normalizeArabicName,
  buildTrueFinalStationNameNormSet: buildTrueFinalStationNameNormSet,
  nfcString: nfcString
};
