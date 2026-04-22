'use strict';

/**
 * Fixed annual reference (day/month only). Station-specific rows from
 * data/fixed_annual_reference.json — no Suhail math, no old dur_windows, no year cycle engine.
 */

var wlu = require('./workbook-dur-lookup');

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function nfcString(value) {
  var s = normalizeString(value);
  try {
    return s.normalize ? s.normalize('NFC') : s;
  } catch (_e) {
    return s;
  }
}

/** DD-MM or empty */
function parseDdMm(s) {
  var t = normalizeString(s);
  if (!t) return null;
  var p = t.split(/[-–\/]/);
  if (p.length < 2) return null;
  var d = parseInt(p[0], 10);
  var m = parseInt(p[1], 10);
  if (!Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { m: m, d: d };
}

/**
 * @returns { { dur_start: string, dur_end: string } } YYYY-MM-DD in ref 2004/2005 for metrics helpers
 */
function buildSyntheticIsoRow(startDdMm, endDdMm) {
  var a = parseDdMm(startDdMm);
  var b = parseDdMm(endDdMm);
  if (!a || !b) return null;
  var sKey = a.m * 100 + a.d;
  var eKey = b.m * 100 + b.d;
  var sY = 2004;
  var eY = 2004;
  if (eKey < sKey) {
    eY = 2005;
  }
  var padM = function (n) { return String(n).padStart(2, '0'); };
  var sIso = sY + '-' + padM(a.m) + '-' + padM(a.d);
  var eIso = eY + '-' + padM(b.m) + '-' + padM(b.d);
  return { dur_start: sIso, dur_end: eIso, startMd: a, endMd: b, startDdMm: startDdMm, endDdMm: endDdMm };
}

function findRowBySheetEn(stations, en) {
  var k = normalizeString(en).toLowerCase();
  for (var i = 0; i < stations.length; i += 1) {
    if (String(stations[i].sheet_station_en).trim().toLowerCase() === k) return stations[i];
  }
  return null;
}

/**
 * @param {object} station — normalized record (name, workbook_city_name, …)
 * @param {object} doc — fixed_annual_reference.json
 */
function resolveFixedAnnualRow(station, doc) {
  var stations = Array.isArray(doc && doc.stations) ? doc.stations : [];
  var alias = (doc && doc.alias_ar_to_sheet_en) || {};

  if (station.fixed_annual_sheet_station) {
    var byField = findRowBySheetEn(stations, station.fixed_annual_sheet_station);
    if (byField) return { ok: true, row: byField, via: 'fixed_annual_sheet_station' };
  }

  var candidates = [station.workbook_city_name, station.name, station.name_ar, station.name_en].map(nfcString).filter(Boolean);
  for (var c = 0; c < candidates.length; c += 1) {
    var ar = candidates[c];
    if (alias[ar]) {
      var r1 = findRowBySheetEn(stations, alias[ar]);
      if (r1) return { ok: true, row: r1, via: 'alias_ar', key: ar };
    }
  }

  for (var j = 0; j < candidates.length; j += 1) {
    for (var i = 0; i < stations.length; i += 1) {
      if (String(stations[i].sheet_station_en).trim() === candidates[j]) {
        return { ok: true, row: stations[i], via: 'sheet_en_name_match' };
      }
    }
  }

  return { ok: false, code: 'STATION_NOT_IN_FIXED_ANNUAL_REFERENCE' };
}

/**
 * @param {{ station: object, asOfIso: string, doc: object }}
 * @returns
 *  | { ok: true, resolved_window_snapshot: object, current: { durRow, start, end }, next: { durRow, name_ar }, suhail_metadata: object, timing_as_of: string }
 *  | { ok: false, error: { code, message, detail? } }
 */
function getFixedAnnualDurSnapshot(params) {
  var station = params && params.station;
  var asOfIso = normalizeString(params && params.asOfIso);
  var doc = params && params.doc;
  if (!asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso) || !doc) {
    return { ok: false, error: { code: 'BAD_INPUT', message: 'as_of or doc missing' } };
  }
  var res = resolveFixedAnnualRow(station, doc);
  if (!res.ok || !res.row) {
    return { ok: false, error: { code: res.code || 'NO_ROW', message: 'station not in fixed annual table' } };
  }
  var row = res.row;
  if (!row.current_dur_start_ddmm || !row.current_dur_end_ddmm || !row.current_dur_name_ar) {
    return { ok: false, error: { code: 'ROW_INCOMPLETE', message: 'start/end or dur name missing', station: row.sheet_station_en } };
  }

  var syn = buildSyntheticIsoRow(row.current_dur_start_ddmm, row.current_dur_end_ddmm);
  if (!syn) {
    return { ok: false, error: { code: 'BAD_DDMM', message: 'invalid start/end' } };
  }

  var pAs = wlu.ymdFromIso(asOfIso);
  if (!pAs) return { ok: false, error: { code: 'BAD_AS_OF', message: 'parse as_of' } };
  if (!wlu.isMonthDayInSeasonalWindow(pAs.m, pAs.d, syn.dur_start, syn.dur_end)) {
    return {
      ok: false,
      error: {
        code: 'OUTSIDE_REFERENCE_WINDOW',
        message: 'date not inside Current Dur [start,end] in fixed annual reference',
        as_of: asOfIso,
        window: { start: row.current_dur_start_ddmm, end: row.current_dur_end_ddmm, station: row.sheet_station_en }
      }
    };
  }

  var fakeWb = {
    year: 2004,
    dur_index: 0,
    dur_name_ar: row.current_dur_name_ar,
    dur_length_days: 13,
    dur_start: syn.dur_start,
    dur_end: syn.dur_end
  };
  var met = wlu.computeDayMetricsForWorkbookRow(fakeWb, asOfIso);

  var startD = wlu.parseIsoDateUtcMidnight(syn.dur_start);
  var endD = wlu.parseIsoDateUtcMidnight(syn.dur_end);
  if (!startD || !endD) {
    return { ok: false, error: { code: 'ISO_BUILD_FAILED', message: 'synthetic window dates' } };
  }

  var rwy = pAs ? pAs.y : 2004;
  var dis = displayWindowIso(rwy, row.current_dur_start_ddmm, row.current_dur_end_ddmm);
  var snapShape = {
    dur_id: 'fa_' + String(row.sheet_station_en).replace(/\s/g, '_'),
    dur_name_ar: row.current_dur_name_ar,
    day_in_dur: met.day_in_dur,
    start_date: dis.start,
    end_date: dis.end,
    days_remaining_in_dur: met.days_remaining_in_dur,
    next_dur_id: 'fa_next',
    next_dur_name_ar: row.next_dur_name_ar || null
  };

  var durRow = {
    id: snapShape.dur_id,
    name_ar: row.current_dur_name_ar,
    name: '',
    name_en: '',
    dur_number: null,
    order_index: null,
    default_days_count: 13,
    phases: []
  };
  return {
    ok: true,
    timing_as_of: asOfIso,
    resolved_window_snapshot: snapShape,
    current: { durRow: durRow, start: startD, end: endD },
    next: {
      durRow: { id: 'fa_next', name_ar: row.next_dur_name_ar || '', default_days_count: 13, dur_number: null, order_index: null, name_en: '', phases: [] },
      start: null,
      end: null,
      name_ar: row.next_dur_name_ar || null
    },
    suhail_metadata: {
      astronomical_ddmm: row.astronomical_suhail_entry_ddmm,
      heritage_ddmm: row.heritage_suhail_entry_ddmm,
      note: 'metadata_only_not_used_for_dur_bounds'
    },
    timing_source: 'fixed_annual_reference',
    route: res.via
  };
}

function displayWindowIso(calendarYear, startDdmm, endDdmm) {
  var a = parseDdMm(startDdmm);
  var b = parseDdMm(endDdmm);
  if (!a || !b) return { start: '', end: '' };
  var key = function (m, d) { return m * 100 + d; };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  if (key(b.m, b.d) >= key(a.m, a.d)) {
    return {
      start: calendarYear + '-' + pad(a.m) + '-' + pad(a.d),
      end: calendarYear + '-' + pad(b.m) + '-' + pad(b.d)
    };
  }
  return {
    start: calendarYear + '-' + pad(a.m) + '-' + pad(a.d),
    end: calendarYear + 1 + '-' + pad(b.m) + '-' + pad(b.d)
  };
}

module.exports = {
  getFixedAnnualDurSnapshot: getFixedAnnualDurSnapshot,
  resolveFixedAnnualRow: resolveFixedAnnualRow,
  buildSyntheticIsoRow: buildSyntheticIsoRow,
  parseDdMm: parseDdMm
};
