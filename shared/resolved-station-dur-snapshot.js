'use strict';

/**
 * Single shared resolved local dur snapshot from persisted station_dur_windows
 * (same inputs as admin GET station-dur-windows + analysis engine).
 */

var resolver = require('./station-local-dur-resolver');
var resolveStationLocalDurAtDate = resolver.resolveStationLocalDurAtDate;

function parseIsoDateUtcMidnight(iso) {
  var m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0));
}

var DEFAULT_DUR_DAYS = 13;

function toArray(a) {
  return Array.isArray(a) ? a : [];
}

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

function sortDurRows(rows) {
  return toArray(rows).slice().sort(function (a, b) {
    var aOrder = Number(a && (a.order_index != null ? a.order_index : a.dur_number) || 0);
    var bOrder = Number(b && (b.order_index != null ? b.order_index : b.dur_number) || 0);
    return aOrder - bOrder;
  });
}

function matchDurRowForWindow(durRows, w) {
  var rows = sortDurRows(durRows);
  var byId = normalizeString(w && w.dur_id);
  var byName = nfcString(w && w.dur_name_ar);
  var ri;
  if (byId) {
    for (ri = 0; ri < rows.length; ri += 1) {
      if (normalizeString(rows[ri] && rows[ri].id) === byId) return rows[ri];
    }
  }
  if (byName) {
    for (ri = 0; ri < rows.length; ri += 1) {
      var row = rows[ri];
      var rn = nfcString(row && (row.name_ar || row.name || row.name_en));
      if (rn === byName) return row;
    }
  }
  return null;
}

function buildSyntheticDurRowFromWindow(w) {
  var days = Math.max(1, toNumber(w && w.days) || DEFAULT_DUR_DAYS);
  return {
    id: normalizeString(w && w.dur_id) || ('local_' + normalizeString(w && w.dur_name_ar)),
    dur_number: null,
    order_index: null,
    default_days_count: days,
    name_ar: normalizeString(w && w.dur_name_ar),
    name_en: '',
    phases: []
  };
}

/**
 * @param {object} params
 * @param {object} params.station_dur_windows – doc { stations: { [id]: record } }
 * @param {string} params.stationId
 * @param {string} params.asOfIso – YYYY-MM-DD (must match analysis UTC calendar day)
 * @param {Array} params.durur_reference – normalized dur rows
 * @returns {object|null}
 */
function getResolvedLocalDurSnapshot(params) {
  var doc = params && params.station_dur_windows;
  var stationId = normalizeString(params && params.stationId);
  var asOfIso = normalizeString(params && params.asOfIso);
  var durRows = sortDurRows(params && params.durur_reference);

  if (!doc || typeof doc.stations !== 'object' || !stationId) return null;
  if (!asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) return null;

  var rec = doc.stations[stationId];
  if (!rec || !rec.generation_ok || !Array.isArray(rec.windows) || rec.windows.length < 1) return null;

  var resolved = resolveStationLocalDurAtDate(rec.windows, asOfIso);
  if (!resolved) return null;

  var windows = rec.windows;
  var idx = -1;
  var wi;
  for (wi = 0; wi < windows.length; wi += 1) {
    var w = windows[wi];
    if (!w || !w.start_date || !w.end_date) continue;
    if (asOfIso >= w.start_date && asOfIso <= w.end_date) {
      idx = wi;
      break;
    }
  }
  if (idx < 0) return null;

  var cw = windows[idx];
  var nw = windows[(idx + 1) % windows.length];
  var curRow = matchDurRowForWindow(durRows, cw) || buildSyntheticDurRowFromWindow(cw);
  var nextRow = matchDurRowForWindow(durRows, nw) || buildSyntheticDurRowFromWindow(nw);

  var start = parseIsoDateUtcMidnight(cw.start_date);
  var end = parseIsoDateUtcMidnight(cw.end_date);
  var nstart = parseIsoDateUtcMidnight(nw.start_date);
  var nend = parseIsoDateUtcMidnight(nw.end_date);
  if (!start || !end || !nstart || !nend) return null;

  var anchorIso = normalizeString(rec.anchor_date);
  var anchorDateParsed = anchorIso ? parseIsoDateUtcMidnight(anchorIso) : null;
  var cycleStartDate = windows[0] && windows[0].start_date ? parseIsoDateUtcMidnight(windows[0].start_date) : null;

  return {
    timing_as_of: asOfIso,
    record: rec,
    resolved_window_snapshot: resolved,
    current: { durRow: curRow, start: start, end: end },
    next: { durRow: nextRow, start: nstart, end: nend },
    suhail_anchor: anchorDateParsed,
    cycle_start: cycleStartDate,
    base_suhail_anchor: anchorDateParsed
  };
}

module.exports = {
  getResolvedLocalDurSnapshot: getResolvedLocalDurSnapshot
};
