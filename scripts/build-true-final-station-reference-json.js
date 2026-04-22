/**
 * One-way import: data/navidur_true_final_station_reference.xlsx → data/true_final_station_reference.json
 * Local / validation only — not loaded by production runtime.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const REPO = path.join(__dirname, '..');
const XLSX_IN = path.join(REPO, 'data', 'navidur_true_final_station_reference.xlsx');
const JSON_OUT = path.join(REPO, 'data', 'true_final_station_reference.json');

function trim(v) {
  return String(v == null ? '' : v).trim();
}

function cell(row, key) {
  if (!row) return '';
  return row[key] != null ? row[key] : '';
}

function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function main() {
  if (!fs.existsSync(XLSX_IN)) {
    console.error('Missing workbook:', XLSX_IN);
    process.exit(1);
  }
  const wb = XLSX.readFile(XLSX_IN, { cellDates: false });
  const name = 'Station_Reference';
  if (wb.SheetNames.indexOf(name) < 0) {
    console.error('Expected sheet', name, 'found', wb.SheetNames);
    process.exit(1);
  }
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const stations = rows.map(function (r) {
    return {
      station_name_ar: trim(cell(r, 'Station')),
      region: trim(cell(r, 'Region')),
      lat: toNum(cell(r, 'Latitude')),
      lon: toNum(cell(r, 'Longitude')),
      astronomical_suhail_entry_md: trim(cell(r, 'Astronomical Suhail Entry (DD-MM)')),
      heritage_suhail_entry_md: trim(cell(r, 'Heritage Suhail Entry (DD-MM)')),
      astronomical_offset_days: toNum(cell(r, 'Astronomical Offset Days')),
      dur_at_astronomical_entry: trim(cell(r, 'Dur at Astronomical Entry')),
      dur_day_at_astronomical_entry: toNum(cell(r, 'Dur Day at Astronomical Entry')),
      dur_start_at_astronomical_entry_md: trim(cell(r, 'Dur Start at Astronomical Entry (DD-MM)')),
      dur_end_at_astronomical_entry_md: trim(cell(r, 'Dur End at Astronomical Entry (DD-MM)')),
      dur_at_heritage_entry: trim(cell(r, 'Dur at Heritage Entry')),
      dur_day_at_heritage_entry: toNum(cell(r, 'Dur Day at Heritage Entry')),
      reference_date_md: trim(cell(r, 'Reference Date (DD-MM)')),
      current_dur_name_ar: trim(cell(r, 'Current Dur')),
      current_dur_day_sheet: toNum(cell(r, 'Current Dur Day')),
      elapsed_days_sheet: toNum(cell(r, 'Elapsed Days')),
      remaining_days_sheet: toNum(cell(r, 'Remaining Days')),
      next_dur_name_ar: trim(cell(r, 'Next Dur')),
      current_dur_start_md: trim(cell(r, 'Current Dur Start (DD-MM)')),
      current_dur_end_md: trim(cell(r, 'Current Dur End (DD-MM)')),
      seasonal_model: trim(cell(r, 'Seasonal Model'))
    };
  }).filter(function (s) {
    return s.station_name_ar;
  });

  const out = {
    version: 1,
    reference_mode: 'true_final_station_workbook_v1',
    source_xlsx: 'data/navidur_true_final_station_reference.xlsx',
    authoritative_sheet: 'Station_Reference',
    generated_at: new Date().toISOString(),
    note:
      'Station-specific table. Authoritative timing for validation: current_dur_start_md, current_dur_end_md (DD-MM) with calendar year from as_of; current_dur_name_ar; next_dur_name_ar. Sheet snapshot columns (reference_date_md, current_dur_day_sheet, etc.) are preserved for comparison only.',
    stations: stations
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('Wrote', JSON_OUT, 'stations', stations.length);
}

main();
