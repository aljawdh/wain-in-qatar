/**
 * NAVIDUR Gulf fish recommendation engine — Phase A (SSOT: gulf_fish_database.json).
 *
 * Primary path: score unified species rows from data/gulf_fish_database.json.
 * Modular components (sum = 100): temperature, depth, tide, wave, current, season, visibility.
 * Fallback: deprecated hardcoded FISH_PROFILES, then empty (analysis engine may use pickSpeciesActivity).
 */
'use strict';

var fishDb = require('./navidur-fish-database');

var W_TEMP = 20;
var W_DEPTH = 15;
var W_TIDE = 20;
var W_WAVE = 15;
var W_CURRENT = 10;
var W_SEASON = 15;
var W_VISIBILITY = 5;
var W_TOTAL = W_TEMP + W_DEPTH + W_TIDE + W_WAVE + W_CURRENT + W_SEASON + W_VISIBILITY;

var DEFAULT_MIN_SCORE = 60;
var DEFAULT_MAX_ITEMS = 8;
var PENALTY_NON_TRADITIONAL_TARGET = 18;
var PENALTY_OFFSHORE_AT_COASTAL = 14;
var BOOST_COASTAL_REEF = 4;
var SEASON_SCORE_CLEAR = 15;
var SEASON_SCORE_NEUTRAL = 5;
var BOOST_TRADITIONAL_SHORE = 8;
var BOOST_TRAIT_ACTIVE = 4;
var SCORE_CALIBRATION = 0.9;

/** @deprecated Phase A — use gulf_fish_database only; kept as emergency fallback */
var FISH_PROFILES = [
  { name_ar: 'شعري', depth_zone: ['shallow', 'coastal'], tide_states: ['حمل', 'فساد'], current_preference: ['weak', 'medium'], temp_range_c: [18, 33], regions: ['الخليج'], dur_preference: ['الرشاء', 'الشرطين', 'البطين', 'الثريا', 'الدبران', 'السماك', 'الغفر'], exclude_if: { wave_height_gt: 1.4, wind_speed_gt: 30 } },
  { name_ar: 'سبيطي', depth_zone: ['shallow', 'coastal'], tide_states: ['حمل'], current_preference: ['weak', 'medium'], temp_range_c: [18, 32], regions: ['الخليج'], dur_preference: ['الرشاء', 'الشرطين', 'البطين', 'الثريا', 'الدبران', 'السماك', 'الغفر'], exclude_if: { wave_height_gt: 1.2, wind_speed_gt: 28 } },
  { name_ar: 'صافي', depth_zone: ['shallow', 'coastal'], tide_states: ['حمل', 'فساد'], current_preference: ['weak', 'medium'], temp_range_c: [20, 34], regions: ['الخليج'], dur_preference: ['الرشاء', 'الشرطين', 'الثريا', 'السماك'], exclude_if: { wave_height_gt: 1.3, wind_speed_gt: 28 } },
  { name_ar: 'قرقفان', depth_zone: ['shallow', 'coastal'], tide_states: ['حمل'], current_preference: ['medium'], temp_range_c: [20, 33], regions: ['الخليج'], dur_preference: ['الرشاء', 'البطين', 'الدبران'], exclude_if: { wave_height_gt: 1.1, wind_speed_gt: 27 } },
  { name_ar: 'كنعد', depth_zone: ['coastal', 'offshore'], tide_states: ['حمل'], current_preference: ['medium', 'strong'], temp_range_c: [22, 33], regions: ['الخليج'], dur_preference: ['الثريا', 'الدبران', 'السماك'], exclude_if: { wave_height_gt: 1.6, wind_speed_gt: 32 } },
  { name_ar: 'بالول', depth_zone: ['coastal', 'offshore'], tide_states: ['حمل', 'فساد'], current_preference: ['medium'], temp_range_c: [20, 33], regions: ['الخليج'], dur_preference: ['الرشاء', 'الثريا', 'السماك'], exclude_if: { wave_height_gt: 1.5, wind_speed_gt: 30 } },
  { name_ar: 'هامور', depth_zone: ['deep', 'offshore'], tide_states: ['فساد'], current_preference: ['medium', 'strong'], temp_range_c: [20, 32], regions: ['الخليج'], dur_preference: ['البطين', 'الثريا', 'الدبران'], exclude_if: { wave_height_gt: 1.8, wind_speed_gt: 34 } },
  { name_ar: 'سيجان', depth_zone: ['shallow', 'coastal'], tide_states: ['حمل', 'فساد'], current_preference: ['weak', 'medium'], temp_range_c: [19, 33], regions: ['الخليج'], dur_preference: ['الرشاء', 'الشرطين', 'السماك'], exclude_if: { wave_height_gt: 1.2, wind_speed_gt: 28 } },
  { name_ar: 'ينم', depth_zone: ['deep', 'offshore'], tide_states: ['فساد'], current_preference: ['medium', 'strong'], temp_range_c: [21, 33], regions: ['الخليج'], dur_preference: ['البطين', 'الثريا', 'الغفر'], exclude_if: { wave_height_gt: 1.7, wind_speed_gt: 33 } },
  { name_ar: 'ضلعة', depth_zone: ['deep', 'offshore'], tide_states: ['فساد'], current_preference: ['strong'], temp_range_c: [22, 34], regions: ['الخليج'], dur_preference: ['الدبران', 'السماك', 'الغفر'], exclude_if: { wave_height_gt: 1.9, wind_speed_gt: 35 } },
  { name_ar: 'حمرا', depth_zone: ['coastal', 'offshore'], tide_states: ['حمل', 'فساد'], current_preference: ['medium'], temp_range_c: [20, 33], regions: ['الخليج'], dur_preference: ['الرشاء', 'الثريا', 'الدبران'], exclude_if: { wave_height_gt: 1.5, wind_speed_gt: 31 } }
];

function toArray(x) {
  return Array.isArray(x) ? x : [];
}

