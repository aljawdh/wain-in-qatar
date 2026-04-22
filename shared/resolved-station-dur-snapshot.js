'use strict';

/**
 * Single shared resolved dur snapshot: operational workbook truth only
 * (data/dur_windows.json → workbook_windows, from Excel import).
 * Does NOT use generated station_dur_windows for timing.
 */

var wb = require('./workbook-dur-lookup');
var findWorkbookCurrentNext = wb.findWorkbookCurrentNext;
var getStationWorkbookCityName = wb.getStationWorkbookCityName;
var computeDayMetricsForWorkbookRow = wb.computeDayMetricsForWorkbookRow;
var buildResolvedSnapshotShapeFromWorkbookRow = wb.buildResolvedSnapshotShapeFromWorkbookRow;
var parseIsoDateUtcMidnight = wb.parseIsoDateUtcMidnight;
var toNumber = wb.toNumber;

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

function sortDurRows(rows) {
  return toArray(rows).slice().sort(function (a, b) {
    var aOrder = Number(a && (a.order_index != null ? a.order_index : a.dur_number) || 0);
    var bOrder = Number(b && (b.order_index != null ? b.order_index : b.dur_number) || 0);
    return aOrder - bOrder;
  });
}

function matchDurRowByWorkbookName(durRows, durNameAr) {
  var rows = sortDurRows(durRows);
  var byName = nfcString(durNameAr);
  if (!byName) return null;
  var ri;
  for (ri = 0; ri < rows.length; ri += 1) {
    var row = rows[ri];
    var rn = nfcString(row && (row.name_ar || row.name || row.name_en));
    if (rn === byName) return row;
  }
  return null;
}

function buildSyntheticDurFromWorkbook(wbRow) {
  return {
    id: 'wb_' + String(wbRow.year) + '_' + String(wbRow.dur_index),
    dur_number: toNumber(wbRow.dur_index),
    order_index: toNumber(wbRow.dur_index),
    default_days_count: Math.max(1, toNumber(wbRow.dur_length_days) || DEFAULT_DUR_DAYS),
    name_ar: normalizeString(wbRow.dur_name_ar),
    name_en: '',
    phases: []
  };
}

/**
 * @param {object} params
 * @param {object} params.station – must include workbook_city_name when using workbook
 * @param {string} params.stationId
 * @param {string} params.asOfIso
 * @param {Array} params.durur_reference
 * @param {Array} params.workbook_windows – from dur_windows.json
 * @returns {object|null}
 */
function getResolvedLocalDurSnapshot(params) {
  var asOfIso = normalizeString(params && params.asOfIso);
  var durRows = sortDurRows(params && params.durur_reference);
  var station = params && params.station;
  var stationId = normalizeString(params && params.stationId);
  var allW = toArray(params && params.workbook_windows);

  if (!asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso) || !stationId) return null;

  var city = getStationWorkbookCityName(station);
  if (!city) return null;

  var found = findWorkbookCurrentNext(allW, city, asOfIso);
  if (!found || !found.current) return null;

  var cr = found.current;
  var nr = found.next;
  var metrics = computeDayMetricsForWorkbookRow(cr, asOfIso);

  var curDurRow = matchDurRowByWorkbookName(durRows, cr.dur_name_ar) || buildSyntheticDurFromWorkbook(cr);
  var nextDurRow = nr
    ? (matchDurRowByWorkbookName(durRows, nr.dur_name_ar) || buildSyntheticDurFromWorkbook(nr))
    : { id: '', name_ar: '', default_days_count: DEFAULT_DUR_DAYS, dur_number: null, order_index: null, name_en: '', phases: [] };

  var start = parseIsoDateUtcMidnight(cr.dur_start);
  var end = parseIsoDateUtcMidnight(cr.dur_end);
  var nstart = nr ? parseIsoDateUtcMidnight(nr.dur_start) : null;
  var nend = nr ? parseIsoDateUtcMidnight(nr.dur_end) : null;

  if (!start || !end) return null;
  if (nr && (!nstart || !nend)) return null;

  var manual = normalizeString(station && station.manual_suhail_anchor_date);
  var suhailAnchor = manual ? parseIsoDateUtcMidnight(manual) : null;

  var y = String(cr.year != null ? cr.year : '');
  var yearRows = (found.cityRows || []).filter(function (r) {
    return r && String(r.year) === y;
  });
  var cycleStart = null;
  if (yearRows.length) {
    var minS = yearRows
      .map(function (r) {
        return r.dur_start;
      })
      .filter(Boolean)
      .sort()[0];
    cycleStart = minS ? parseIsoDateUtcMidnight(minS) : null;
  }

  var snapShape = buildResolvedSnapshotShapeFromWorkbookRow(cr, nr, asOfIso, metrics);

  return {
    timing_as_of: asOfIso,
    record: {
      source: 'operational_workbook',
      station_id: stationId,
      workbook_file: 'dur_windows.json',
      city: city
    },
    resolved_window_snapshot: snapShape,
    current: { durRow: curDurRow, start: start, end: end },
    next: {
      durRow: nextDurRow,
      start: nr ? nstart : null,
      end: nr ? nend : null
    },
    suhail_anchor: suhailAnchor,
    cycle_start: cycleStart || start,
    base_suhail_anchor: suhailAnchor
  };
}

module.exports = {
  getResolvedLocalDurSnapshot: getResolvedLocalDurSnapshot
};
