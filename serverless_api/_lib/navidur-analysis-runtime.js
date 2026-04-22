'use strict';

const { readJsonFile } = require('./data-store');
const { cleanString, toNumber } = require('./security');

function pickStationFromReference(stations, stationId) {
  var id = cleanString(stationId, 80);
  if (!id) return null;
  return (Array.isArray(stations) ? stations : []).find(function (station) {
    return station && String(station.id) === id;
  }) || null;
}

function normalizeRequestedStation(body, stations) {
  var requestedStation = body && body.station && typeof body.station === 'object' ? body.station : null;
  var stationId = cleanString(
    body && (body.station_id || (requestedStation && requestedStation.id)),
    80
  );

  var storedStation = pickStationFromReference(stations, stationId);
  var raw = Object.assign({}, storedStation || {}, requestedStation || {});
  var lat = toNumber(raw.lat != null ? raw.lat : body && body.lat);
  var lon = toNumber(raw.lon != null ? raw.lon : (raw.lng != null ? raw.lng : (body && (body.lon != null ? body.lon : body.lng))));

  return {
    id: storedStation ? storedStation.id : (cleanString(raw.id, 80) || null),
    name: cleanString(raw.name, 120),
    lat: lat,
    lon: lon,
    country: cleanString(raw.country, 80),
    region: cleanString(raw.region, 80),
    station_role_type: cleanString(raw.station_role_type, 40),
    reference_station_id: cleanString(raw.reference_station_id, 80),
    is_reference_station: !!raw.is_reference_station,
    reference_priority: toNumber(raw.reference_priority),
    latitude_band_key: cleanString(raw.latitude_band_key, 80),
    manual_suhail_anchor_date: cleanString(raw.manual_suhail_anchor_date, 20),
    manual_cycle_start_date: cleanString(raw.manual_cycle_start_date, 20),
    is_verified: !!raw.is_verified,
    calibration_notes: cleanString(raw.calibration_notes, 1200),
    workbook_city_key: cleanString(raw.workbook_city_key, 80),
    workbook_city_name: cleanString(raw.workbook_city_name, 200)
  };
}

function deriveWaterTraits(environment) {
  var observed = [];
  if (environment.wind_speed_kmh != null) {
    if (environment.wind_speed_kmh >= 30) observed.push('رياح قوية');
    else if (environment.wind_speed_kmh >= 18) observed.push('رياح متوسطة');
    else observed.push('رياح خفيفة');
  }
  if (environment.wave_height_m != null) {
    if (environment.wave_height_m >= 1.5) observed.push('بحر مضطرب');
    else if (environment.wave_height_m >= 0.7) observed.push('نشاط الموج');
    else observed.push('بحر هادئ');
  }
  if (environment.current_speed_ms != null) {
    if (environment.current_speed_ms >= 0.8) observed.push('تيار قوي');
    else if (environment.current_speed_ms >= 0.45) observed.push('نشاط التيارات');
    else observed.push('تيار خفيف');
  }
  if (environment.temp_c != null) {
    if (environment.temp_c >= 31) observed.push('جو حار وجاف');
    else if (environment.temp_c <= 18) observed.push('جو بارد');
    else observed.push('اعتدال الجو');
  }
  return observed;
}

