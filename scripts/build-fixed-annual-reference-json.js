#!/usr/bin/env node
/**
 * One-way import: data/navidur_fixed_annual_reference.xlsx → data/fixed_annual_reference.json
 * No merge with prior timing sources.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const REPO = path.join(__dirname, '..');
const XLSX_IN = path.join(REPO, 'data', 'navidur_fixed_annual_reference.xlsx');
const JSON_OUT = path.join(REPO, 'data', 'fixed_annual_reference.json');

const ALIAS_AR_TO_SHEET_EN = {
  الكويت: 'Kuwait',
  الجبيل: 'Jubail',
  العقير: 'Al Uqair',
  'أم باب': 'Umm Bab',
  دبي: 'Dubai',
  أبوظبي: 'Abu Dhabi',
  مسندم: 'Musandam',
  مسقط: 'Muscat',
  الدقم: 'Duqm',
  صلالة: 'Salalah',
  المكلا: 'Mukalla',
  حقل: 'Haql',
  الوجه: 'Al Wajh',
  ينبع: 'Yanbu',
  جدة: 'Jeddah',
  القنفذة: 'Qunfudhah',
  جازان: 'Jazan',
  الحديدة: 'Hodeidah',
  الإسكندرية: 'Alexandria',
  بيروت: 'Beirut',
  أنطاليا: 'Antalya'
};

function nowIso() {
  return new Date().toISOString();
}

function main() {
  if (!fs.existsSync(XLSX_IN)) {
    console.error('missing', XLSX_IN);
    process.exit(1);
  }
  const wb = XLSX.readFile(XLSX_IN, { cellDates: false });
  const sh = wb.Sheets['Annual_Reference'];
  if (!sh) {
    console.error('missing_sheet_Annual_Reference');
    process.exit(1);
  }
  const rows = XLSX.utils.sheet_to_json(sh, { defval: null, raw: false });
  const stations = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] || {};
    const en = String(r.Station || '').trim();
    if (!en) continue;
    stations.push({
      sheet_station_en: en,
      region: r.Region != null ? String(r.Region).trim() : null,
      latitude: r.Latitude,
      longitude: r.Longitude,
      reference_type: r['Reference Type'] != null ? String(r['Reference Type']).trim() : null,
      astronomical_suhail_entry_ddmm: r['Astronomical Suhail Entry (DD-MM)'] != null
        ? String(r['Astronomical Suhail Entry (DD-MM)']).trim() || null
        : null,
      heritage_suhail_entry_ddmm: r['Heritage Suhail Entry (DD-MM)'] != null
        ? String(r['Heritage Suhail Entry (DD-MM)']).trim() || null
        : null,
      dur_name_at_heritage_entry_snapshot: r['Dur at Heritage Entry'] != null
        ? String(r['Dur at Heritage Entry']).trim() || null
        : null,
      current_dur_name_ar: r['Current Dur on 23-04'] != null ? String(r['Current Dur on 23-04']).trim() || null : null,
      next_dur_name_ar: r['Next Dur'] != null ? String(r['Next Dur']).trim() || null : null,
      current_dur_start_ddmm: r['Current Dur Start (DD-MM)'] != null
        ? String(r['Current Dur Start (DD-MM)']).trim() || null
        : null,
      current_dur_end_ddmm: r['Current Dur End (DD-MM)'] != null
        ? String(r['Current Dur End (DD-MM)']).trim() || null
        : null,
      method: r.Method != null ? String(r.Method).trim() : null
    });
  }

  const doc = {
    version: 1,
    reference_mode: 'fixed_annual_day_month',
    source_xlsx: 'data/navidur_fixed_annual_reference.xlsx',
    sheet: 'Annual_Reference',
    generated_at: nowIso(),
    description_ar:
      'بيانات مستوردة فقط من المصنف السنوي الثابت. التوقيت الموسمي حسب يوم-شهر فقط. دخول سهيل مذكور كمرجع فقط ولا يضبط الدر الحالي في المحرك.',
    stations: stations,
    alias_ar_to_sheet_en: ALIAS_AR_TO_SHEET_EN
  };

  const tmp = JSON_OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, JSON_OUT);
  console.log(JSON.stringify({ ok: true, out: path.relative(REPO, JSON_OUT), station_rows: stations.length }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

module.exports = { main, XLSX_IN, JSON_OUT, ALIAS_AR_TO_SHEET_EN };
