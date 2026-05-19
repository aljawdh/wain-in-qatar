'use strict';

var tfLookup = require('../../shared/true-final-station-reference-lookup');
var seasonalCore = require('../../shared/navdur-seasonal-core');
var suhailCalc = require('../../shared/suhail-canopus-calc');

var CALENDAR_MODES = {
  copy_from_reference: 'copy_from_reference',
  copy_and_shift_by_suhail_anchor: 'copy_and_shift_by_suhail_anchor',
  generate_from_coordinates: 'generate_from_coordinates'
};

var SUHAIL_YEAR0 = 2025;
var SUHAIL_YEAR1 = 2050;

function stationNameAr(station) {
  return String(station && (station.name_ar || station.name) || '').trim();
}

function stationNameMatches(rowName, wantName) {
  var wantExact = tfLookup.nfcString(wantName);
  var wantNorm = tfLookup.normalizeArabicName(wantName);
  var rowExact = tfLookup.nfcString(rowName);
  if (rowExact === wantExact) return true;
  if (wantNorm && tfLookup.normalizeArabicName(rowName) === wantNorm) return true;
  return false;
}

function countAnnualRows(doc, nameAr) {
  var annual = Array.isArray(doc && doc.annual_flat_rows) ? doc.annual_flat_rows : [];
  var n = 0;
  for (var i = 0; i < annual.length; i += 1) {
    if (stationNameMatches(annual[i] && annual[i].station_name_ar, nameAr)) n += 1;
  }
  return n;
}

function findTrueFinalStationEntry(doc, nameAr) {
  var list = Array.isArray(doc && doc.stations) ? doc.stations : [];
  for (var i = 0; i < list.length; i += 1) {
    if (stationNameMatches(list[i] && list[i].station_name_ar, nameAr)) return list[i];
  }
  return null;
}

function doyFromDdMm(ddmm) {
  var p = tfLookup.parseDayMonthDdMm(ddmm);
  if (!p) return null;
  return seasonalCore.dayOfYearNonLeap2001(p.m, p.d);
}

function shiftDdMm(ddmm, shiftDays) {
  var doy = doyFromDdMm(ddmm);
  if (doy == null || !Number.isFinite(Number(shiftDays))) return ddmm;
  var next = seasonalCore.addDaysToDoy1Based(doy, Number(shiftDays));
  return seasonalCore.doy1ToDdMm(next);
}

function resolveSuhailMdFromTrueFinal(doc, nameAr) {
  var entry = findTrueFinalStationEntry(doc, nameAr);
  if (!entry) return { md: '', method: 'missing_true_final_entry' };
  var md =
    String(entry.astronomical_suhail_entry_md || '').trim() ||
    String(entry.heritage_suhail_entry_md || '').trim();
  if (md) {
    return {
      md: md,
      method: entry.astronomical_suhail_entry_md ? 'astronomical_suhail_entry_md' : 'heritage_suhail_entry_md'
    };
  }
  return { md: '', method: 'missing_suhail_md_in_entry' };
}

function resolveSuhailMdFromCoordinates(lat, lon) {
  var la = Number(lat);
  var lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) {
    return { md: '', method: 'invalid_coordinates', error: 'invalid_coordinates' };
  }
  var mode = suhailCalc.modeAstronomicalSuhailEntry(la, lo, SUHAIL_YEAR0, SUHAIL_YEAR1, false);
  if (!mode || !mode.modeDdMm) {
    return {
      md: '',
      method: 'mode_astronomical_suhail_entry',
      error: (mode && mode.warning) || 'suhail_unresolved'
    };
  }
  return { md: mode.modeDdMm, method: 'mode_astronomical_suhail_entry' };
}

function computeSuhailShift(sourceMd, targetMd) {
  var dSource = doyFromDdMm(sourceMd);
  var dTarget = doyFromDdMm(targetMd);
  if (dSource == null || dTarget == null) {
    return { ok: false, error: 'suhail_date_parse_failed', source_suhail_date: sourceMd, target_suhail_date: targetMd };
  }
  return {
    ok: true,
    shift_days: seasonalCore.signedOffsetDays(dTarget, dSource),
    source_suhail_date: sourceMd,
    target_suhail_date: targetMd,
    anchor_method: 'true_final_or_astronomical_mode'
  };
}

function removeTargetCalendar(doc, targetName) {
  doc.stations = (Array.isArray(doc.stations) ? doc.stations : []).filter(function (row) {
    return !stationNameMatches(row && row.station_name_ar, targetName);
  });
  doc.annual_flat_rows = (Array.isArray(doc.annual_flat_rows) ? doc.annual_flat_rows : []).filter(function (row) {
    return !stationNameMatches(row && row.station_name_ar, targetName);
  });
}

function buildAnnualRowMetadata(opts) {
  return {
    promoted_reference_station: true,
    copied_from_reference_station_id: opts.copied_from_reference_station_id || '',
    calendar_generation_mode: opts.calendar_generation_mode || '',
    requires_calibration: true,
    calibration_status: opts.calibration_status || 'initial_promoted_reference',
    shift_days: opts.shift_days != null ? opts.shift_days : null,
    source_suhail_date: opts.source_suhail_date || null,
    target_suhail_date: opts.target_suhail_date || null,
    anchor_method: opts.anchor_method || null
  };
}