async function fetchWeatherAndMarineInputs(station, body) {
  var liveInputs = body && body.live_inputs && typeof body.live_inputs === 'object'
    ? Object.assign({}, body.live_inputs)
    : {};

  var hasExplicitValues =
    liveInputs.temp_c != null ||
    liveInputs.wind_speed_kmh != null ||
    liveInputs.wave_height_m != null ||
    liveInputs.current_speed_ms != null ||
    (liveInputs.wind && (liveInputs.wind.speed_kmh != null || liveInputs.wind.direction_deg != null)) ||
    (liveInputs.marine && (liveInputs.marine.wave_height_m != null || liveInputs.marine.current_speed_ms != null)) ||
    (liveInputs.tide && (liveInputs.tide.current != null || liveInputs.tide.previous != null || liveInputs.tide.next != null));

  if (hasExplicitValues) return liveInputs;
  if (station.lat == null || station.lon == null) throw new Error('station_coordinates_required');

  var weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
  weatherUrl.searchParams.set('latitude', String(station.lat));
  weatherUrl.searchParams.set('longitude', String(station.lon));
  weatherUrl.searchParams.set('current', 'wind_speed_10m,wind_direction_10m');
  weatherUrl.searchParams.set('timezone', 'GMT');

  var marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine');
  marineUrl.searchParams.set('latitude', String(station.lat));
  marineUrl.searchParams.set('longitude', String(station.lon));
  marineUrl.searchParams.set('current', 'sea_surface_temperature,ocean_current_velocity,wave_height');
  marineUrl.searchParams.set('hourly', 'sea_level_height_msl');
  marineUrl.searchParams.set('timezone', 'GMT');

  var responses = await Promise.all([
    fetch(weatherUrl.toString(), { method: 'GET' }),
    fetch(marineUrl.toString(), { method: 'GET' })
  ]);

  var weatherPayload = responses[0].ok ? await responses[0].json() : {};
  var marinePayload = responses[1].ok ? await responses[1].json() : {};
  var weatherCurrent = weatherPayload && weatherPayload.current ? weatherPayload.current : {};
  var marineCurrent = marinePayload && marinePayload.current ? marinePayload.current : {};
  var hourly = marinePayload && marinePayload.hourly ? marinePayload.hourly : {};
  var tideArray = Array.isArray(hourly.sea_level_height_msl) ? hourly.sea_level_height_msl : [];

  var tideIndex = Math.max(0, tideArray.length - 1);
  var currentTide = toNumber(tideArray[tideIndex]);
  var prevTide = toNumber(tideArray[Math.max(0, tideIndex - 1)]);
  var nextTide = toNumber(tideArray[Math.min(tideArray.length - 1, tideIndex + 1)]);

  return {
    temp_c: toNumber(marineCurrent.sea_surface_temperature),
    wind_speed_kmh: toNumber(weatherCurrent.wind_speed_10m),
    wind_direction_deg: toNumber(weatherCurrent.wind_direction_10m),
    wave_height_m: toNumber(marineCurrent.wave_height),
    current_speed_ms: toNumber(marineCurrent.ocean_current_velocity),
    tide: {
      current: currentTide,
      previous: prevTide != null ? prevTide : currentTide,
      next: nextTide != null ? nextTide : currentTide
    }
  };
}

async function loadReferenceData() {
  var rows = await Promise.all([
    readJsonFile('stations', []),
    readJsonFile('durur_master', []),
    readJsonFile('trait_dictionaries', []),
    readJsonFile('season_events', []),
    readJsonFile('fish_species', []),
    readJsonFile('advice_basis_tags', []),
    readJsonFile('station_dur_profiles', []),
    readJsonFile('station_dur_overrides', []),
    readJsonFile('durur_overrides', []),
    readJsonFile('station_dur_windows', { version: 1, stations: {} }),
    readJsonFile('dur_windows', { version: 2, workbook_windows: [] }),
    readJsonFile('fixed_annual_reference', { version: 0, stations: [] })
  ]);

  return {
    stations: Array.isArray(rows[0]) ? rows[0] : [],
    durur_master: Array.isArray(rows[1]) ? rows[1] : [],
    traits_reference: Array.isArray(rows[2]) ? rows[2] : [],
    seasonal_events: Array.isArray(rows[3]) ? rows[3] : [],
    fish_reference: Array.isArray(rows[4]) ? rows[4] : [],
    advice_templates: Array.isArray(rows[5]) ? rows[5] : [],
    station_profiles: Array.isArray(rows[6]) ? rows[6] : [],
    overrides: Array.isArray(rows[7]) ? rows[7] : [],
    durur_overrides: Array.isArray(rows[8]) ? rows[8] : [],
    station_dur_windows: rows[9] && typeof rows[9] === 'object' ? rows[9] : { version: 1, stations: {} },
    dur_windows: rows[10] && typeof rows[10] === 'object' ? rows[10] : { version: 2, workbook_windows: [] },
    fixed_annual_reference: rows[11] && typeof rows[11] === 'object' ? rows[11] : { version: 0, stations: [] }
  };
}

module.exports = {
  normalizeRequestedStation: normalizeRequestedStation,
  deriveWaterTraits: deriveWaterTraits,
  fetchWeatherAndMarineInputs: fetchWeatherAndMarineInputs,
  loadReferenceData: loadReferenceData
};
