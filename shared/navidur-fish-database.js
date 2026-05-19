/**
 * Gulf fish reference (from data/gulf_fish_database.json).
 * - Fish are NOT tied to a fixed station: matching uses country, habitat, depth, and eco-zone.
 * - New stations work automatically if they provide country, depth or zoneType, lat/lon (see analysis engine).
 */
'use strict';

var path = require('path');
var fs = require('fs');

var enrichFishBehavior = null;
try {
  enrichFishBehavior = require('./navidur-fish-behavior-defaults').enrichFishBehavior;
} catch (_e) {
  enrichFishBehavior = null;
}

var GULF_GENERIC_LABEL = 'عام-خليجي';

function toArray(x) {
  return Array.isArray(x) ? x : [];
}

function normalizeString(v) {
  return String(v == null ? '' : v).trim();
}

function normalizeCountry(v) {
  var c = normalizeString(v);
  if (c === 'عمان') return 'عُمان';
  if (c === 'الامارات' || c === 'الإمارات العربية المتحدة') return 'الإمارات';
  return c;
}

function isPelagicClassification(row) {
  return /سطحي|مهاجر|إسقم|تون|لخم|تونة/i.test(normalizeString(row && row.classification_ar));
}

/**
 * Derive scoring preferences from Gulf DB row + safe defaults (Phase A SSOT).
 * Optional JSON fields: preferred_temp_min/max, preferred_wave_max, preferred_current_max,
 * dur_preference[], visibility_preference, activity_months[] (1-12).
 */
function buildScoringProfile(row) {
  var r = row || {};
  var pelagic = isPelagicClassification(r);
  var tempMin = r.preferred_temp_min != null ? Number(r.preferred_temp_min) : (pelagic ? 24 : 20);
  var tempMax = r.preferred_temp_max != null ? Number(r.preferred_temp_max) : (pelagic ? 32 : 33);
  if (!Number.isFinite(tempMin)) tempMin = pelagic ? 24 : 20;
  if (!Number.isFinite(tempMax)) tempMax = pelagic ? 32 : 33;
  var waveMax = r.preferred_wave_max != null ? Number(r.preferred_wave_max) : (pelagic ? 1.65 : 1.35);
  if (!Number.isFinite(waveMax)) waveMax = pelagic ? 1.65 : 1.35;
  var curMax = r.preferred_current_max != null ? Number(r.preferred_current_max) : (pelagic ? 1.25 : 0.85);
  if (!Number.isFinite(curMax)) curMax = pelagic ? 1.25 : 0.85;
  var curMin = r.preferred_current_min != null ? Number(r.preferred_current_min) : 0.2;
  if (!Number.isFinite(curMin)) curMin = 0.2;
  var months = toArray(r.activity_months).map(function (m) {
    return Number(m);
  }).filter(function (m) {
    return Number.isFinite(m) && m >= 1 && m <= 12;
  });
  return {
    preferred_temp_min: tempMin,
    preferred_temp_max: tempMax,
    preferred_wave_max: waveMax,
    preferred_current_min: curMin,
    preferred_current_max: curMax,
    preferred_depth_m: r.depth_m && typeof r.depth_m === 'object' ? r.depth_m : { min: null, max: null, label: '' },
    water_state_pref: normalizeString(r.water_state_pref),
    habitat_tags: toArray(r.habitat_tags).map(normalizeString).filter(Boolean),
    countries: toArray(r.countries).map(normalizeCountry).filter(Boolean),
    activity_months: months.length ? months : null,
    dur_preference: toArray(r.dur_preference).map(normalizeString).filter(Boolean),
    visibility_preference: normalizeString(r.visibility_preference) || 'medium'
  };
}

/** Ecological / bathymetry tags (Arabic) used for filtering. */
var ECO_TAGS = ['ساحلي', 'غزير', 'شعاب', 'رملي', 'طيني', 'مياه مفتوحة'];

/**
 * @param {object} row — raw JSON species row
 * @returns {object} unified fields for the recommendation engine
 */
