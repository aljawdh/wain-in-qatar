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

function normalizeNullableString(value, maxLen) {
  const cleaned = cleanString(value, maxLen);
  return cleaned || null;
}

function normalizeNullableBoolean(value, fallback) {
  if (value === true || value === false) return value;
  if (fallback === true || fallback === false) return fallback;
  return null;
}

function normalizeIsoDate(value) {
  const cleaned = cleanString(value, 20);
  if (!cleaned) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null;
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
  const isReferenceStation = input.is_reference_station != null ? !!input.is_reference_station : !!base.is_reference_station;
  const isOperationalStation = normalizeNullableBoolean(
    input.is_operational_station,
    base.is_operational_station != null ? !!base.is_operational_station : !isReferenceStation
  );
  const operationalVisibility = normalizeNullableBoolean(
    input.operational_visibility,
    base.operational_visibility != null ? !!base.operational_visibility : !isReferenceStation
  );
  const station = {
    id: cleanString(base.id || input.id, 80),
    name: cleanString(input.name != null ? input.name : base.name, 100),
    lat: toNumber(input.lat != null ? input.lat : base.lat),
    lon: toNumber(input.lon != null ? input.lon : base.lon),
    country: cleanString(input.country != null ? input.country : base.country, 80),
    region: cleanString(input.region != null ? input.region : base.region, 80) || 'gulf',
    local_area: cleanString(input.local_area != null ? input.local_area : base.local_area, 80),
    fishing_mode: fishingMode,
    category,
    status,
    featured,
    tags: normalizeTags(input.tags != null ? input.tags : base.tags, category, featured),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : (Number(base.sort_order) || 0),
    default_radius: Number.isFinite(Number(input.default_radius)) ? Number(input.default_radius) : (Number(base.default_radius) || 0.02),
    station_role_type: (function () {
      const v = cleanString(input.station_role_type != null ? input.station_role_type : base.station_role_type, 40).toLowerCase();
      if (v === 'primary_reference' || v === 'secondary_linked' || v === 'latlon_band_station') return v;
      return 'secondary_linked';
    })(),
    primary_reference: input.primary_reference != null ? !!input.primary_reference : !!base.primary_reference,
    reference_station_id: cleanString(input.reference_station_id != null ? input.reference_station_id : base.reference_station_id, 80),
    notes: cleanString(input.notes != null ? input.notes : base.notes, 800),
    added_from_field: input.added_from_field != null ? !!input.added_from_field : !!base.added_from_field,
    source_tag: cleanString(input.source_tag != null ? input.source_tag : base.source_tag, 40),
    assigned_members: Array.isArray(input.assigned_members != null ? input.assigned_members : base.assigned_members)
      ? (input.assigned_members != null ? input.assigned_members : base.assigned_members).map((x) => cleanString(x, 80)).filter(Boolean).slice(0, 300)
      : [],
    trust_priority: input.trust_priority != null ? Number(input.trust_priority) : (base.trust_priority != null ? Number(base.trust_priority) : null),
    station_quality_score: input.station_quality_score != null ? Number(input.station_quality_score) : (base.station_quality_score != null ? Number(base.station_quality_score) : null),
    seabed_type: cleanString(input.seabed_type != null ? input.seabed_type : base.seabed_type, 80) || null,
    depth_profile: cleanString(input.depth_profile != null ? input.depth_profile : base.depth_profile, 120) || null,
    is_reference_station: isReferenceStation,
    is_operational_station: isOperationalStation == null ? !isReferenceStation : isOperationalStation,
    operational_visibility: operationalVisibility == null ? !isReferenceStation : operationalVisibility,
    reference_anchor_mode: isReferenceStation
      ? (normalizeNullableString(input.reference_anchor_mode != null ? input.reference_anchor_mode : base.reference_anchor_mode, 80) || 'coastal_land_anchor')
      : normalizeNullableString(input.reference_anchor_mode != null ? input.reference_anchor_mode : base.reference_anchor_mode, 80),
    reference_priority: input.reference_priority != null
      ? (Number.isFinite(Number(input.reference_priority)) ? Number(input.reference_priority) : null)
      : (base.reference_priority != null && Number.isFinite(Number(base.reference_priority)) ? Number(base.reference_priority) : null),
    latitude_band_key: normalizeNullableString(input.latitude_band_key != null ? input.latitude_band_key : base.latitude_band_key, 80),
    manual_suhail_anchor_date: normalizeIsoDate(input.manual_suhail_anchor_date != null ? input.manual_suhail_anchor_date : base.manual_suhail_anchor_date),
    manual_cycle_start_date: normalizeIsoDate(input.manual_cycle_start_date != null ? input.manual_cycle_start_date : base.manual_cycle_start_date),
    is_verified: input.is_verified != null ? !!input.is_verified : !!base.is_verified,
    calibration_notes: normalizeNullableString(input.calibration_notes != null ? input.calibration_notes : base.calibration_notes, 1200),
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
