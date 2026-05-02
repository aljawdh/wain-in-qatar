/**
 * NAVIDUR Gulf fish recommendation engine (score 0–100).
 *
 * Base weight model (unchanged; multiplied by small dynamic factors):
 *   DUR 25, water 20, temp 20, depth 15, zone 10, time 5, country 5
 *
 * Extensions (additive, then clamp 0–100):
 *   - Tide direction سقي/ثبر vs preferred_tide_phase: +10 or −5
 *   - Behavior intelligence layer: +0 to +15 (time, حمل/فساد, tide, behavior profile)
 *   - Micro bonus for pelagic+حمل / bottom+فساد: +0 to +5
 *
 * If sea surface temperature is missing, temperature term is scaled as before, then
 * behavior/tide/micro are applied, then result clamped to 100.
 */
'use strict';

var fishDb = require('./navidur-fish-database');
var getLearningScoreDelta;
try {
  getLearningScoreDelta = require('./navidur-learning-apply-engine').getLearningScoreDelta;
} catch (_e) {
  getLearningScoreDelta = null;
}

var W_DUR = 25;
var W_WATER = 20;
var W_TEMP = 20;
var W_DEPTH = 15;
var W_ZONE = 10;
var W_TIME = 5;
var W_COUNTRY = 5;
var W_SUM_NO_TEMP = W_DUR + W_WATER + W_DEPTH + W_ZONE + W_TIME + W_COUNTRY;
var W_BEHAVIOR_CAP = 15;
var W_TIDE_MATCH = 10;
var W_TIDE_OPP = -5;
var W_DYN_MAX = 5;
var FISH_MIN_CONFIDENCE = 60;
var FISH_MAX_ITEMS = 3;

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
  var lo = isPelagicish(fish) ? 24 : 20;
  var hi = isPelagicish(fish) ? 32 : 33;
  if (t >= lo && t <= hi) return 1;
  var margin = 4;
  if (t < lo) return clamp(1 - (lo - t) / margin, 0, 1);
  return clamp(1 - (t - hi) / margin, 0, 1);
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
  if (d >= mn && d <= mx) return 1;
  var err = d < mn ? mn - d : d - mx;
  var width = Math.max(5, (mx - mn) || 10);
  return clamp(1 - err / (width * 0.5), 0, 1);
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
  if (!p) return 0.55;
  if (tideState === 'UNKNOWN') return 0.45;
  return 0.25;
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
  var c = normalizeString(stationCountry);
  var list = toArray(fish.countries);
  if (!c) {
    if (!list.length) return 1;
    return 0.8;
  }
  if (list.indexOf(c) >= 0) return 1;
  return 0;
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

function fishReasonShort(profile, ctx) {
  if (profile.tide_states.indexOf('حمل') >= 0 && ctx.depth_zone === 'shallow') return 'مناسب للحمل والمياه الساحلية الهادئة';
  if (profile.current_preference.indexOf('medium') >= 0) return 'مناسب مع تيار متوسط وحرارة ماء ملائمة';
  if (ctx.depth_zone === 'deep') return 'فرصته أفضل في الغزير مع نشاط التيار';
  return 'ملائم لظروف البحر الحالية في المحطة';
}

/**
 * @param {object} ctx
 * @returns {{ items: object[], species_activity: string[] }}
 */
function getGulfFishRecommendations(ctx) {
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
      reason_ar: fishReasonShort(profile, {
        tide_state: tideStateAr,
        depth_zone: depthZone,
        current_strength: currentStrength,
        temp_c: tempC
      })
    };
  });

  scored.sort(function (a, b) { return b.confidence - a.confidence; });
  var picked = scored.filter(function (x) { return x.confidence >= FISH_MIN_CONFIDENCE; }).slice(0, FISH_MAX_ITEMS);
  var selectedFish = picked.map(function (x) { return x.name_ar; });

  try {
    if (typeof console !== 'undefined' && console && typeof console.debug === 'function') {
      console.debug('NAVIDUR_FISH_RECOMMENDATION_CONTEXT', {
        station: normalizeString(station && station.name),
        depth_zone: depthZone,
        tide_state: tideStateAr,
        dur_name: durName,
        temp_c: tempC,
        wave_height_m: waveHeight,
        wind_speed_kmh: windSpeed,
        current_strength: currentStrength,
        selected_fish: selectedFish
      });
      console.debug('NAVIDUR_FISH_RECOMMENDATION_RESULT', picked);
    }
  } catch (_dbgFishErr) { /* ignore */ }

  return { items: picked, species_activity: selectedFish, lock_species_activity: true };
}

module.exports = {
  getGulfFishRecommendations: getGulfFishRecommendations,
  getTimeOfDayAr: getTimeOfDayAr,
  resolveStationDepthAndZone: resolveStationDepthAndZone,
  resolveTidePhaseArabic: resolveTidePhaseArabic
};