function normalizeString(v) {
  return String(v == null ? '' : v).trim();
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function toNumberLike(v) {
  var n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} liveEnvironment — from navidur resolveLiveEnvironment
 * @returns {''|'سقي'|'ثبر'}
 */
function resolveTidePhaseArabic(liveEnvironment) {
  var e = liveEnvironment || {};
  var prev = toNumberLike(e.tide_previous);
  var cur = toNumberLike(e.tide_current);
  var next = toNumberLike(e.tide_next);
  if (prev == null || cur == null) return '';
  var d0 = cur - prev;
  if (d0 > 0.005) return 'سقي';
  if (d0 < -0.005) return 'ثبر';
  if (next != null) {
    var d1 = next - cur;
    if (d0 >= 0 && d1 >= 0) return 'سقي';
    if (d0 <= 0 && d1 <= 0) return 'ثبر';
  }
  return '';
}

/**
 * @param {Date} d
 * @returns {'فجر'|'نهار'|'عصر'|'ليل'}
 */
function getTimeOfDayAr(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) d = new Date();
  var utc = d.getUTCHours() * 60 + d.getUTCMinutes();
  var gulf = (utc + 3 * 60) % (24 * 60);
  var h = gulf / 60;
  if (h >= 4 && h < 7) return 'فجر';
  if (h >= 7 && h < 15) return 'نهار';
  if (h >= 15 && h < 18) return 'عصر';
  return 'ليل';
}

function isPelagicish(fish) {
  return /سطحي|مهاجر|إسقم|تون|لخم|open|تونة/i.test(normalizeString(fish.classification_ar));
}

function isBottomish(fish) {
  return /قاع|شعاب|هامور|قاعي|بوم|صخر|ساحلي قاعي/i.test(normalizeString(fish.classification_ar));
}

function isNonTraditionalFishTarget(fish) {
  var n = normalizeString(fish && fish.fish_name_ar);
  var c = normalizeString(fish && fish.classification_ar) + ' ' + normalizeString(fish && fish.family);
  if (/حبار|خسوق|أخطبوط|اخطبوط|عقرب البحر|قنديل|جمبري|ربيان|محار|سلطعون|حبار|كاليماري|سبيط\s*\/|كاليماري/i.test(n)) return true;
  if (/رخويات|قشريات|رخوي|cephalopod|mollusk|crustacean|scorpionfish/i.test(c)) return true;
  if (/حبار|أخطبوط|قنديل|جمبري|ربيان|عقرب/i.test(c)) return true;
  return false;
}

function stationIsCoastalReef(zoneType) {
  var z = normalizeString(zoneType);
  return /شعاب|ساحل|رمل|طين|شاطئ|ضحل|ساحلي/.test(z);
}

function fishIsOffshorePelagic(fish) {
  if (isPelagicish(fish)) return true;
  var ez = normalizeString(fish.eco_zone);
  var tags = toArray(fish.habitat_tags).join(' ');
  if (/مياه مفتوحة|offshore|open/i.test(ez + ' ' + tags)) return true;
  if (ez === 'غزير' && !/شعاب|ساحل|رمل|ضحل/.test(tags)) return true;
  return false;
}

function fishIsCoastalReef(fish) {
  var tags = toArray(fish.habitat_tags).join(' ');
  var h = normalizeString(fish.habitat);
  var c = normalizeString(fish.classification_ar);
  if (/شعاب|ساحل|رمل|ضحل|حشائش|خور|صخور/i.test(tags + ' ' + h)) return true;
  if (/قاعي|عاشب|شعريات|صافي|أرنب/i.test(c) && !isPelagicish(fish)) return true;
  return false;
}

function nonTraditionalTargetSupported(fish, ctx, ratios) {
  if (!matchFishToTraits(fish, ctx.traitBundle, ctx.currentDur, ctx.activePhase)) return false;
  return (ratios.tideR >= 0.85) && (ratios.depthR >= 0.75);
}

var TRADITIONAL_SHORE_TARGETS = [
  'شعري', 'سبيطي', 'صافي', 'حمرا', 'هامور', 'جش', 'قرقفان', 'فسكر', 'سيجان', 'نقرور', 'شاخورة', 'بوري', 'سكل', 'ينم'
];

function isTraditionalShoreTarget(fish) {
  var n = normalizeString(fish && fish.fish_name_ar);
  if (!n) return false;
  return TRADITIONAL_SHORE_TARGETS.some(function (t) {
    return n === t || n.indexOf(t) >= 0;
  });
}

function displayZoneLabel(fish, stationZone) {
  var tags = toArray(fish.habitat_tags).filter(Boolean);
  var z = normalizeString(stationZone);
  if (stationIsCoastalReef(z) && tags.length) return tags[0];
  if (tags.length) return tags[0];
  if (/شعاب|ساحل|رمل|ضحل|حشائش|خور/.test(normalizeString(fish.habitat))) {
    return 'ساحلي';
  }
  var ez = normalizeString(fish.eco_zone);
  if (stationIsCoastalReef(z) && /غزير|مفتوح|مياه مفتوحة/.test(ez)) return tags[0] || 'شعاب';
  return ez || tags[0] || '—';
}

function activityHas(fish, label) {
  return toArray(fish && fish.behavior && fish.behavior.activity).indexOf(label) >= 0;
}

/**
 * Light multipliers (≈0.95–1.1) on base components — does not remove original weights.
 * @returns {{ dur:number, water:number, temp:number, depth:number, zone:number, time:number, country:number }}
 */
function getDynamicWeightMultipliers(fish, tideState, tod) {
  var m = { dur: 1, water: 1, temp: 1, depth: 1, zone: 1, time: 1, country: 1 };
  if (tideState === 'LOAD' && isPelagicish(fish)) m.water = 1.08;
  if (tideState === 'LOAD' && isPelagicish(fish)) m.time = 1.04;
  if (tideState === 'LOAD' && activityHas(fish, 'فجر') && (tod === 'فجر' || tod === 'عصر')) m.time = Math.max(m.time, 1.05);
  if (tideState === 'FASAD' && isBottomish(fish)) m.depth = 1.08;
  if (tideState === 'FASAD' && isBottomish(fish)) m.zone = 1.04;
  if (tideState === 'FASAD' && fish.behavior && fish.behavior.movement === 'ثابت' && fish.behavior.feeding_type === 'مفترس') m.depth = Math.max(m.depth, 1.04);
  var nightTod = tod === 'ليل' || tod === 'فجر';
  var dayTod = tod === 'نهار' || tod === 'عصر';
  if (nightTod && activityHas(fish, 'ليلي')) m.time = 1.07;
  if (dayTod && activityHas(fish, 'نهاري')) m.time = 1.07;
  return m;
}

