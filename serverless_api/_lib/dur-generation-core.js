'use strict';

/**
 * Pure date math for batch dur window generation (no I/O).
 */

function parseIsoDate(iso) {
  var m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
}

function formatIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  var y = date.getUTCFullYear();
  var mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  var d = String(date.getUTCDate()).padStart(2, '0');
  return y + '-' + mo + '-' + d;
}

function addUtcDays(date, days) {
  var d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d;
}

/**
 * Build windows from anchor ISO date + sequence rules when every rule has numeric offset and duration.
 *
 * @param {string} anchorIso – YYYY-MM-DD
 * @param {Array<{dur_id:string,dur_name_ar?:string|null,offset_days_from_anchor:number|null,duration_days:number|null}>} rules
 * @returns {{ ok: boolean, reason?: string, windows?: Array<object> }}
 */
function buildWindowsFromAnchor(anchorIso, rules) {
  var anchor = parseIsoDate(anchorIso);
  if (!anchor) return { ok: false, reason: 'bad_anchor_date' };

  var list = Array.isArray(rules) ? rules : [];
  var windows = [];

  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    var off = r.offset_days_from_anchor;
    var dur = r.duration_days;
    if (off == null || dur == null || !Number.isFinite(Number(off)) || !Number.isFinite(Number(dur))) {
      return { ok: false, reason: 'missing_offset_or_duration_at_' + (r && r.dur_id ? r.dur_id : String(i)) };
    }
    var start = addUtcDays(anchor, Number(off));
    var end = addUtcDays(start, Number(dur) - 1);
    windows.push({
      dur_id: r.dur_id,
      dur_name_ar: r.dur_name_ar != null ? r.dur_name_ar : null,
      start_date: formatIsoDate(start),
      end_date: formatIsoDate(end),
      days: Number(dur),
      source_mode: 'generated_from_anchor'
    });
  }

  return { ok: true, windows: windows };
}

module.exports = {
  parseIsoDate,
  formatIsoDate,
  addUtcDays,
  buildWindowsFromAnchor
};
