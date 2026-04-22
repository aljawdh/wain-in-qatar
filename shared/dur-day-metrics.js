/**
 * Date-window day counts only (ISO dur_start / dur_end + as_of).
 * Used by true_final_station_reference lookup — not a timing "source" on its own.
 */
'use strict';

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function parseIsoYmd(iso) {
  var m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function ymdFromIso(iso) {
  return parseIsoYmd(iso);
}

function monthDayKey(m, d) {
  return m * 100 + d;
}

function dayOfYear2004(m, d) {
  return (
    Math.floor(
      (Date.UTC(2004, m - 1, d, 0, 0, 0, 0) - Date.UTC(2004, 0, 1, 0, 0, 0, 0)) / 86400000
    ) + 1
  );
}

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

module.exports = {
  normalizeString: normalizeString,
  ymdFromIso: ymdFromIso,
  computeDayMetricsForWorkbookRow: computeDayMetricsForWorkbookRow
};