/**
 * @returns {number} 0..1 for scaling to W_BEHAVIOR_CAP
 */
function computeBehaviorMatch01(fish, tod, tideState, tidePhaseAr, waterStateAr) {
  var b = fish && fish.behavior;
  if (!b || typeof b !== 'object') return 0.35;
  var s = 0;
  var act = toArray(b.activity);
  if (tod === 'ليل' && act.indexOf('ليلي') >= 0) s += 0.3;
  else if ((tod === 'فجر' || tod === 'ليل') && (act.indexOf('ليلي') >= 0 || act.indexOf('فجر') >= 0)) s += 0.22;
  else if ((tod === 'نهار' || tod === 'عصر') && act.indexOf('نهاري') >= 0) s += 0.28;
  else if (act.length) s += 0.12;

  if (tideState === 'LOAD' && (isPelagicish(fish) || b.feeding_type === 'مفترس' && b.movement === 'متحرك')) s += 0.18;
  if (tideState === 'FASAD' && b.movement === 'ثابت' && (b.feeding_type === 'مفترس' || isBottomish(fish))) s += 0.18;
  if (tidePhaseAr && toArray(fish.preferred_tide_phase).indexOf(tidePhaseAr) >= 0) s += 0.2;
  if (waterStateAr && tideState === 'LOAD' && b.aggression === 'عالي' && isPelagicish(fish)) s += 0.1;
  if (waterStateAr && tideState === 'FASAD' && b.movement === 'ثابت') s += 0.1;
  return clamp(s, 0, 1);
}

/**
 * +10 if current tide phase in preferred, −5 if clearly opposite to a single strong preference.
 */
function computeTidePhasePoints(fish, currentPhase) {
  var pref = toArray(fish.preferred_tide_phase);
  if (!currentPhase || !pref.length) return 0;
  if (pref.indexOf(currentPhase) >= 0) {
    return pref.length >= 2 ? 8 : W_TIDE_MATCH;
  }
  if (pref.length === 1) {
    if (pref[0] === 'سقي' && currentPhase === 'ثبر') return W_TIDE_OPP;
    if (pref[0] === 'ثبر' && currentPhase === 'سقي') return W_TIDE_OPP;
  }
  return 0;
}

/**
 * +0..5 contextual boost
 */
function computeDynamicMicroBonus(fish, tideState, tod) {
  var x = 0;
  if (tideState === 'LOAD' && isPelagicish(fish)) x += 2.2;
  if (tideState === 'FASAD' && isBottomish(fish) && fish.behavior && fish.behavior.feeding_type === 'مفترس') x += 2.2;
  var nightTod = tod === 'ليل' || tod === 'فجر';
  var dayTod = tod === 'نهار' || tod === 'عصر';
  if (nightTod && activityHas(fish, 'ليلي')) x += 1.5;
  if (dayTod && activityHas(fish, 'نهاري')) x += 1.5;
  return Math.min(W_DYN_MAX, x);
}

/**
 * @param {string} tideState
 * @returns {string}
 */
function waterStateArabic(tideState) {
  if (tideState === 'LOAD') return 'حمل';
  if (tideState === 'FASAD') return 'فساد';
  return 'غير محدد';
}

/**
 * @param {object} opt
 * @param {string} opt.durName
 * @param {string} opt.waterAr
 * @param {string} opt.tidePhase
 * @param {string} opt.tod
 * @param {string[]} opt.hits
 */
function buildSmartReasonAr(opt) {
  var o = opt || {};
  var bits = [];
  if (o.durName) bits.push('الدر «' + o.durName + '»');
  if (o.waterAr) bits.push('حالة الماء ' + o.waterAr);
  if (o.tidePhase) bits.push('التايد ' + o.tidePhase);
  if (o.tod) bits.push('الوقت ' + o.tod);
  var detail = toArray(o.hits).length ? o.hits.slice(0, 4).join('؛ ') : 'ظروف مقبولة';
  if (o.lead) {
    return o.lead + ' ' + (bits.length ? '— ' + bits.join('، ') + '. ' : '') + detail + '.';
  }
  return (bits.length ? bits.join(' — ') + '. ' : '') + detail + '.';
}

function mapConfidence(score) {
  if (score > 85) return 'قوي جداً';
  if (score >= 70) return 'مرتفع';
  if (score >= 55) return 'متوسط';
  return 'ضعيف';
}

// ─── geometry / env (unchanged) ─────────────────────────────────────────────

/**
 * @param {string} zoneType
 * @returns {{ min: number, max: number, mid: number }}
 */
function depthRangeFromZoneType(zoneType) {
  var z = normalizeString(zoneType);
  if (z === 'ساحلي') return { min: 1, max: 15, mid: 8 };
  if (z === 'شعاب') return { min: 5, max: 40, mid: 22 };
  if (z === 'غزير') return { min: 40, max: 120, mid: 55 };
  if (z === 'رملي') return { min: 3, max: 25, mid: 14 };
  if (z === 'طيني') return { min: 0, max: 12, mid: 6 };
  if (z === 'مياه مفتوحة') return { min: 20, max: 200, mid: 60 };
  return { min: null, max: null, mid: null };
}

function inferZoneTypeFromDepth(depthM) {
  if (depthM == null || !isFinite(depthM)) return '';
  if (depthM < 5) return 'ساحلي';
  if (depthM <= 25) return 'رملي';
  if (depthM <= 40) return 'شعاب';
  return 'غزير';
}

function resolveStationDepthAndZone(station) {
  var s = station || {};
  var z = normalizeString(s.zoneType || s.zone);
  var d = s.depth != null ? Number(s.depth) : null;
  var depthInferred = false;
  if (!isFinite(d)) {
    var rng = z ? depthRangeFromZoneType(z) : { mid: null };
    if (rng && rng.mid != null) {
      d = rng.mid;
      depthInferred = true;
    } else {
      d = null;
    }
  }
  if (!z && d != null && isFinite(d)) {
    z = inferZoneTypeFromDepth(d);
  }
  return { depthM: d, zoneType: z, depthInferred: depthInferred, zoneInferred: !normalizeString(s.zoneType || s.zone) && !!z };
}

function parseMethodsMethods(raw) {
  var t = normalizeString(raw);
  if (!t) return [];
  return t.split(/[،,]/).map(function (x) {
    return normalizeString(x);
  }).filter(Boolean);
}

