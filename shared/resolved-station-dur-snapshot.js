'use strict';

/**
 * Single shared resolved dur snapshot: operational workbook only.
 * City keys match dur_windows via normalizeWorkbookCityKey; display names and dates from workbook rows.
 * durRow is synthetic (workbook) only — never from durur_master.
 */

var wb = require('./workbook-dur-lookup');
var buildWorkbookCityCatalog = wb.buildWorkbookCityCatalog;
var resolveStationWorkbookCity = wb.resolveStationWorkbookCity;
var findWorkbookCurrentNextStrict = wb.findWorkbookCurrentNextStrict;
var getStationWorkbookCityName = wb.getStationWorkbookCityName;
var computeDayMetricsForWorkbookRow = wb.computeDayMetricsForWorkbookRow;
var buildResolvedSnapshotShapeFromWorkbookRow = wb.buildResolvedSnapshotShapeFromWorkbookRow;
var parseIsoDateUtcMidnight = wb.parseIsoDateUtcMidnight;
var toNumber = wb.toNumber;

var DEFAULT_DUR_DAYS = 13;

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
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
 * @returns {object|null} null = no workbook_city on station (caller may use legacy)
 *  | { error: { code, message, ... } }
 *  | { resolved_window_snapshot, current, next, record, ... } success (no .error)
 */
function getResolvedLocalDurSnapshot(params) {
  var asOfIso = normalizeString(params && params.asOfIso);
  var station = params && params.station;
  var stationId = normalizeString(params && params.stationId);
  var allW = Array.isArray(params && params.workbook_windows) ? params.workbook_windows : [];

  if (!asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso) || !stationId) return null;

  if (!getStationWorkbookCityName(station)) return null;

  var catalog = buildWorkbookCityCatalog(allW);
  var resolved = resolveStationWorkbookCity(station, catalog);
  if (!resolved.ok) {
    return {
      error: {
        code: resolved.code,
        message:
          resolved.code === 'WORKBOOK_CITY_UNMAPPED'
            ? 'workbook_city_name does not match any city in dur_windows.json'
            : 'workbook city could not be resolved',
        input: resolved.input,
        key: resolved.key
      }
    };
  }

  var found = findWorkbookCurrentNextStrict(allW, resolved.key, asOfIso);
  if (!found.ok) {
    var msg = {
      NO_ROWS_FOR_CITY: 'no workbook rows for resolved city',
      NO_WINDOW_CONTAINS_DATE: 'no row contains as_of in [dur_start, dur_end]',
      DUPLICATE_CONTAINING_ROWS: 'multiple rows contain the same as_of (data error)',
      BAD_INPUT: 'invalid workbook lookup input'
    }[found.code] || 'workbook lookup failed';
    return {
      error: {
        code: found.code,
        message: msg,
        city: resolved.canonical,
        as_of: asOfIso,
        count: found.count,
        rows: found.rows
      }
    };
  }

  var cr = found.current;
  var nr = found.next;
  var metrics = computeDayMetricsForWorkbookRow(cr, asOfIso);

  var curDurRow = buildSyntheticDurFromWorkbook(cr);
  var nextDurRow = nr
    ? buildSyntheticDurFromWorkbook(nr)
    : { id: '', name_ar: '', default_days_count: DEFAULT_DUR_DAYS, dur_number: null, order_index: null, name_en: '', phases: [] };

  var start = parseIsoDateUtcMidnight(cr.dur_start);
  var end = parseIsoDateUtcMidnight(cr.dur_end);
  var nstart = nr ? parseIsoDateUtcMidnight(nr.dur_start) : null;
  var nend = nr ? parseIsoDateUtcMidnight(nr.dur_end) : null;

  if (!start || !end) {
    return { error: { code: 'INVALID_WINDOW_DATES', message: 'current row has invalid dur_start/dur_end' } };
  }
  if (nr && (!nstart || !nend)) {
    return { error: { code: 'INVALID_NEXT_WINDOW_DATES', message: 'next row has invalid dates' } };
  }

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
      city: resolved.canonical
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
