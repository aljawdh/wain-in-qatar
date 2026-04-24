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

/**
 * @param {object} ctx
 * @returns {{ items: object[], species_activity: string[] }}
 */
function getGulfFishRecommendations(ctx) {
  var opt = (ctx && ctx.options) || {};
  var minScore = opt.minScore != null ? opt.minScore : 45;
  var maxItems = opt.maxItems != null ? opt.maxItems : 8;

  var list = toArray(ctx && ctx.species);
  var station = ctx.station || {};
  var env = ctx.liveEnvironment || {};
  var tideState = ctx.tideState;
  var traitBundle = ctx.traitBundle || {};
  var currentDur = ctx.currentDur || {};
  var activePhase = ctx.activePhase;
  var analysisDate = ctx.analysisDateTime instanceof Date ? ctx.analysisDateTime : new Date();
  if (ctx.analysisDateTime && !(ctx.analysisDateTime instanceof Date)) {
    var tmpd = new Date(ctx.analysisDateTime);
    if (!isNaN(tmpd.getTime())) analysisDate = tmpd;
  }

  var tod = getTimeOfDayAr(analysisDate);
  var tidePhaseAr = resolveTidePhaseArabic(env);
  var waterStateAr = waterStateArabic(tideState);
  var durName = '';
  try {
    durName = normalizeString(currentDur.durRow && (currentDur.durRow.name_ar || currentDur.durRow.name));
  } catch (_e) { /* ignore */ }

  var res = resolveStationDepthAndZone(station);
  var stationDepth = res.depthM;
  var stationZone = res.zoneType;
  var sst = env.temp_c != null ? Number(env.temp_c) : null;
  if (!isFinite(sst)) sst = null;

  var country = normalizeString(station.country);
  var speciesPool = toArray(list);
  if (!speciesPool.length) {
    try {
      speciesPool = fishDb.getUnifiedSpeciesList(fishDb.loadGulfFishDatabaseFromDisk());
    } catch (_e) {
      speciesPool = [];
    }
  }
  speciesPool = country ? fishDb.filterByCountry(speciesPool, country) : speciesPool.slice();

  if (!speciesPool.length) {
    return { items: [], species_activity: [] };
  }

  var scored = speciesPool.map(function (fish) {
    var mults = getDynamicWeightMultipliers(fish, tideState, tod);
    var rDur = matchFishToTraits(fish, traitBundle, currentDur, activePhase) ? 1
      : (normalizeString(fish.seasonality_ar).indexOf('طوال') >= 0 || normalizeString(fish.seasonality_ar).indexOf('عام') >= 0 ? 0.55 : 0.35);
    var durPts = rDur * W_DUR * (mults.dur || 1);
    var waterPts = waterPrefMatches(tideState, fish) * W_WATER * (mults.water || 1);
    var tempPts = sst != null ? tempComfortRatio(sst, fish) * W_TEMP * (mults.temp || 1) : 0;
    var depthPts = depthFitRatio(stationDepth, fish) * W_DEPTH * (mults.depth || 1);
    var zonePts = zoneTypeFit(stationZone, fish) * W_ZONE * (mults.zone || 1);
    var timePts = timeOfDayFit(tod, fish) * W_TIME * (mults.time || 1);
    var countryPts = countryFit(country, fish) * W_COUNTRY * (mults.country || 1);

    var lineSum = durPts + waterPts + tempPts + depthPts + zonePts + timePts + countryPts;
    var baseScaled;
    if (sst == null) {
      var sumNoT = durPts + waterPts + depthPts + zonePts + timePts + countryPts;
      baseScaled = (sumNoT / W_SUM_NO_TEMP) * 100;
    } else {
      baseScaled = lineSum;
    }

    var b01 = computeBehaviorMatch01(fish, tod, tideState, tidePhaseAr, waterStateAr);
    var behaviorPts = b01 * W_BEHAVIOR_CAP;
    var tidePts = computeTidePhasePoints(fish, tidePhaseAr);
    var dynBonus = computeDynamicMicroBonus(fish, tideState, tod);
    var total = baseScaled + behaviorPts + tidePts + dynBonus;
    var score = Math.round(clamp(total, 0, 100));

    var hits = [];
    if (rDur >= 0.8) hits.push('يُلائم الدر والسمات الموسمية');
    else if (rDur >= 0.4) hits.push('إمكانية موسمية معقولة');
    if (tideState === 'LOAD' && fish.water_state_pref === 'LOAD') hits.push('ماء «حمل» ينسجم مع تفضيله');
    if (tideState === 'FASAD' && fish.water_state_pref === 'FASAD') hits.push('ماء «فساد» ينسجم مع تفضيله');
    if (sst != null && tempComfortRatio(sst, fish) >= 0.85) hits.push('حرارة مناسبة');
    if (depthFitRatio(stationDepth, fish) >= 0.9) hits.push('عمق مريح');
    if (tidePhaseAr && toArray(fish.preferred_tide_phase).indexOf(tidePhaseAr) >= 0) {
      hits.push('يتوافق مع اتجاه المد ' + tidePhaseAr);
    }
    if (b01 >= 0.65) {
      hits.push('سلوك النوع يتطابق مع الوقت والماء (حمل/فساد' + (tidePhaseAr ? '، ' + tidePhaseAr : '') + ')');
    }

    var lead = '';
    if (activityHas(fish, 'ليلي') && (tod === 'ليل' || tod === 'فجر')) {
      lead = 'نشط ليلاً ويتوافق مع ' + (tideState === 'FASAD' ? 'فساد' : 'حمل') + (tidePhaseAr ? ' و' + tidePhaseAr : '') + (durName ? '، ويزداد ملاءمته في «' + durName + '»' : '') + '؛';
    } else if (activityHas(fish, 'نهاري') && (tod === 'نهار' || tod === 'عصر')) {
      lead = 'نشط نهاراً ويُفضّل أوقات الضوء مع ' + (tideState === 'FASAD' ? 'فساد' : 'حمل') + (tidePhaseAr ? ' و' + tidePhaseAr : '') + (durName ? ' — در «' + durName + '»' : '') + '؛';
    } else {
      lead = 'تقييم مُحدَّث';
    }
    var reason_ar = buildSmartReasonAr({ lead: lead, durName: durName, waterAr: waterStateAr, tidePhase: tidePhaseAr, tod: tod, hits: hits });

    var methods = parseMethodsMethods(fish.methods_raw);
    if (!methods.length) methods = ['تروق محلية', 'قصبة'];

    return {
      fish_name_ar: fish.fish_name_ar,
      fish_name_en: fish.fish_name_en,
      score: score,
      confidence: mapConfidence(score),
      reason_ar: reason_ar,
      recommended_methods: methods,
      habitat: fish.habitat || (fish.habitat_tags && fish.habitat_tags[0]) || '—',
      feeding: fish.feeding || '—',
      zone: fish.eco_zone || (fish.habitat_tags && fish.habitat_tags[0]) || '—',
      best_time: bestTimesForFish(fish)
    };
  });

  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.fish_name_ar.localeCompare(b.fish_name_ar, 'ar');
  });

  var qualified = scored.filter(function (r) { return r.score >= minScore; });
  var picked = qualified.slice(0, maxItems);
  var speciesNames = picked.map(function (p) { return p.fish_name_ar; }).filter(Boolean);

  return { items: picked, species_activity: speciesNames };
}

module.exports = {
  getGulfFishRecommendations: getGulfFishRecommendations,
  getTimeOfDayAr: getTimeOfDayAr,
  resolveStationDepthAndZone: resolveStationDepthAndZone,
  resolveTidePhaseArabic: resolveTidePhaseArabic
};