function bestTimesForFish(fish) {
  var b = fish.behavior;
  var act = b && toArray(b.activity);
  if (act && act.length) {
    var out = [];
    if (act.indexOf('ليلي') >= 0) { out.push('ليل'); out.push('فجر'); }
    if (act.indexOf('فجر') >= 0 && out.indexOf('فجر') < 0) out.push('فجر');
    if (act.indexOf('نهاري') >= 0) { out.push('نهار'); out.push('عصر'); }
    if (act.indexOf('عصر') >= 0 && out.indexOf('عصر') < 0) out.push('عصر');
    if (out.length) return out;
  }
  var s = normalizeString(fish.classification_ar) + ' ' + normalizeString(fish.seasonality_ar);
  if (/سطحي|مهاجر|تون|لخم|إسقم/i.test(s)) return ['فجر', 'ليل', 'عصر'];
  if (/قاع|شعاب|هامور|صخر/i.test(s)) return ['ليل', 'فجر', 'نهار'];
  return ['فجر', 'ليل', 'نهار'];
}

function tempComfortRatio(t, fish) {
  if (t == null || !isFinite(t)) return 0;
  var sc = fish && fish.scoring ? fish.scoring : {};
  var lo = sc.preferred_temp_min != null ? Number(sc.preferred_temp_min) : (isPelagicish(fish) ? 24 : 20);
  var hi = sc.preferred_temp_max != null ? Number(sc.preferred_temp_max) : (isPelagicish(fish) ? 32 : 33);
  if (t >= lo && t <= hi) return 0.88;
  var margin = 5;
  if (t < lo) return clamp(1 - (lo - t) / margin, 0, 0.85);
  return clamp(1 - (t - hi) / margin, 0, 0.85);
}

function depthFitRatio(d, fish) {
  var dm = fish.depth_m || {};
  var mn = dm.min;
  var mx = dm.max;
  if (d == null || !isFinite(d)) {
    if (mn == null && mx == null) return 0.5;
    return 0.45;
  }
  if (mn == null && mx == null) return 0.6;
  if (d >= mn && d <= mx) return 0.88;
  var err = d < mn ? mn - d : d - mx;
  var width = Math.max(5, (mx - mn) || 10);
  return clamp(1 - err / (width * 0.5), 0, 0.85);
}

function matchFishToTraits(fish, traitBundle, currentDur, activePhase) {
  var n = normalizeString(fish.fish_name_ar);
  if (!n) return false;
  var pool = toArray(traitBundle && traitBundle.fish_traits)
    .concat(toArray(currentDur && currentDur.durRow && currentDur.durRow.fish_traits))
    .concat(toArray(activePhase && activePhase.fish_traits));
  for (var i = 0; i < pool.length; i += 1) {
    var t = normalizeString(pool[i]);
    if (!t) continue;
    var nl = n.toLowerCase();
    if (t === n || t.toLowerCase() === nl) return true;
    if (n.indexOf(t) >= 0 || t.indexOf(n) >= 0) return true;
  }
  return false;
}

function waterPrefMatches(tideState, fish) {
  var p = normalizeString(fish.water_state_pref);
  if (p === 'LOAD' && tideState === 'LOAD') return 1;
  if (p === 'FASAD' && tideState === 'FASAD') return 1;
  if (!p) return 0.45;
  if (tideState === 'UNKNOWN') return 0.4;
  return 0.3;
}

function zoneTypeFit(stationZ, fish) {
  if (!stationZ) return 0.55;
  var ez = normalizeString(fish.eco_zone);
  var tags = toArray(fish.habitat_tags);
  if (stationZ === ez) return 1;
  if (tags.indexOf(stationZ) >= 0) return 1;
  var rel = {
    'ساحلي': { ساحلي: 1, رملي: 0.7, شعاب: 0.5, طيني: 0.75, 'مياه مفتوحة': 0.3, غزير: 0.2 },
    'رملي': { رملي: 1, ساحلي: 0.75, شعاب: 0.65, 'مياه مفتوحة': 0.4, طيني: 0.5, غزير: 0.3 },
    'شعاب': { شعاب: 1, رملي: 0.65, ساحلي: 0.45, غزير: 0.55, 'مياه مفتوحة': 0.35, طيني: 0.4 },
    'غزير': { غزير: 1, 'مياه مفتوحة': 0.85, شعاب: 0.5, ساحلي: 0.2, رملي: 0.25, طيني: 0.2 },
    'طيني': { طيني: 1, ساحلي: 0.8, رملي: 0.6, شعاب: 0.4, 'مياه مفتوحة': 0.3, غزير: 0.15 },
    'مياه مفتوحة': { 'مياه مفتوحة': 1, غزير: 0.75, شعاب: 0.4, ساحلي: 0.3, رملي: 0.35, طيني: 0.2 }
  };
  var row = rel[stationZ];
  if (!row) return 0.45;
  var best = 0;
  if (ez && row[ez] != null) best = row[ez];
  for (var i = 0; i < tags.length; i += 1) {
    if (row[tags[i]] != null) best = Math.max(best, row[tags[i]]);
  }
  return best;
}

function timeOfDayFit(tod, fish) {
  var bt = bestTimesForFish(fish);
  if (bt.indexOf(tod) >= 0) return 1;
  if (tod === 'نهار' && (bt.indexOf('عصر') >= 0 || bt.indexOf('ليل') >= 0)) return 0.35;
  return 0.2;
}

function countryFit(stationCountry, fish) {
  var c = fishDb.normalizeCountry ? fishDb.normalizeCountry(stationCountry) : normalizeString(stationCountry);
  var list = toArray(fish.countries);
  if (!c) {
    if (!list.length) return 1;
    return 0.8;
  }
  if (list.indexOf(c) >= 0) return 1;
  return 0;
}

function waveComfortRatio(waveM, fish) {
  var sc = fish && fish.scoring ? fish.scoring : {};
  var max = sc.preferred_wave_max != null ? Number(sc.preferred_wave_max) : 1.4;
  if (waveM == null || !isFinite(waveM)) return 0.45;
  if (waveM <= max) return 1;
  return clamp(1 - (waveM - max) / 1.2, 0, 0.9);
}

