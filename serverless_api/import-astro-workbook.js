'use strict';

/**
 * One-way import from NAVIDUR master workbook → data/dur_sequence_map.json,
 * data/star_events.json, data/dur_windows.json (city-level workbook windows only).
 * Does not enable runtime astro engine. Safe to run offline before deploy.
 *
 * Usage: node serverless_api/import-astro-workbook.js
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const repoRoot = path.join(__dirname, '..');
const WORKBOOK_REL = path.join('data_sources', 'workbooks', 'navidur_durur_master_workbook_v1.xlsx');
const WORKBOOK_ABS = path.join(repoRoot, WORKBOOK_REL);
const DATA_DIR = path.join(repoRoot, 'data');

const IMPORT_VERSION = 'workbook_import_v1';
const EXPECTED_DUR_COUNT = 28;

function nowIso() {
  return new Date().toISOString();
}

/** @param {string|null|undefined} s */
function normalizeArabic(s) {
  if (s == null || s === '') return '';
  return String(s).replace(/^\s+|\s+$/g, '').normalize('NFC');
}

/** @param {string|null|undefined} raw */
function parseIsoDate(raw) {
  var t = raw == null ? '' : String(raw).trim();
  if (!t) return null;
  var m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  var dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  if (Number.isNaN(dt.getTime())) return null;
  return m[0];
}

