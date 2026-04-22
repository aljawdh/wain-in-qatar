'use strict';

const { parseIsoDate, formatIsoDate } = require('./dur-generation-core');

function utcTodayIso() {
  const d = new Date();
  return formatIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0)));
}

function daysBetweenUtc(startDate, endDate) {
  var ms = endDate.getTime() - startDate.getTime();
  return Math.round(ms / 86400000);
}

/**
 * @param {object[]} windows from station-local generation
 * @param {string} isoDate YYYY-MM-DD (UTC calendar)
 * @returns {object | null}
 */
function resolveStationLocalDurAtDate(windows, isoDate) {
  if (!Array.isArray(windows) || !isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  var i;
  for (i = 0; i < windows.length; i += 1) {
    var w = windows[i];
    if (!w || !w.start_date || !w.end_date) continue;
    if (isoDate >= w.start_date && isoDate <= w.end_date) {
      var start = parseIsoDate(w.start_date);
      var cur = parseIsoDate(isoDate);
      if (!start || !cur) return null;
      var dayInDur = daysBetweenUtc(start, cur) + 1;
      var next = i + 1 < windows.length ? windows[i + 1] : windows[0];
      var end = parseIsoDate(w.end_date);
      var daysRemainingInDur =
        end && cur ? Math.max(0, Math.round((end.getTime() - cur.getTime()) / 86400000)) : null;
      return {
        dur_id: w.dur_id,
        dur_name_ar: w.dur_name_ar,
        day_in_dur: dayInDur,
        start_date: w.start_date,
        end_date: w.end_date,
        days_remaining_in_dur: daysRemainingInDur,
        next_dur_id: next ? next.dur_id : null,
        next_dur_name_ar: next ? next.dur_name_ar : null,
        wraps_to_next_cycle: i + 1 >= windows.length
      };
    }
  }
  return null;
}

module.exports = {
  resolveStationLocalDurAtDate,
  utcTodayIso
};