function currentComfortRatio(ms, fish) {
  var sc = fish && fish.scoring ? fish.scoring : {};
  var lo = sc.preferred_current_min != null ? Number(sc.preferred_current_min) : 0.2;
  var hi = sc.preferred_current_max != null ? Number(sc.preferred_current_max) : 0.9;
  if (ms == null || !isFinite(ms)) return 0.45;
  if (ms >= lo && ms <= hi) return 1;
  var err = ms < lo ? lo - ms : ms - hi;
  return clamp(1 - err / 0.6, 0, 0.88);
}

function computeSeasonScorePoints(fish, traitBundle, currentDur, activePhase, analysisDate) {
  var sc = fish && fish.scoring ? fish.scoring : {};
  var durList = toArray(sc.dur_preference);
  var durName = normalizeString(currentDur && currentDur.durRow && (currentDur.durRow.name_ar || currentDur.durRow.name));
  var months = sc.activity_months;
  var hasDurPref = durList.length > 0;
  var hasMonths = months && months.length > 0;
  var durMatch = false;
  if (hasDurPref && durName) {
    durMatch = durList.some(function (d) {
      return durName.indexOf(d) >= 0 || d.indexOf(durName) >= 0;
    });
  }
  if (durMatch) return SEASON_SCORE_CLEAR;
  if (hasMonths && analysisDate instanceof Date && !isNaN(analysisDate.getTime())) {
    if (months.indexOf(analysisDate.getUTCMonth() + 1) >= 0) return SEASON_SCORE_CLEAR;
    return SEASON_SCORE_NEUTRAL;
  }
  return SEASON_SCORE_NEUTRAL;
}

function habitatStationFitRatio(stationZone, fish) {
  var base = zoneTypeFit(stationZone, fish);
  if (stationIsCoastalReef(stationZone)) {
    if (fishIsOffshorePelagic(fish)) return Math.min(base, 0.35);
    if (fishIsCoastalReef(fish)) return Math.max(base, 0.88);
  }
  return base;
}

/**
 * @returns {{ temperature_score, depth_score, tide_score, wave_score, current_score, season_score, visibility_score, final_score, hits: string[] }}
 */
function scoreGulfSpeciesModular(fish, ctx) {
  var env = ctx.liveEnvironment || {};
  var tideState = ctx.tideState;
  var station = ctx.station || {};
  var res = resolveStationDepthAndZone(station);
  var stationDepth = res.depthM;
  var stationZone = res.zoneType;
  var sst = env.temp_c != null ? Number(env.temp_c) : null;
  var wave = env.wave_height_m != null ? Number(env.wave_height_m) : null;
  var current = env.current_speed_ms != null ? Number(env.current_speed_ms) : null;

  var tempR = sst != null ? tempComfortRatio(sst, fish) : 0.45;
  var depthR = depthFitRatio(stationDepth, fish);
  var tideR = waterPrefMatches(tideState, fish);
  var waveR = waveComfortRatio(wave, fish);
  var curR = currentComfortRatio(current, fish);
  var season_score = computeSeasonScorePoints(fish, ctx.traitBundle, ctx.currentDur, ctx.activePhase, ctx.analysisDateTime);
  var visR = habitatStationFitRatio(stationZone, fish);

  var temperature_score = Math.round(W_TEMP * tempR);
  var depth_score = Math.round(W_DEPTH * depthR);
  var tide_score = Math.round(W_TIDE * tideR);
  var wave_score = Math.round(W_WAVE * waveR);
  var current_score = Math.round(W_CURRENT * curR);
  var visibility_score = Math.round(W_VISIBILITY * visR);

  var componentSum = temperature_score + depth_score + tide_score + wave_score + current_score + season_score + visibility_score;
  var adjustment = 0;
  if (fishIsOffshorePelagic(fish) && stationIsCoastalReef(stationZone)) adjustment -= PENALTY_OFFSHORE_AT_COASTAL;
  if (fishIsCoastalReef(fish) && stationIsCoastalReef(stationZone)) adjustment += BOOST_COASTAL_REEF;
  if (isTraditionalShoreTarget(fish) && stationIsCoastalReef(stationZone)) adjustment += BOOST_TRADITIONAL_SHORE;
  if (stationIsCoastalReef(stationZone) && matchFishToTraits(fish, ctx.traitBundle, ctx.currentDur, ctx.activePhase)) {
    adjustment += BOOST_TRAIT_ACTIVE;
  }
  if (isNonTraditionalFishTarget(fish)) {
    adjustment -= PENALTY_NON_TRADITIONAL_TARGET;
    if (nonTraditionalTargetSupported(fish, ctx, { tideR: tideR, depthR: depthR })) adjustment += 10;
  }

  var final_score = clamp(Math.round(componentSum * SCORE_CALIBRATION) + adjustment, 0, 100);

  var hits = [];
  if (tempR >= 0.88 && sst != null) hits.push('حرارة ماء مناسبة');
  else if (tempR >= 0.55 && sst != null) hits.push('حرارة ماء مقبولة');
  if (depthR >= 0.85) hits.push('عمق المحطة ضمن نطاق النوع');
  if (tideR >= 0.9 && tideState === 'LOAD') hits.push('حالة حمل');
  else if (tideR >= 0.9 && tideState === 'FASAD') hits.push('حالة فساد');
  else if (tideR >= 0.5) hits.push('حالة مد مقبولة');
  if (waveR >= 0.85 && wave != null) hits.push('ارتفاع موج مناسب');
  if (curR >= 0.85 && current != null) {
    hits.push(current < 0.35 ? 'تيار ضعيف' : current > 0.75 ? 'تيار قوي' : 'تيار متوسط');
  }
  if (season_score >= SEASON_SCORE_CLEAR) hits.push('موسم ودر ملائمان');
  else if (season_score > SEASON_SCORE_NEUTRAL) hits.push('موسم عام مقبول');
  if (visR >= 0.85 && stationZone) hits.push('موطن يناسب ' + (displayZoneLabel(fish, stationZone) || stationZone));

  return {
    temperature_score: temperature_score,
    depth_score: depth_score,
    tide_score: tide_score,
    wave_score: wave_score,
    current_score: current_score,
    season_score: season_score,
    visibility_score: visibility_score,
    adjustment: adjustment,
    final_score: final_score,
    hits: hits
  };
}

