'use strict';

const { cleanString, toNumber } = require('./security');
const { nowIso } = require('./data-store');

function normalizeStatus(status) {
  const s = cleanString(status, 20).toLowerCase();
  if (s === 'active' || s === 'archived' || s === 'disabled') return s;
  return 'active';
}

function normalizeCategory(category) {
  const c = cleanString(category, 40).toLowerCase();
  if (!c) return 'all';
  if (c === 'nearby' || c === 'popular' || c === 'all') return c;
  return c;
}

function normalizeFishingMode(mode, fallback) {
  const m = cleanString(mode != null ? mode : fallback, 20).toLowerCase();
  if (m === 'deep') return 'deep';
  return 'coastal';
}

function normalizeTags(tags, category, featured) {
  const list = Array.isArray(tags) ? tags : [];
  const cleaned = list.map((t) => cleanString(t, 40).toLowerCase()).filter(Boolean);
  if (category === 'nearby' && !cleaned.includes('nearby')) cleaned.push('nearby');
  if (category === 'popular' && !cleaned.includes('popular')) cleaned.push('popular');
  if (featured && !cleaned.includes('featured')) cleaned.push('featured');
  return Array.from(new Set(cleaned)).slice(0, 20);
}

function validateStationInput(input) {
  const name = cleanString(input.name, 100);
  const lat = toNumber(input.lat);
  const lon = toNumber(input.lon);

  if (!name) throw new Error('station_name_required');
  if (lat == null || lon == null) throw new Error('station_coordinates_required');
  if (lat < -90 || lat > 90) throw new Error('station_lat_out_of_range');
  if (lon < -180 || lon > 180) throw new Error('station_lon_out_of_range');
}

function normalizeStationInput(input, existing) {
  const base = existing || {};
  const now = nowIso();
  const status = normalizeStatus(input.status || base.status);
  const category = normalizeCategory(input.category || base.category || 'all');
  const featured = input.featured != null ? !!input.featured : !!base.featured;
  const fishingMode = normalizeFishingMode(input.fishing_mode, base.fishing_mode);
  const station = {
    id: cleanString(base.id || input.id, 80),
    name: cleanString(input.name != null ? input.name : base.name, 100),
    lat: toNumber(input.lat != null ? input.lat : base.lat),
    lon: toNumber(input.lon != null ? input.lon : base.lon),
    country: cleanString(input.country != null ? input.country : base.country, 80),
    region: cleanString(input.region != null ? input.region : base.region, 80) || 'gulf',
    fishing_mode: fishingMode,
    category,
    status,
    featured,
    tags: normalizeTags(input.tags != null ? input.tags : base.tags, category, featured),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : (Number(base.sort_order) || 0),
    default_radius: Number.isFinite(Number(input.default_radius)) ? Number(input.default_radius) : (Number(base.default_radius) || 0.02),
    notes: cleanString(input.notes != null ? input.notes : base.notes, 800),
    assigned_members: Array.isArray(input.assigned_members != null ? input.assigned_members : base.assigned_members)
      ? (input.assigned_members != null ? input.assigned_members : base.assigned_members).map((x) => cleanString(x, 80)).filter(Boolean).slice(0, 300)
      : [],
    trust_priority: input.trust_priority != null ? Number(input.trust_priority) : (base.trust_priority != null ? Number(base.trust_priority) : null),
    station_quality_score: input.station_quality_score != null ? Number(input.station_quality_score) : (base.station_quality_score != null ? Number(base.station_quality_score) : null),
    seabed_type: cleanString(input.seabed_type != null ? input.seabed_type : base.seabed_type, 80) || null,
    depth_profile: cleanString(input.depth_profile != null ? input.depth_profile : base.depth_profile, 120) || null,
    created_at: base.created_at || now,
    updated_at: now
  };

  validateStationInput(station);
  if (station.default_radius <= 0 || station.default_radius > 3) throw new Error('station_default_radius_invalid');
  if (station.sort_order < 0) throw new Error('station_sort_order_invalid');

  return station;
}

function hasDuplicateStation(stations, station, skipId) {
  const keyName = String(station.name || '').trim().toLowerCase();
  const lat = Number(station.lat).toFixed(5);
  const lon = Number(station.lon).toFixed(5);
  return stations.some((s) => {
    if (skipId && s.id === skipId) return false;
    return String(s.name || '').trim().toLowerCase() === keyName
      && Number(s.lat).toFixed(5) === lat
      && Number(s.lon).toFixed(5) === lon;
  });
}

module.exports = {
  normalizeStatus,
  validateStationInput,
  normalizeStationInput,
  hasDuplicateStation
};
