#!/usr/bin/env node
/**
 * Rebuilds data/dur_windows.json from data/navidur_operational_durur_2025_2026.xlsx only.
 * - Template windows: sheet "نوافذ_الدرور" (serial dates in columns).
 * - City list: sheet "ملخص_المحطات" (column "المحطة"); each city gets the same window rows as the template.
 * Does not read existing dur_windows.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const REPO = path.join(__dirname, '..');
const XLSX_PATH = path.join(REPO, 'data', 'navidur_operational_durur_2025_2026.xlsx');
const OUT_PATH = path.join(REPO, 'data', 'dur_windows.json');

const SHEET_WINDOWS = 'نوافذ_الدرور';
const SHEET_CITIES = 'ملخص_المحطات';
const COL_CITY = 'المحطة';

function nowIso() {
  return new Date().toISOString();
}

function normalizeArabic(s) {
  if (s == null || s === '') return '';
  return String(s).replace(/^\s+|\s+$/g, '').normalize('NFC');
}

function parseIntSafe(v) {
  if (v == null || v === '') return null;
  var n = parseInt(String(v).trim().replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Excel 1900 serial to YYYY-MM-DD (UTC, whole calendar day).
 * @param {number|string} serial
 */
function serialToIso(serial) {
  if (serial == null || serial === '') return null;
  var n = Number(serial);
  if (!Number.isFinite(n)) return null;
  var epoch = new Date(Date.UTC(1899, 11, 30));
  var ms = epoch.getTime() + Math.round(n) * 86400000;
  var d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function isValidIso(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-');
  var dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 0, 0, 0, 0));
  return !Number.isNaN(dt.getTime());
}

function mustGetSheet(wb, name) {
  var sh = wb.Sheets[name];
  if (!sh || !sh['!ref']) throw new Error('missing_or_empty_sheet_' + name);
  return sh;
}

function getCitiesFromSummary(wb) {
  var sh = mustGetSheet(wb, SHEET_CITIES);
  var rows = XLSX.utils.sheet_to_json(sh, { defval: null, raw: false });
  var cities = [];
  var seen = Object.create(null);
  rows.forEach(function (r) {
    var c = normalizeArabic(r[COL_CITY]);
    if (!c || seen[c]) return;
    seen[c] = true;
    cities.push(c);
  });
  if (!cities.length) throw new Error('no_cities_in_' + SHEET_CITIES);
  return cities;
}

function getWindowTemplate(wb) {
  var sh = mustGetSheet(wb, SHEET_WINDOWS);
  return XLSX.utils.sheet_to_json(sh, { defval: null, raw: true });
}