function buildStructuredReasonAr(hits, finalScore) {
  var parts = toArray(hits).filter(Boolean);
  if (!parts.length) {
    return finalScore >= 55 ? 'نشاط مقبول حسب الظروف العامة في المحطة.' : 'تقييم مبدئي حسب الظروف العامة.';
  }
  var lead = finalScore >= 70 ? 'نشاط مرتفع بسبب:' : finalScore >= 50 ? 'نشاط متوسط بسبب:' : 'نشاط محدود بسبب:';
  return lead + ' ' + parts.join('، ') + '.';
}

function recommendationItemFromFish(fish, modular, stationZone) {
  var score = modular.final_score;
  var methods = parseMethodsMethods(fish.methods_raw);
  if (!methods.length) methods = ['تروق محلية', 'قصبة'];
  return {
    name_ar: fish.fish_name_ar,
    fish_name_ar: fish.fish_name_ar,
    fish_name_en: fish.fish_name_en || '',
    confidence: score,
    score: score,
    reason_ar: buildStructuredReasonAr(modular.hits, score),
    recommended_methods: methods,
    habitat: fish.habitat || (fish.habitat_tags && fish.habitat_tags[0]) || '—',
    feeding: fish.feeding || '—',
    zone: displayZoneLabel(fish, stationZone || ''),
    best_time: bestTimesForFish(fish).join('، ')
  };
}

function normalizeDepthZoneArToKey(zoneType) {
  var z = normalizeString(zoneType);
  if (z === 'ساحلي' || z === 'shallow' || z === 'coastal') return 'shallow';
  if (z === 'غزير' || z === 'deep' || z === 'offshore' || z === 'مياه مفتوحة') return 'deep';
  if (z === 'شعاب' || z === 'رملي' || z === 'طيني') return 'coastal';
  return 'coastal';
}

function normalizeTideStateArabic(tideState) {
  if (tideState === 'LOAD') return 'حمل';
  if (tideState === 'FASAD') return 'فساد';
  return '';
}

function currentStrengthLabel(ms) {
  var n = toNumberLike(ms);
  if (n == null) return 'medium';
  if (n < 0.25) return 'weak';
  if (n <= 0.7) return 'medium';
  return 'strong';
}

function stationRegionBucket(station) {
  var country = normalizeString(station && station.country);
  var region = normalizeString(station && station.region);
  var name = normalizeString(station && station.name);
  var gulfCountries = ['قطر', 'البحرين', 'الكويت', 'الإمارات', 'الإمارات العربية المتحدة'];
  if (gulfCountries.indexOf(country) >= 0) return 'الخليج';
  if (country === 'السعودية') {
    if (/حقل|ضبا|الوجه|أملج|ينبع|رابغ|جدة|الليث|القنفذة|جازان/.test(name)) return 'البحر الأحمر';
    return 'الخليج';
  }
  if (country === 'عمان') {
    if (/مسقط|مطرح|بركاء|صحار|شناص/.test(name) || /gulf|arabian_gulf|الخليج/.test(region)) return 'الخليج';
    return 'بحر عمان';
  }
  return 'الخليج';
}

var OP_BOOST_HIGH = 14;
var OP_BOOST_MEDIUM = 6;
var NON_PRIMARY_PENALTY_LOW = 18;
var DUPLICATE_FAMILY_PENALTY = 22;

var COASTAL_HIGH_PRIORITY_KEYS = [
  'سبيطي', 'شعم', 'بدح', 'قرقفان', 'فسكر', 'نيسر', 'حاقول', 'سلس', 'ضلعة', 'شعري', 'بالول'
];
var COASTAL_MEDIUM_PRIORITY_KEYS = [
  'هامور', 'حمرا', 'ميد', 'موزة', 'مرجان', 'درّد', 'بوري', 'بياح', 'شاخورة', 'جش', 'نقرور', 'عومة', 'حريد', 'فرش'
];

function fishNameMatchesKeys(fish, keys) {
  var n = normalizeString(fish && fish.fish_name_ar);
  if (!n) return false;
  return keys.some(function (k) {
    return n === k || n.indexOf(k) >= 0;
  });
}

function stationIsOperationalCoastalQatar(station) {
  var s = station || {};
  var id = normalizeString(s.id);
  var name = normalizeString(s.name);
  var country = fishDb.normalizeCountry ? fishDb.normalizeCountry(s.country) : normalizeString(s.country);
  if (id === 'st_mpbxjqft2xgor1ew' || /كتارا/i.test(name)) return true;
  if (country === 'قطر' && stationIsCoastalReef(s.zoneType || s.zone)) return true;
  return false;
}

function hasSafiSeagrassContext(fish, ctx) {
  var station = (ctx && ctx.station) || {};
  var site = (ctx && (ctx.site_environment || ctx.siteEnvironment)) || {};
  var tags = toArray(fish && fish.habitat_tags).join(' ');
  var hab = normalizeString(fish && fish.habitat) + ' ' + normalizeString(fish && fish.feeding);
  var stZ = normalizeString(station.zoneType || station.zone || station.habitat);
  var seabed = normalizeString(site.seabed_type || site.seabed);
  return /seagrass|أعشاب|حشائش|عشب بحري|حشائش بحرية/i.test(tags + ' ' + hab + ' ' + stZ + ' ' + seabed);
}

function isSafiFish(fish) {
  return /صافي/i.test(normalizeString(fish && fish.fish_name_ar));
}

function isSideCatchOrLowDisplayFish(fish) {
  if (isNonTraditionalFishTarget(fish)) return true;
  var n = normalizeString(fish && fish.fish_name_ar);
  var c = normalizeString(fish && fish.classification_ar) + ' ' + normalizeString(fish && fish.family);
  return /ربيان|جمبري|محار|قنديل|قرش|سلطعون|لوبستر|قشريات|رخويات|حصان البحر|فرس البحر|سمك الحجر/i.test(n + ' ' + c);
}

/**
 * @param {object} fish
 * @returns {string}
 */