function unifySpeciesRow(row) {
  var h = toArray(row.habitat_tags);
  var tags = h.map(normalizeString).filter(Boolean);
  var base = {
    id: normalizeString(row.id),
    fish_name_ar: normalizeString(row.fish_name_ar),
    fish_name_en: normalizeString(row.fish_name_en),
    scientific_name: normalizeString(row.scientific_name),
    family: normalizeString(row.family),
    classification_ar: normalizeString(row.classification_ar),
    habitat: normalizeString(row.habitat),
    feeding: normalizeString(row.feeding),
    methods_raw: normalizeString(row.methods_raw),
    depth_m: row.depth_m && typeof row.depth_m === 'object' ? {
      min: row.depth_m.min,
      max: row.depth_m.max,
      label: normalizeString(row.depth_m.label)
    } : { min: null, max: null, label: '' },
    seasonality_ar: normalizeString(row.seasonality_ar),
    eco_zone: normalizeString(row.eco_zone),
    water_state_pref: normalizeString(row.water_state_pref),
    habitat_tags: tags,
    countries: toArray(row.countries).map(normalizeString).filter(Boolean)
  };
  if (enrichFishBehavior) {
    var eb = enrichFishBehavior(row);
    base.behavior = eb.behavior;
    base.preferred_tide_phase = toArray(eb.preferred_tide_phase);
  } else {
    base.behavior = { activity: ['نهاري', 'ليلي'], aggression: 'متوسط', movement: 'متحرك', feeding_type: 'مختلط' };
    base.preferred_tide_phase = ['سقي', 'ثبر'];
  }
  base.scoring = buildScoringProfile(row);
  return base;
}

var _cached = null;
var _cachedPath = null;

/**
 * Load JSON from disk (Node). Cached per path for repeated analyses.
 * @param {string} [jsonPath] — default: ../data/gulf_fish_database.json from this file
 * @returns {{ version: number, species: object[] }}
 */
function loadGulfFishDatabaseFromDisk(jsonPath) {
  var p = jsonPath || path.join(__dirname, '..', 'data', 'gulf_fish_database.json');
  if (_cached && _cachedPath === p) return _cached;
  var raw = fs.readFileSync(p, 'utf8');
  _cached = JSON.parse(raw);
  _cachedPath = p;
  return _cached;
}

/**
 * @param {object} doc — full JSON document
 * @returns {object[]}
 */
function getUnifiedSpeciesList(doc) {
  var d = doc || {};
  return toArray(d.species).map(unifySpeciesRow).filter(function (r) {
    return r.fish_name_ar;
  });
}

/**
 * @param {string} country
 * @param {object[]} list — unified list
 * @returns {object[]}
 */
function filterByCountry(list, country) {
  var c = normalizeCountry(country);
  if (!c) {
    return list.slice();
  }
  var out = list.filter(function (f) {
    if (!f.countries.length) return true;
    return f.countries.indexOf(c) >= 0;
  });
  if (out.length) return out;
  return list.filter(function (f) {
    return !f.countries.length;
  });
}

/**
 * @param {string} tag — one of ECO_TAGS
 * @param {object[]} list
 */
function filterByEcologicalTag(list, tag) {
  var t = normalizeString(tag);
  if (!t) return list.slice();
  return list.filter(function (f) {
    if (f.habitat_tags.indexOf(t) >= 0) return true;
    if (f.eco_zone && normalizeString(f.eco_zone) === t) return true;
    return false;
  });
}

module.exports = {
  ECO_TAGS: ECO_TAGS,
  GULF_GENERIC_LABEL: GULF_GENERIC_LABEL,
  unifySpeciesRow: unifySpeciesRow,
  buildScoringProfile: buildScoringProfile,
  normalizeCountry: normalizeCountry,
  loadGulfFishDatabaseFromDisk: loadGulfFishDatabaseFromDisk,
  getUnifiedSpeciesList: getUnifiedSpeciesList,
  filterByCountry: filterByCountry,
  filterByEcologicalTag: filterByEcologicalTag
};