function copyAnnualFlatRows(doc, options) {
  var sourceName = options.source_name_ar;
  var targetStation = options.target_station;
  var targetName = stationNameAr(targetStation);
  var mode = options.calendar_generation_mode;
  var shiftDays = options.shift_days || 0;
  var metaBase = options.metadata || {};
  var annual = Array.isArray(doc.annual_flat_rows) ? doc.annual_flat_rows : [];
  var added = [];

  for (var i = 0; i < annual.length; i += 1) {
    var row = annual[i];
    if (!row || !stationNameMatches(row.station_name_ar, sourceName)) continue;
    var startMd = String(row.start_md || '');
    var endMd = String(row.end_md || '');
    if (mode === CALENDAR_MODES.copy_and_shift_by_suhail_anchor && shiftDays) {
      startMd = shiftDdMm(startMd, shiftDays);
      endMd = shiftDdMm(endMd, shiftDays);
    }
    var clone = Object.assign({}, row, {
      station_name_ar: targetName,
      start_md: startMd,
      end_md: endMd
    }, buildAnnualRowMetadata(metaBase));
    annual.push(clone);
    added.push(clone);
  }

  doc.annual_flat_rows = annual;
  return added.length;
}

function upsertTrueFinalStationEntry(doc, targetStation, sourceStation, options) {
  var targetName = stationNameAr(targetStation);
  var sourceName = stationNameAr(sourceStation);
  var sourceEntry = findTrueFinalStationEntry(doc, sourceName) || {};
  var list = Array.isArray(doc.stations) ? doc.stations.slice() : [];
  list = list.filter(function (row) {
    return !stationNameMatches(row && row.station_name_ar, targetName);
  });

  var entry = Object.assign({}, sourceEntry, {
    station_id: String(targetStation.id || ''),
    station_name: targetName,
    station_name_ar: targetName,
    country: String(targetStation.country || sourceEntry.region || ''),
    region: String(targetStation.region || sourceEntry.region || 'الخليج'),
    lat: targetStation.lat != null ? targetStation.lat : sourceEntry.lat,
    lon: targetStation.lon != null ? targetStation.lon : sourceEntry.lon,
    lng: targetStation.lon != null ? targetStation.lon : sourceEntry.lon,
    is_reference_station: true,
    reference_calendar_status: options.reference_calendar_status || '',
    copied_from_reference_station_id: options.copied_from_reference_station_id || '',
    copied_from_reference_station_name: sourceName,
    requires_calibration: true,
    calibration_status: 'initial_promoted_reference',
    calendar_generation_mode: options.calendar_generation_mode || '',
    shift_days: options.shift_days != null ? options.shift_days : null,
    source_suhail_date: options.source_suhail_date || null,
    target_suhail_date: options.target_suhail_date || null,
    anchor_method: options.anchor_method || null
  });

  if (options.target_suhail_date && modeUsesShift(options.calendar_generation_mode)) {
    entry.astronomical_suhail_entry_md = options.target_suhail_date;
    if (!entry.heritage_suhail_entry_md && sourceEntry.heritage_suhail_entry_md) {
      entry.heritage_suhail_entry_md = shiftDdMm(sourceEntry.heritage_suhail_entry_md, options.shift_days || 0);
    }
  }

  list.push(entry);
  doc.stations = list;
  return entry;
}

function modeUsesShift(mode) {
  return mode === CALENDAR_MODES.copy_and_shift_by_suhail_anchor;
}

function calendarStatusForMode(mode) {
  if (mode === CALENDAR_MODES.copy_from_reference) return 'copied_from_reference';
  if (mode === CALENDAR_MODES.copy_and_shift_by_suhail_anchor) return 'shifted_from_reference';
  if (mode === CALENDAR_MODES.generate_from_coordinates) return 'generated_from_coordinates';
  return 'unknown';
}

function isValidCalendarSourceStation(station, doc) {
  if (!station) return { ok: false, error: 'invalid_source_reference' };
  var name = stationNameAr(station);
  var rows = countAnnualRows(doc, name);
  if (rows < 1) return { ok: false, error: 'source_missing_annual_flat_rows', annual_rows: rows };
  var isRef = station.is_reference_station === true || station.primary_reference === true;
  var inCatalog = !!findTrueFinalStationEntry(doc, name);
  if (!isRef && !inCatalog) {
    return { ok: false, error: 'invalid_source_reference', hint: 'source must be reference or in true_final catalog' };
  }
  return { ok: true, annual_rows: rows, is_reference_station: isRef, in_true_final_catalog: inCatalog };
}

module.exports = {
  CALENDAR_MODES: CALENDAR_MODES,
  stationNameAr: stationNameAr,
  stationNameMatches: stationNameMatches,
  countAnnualRows: countAnnualRows,
  findTrueFinalStationEntry: findTrueFinalStationEntry,
  removeTargetCalendar: removeTargetCalendar,
  copyAnnualFlatRows: copyAnnualFlatRows,
  upsertTrueFinalStationEntry: upsertTrueFinalStationEntry,
  resolveSuhailMdFromTrueFinal: resolveSuhailMdFromTrueFinal,
  resolveSuhailMdFromCoordinates: resolveSuhailMdFromCoordinates,
  computeSuhailShift: computeSuhailShift,
  calendarStatusForMode: calendarStatusForMode,
  isValidCalendarSourceStation: isValidCalendarSourceStation
};