function resolveNormalizedFamilyGroup(fish) {
  var n = normalizeString(fish && fish.fish_name_ar);
  if (/صافي/i.test(n)) return 'grp_safi';
  if (/شعري|شعور|إمبراطور/i.test(n)) return 'grp_emperor';
  if (/بوري|بياح|شاخورة/i.test(n)) return 'grp_bream_pomfret';
  if (/سبيطي/i.test(n)) return 'grp_sabit';
  if (/بدح/i.test(n)) return 'grp_badah';
  if (/شعم/i.test(n)) return 'grp_shaam';
  if (/فسكر|قرقفان/i.test(n)) return 'grp_faskar';
  if (/هامور|بالول|بربور/i.test(n)) return 'grp_grouper';
  if (/حبار|كاليماري|سبيط\s*\/|خسوق|أخطبوط/i.test(n)) return 'grp_cephalopod';
  if (/عقرب البحر/i.test(n)) return 'grp_scorpionfish';
  if (/مرجان|سنابر/i.test(n)) return 'grp_snapper';
  if (/درّد|أرنب منقط/i.test(n)) return 'grp_spotted_rabbit';
  return 'grp_' + (normalizeString(fish && fish.id) || ('name_' + n));
}

/**
 * @returns {'high'|'medium'|'low'|'neutral'}
 */
function getOperationalPriorityTier(fish, ctx) {
  if (!stationIsOperationalCoastalQatar(ctx && ctx.station)) return 'neutral';
  if (isSideCatchOrLowDisplayFish(fish)) return 'low';
  if (isSafiFish(fish)) return hasSafiSeagrassContext(fish, ctx) ? 'high' : 'medium';
  if (fishNameMatchesKeys(fish, COASTAL_HIGH_PRIORITY_KEYS)) return 'high';
  if (fishNameMatchesKeys(fish, COASTAL_MEDIUM_PRIORITY_KEYS)) return 'medium';
  return 'neutral';
}

function computeOperationalPriorityBoost(fish, ctx) {
  var tier = getOperationalPriorityTier(fish, ctx);
  if (tier === 'high') return OP_BOOST_HIGH;
  if (tier === 'medium') return OP_BOOST_MEDIUM;
  return 0;
}

function computeNonPrimaryTargetPenalty(fish, ctx) {
  if (!stationIsOperationalCoastalQatar(ctx && ctx.station)) return 0;
  if (getOperationalPriorityTier(fish, ctx) === 'low') return NON_PRIMARY_PENALTY_LOW;
  return 0;
}

/**
 * display_rank_score = final_score + boost - non_primary (duplicate applied at pick time)
 * @param {object} row — { fish, modular }
 * @param {object} scoreCtx
 * @returns {number}
 */
function computeDisplayRankScore(row, scoreCtx) {
  var finalScore = row.modular.final_score;
  var boost = computeOperationalPriorityBoost(row.fish, scoreCtx);
  var nonPrimary = computeNonPrimaryTargetPenalty(row.fish, scoreCtx);
  return finalScore + boost - nonPrimary;
}

/**
 * @param {object[]} qualified — scored rows
 * @param {object} scoreCtx
 * @param {number} maxItems
 * @returns {object[]}
 */
function pickRankedWithDiversity(qualified, scoreCtx, maxItems) {
  var enriched = qualified.map(function (row) {
    return {
      fish: row.fish,
      modular: row.modular,
      display_rank_score: computeDisplayRankScore(row, scoreCtx),
      _family_group: resolveNormalizedFamilyGroup(row.fish)
    };
  });

  enriched.sort(function (a, b) {
    if (b.display_rank_score !== a.display_rank_score) return b.display_rank_score - a.display_rank_score;
    if (b.modular.final_score !== a.modular.final_score) return b.modular.final_score - a.modular.final_score;
    return a.fish.fish_name_ar.localeCompare(b.fish.fish_name_ar, 'ar');
  });

  var picked = [];
  var groupsUsed = {};
  var pickedKeys = {};

  function tryPick(row, allowDuplicate) {
    var key = row.fish.id || row.fish.fish_name_ar;
    if (pickedKeys[key]) return false;
    var g = row._family_group;
    if (!allowDuplicate && groupsUsed[g]) {
      var prev = groupsUsed[g];
      var both90 = row.modular.final_score > 90 && prev.final_score > 90;
      if (!both90) return false;
    }
    picked.push(row);
    pickedKeys[key] = true;
    if (!groupsUsed[g]) {
      groupsUsed[g] = { final_score: row.modular.final_score, name: row.fish.fish_name_ar };
    }
    return true;
  }

  for (var i = 0; i < enriched.length && picked.length < maxItems; i++) {
    tryPick(enriched[i], false);
  }

  if (picked.length < maxItems) {
    for (var j = 0; j < enriched.length && picked.length < maxItems; j++) {
      tryPick(enriched[j], true);
    }
  }

  return picked;
}

/**
 * @deprecated Emergency fallback when Gulf DB scoring yields no qualified species.
 */
function getGulfFishRecommendationsDeprecatedProfiles(ctx, minScore, maxItems) {
  var station = ctx && ctx.station ? ctx.station : {};
  var env = ctx && ctx.liveEnvironment ? ctx.liveEnvironment : {};
  var tideStateAr = normalizeTideStateArabic(ctx && ctx.tideState);
  var durName = normalizeString(ctx && ctx.currentDur && ctx.currentDur.durRow && (ctx.currentDur.durRow.name_ar || ctx.currentDur.durRow.name));
  var zoneRaw = normalizeString(station.zoneType || station.zone);
  var depthZone = normalizeDepthZoneArToKey(zoneRaw);
  var currentStrength = currentStrengthLabel(env.current_speed_ms);
  var tempC = toNumberLike(env.temp_c);
  var waveHeight = toNumberLike(env.wave_height_m);
  var windSpeed = toNumberLike(env.wind_speed_kmh);
  var regionBucket = stationRegionBucket(station);
  var floor = minScore != null ? minScore : 60;
  var cap = maxItems != null ? maxItems : 3;

  var scored = FISH_PROFILES.map(function (profile) {
    var score = 0;
    if (profile.depth_zone.indexOf(depthZone) >= 0 || (depthZone === 'shallow' && profile.depth_zone.indexOf('coastal') >= 0) || (depthZone === 'deep' && profile.depth_zone.indexOf('offshore') >= 0)) score += 30;
    if (profile.tide_states.indexOf(tideStateAr) >= 0) score += 25;
    if (tempC != null && tempC >= profile.temp_range_c[0] && tempC <= profile.temp_range_c[1]) score += 20;
    if (durName && profile.dur_preference.indexOf(durName) >= 0) score += 15;
    if (profile.current_preference.indexOf(currentStrength) >= 0) score += 10;
    if (waveHeight != null && profile.exclude_if && profile.exclude_if.wave_height_gt != null && waveHeight > profile.exclude_if.wave_height_gt) score -= 30;
    if (windSpeed != null && profile.exclude_if && profile.exclude_if.wind_speed_gt != null && windSpeed > profile.exclude_if.wind_speed_gt) score -= 30;
    if (profile.regions.indexOf(regionBucket) < 0) score -= 50;
    var confidence = clamp(Math.round(score), 0, 100);
    return {
      name_ar: profile.name_ar,
      fish_name_ar: profile.name_ar,
      confidence: confidence,
      score: confidence,
      reason_ar: buildStructuredReasonAr(['مسار احتياطي (ملفات ثابتة)'], confidence)
    };
  });

  scored.sort(function (a, b) { return b.confidence - a.confidence; });
  var picked = scored.filter(function (x) { return x.confidence >= floor; }).slice(0, cap);
  return {
    items: picked,
    species_activity: picked.map(function (x) { return x.name_ar; }),
    lock_species_activity: picked.length > 0,
    _engine_path: 'deprecated_fish_profiles'
  };
}