/** @param {*} v */
function parseFiniteNumber(v) {
  if (v == null || v === '') return null;
  var n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** @param {*} v */
function parseIntSafe(v) {
  if (v == null || v === '') return null;
  var n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} sheetName
 * @param {XLSX.WorkSheet} sheet
 */
function sheetToRows(sheetName, sheet) {
  if (!sheet || !sheet['!ref']) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
}

/**
 * @param {XLSX.WorkBook} wb
 * @param {string} exact
 */
function mustGetSheet(wb, exact) {
  var i = wb.SheetNames.indexOf(exact);
  if (i < 0) throw new Error('missing_sheet_' + exact);
  var sh = wb.Sheets[exact];
  if (!sh) throw new Error('empty_sheet_' + exact);
  return sh;
}

/**
 * @returns {{ doc: object, warnings: string[], partial: boolean }}
 */
function buildDurSequence(wb, metaBase) {
  var warnings = [];
  var sh = mustGetSheet(wb, 'Durur_Sequence');
  var rows = sheetToRows('Durur_Sequence', sh);
  var rules = [];

  rows.forEach(function (row, idx) {
    var di = parseIntSafe(row.dur_index);
    var nameAr = normalizeArabic(row.dur_name);
    var durDays = parseIntSafe(row.dur_length_days);
    if (di == null || !nameAr || durDays == null) {
      warnings.push('Durur_Sequence row ' + (idx + 2) + ': missing dur_index/dur_name/dur_length_days — skipped');
      return;
    }
    var durId = 'dur_' + String(di).padStart(2, '0');
    rules.push({
      dur_id: durId,
      dur_name_ar: nameAr,
      sequence_index: di,
      offset_days_from_anchor: null,
      duration_days: durDays
    });
  });

  rules.sort(function (a, b) {
    return a.sequence_index - b.sequence_index;
  });

  var partial = rules.length !== EXPECTED_DUR_COUNT;
  if (partial) {
    warnings.push(
      'Durur_Sequence: expected ' + EXPECTED_DUR_COUNT + ' rules, got ' + rules.length + ' (partial import flagged)'
    );
  }

  var dupIdx = new Set();
  rules.forEach(function (r) {
    if (dupIdx.has(r.sequence_index)) {
      warnings.push('duplicate sequence_index ' + r.sequence_index);
      partial = true;
    }
    dupIdx.add(r.sequence_index);
  });

  var doc = {
    version: 2,
    anchor_star: 'suhail',
    notes_ar:
      'مستورد من المصنف المرجعي — أسماء الدور وأطوالها كما في الورقة؛ offset_days_from_anchor غير موجود في المصنف ويبقى فارغاً.',
    rules: rules,
    import: Object.assign({}, metaBase, {
      source_sheet_names: ['Durur_Sequence'],
      row_count: rules.length,
      warnings: warnings.slice(),
      partial: partial
    })
  };

  return { doc: doc, warnings: warnings, partial: partial };
}

/**
 * @param {XLSX.WorkBook} wb
 * @param {object} metaBase
 */
function buildStarEvents(wb, metaBase) {
  var warnings = [];
  var skippedRows = 0;
  /** @type {object[]} */
  var events = [];
  var profiles = [
    { sheet: 'Astronomical_2016_2025', calendar_profile: 'operational_v1' },
    { sheet: 'Astronomical_2026_2055', calendar_profile: 'operational_v1' },
    { sheet: 'Strict_-12_2016_2025', calendar_profile: 'strict_minus_12' },
    { sheet: 'Strict_-12_2026_2055', calendar_profile: 'strict_minus_12' }
  ];

  profiles.forEach(function (p) {
    var sh = wb.Sheets[p.sheet];
    if (!sh) {
      warnings.push('missing_optional_sheet_' + p.sheet);
      return;
    }
    var rows = sheetToRows(p.sheet, sh);
    rows.forEach(function (row, idx) {
      var city = normalizeArabic(row.city);
      var y = parseIntSafe(row.year);
      var entry = parseIsoDate(row.entry_date);
      if (!city || y == null || !entry) {
        skippedRows++;
        warnings.push(p.sheet + ' row ' + (idx + 2) + ': skip (city/year/entry_date)');
        return;
      }
      var lat = parseFiniteNumber(row.lat);
      var lon = parseFiniteNumber(row.lon);
      var timeUtc = row.time_utc != null && String(row.time_utc).trim() !== '' ? String(row.time_utc).trim() : null;
      var alt = parseFiniteNumber(row.star_alt_deg);

      events.push({
        star_key: 'suhail',
        city: city,
        lat: lat,
        lon: lon,
        latitude_band_key: null,
        year: y,
        event_date: entry,
        time_utc: timeUtc,
        star_alt_deg: alt,
        calendar_profile: p.calendar_profile,
        source_sheet: p.sheet,
        source: 'workbook_import',
        source_file: metaBase.source_file_name,
        is_verified: false,
        imported: true
      });
    });
  });

  var knownKeysPath = path.join(DATA_DIR, 'star_events.json');
  var prevKnown = [];
  try {
    var rawPrev = fsSync.readFileSync(knownKeysPath, 'utf8');
    var prev = JSON.parse(rawPrev);
    if (Array.isArray(prev.known_latitude_band_keys)) prevKnown = prev.known_latitude_band_keys;
  } catch (_) {
    /* ignore */
  }

  var sheetNamesUsed = profiles.map(function (p) {
    return wb.SheetNames.indexOf(p.sheet) >= 0 ? p.sheet : null;
  }).filter(Boolean);

  var partial =
    warnings.some(function (w) {
      return w.indexOf('missing_optional_sheet') === 0;
    }) || skippedRows > 0;

  var doc = {
    version: 2,
    star_key_default: 'suhail',
    schema_note:
      'مدخلات مدنية (city) من استيراد المصنف — latitude_band_key غير مربوط تلقائياً بخطوط عرض المحطات.',
    known_latitude_band_keys: prevKnown.length ? prevKnown : [],
    events: events,
    import: Object.assign({}, metaBase, {
      source_sheet_names: sheetNamesUsed,
      row_count: events.length,
      skipped_rows: skippedRows,
      warnings: warnings.slice(),
      partial: partial
    })
  };

  return { doc: doc, warnings: warnings, partial: partial };
}

/**
 * @param {XLSX.WorkBook} wb
 * @param {object} metaBase
 */
function buildDurWindows(wb, metaBase) {
  var warnings = [];
  var sh = mustGetSheet(wb, 'Durur_Windows_All');
  var rows = sheetToRows('Durur_Windows_All', sh);

  /** @type {object[]} */
  var windows = [];
  var seen = new Map();
  var malformed = 0;
  var dupSkipped = 0;

  rows.forEach(function (row, idx) {
    var city = normalizeArabic(row.city);
    var year = parseIntSafe(row.year);
    var durIdx = parseIntSafe(row.dur_index);
    var nameAr = normalizeArabic(row.dur_name);
    var lenDays = parseIntSafe(row.dur_length_days);
    var start = parseIsoDate(row.dur_start);
    var end = parseIsoDate(row.dur_end);
    var entry = parseIsoDate(row.entry_date);

    if (!city || year == null || durIdx == null || !nameAr || lenDays == null || !start || !end) {
      malformed++;
      warnings.push('Durur_Windows_All row ' + (idx + 2) + ': malformed — skipped');
      return;
    }

    var dedup = city + '|' + year + '|' + durIdx;
    if (seen.has(dedup)) {
      dupSkipped++;
      warnings.push('Durur_Windows_All row ' + (idx + 2) + ': duplicate ' + dedup + ' — skipped');
      return;
    }
    seen.set(dedup, true);

    windows.push({
      city: city,
      year: year,
      dur_index: durIdx,
      dur_name_ar: nameAr,
      dur_length_days: lenDays,
      dur_start: start,
      dur_end: end,
      entry_date: entry || null,
      source: 'workbook_import'
    });
  });

  var cities = new Set(windows.map(function (w) { return w.city; }));
  var years = new Set(windows.map(function (w) { return w.year; }));

  var expectedCombinations = cities.size * years.size * EXPECTED_DUR_COUNT;
  var partial =
    malformed > 0 ||
    dupSkipped > 0 ||
    windows.length !== expectedCombinations ||
    windows.length !== rows.length - malformed - dupSkipped;

  if (windows.length !== expectedCombinations) {
    warnings.push(
      'Durur_Windows_All: imported ' + windows.length + ' windows; expected ' + expectedCombinations +
        ' (' + cities.size + ' cities × ' + years.size + ' years × ' + EXPECTED_DUR_COUNT + ' durs)'
    );
  }

  var workbookMeta = Object.assign({}, metaBase, {
    source_sheet_names: ['Durur_Windows_All'],
    row_count: windows.length,
    skipped_malformed_rows: malformed,
    skipped_duplicate_rows: dupSkipped,
    warnings: warnings.slice(),
    partial: partial,
    stats: {
      imported_cities: cities.size,
      imported_years: years.size,
      imported_dur_windows: windows.length
    }
  });

  var doc = {
    version: 2,
    incomplete: true,
    incomplete_reason: 'workbook_city_layer_band_engine_primary',
    message_ar:
      'نوافذ الدور لكل مدينة وسنة مستوردة من المصنف؛ طبقة خط العرض (bands) للمولّد القديم منفصلة ولا تُستبدل تلقائياً.',
    generated_at: nowIso(),
    bands: {},
    workbook_windows: windows,
    workbook_import: workbookMeta
  };

  return { doc: doc, warnings: warnings, partial: partial };
}

async function writeJson(relPath, obj) {
  var full = path.join(DATA_DIR, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  var tmp = full + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, full);
}

async function main() {
  await fs.access(WORKBOOK_ABS);

  var wb = XLSX.readFile(WORKBOOK_ABS, { cellDates: false });
  var metaBase = {
    imported_at: nowIso(),
    source_file_name: path.basename(WORKBOOK_ABS),
    source_file_path: WORKBOOK_REL.replace(/\\/g, '/'),
    import_version: IMPORT_VERSION,
    workbook_sheet_names: wb.SheetNames.slice()
  };

  var allWarnings = [];

  var seq = buildDurSequence(wb, metaBase);
  allWarnings = allWarnings.concat(seq.warnings);

  var stars = buildStarEvents(wb, metaBase);
  allWarnings = allWarnings.concat(stars.warnings);

  var wins = buildDurWindows(wb, metaBase);
  allWarnings = allWarnings.concat(wins.warnings);

  await writeJson('dur_sequence_map.json', seq.doc);
  await writeJson('star_events.json', stars.doc);
  await writeJson('dur_windows.json', wins.doc);

  console.log(JSON.stringify({
    ok: true,
    import_version: IMPORT_VERSION,
    workbook: WORKBOOK_REL.replace(/\\/g, '/'),
    sheets_used: {
      Durur_Sequence: true,
      Astronomical_2016_2025: wb.SheetNames.indexOf('Astronomical_2016_2025') >= 0,
      Astronomical_2026_2055: wb.SheetNames.indexOf('Astronomical_2026_2055') >= 0,
      Strict_minus12_2016_2025: wb.SheetNames.indexOf('Strict_-12_2016_2025') >= 0,
      Strict_minus12_2026_2055: wb.SheetNames.indexOf('Strict_-12_2026_2055') >= 0,
      Durur_Windows_All: true
    },
    dur_sequence_rules: seq.doc.rules.length,
    star_events_rows: stars.doc.events.length,
    dur_windows_rows: wins.doc.workbook_windows.length,
    workbook_import_stats: wins.doc.workbook_import.stats,
    partial_flags: {
      dur_sequence: seq.partial,
      star_events: stars.partial,
      dur_windows: wins.partial
    },
    warning_count: allWarnings.length,
    warnings_sample: allWarnings.slice(0, 30)
  }, null, 2));
}

if (require.main === module) {
  main().catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  main,
  IMPORT_VERSION,
  WORKBOOK_REL,
  normalizeArabic,
  parseIsoDate
};
