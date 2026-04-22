#!/usr/bin/env node
'use strict';

/**
 * Read-only validation: station ↔ dur_windows.json workbook city mapping and strict lookup.
 * Does not modify Excel or JSON data.
 */

var fs = require('fs');
var path = require('path');

var wb = require('../shared/workbook-dur-lookup');
var buildWorkbookCityCatalog = wb.buildWorkbookCityCatalog;
var resolveStationWorkbookCity = wb.resolveStationWorkbookCity;
var findWorkbookCurrentNextStrict = wb.findWorkbookCurrentNextStrict;
var normalizeWorkbookCityKey = wb.normalizeWorkbookCityKey;
var getStationWorkbookCityName = wb.getStationWorkbookCityName;
var isMonthDayInSeasonalWindow = wb.isMonthDayInSeasonalWindow;
var ymdFromIso = wb.ymdFromIso;

function addDaysIso(iso, delta) {
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta, 0, 0, 0, 0));
  return d.toISOString().slice(0, 10);
}

function expectedContainingRow(cityRows, asOfIso) {
  var a = ymdFromIso(asOfIso);
  if (!a) return { expected: null, count: 0 };
  var containing = cityRows.filter(function (r) {
    if (!r || !r.dur_start || !r.dur_end) return false;
    return isMonthDayInSeasonalWindow(a.m, a.d, r.dur_start, r.dur_end);
  });
  if (containing.length === 0) return { expected: null, count: 0 };
  if (containing.length > 1) {
    containing.sort(function (x, y) {
      return Math.abs((x.year || 0) - a.y) - Math.abs((y.year || 0) - a.y) || (y.year || 0) - (x.year || 0);
    });
  }
  return { expected: containing[0], count: 1 };
}

function rowSig(r) {
  if (!r) return '';
  return [r.city, r.year, r.dur_index, r.dur_start, r.dur_end, r.dur_name_ar].join('|');
}

function rowSeasonalSig(r) {
  if (!r) return '';
  var s = ymdFromIso(r.dur_start);
  var e = ymdFromIso(r.dur_end);
  if (!s || !e) return '';
  return [s.m, s.d, e.m, e.d, normalizeString(r.dur_name_ar || '')].join(':');
}
function normalizeString(v) {
  return String(v == null ? '' : v).trim();
}

function main() {
  var root = path.join(__dirname, '..');
  var dwPath = path.join(root, 'data', 'dur_windows.json');
  var stPath = path.join(root, 'data', 'stations.json');

  var dw = JSON.parse(fs.readFileSync(dwPath, 'utf8'));
  var workbookWindows = Array.isArray(dw.workbook_windows) ? dw.workbook_windows : [];
  var stations = JSON.parse(fs.readFileSync(stPath, 'utf8'));
  if (!Array.isArray(stations)) stations = [];

  var catalog = buildWorkbookCityCatalog(workbookWindows);

  var today = new Date().toISOString().slice(0, 10);
  var testDates = [today];
  var d;
  for (d = -30; d <= 30; d += 10) {
    if (d !== 0) testDates.push(addDaysIso(today, d));
  }
  var extras = ['2026-01-15', '2026-06-01', '2026-09-20', '2026-12-05'];
  extras.forEach(function (e) {
    if (testDates.indexOf(e) < 0) testDates.push(e);
  });

  var invalidMapping = [];
  var missingWorkbook = [];
  var lookupErrors = [];
  var mismatchLog = [];

  var withCity = stations.filter(function (s) {
    return s && getStationWorkbookCityName(s);
  });

  var i;
  for (i = 0; i < withCity.length; i += 1) {
    var st = withCity[i];
    var rawCity = getStationWorkbookCityName(st);
    var res = resolveStationWorkbookCity(st, catalog);
    if (!res.ok) {
      invalidMapping.push({ id: st.id, name: st.name_ar || st.name, workbook_city_name: rawCity, code: res.code, key: res.key });
      continue;
    }

    var cityRows = workbookWindows.filter(function (r) {
      return r && normalizeWorkbookCityKey(r.city) === res.key;
    });
    if (!cityRows.length) {
      missingWorkbook.push({ id: st.id, city: res.canonical, reason: 'NO_ROWS_AFTER_KEY' });
      continue;
    }
    var years = {};
    var j;
    for (j = 0; j < cityRows.length; j += 1) {
      var yr = cityRows[j].year;
      if (yr != null) years[String(yr)] = true;
    }
    if (Object.keys(years).length < 2) {
      missingWorkbook.push({ id: st.id, city: res.canonical, reason: 'SINGLE_CYCLE_OR_YEAR', row_count: cityRows.length });
    }

    cityRows.sort(function (a, b) {
      var c = String(a.dur_start).localeCompare(String(b.dur_start));
      if (c !== 0) return c;
      c = Number(a.year) - Number(b.year);
      if (c !== 0) return c;
      return Number(a.dur_index) - Number(b.dur_index);
    });

    var ti;
    for (ti = 0; ti < testDates.length; ti += 1) {
      var iso = testDates[ti];
      if (!iso) continue;
      var found = findWorkbookCurrentNextStrict(workbookWindows, res.key, iso);
      var exp = expectedContainingRow(cityRows, iso);

      if (!found.ok) {
        if (found.code === 'NO_WINDOW_CONTAINS_DATE' && exp.count === 0) {
          continue;
        }
        lookupErrors.push({
          station_id: st.id,
          city: res.canonical,
          as_of: iso,
          code: found.code,
          expected_count: exp.count
        });
        continue;
      }
      if (exp.count !== 1) {
        lookupErrors.push({
          station_id: st.id,
          city: res.canonical,
          as_of: iso,
          code: 'EXPECTED_MISMATCH_DUPLICATE_OR_GAP',
          expected_count: exp.count
        });
        continue;
      }
      if (rowSeasonalSig(found.current) !== rowSeasonalSig(exp.expected)) {
        mismatchLog.push({
          station_id: st.id,
          as_of: iso,
          actual: rowSeasonalSig(found.current) + ' ' + rowSig(found.current),
          expected: rowSeasonalSig(exp.expected) + ' ' + rowSig(exp.expected)
        });
        lookupErrors.push({
          station_id: st.id,
          city: res.canonical,
          as_of: iso,
          code: 'ROW_MISMATCH'
        });
      }
    }
  }

  var report = {
    total_stations_checked: stations.length,
    stations_with_workbook_city: withCity.length,
    stations_with_invalid_city_mapping: invalidMapping.map(function (x) {
      return x.id;
    }),
    invalid_mapping_detail: invalidMapping,
    stations_with_missing_or_sparse_workbook_data: missingWorkbook.map(function (x) {
      return x.id;
    }),
    missing_workbook_detail: missingWorkbook,
    stations_with_lookup_errors: lookupErrors.length
      ? Array.from(new Set(lookupErrors.map(function (e) {
        return e.station_id;
      })))
      : [],
    lookup_errors_sample: lookupErrors.slice(0, 50),
    row_mismatch_samples: mismatchLog.slice(0, 20),
    summary: {
      strict_rule: 'MM-DD in seasonal window (dur_start/dur_end, year-agnostic; wrap allowed)',
      next_rule: 'next distinct seasonal window (circular, by start day-of-year)',
      name_source: 'workbook row dur_name_ar only (synthetic durRow)',
      notes: 'City key: NFC, tatweel removed, whitespace removed, alef/hamza unified to alef'
    }
  };

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
