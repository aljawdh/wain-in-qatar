'use strict';

/**
 * Read-only index of workbook cities from imported dur_windows + coordinates from star_events.
 * Used for admin mapping suggestions only — not wired to public runtime.
 */

/** Max geodesic distance for an automatic nearest_city suggestion (strict). Beyond this → needs_review only. */
var NEAREST_SAFE_AUTO_KM = 80;

/** @param {string|null|undefined} s */
function normalizeWorkbookCityName(s) {
  if (s == null || s === '') return '';
  return String(s).replace(/^\s+|\s+$/g, '').normalize('NFC');
}

function cityKeyFromName(name) {
  return normalizeWorkbookCityName(name);
}

/**
 * Optional Arabic / spelling variants → canonical workbook display name (must exist in index).
 * Extend only when alias is agreed in data workflow — never guess geography.
 */
var CITY_NAME_ALIASES = {};

function haversineKm(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad;
  var dLon = (lon2 - lon1) * toRad;
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * @param {{ workbook_windows?: object[] }} durWindowsDoc
 * @param {{ events?: object[] }} starEventsDoc
 */
function buildWorkbookCityIndex(durWindowsDoc, starEventsDoc) {
  var rows = Array.isArray(durWindowsDoc.workbook_windows) ? durWindowsDoc.workbook_windows : [];
  var seen = new Map();

  rows.forEach(function (w) {
    if (!w || !w.city) return;
    var name = String(w.city).trim();
    var key = cityKeyFromName(name);
    if (!key) return;
    if (!seen.has(key)) {
      seen.set(key, { key: key, name: name, lat: null, lon: null });
    }
  });

  var events = Array.isArray(starEventsDoc.events) ? starEventsDoc.events : [];
  events.forEach(function (ev) {
    if (!ev || ev.calendar_profile !== 'operational_v1') return;
    var name = ev.city != null ? String(ev.city).trim() : '';
    var key = cityKeyFromName(name);
    if (!key || !seen.has(key)) return;
    var slot = seen.get(key);
    if (slot.lat == null && ev.lat != null && ev.lon != null) {
      slot.lat = Number(ev.lat);
      slot.lon = Number(ev.lon);
    }
  });

  var cities = Array.from(seen.values()).sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name), 'ar');
  });

  var byKey = new Map();
  cities.forEach(function (c) {
    byKey.set(c.key, c);
  });

  return { cities: cities, byKey: byKey };
}

/**
 * @param {object} station
 * @param {{ cities: object[], byKey: Map }} index
 */
function suggestWorkbookCityForStation(station, index) {
  var empty = {
    preserved: false,
    workbook_city_key: null,
    workbook_city_name: null,
    workbook_match_mode: null,
    workbook_assignment_status: 'needs_review',
    confidence: 'none',
    distance_km: null,
    rationale: 'no_match'
  };

  if (!station || typeof station !== 'object') return empty;

  var modeIn = String(station.workbook_match_mode || '').toLowerCase();
  var statusIn = String(station.workbook_assignment_status || '').toLowerCase();
  var existingKey = station.workbook_city_key != null ? normalizeWorkbookCityName(station.workbook_city_key) : '';
  var existingName = station.workbook_city_name != null ? String(station.workbook_city_name).trim() : '';

  if (modeIn === 'manual' && statusIn === 'manual_confirmed' && existingKey && index.byKey.has(existingKey)) {
    var kept = index.byKey.get(existingKey);
    return {
      preserved: true,
      workbook_city_key: kept.key,
      workbook_city_name: kept.name,
      workbook_match_mode: 'manual',
      workbook_assignment_status: 'manual_confirmed',
      confidence: 'high',
      distance_km: null,
      rationale: 'manual_mapping_preserved'
    };
  }

  var stName = normalizeWorkbookCityName(station.name);
  var lat = Number(station.lat);
  var lon = Number(station.lon);

  /** @type {{ key: string, name: string, distanceKm?: number } | null} */
  var bestExact = null;
  index.cities.forEach(function (c) {
    if (normalizeWorkbookCityName(c.name) === stName || c.key === stName) {
      bestExact = { key: c.key, name: c.name };
    }
  });
  if (bestExact) {
    return {
      preserved: false,
      workbook_city_key: bestExact.key,
      workbook_city_name: bestExact.name,
      workbook_match_mode: 'exact_name',
      workbook_assignment_status: 'auto_assigned',
      confidence: 'high',
      distance_km: null,
      rationale: 'exact_normalized_name'
    };
  }

  var aliasCanon = CITY_NAME_ALIASES[stName];
  if (aliasCanon) {
    var ak = cityKeyFromName(aliasCanon);
    if (index.byKey.has(ak)) {
      var ac = index.byKey.get(ak);
      return {
        preserved: false,
        workbook_city_key: ac.key,
        workbook_city_name: ac.name,
        workbook_match_mode: 'exact_name',
        workbook_assignment_status: 'auto_assigned',
        confidence: 'high',
        distance_km: null,
        rationale: 'approved_alias_table'
      };
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Object.assign({}, empty, { rationale: 'missing_coordinates' });
  }

  var best = null;
  var bestD = Infinity;
  index.cities.forEach(function (c) {
    if (c.lat == null || c.lon == null) return;
    var d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  });

  if (!best) {
    return Object.assign({}, empty, { rationale: 'no_coordinates_for_workbook_cities' });
  }

  var withinSafe = bestD <= NEAREST_SAFE_AUTO_KM;
  var assign = withinSafe ? 'auto_assigned' : 'needs_review';
  var conf = withinSafe ? 'medium' : 'low';

  return {
    preserved: false,
    workbook_city_key: best.key,
    workbook_city_name: best.name,
    workbook_match_mode: 'nearest_city',
    workbook_assignment_status: assign,
    confidence: conf,
    distance_km: Math.round(bestD * 10) / 10,
    rationale: withinSafe ? 'nearest_within_safe_distance_km' : 'nearest_exceeds_safe_distance_requires_review'
  };
}

/**
 * @param {object[]} stations
 * @param {{ cities: object[] }} index
 */
function summarizeWorkbookMappingStats(stations, index) {
  var list = Array.isArray(stations) ? stations : [];
  var keys = index && index.byKey instanceof Map ? index.byKey : new Map();
  var total = list.length;
  var mapped = 0;
  var unmapped = 0;
  var manualConfirmed = 0;
  var needsReview = 0;
  var autoAssigned = 0;
  var invalid_workbook_key = 0;

  list.forEach(function (s) {
    if (!s || !s.id) return;
    var k = s.workbook_city_key != null ? String(s.workbook_city_key).trim() : '';
    if (!k) {
      unmapped++;
      return;
    }
    if (!keys.has(normalizeWorkbookCityName(k))) invalid_workbook_key++;
    mapped++;
    var st = String(s.workbook_assignment_status || '').toLowerCase();
    if (st === 'manual_confirmed') manualConfirmed++;
    else if (st === 'needs_review') needsReview++;
    else if (st === 'auto_assigned') autoAssigned++;
  });

  return {
    total_stations: total,
    mapped_stations: mapped,
    unmapped_stations: unmapped,
    manual_confirmed: manualConfirmed,
    needs_review: needsReview,
    auto_assigned: autoAssigned,
    invalid_workbook_key: invalid_workbook_key,
    workbook_city_catalog_size: keys.size
  };
}

module.exports = {
  normalizeWorkbookCityName,
  cityKeyFromName,
  buildWorkbookCityIndex,
  suggestWorkbookCityForStation,
  summarizeWorkbookMappingStats,
  haversineKm,
  NEAREST_SAFE_AUTO_KM
};
