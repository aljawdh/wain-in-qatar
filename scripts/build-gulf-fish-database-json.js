/**
 * One-shot: merge data/gulf_fish_database.xlsx (sheets 01 + 02) → data/gulf_fish_database.json
 * Run: node scripts/build-gulf-fish-database-json.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const XLSX_IN = path.join(ROOT, 'data', 'gulf_fish_database.xlsx');
const JSON_OUT = path.join(ROOT, 'data', 'gulf_fish_database.json');

function parseDepthRange(text) {
  const s = String(text || '').trim();
  if (!s) return { min_m: null, max_m: null, label: '' };
  const low = s.toLowerCase();
  const surf = low.match(/سطحي/i);
  if (surf) {
    const m = s.match(/(\d+)\s*[-–]?\s*(\d+)?\s*م?/);
    if (m) {
      const a = Number(m[1]);
      const b = m[2] != null ? Number(m[2]) : 60;
      return { min_m: 0, max_m: b, label: s };
    }
    return { min_m: 0, max_m: 40, label: s };
  }
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*م?/);
  if (m) {
    return { min_m: parseFloat(m[1].replace(',', '.')), max_m: parseFloat(m[2].replace(',', '.')), label: s };
  }
  const one = s.match(/(\d+)\s*م/);
  if (one) {
    const v = Number(one[1]);
    return { min_m: v, max_m: v, label: s };
  }
  return { min_m: null, max_m: null, label: s };
}

function inferHabitatTags(localHabitat) {
  const t = String(localHabitat || '');
  const tags = new Set();
  if (/شعاب|صخر|reef/i.test(t)) tags.add('شعاب');
  if (/رمل|rubble|ساحل/i.test(t)) tags.add('رملي');
  if (/طين|mangrove|سابخ/i.test(t)) tags.add('طيني');
  if (/مفتوح|مياه مفتوحة|open|offshore|خارجي/i.test(t)) tags.add('مياه مفتوحة');
  if (/ساحل|ساحلي|شاطئ|ضحل/i.test(t)) tags.add('ساحلي');
  if (/عميق|أعماق|عمق|غزير|deep|جرف/i.test(t)) tags.add('غزير');
  if (!tags.size) tags.add('عام');
  return Array.from(tags);
}

function inferEcoZone(classification) {
  const c = String(classification || '');
  if (/سطحي|مهاجر|تونة|لخم|إسقمر|open/i.test(c)) return { zone: 'مياه مفتوحة', water_pref: 'LOAD' };
  if (/قاعي|قاع|صخور|بوم|هامور|ناجل/i.test(c)) return { zone: 'غزير', water_pref: 'FASAD' };
  if (/ساحل|ضحل|نهر|مصب/i.test(c)) return { zone: 'ساحلي', water_pref: 'LOAD' };
  if (/شعاب|مرجان/i.test(c)) return { zone: 'شعاب', water_pref: 'FASAD' };
  return { zone: 'شعاب', water_pref: 'FASAD' };
}

function build() {
  const wb = XLSX.readFile(XLSX_IN);
  const sh1 = wb.Sheets['01_قاعدة_الأنواع'];
  const sh2 = wb.Sheets['02_حسب_الدولة'];
  if (!sh1) throw new Error('missing sheet 01_قاعدة_الأنواع');
  if (!sh2) throw new Error('missing sheet 02_حسب_الدولة');

  const base = XLSX.utils.sheet_to_json(sh1, { defval: '' });
  const byCountry = XLSX.utils.sheet_to_json(sh2, { defval: '' });

  const countriesById = {};
  byCountry.forEach(function (row) {
    const id = String(row.Species_ID || '').trim();
    if (!id) return;
    if (!countriesById[id]) countriesById[id] = [];
    const co = String(row['الدولة'] || '').trim();
    if (co && countriesById[id].indexOf(co) < 0) countriesById[id].push(co);
  });

  const species = base.map(function (row) {
    const id = String(row.Species_ID || '').trim();
    const depth = parseDepthRange(row['نطاق العمق'] || row['العمق']);
    const eco = inferEcoZone(row['التصنيف']);
    const habitat = String(row['الموطن الأساسي'] || row['الموطن'] || '');
    return {
      id: id,
      fish_name_ar: String(row['الاسم المحلي'] || '').trim(),
      fish_name_en: String(row['English common name'] || '').trim(),
      scientific_name: String(row['Scientific name'] || '').trim(),
      family: String(row['العائلة/المجموعة'] || '').trim(),
      classification_ar: String(row['التصنيف'] || '').trim(),
      habitat: habitat,
      habitat_tags: inferHabitatTags(habitat),
      feeding: String(row['الغذاء'] || '').trim(),
      notes: String(row['سمات فريدة/ملاحظات'] || row['سمات فريدة'] || '').trim(),
      methods_raw: String(row['طرق الصيد'] || '').trim(),
      depth_m: { min: depth.min_m, max: depth.max_m, label: depth.label },
      spread: String(row['الانتشار'] || '').trim(),
      seasonality_ar: String(row['الموسمية العامة'] || row['الموسمية'] || '').trim(),
      commercial: String(row['القيمة التجارية'] || row['الأهمية داخل الدولة'] || '').trim(),
      eco_zone: eco.zone,
      water_state_pref: eco.water_pref,
      countries: countriesById[id] || [],
      source_refs: String(row['Source refs'] || '').trim()
    };
  }).filter(function (s) { return s.fish_name_ar; });

  const doc = {
    version: 1,
    generated_at: new Date().toISOString(),
    source_path: 'data/gulf_fish_database.xlsx',
    species: species
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log('Wrote', JSON_OUT, 'species count:', species.length);
}

build();