function buildDoc(wb) {
  var templateRows = getWindowTemplate(wb);
  var cities = getCitiesFromSummary(wb);
  var warnings = [];
  var malformed = [];
  var out = [];
  var seenKeys = Object.create(null);

  templateRows.forEach(function (row, idx) {
    var line = idx + 2;
    var cycle = normalizeArabic(row['الدورة']);
    var durIndex = parseIntSafe(row['الترتيب']);
    var nameAr = normalizeArabic(row['اسم الدُّر']);
    var lenDays = parseIntSafe(row['المدة (يوم)']);
    var sRaw = row['بداية الدُّر'];
    var eRaw = row['نهاية الدُّر'];
    var start = serialToIso(sRaw);
    var end = serialToIso(eRaw);
    if (!nameAr || durIndex == null || lenDays == null) {
      malformed.push({ line: line, reason: 'missing_name_index_or_length', row: row });
      return;
    }
    if (!start || !end || !isValidIso(start) || !isValidIso(end)) {
      malformed.push({ line: line, reason: 'bad_date_serial', sRaw: sRaw, eRaw: eRaw, start: start, end: end, row: row });
      return;
    }
    if (start > end) {
      malformed.push({ line: line, reason: 'start_after_end', start: start, end: end });
      return;
    }
    if (!cycle) {
      warnings.push('row ' + line + ': empty الدورة (continuing with dates only)');
    }
    var y = new Date(start + 'T00:00:00.000Z').getUTCFullYear();

    cities.forEach(function (city) {
      var rec = {
        city: city,
        year: y,
        dur_index: durIndex,
        dur_name_ar: nameAr,
        dur_length_days: lenDays,
        dur_start: start,
        dur_end: end,
        entry_date: start,
        source: 'workbook_import',
        operational_cycle_label: cycle || null
      };
      var k = city + '\t' + y + '\t' + durIndex;
      if (seenKeys[k]) {
        warnings.push('duplicate key skipped ' + k);
        return;
      }
      seenKeys[k] = true;
      out.push(rec);
    });
  });

  out.sort(function (a, b) {
    if (a.city !== b.city) return String(a.city).localeCompare(String(b.city), 'ar');
    if (a.year !== b.year) return a.year - b.year;
    return a.dur_index - b.dur_index;
  });

  return {
    doc: {
      version: 2,
      incomplete: malformed.length > 0,
      incomplete_reason: malformed.length ? 'operational_workbook_rebuild_malformed_rows' : null,
      message_ar:
        'مبني بالكامل من الملف: navidur_operational_durur_2025_2026.xlsx — الورقة نوافذ_الدرور (النوافذ) × ملخص_المحطات (المدن). لا دمج من dur_windows.json السابق.',
      generated_at: nowIso(),
      bands: {},
      workbook_windows: out,
      workbook_import: {
        import_version: 'operational_workbook_2025_2026_rebuild_v1',
        imported_at: nowIso(),
        source_file_name: 'navidur_operational_durur_2025_2026.xlsx',
        source_sheets: [SHEET_WINDOWS, SHEET_CITIES],
        city_count: cities.length,
        template_row_count: templateRows.length,
        output_row_count: out.length,
        malformed_row_count: malformed.length,
        malformed: malformed,
        warnings: warnings
      }
    },
    cities: cities,
    malformed: malformed,
    warnings: warnings
  };
}

function verifyAbuDhabi() {
  var wb = require(path.join(REPO, 'shared', 'workbook-dur-lookup.js'));
  var raw = fs.readFileSync(OUT_PATH, 'utf8');
  var doc = JSON.parse(raw);
  var rows = Array.isArray(doc.workbook_windows) ? doc.workbook_windows : [];
  var found = wb.findWorkbookCurrentNextStrict(rows, wb.normalizeWorkbookCityKey('أبوظبي'), '2026-04-22');
  if (!found.ok) {
    return { ok: false, error: found };
  }
  var c = found.current;
  var n = found.next;
  var pass =
    c &&
    c.dur_name_ar === 'المؤخر' &&
    c.dur_start === '2026-04-13' &&
    c.dur_end === '2026-04-25' &&
    n &&
    n.dur_name_ar === 'الرشاء';
  return {
    ok: pass,
    current: c ? { name: c.dur_name_ar, start: c.dur_start, end: c.dur_end } : null,
    next: n ? { name: n.dur_name_ar, start: n.dur_start, end: n.dur_end } : null
  };
}

function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error('missing', XLSX_PATH);
    process.exit(1);
  }
  var xwb = XLSX.readFile(XLSX_PATH, { cellDates: false });
  var result = buildDoc(xwb);
  if (result.malformed.length) {
    console.error('MALFORMED rows (file not written):', JSON.stringify(result.malformed, null, 2));
    process.exit(1);
  }
  var json = JSON.stringify(result.doc, null, 2) + '\n';
  var tmp = OUT_PATH + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, OUT_PATH);
  var v = verifyAbuDhabi();
  console.log(
    JSON.stringify(
      {
        ok: true,
        written: OUT_PATH,
        workbook_window_rows: result.doc.workbook_windows.length,
        cities: result.cities.length,
        warnings: result.warnings,
        verify_abu_dhabi_2026_04_22: v
      },
      null,
      2
    )
  );
  if (!v.ok) {
    process.exit(2);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

module.exports = { buildDoc, main, XLSX_PATH, OUT_PATH };