/**
 * @param {object} ctx
 * @returns {{ items: object[], species_activity: string[], lock_species_activity: boolean }}
 */
function getGulfFishRecommendations(ctx) {
  var opt = (ctx && ctx.options) || {};
  var minScore = opt.minScore != null ? Number(opt.minScore) : DEFAULT_MIN_SCORE;
  var maxItems = opt.maxItems != null ? Number(opt.maxItems) : DEFAULT_MAX_ITEMS;
  if (!Number.isFinite(minScore)) minScore = DEFAULT_MIN_SCORE;
  if (!Number.isFinite(maxItems)) maxItems = DEFAULT_MAX_ITEMS;

  var station = ctx && ctx.station ? ctx.station : {};
  var list = toArray(ctx && ctx.species);
  if (!list.length) {
    try {
      list = fishDb.getUnifiedSpeciesList(fishDb.loadGulfFishDatabaseFromDisk());
    } catch (_e) {
      list = [];
    }
  }
  var country = fishDb.normalizeCountry ? fishDb.normalizeCountry(station.country) : normalizeString(station.country);
  var speciesPool = country ? fishDb.filterByCountry(list, country) : list.slice();
  if (!speciesPool.length) {
    speciesPool = list.slice();
  }

  var analysisDate = ctx.analysisDateTime instanceof Date ? ctx.analysisDateTime : new Date();
  if (ctx.analysisDateTime && !(ctx.analysisDateTime instanceof Date)) {
    var tmp = new Date(ctx.analysisDateTime);
    if (!isNaN(tmp.getTime())) analysisDate = tmp;
  }

  var scoreCtx = {
    station: station,
    liveEnvironment: ctx.liveEnvironment || {},
    tideState: ctx.tideState,
    traitBundle: ctx.traitBundle || {},
    currentDur: ctx.currentDur || {},
    activePhase: ctx.activePhase,
    analysisDateTime: analysisDate
  };

  if (!speciesPool.length) {
    var depEmpty = getGulfFishRecommendationsDeprecatedProfiles(scoreCtx, minScore, maxItems);
    try {
      if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
        console.warn('NAVIDUR_FISH_ENGINE_FALLBACK', { path: depEmpty._engine_path, reason: 'empty_gulf_pool' });
      }
    } catch (_w0) { /* ignore */ }
    return {
      items: depEmpty.items,
      species_activity: depEmpty.species_activity,
      lock_species_activity: depEmpty.lock_species_activity
    };
  }

  var scored = speciesPool.map(function (fish) {
    var modular = scoreGulfSpeciesModular(fish, scoreCtx);
    return { fish: fish, modular: modular };
  });

  var qualified = scored.filter(function (row) {
    return row.modular.final_score >= minScore && countryFit(station.country, row.fish) > 0;
  });
  var pickedRows = pickRankedWithDiversity(qualified, scoreCtx, maxItems);
  var stationZoneLabel = normalizeString(station.zoneType || station.zone);
  var picked = pickedRows.map(function (row) {
    return recommendationItemFromFish(row.fish, row.modular, stationZoneLabel);
  });

  if (!picked.length) {
    try {
      if (typeof console !== 'undefined' && console && typeof console.debug === 'function') {
        console.debug('NAVIDUR_FISH_ENGINE_NO_QUALIFIED', {
          path: 'gulf_fish_database',
          station: normalizeString(station && station.name),
          minScore: minScore,
          pool_size: speciesPool.length
        });
      }
    } catch (_nq) { /* ignore */ }
    return { items: [], species_activity: [], lock_species_activity: false };
  }

  var selectedFish = picked.map(function (x) { return x.fish_name_ar; }).filter(Boolean);
  try {
    if (typeof console !== 'undefined' && console && typeof console.debug === 'function') {
      console.debug('NAVIDUR_FISH_RECOMMENDATION_ENGINE', {
        path: 'gulf_fish_database',
        station: normalizeString(station && station.name),
        country: country,
        pool_size: speciesPool.length,
        qualified: qualified.length,
        selected_fish: selectedFish,
        weights_total: W_TOTAL
      });
    }
  } catch (_dbgFishErr) { /* ignore */ }

  return { items: picked, species_activity: selectedFish, lock_species_activity: true };
}

module.exports = {
  getGulfFishRecommendations: getGulfFishRecommendations,
  scoreGulfSpeciesModular: scoreGulfSpeciesModular,
  computeDisplayRankScore: computeDisplayRankScore,
  resolveNormalizedFamilyGroup: resolveNormalizedFamilyGroup,
  pickRankedWithDiversity: pickRankedWithDiversity,
  hasSafiSeagrassContext: hasSafiSeagrassContext,
  getOperationalPriorityTier: getOperationalPriorityTier,
  getGulfFishRecommendationsDeprecatedProfiles: getGulfFishRecommendationsDeprecatedProfiles,
  getTimeOfDayAr: getTimeOfDayAr,
  resolveStationDepthAndZone: resolveStationDepthAndZone,
  resolveTidePhaseArabic: resolveTidePhaseArabic,
  W_TOTAL: W_TOTAL
};
