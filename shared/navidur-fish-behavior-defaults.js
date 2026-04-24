/**
 * Per-species behavior profiles for NAVIDUR (merged into unified fish rows at runtime).
 * New stations: no per-station rules — only id/classification–based behavior.
 */
'use strict';

function toArray(x) {
  return Array.isArray(x) ? x : [];
}

function normalizeString(v) {
  return String(v == null ? '' : v).trim();
}

/** Extra tuning by id (optional). */
var BY_ID = {
  F001: { behavior: { activity: ['ليلي', 'فجر', 'نهار'], aggression: 'عالي', movement: 'ثابت', feeding_type: 'مفترس' }, preferred_tide_phase: ['ثبر', 'سقي'] },
  F003: { behavior: { activity: ['فجر', 'نهاري', 'عصر'], aggression: 'عالي', movement: 'متحرك', feeding_type: 'مفترس' }, preferred_tide_phase: ['سقي'] },
  F010: { behavior: { activity: ['ليلي', 'فجر', 'نهار'], aggression: 'عالي', movement: 'متحرك', feeding_type: 'مفترس' }, preferred_tide_phase: ['سقي', 'ثبر'] },
  F012: { behavior: { activity: ['ليلي', 'فجر'], aggression: 'متوسط', movement: 'ثابت', feeding_type: 'مختلط' }, preferred_tide_phase: ['ثبر', 'سقي'] }
};

/** Night-leaning (boost when ليل/فجر) — by id, not by station. */
var NIGHT_FAV_IDS = { F001: 1, F010: 1, F012: 1 };
/** Day-leaning (boost when نهار/عصر) */
var DAY_FAV_IDS = { F005: 1, F030: 1, F031: 1 };

function inferFromClassification(row) {
  var c = normalizeString(row.classification_ar);
  var eco = normalizeString(row.eco_zone);
  var w = normalizeString(row.water_state_pref);
  var b = { activity: ['نهاري', 'ليلي'], aggression: 'متوسط', movement: 'متحرك', feeding_type: 'مختلط' };
  var tide = ['سقي', 'ثبر'];
  if (/سطحي|مهاجر|إسقم|تون|لخم|تونة/i.test(c)) {
    b = { activity: ['فجر', 'نهاري', 'عصر'], aggression: 'عالي', movement: 'متحرك', feeding_type: 'مفترس' };
    tide = ['سقي'];
  } else if (/قاع|هامور|صخر|بوم|ناجل|لنغيل/i.test(c) || eco === 'غزير' || w === 'FASAD') {
    b = { activity: ['ليلي', 'فجر', 'نهار'], aggression: 'عالي', movement: 'ثابت', feeding_type: 'مفترس' };
    tide = ['ثبر', 'سقي'];
  } else if (/عاشب|صبور|صافي|أرنب/i.test(c)) {
    b = { activity: ['نهاري', 'عصر'], aggression: 'منخفض', movement: 'ثابت', feeding_type: 'عاشب' };
    tide = ['سقي', 'ثبر'];
  }
  return { behavior: b, preferred_tide_phase: tide };
}

function applySpecialName(row, out) {
  var id = normalizeString(row.id);
  var n = normalizeString(row.fish_name_ar);
  if (NIGHT_FAV_IDS[id] || /هامور|عندق|قرقفان|كوفر|فسكر/i.test(n)) {
    out.behavior = Object.assign({}, out.behavior, { activity: uniqueAct(['ليلي', 'فجر', 'نهار']) });
  }
  if (DAY_FAV_IDS[id] || /شعم|سبيطي|ينم|بياض/i.test(n)) {
    out.behavior = Object.assign({}, out.behavior, { activity: uniqueAct(['نهاري', 'عصر', 'فجر'].concat(out.behavior.activity || [])) });
  }
  return out;
}

function uniqueAct(arr) {
  var s = [];
  toArray(arr).forEach(function (x) {
    if (x && s.indexOf(x) < 0) s.push(x);
  });
  return s;
}

/**
 * @param {object} row — raw or partial species from gulf_fish_database
 * @returns {{ behavior: object, preferred_tide_phase: string[] }}
 */
function enrichFishBehavior(row) {
  var r = row || {};
  var fromJsonB = r.behavior && typeof r.behavior === 'object' ? r.behavior : null;
  var fromJsonT = toArray(r.preferred_tide_phase);
  var id = normalizeString(r.id);
  if (BY_ID[id]) {
    var m = { behavior: Object.assign({}, BY_ID[id].behavior, fromJsonB || {}), preferred_tide_phase: fromJsonT.length ? fromJsonT : BY_ID[id].preferred_tide_phase.slice() };
    return m;
  }
  var inf = inferFromClassification(r);
  if (fromJsonB) {
    inf.behavior = Object.assign({}, inf.behavior, fromJsonB);
  }
  if (fromJsonT.length) {
    inf.preferred_tide_phase = fromJsonT;
  }
  applySpecialName(r, inf);
  return inf;
}

module.exports = {
  enrichFishBehavior: enrichFishBehavior
};
