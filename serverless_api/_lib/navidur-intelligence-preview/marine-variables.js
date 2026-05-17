'use strict';

var COMPASS = [
  { code: 'N', label_ar: 'شمال' },
  { code: 'NE', label_ar: 'شمال شرقي' },
  { code: 'E', label_ar: 'شرق' },
  { code: 'SE', label_ar: 'جنوب شرقي' },
  { code: 'S', label_ar: 'جنوب' },
  { code: 'SW', label_ar: 'جنوب غربي' },
  { code: 'W', label_ar: 'غرب' },
  { code: 'NW', label_ar: 'شمال غربي' }
];

function toNum(v) {
  var n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function degToCompass(deg) {
  var n = toNum(deg);
  if (n == null) return { code: null, label_ar: null };
  var idx = Math.round(((n % 360) + 360) % 360 / 45) % 8;
  return COMPASS[idx];
}

function mapTideStateHamalFasad(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return 'unknown';
  var upper = s.toUpperCase();
  if (upper === 'LOAD' || upper === 'HAMAL' || s.indexOf('حمل') >= 0 || s === 'سقي' || upper === 'RISING') return 'hamal';
  if (upper === 'FASAD' || s.indexOf('فساد') >= 0 || s === 'ثبر' || upper === 'FALLING') return 'fasad';
  if (upper === 'IDLE' || upper === 'STABLE' || s === 'خامل' || upper === 'UNKNOWN') return 'unknown';
  return 'unknown';
}

function tideStateLabelAr(state) {
  if (state === 'hamal') return 'حمل';
  if (state === 'fasad') return 'فساد';
  return 'غير معروف';
}

function pickNum(primary, fallback) {
  var a = toNum(primary);
  if (a != null) return a;
  return toNum(fallback);
}

function isOpenMeteoMarineMeta(meta) {
  var fs = meta && meta.forecast_source ? String(meta.forecast_source) : '';
  return fs.indexOf('open_meteo') >= 0 && !meta.no_data_for_date;
}

function fieldQuality(value, meta, explicitSource) {
  var available = value !== null && value !== undefined && value !== '';
  if (explicitSource === 'derived_tide') {
    var tideOk = available && value !== 'unknown';
    return {
      available: tideOk,
      missing: !tideOk,
      source: tideOk ? 'derived_tide' : 'not_available'
    };
  }
  if (!available) {
    return { available: false, missing: true, source: 'not_available' };
  }
  if (explicitSource === 'open_meteo_marine' || isOpenMeteoMarineMeta(meta)) {
    return { available: true, missing: false, source: 'open_meteo_marine' };
  }
  if (meta && meta.from_cache) {
    return { available: true, missing: false, source: 'open_meteo_marine' };
  }
  return { available: true, missing: false, source: 'not_available' };
}

function extractFromDto(dto, weatherMeta) {
  var norm = weatherMeta && weatherMeta.normalized_marine && typeof weatherMeta.normalized_marine === 'object'
    ? weatherMeta.normalized_marine
    : null;
  var env = dto && dto.environment ? dto.environment : {};
  var tide = dto && dto.tide ? dto.tide : {};
  var envTide = env.tide && typeof env.tide === 'object' ? env.tide : {};
  var meta = weatherMeta || {};

  var tideState = mapTideStateHamalFasad(tide.state != null ? tide.state : (norm && norm.tide_state));
  var tideLevel = pickNum(norm && norm.tide_level, envTide.height_m != null ? envTide.height_m : tide.height_m);

  var currentDirDeg = pickNum(norm && norm.current_direction, env.current_direction_deg || env.ocean_current_direction_deg);
  var waveDirDeg = pickNum(norm && norm.wave_direction, env.wave_direction_deg);
  var wavePeriod = pickNum(norm && norm.wave_period, env.wave_period_s);
  var windDirDeg = pickNum(norm && norm.wind_direction, env.wind_direction_deg);

  var windCompass = degToCompass(windDirDeg);

  var values = {
    sea_surface_temperature: pickNum(norm && norm.sea_surface_temperature, env.temp_c),
    current_speed: pickNum(norm && norm.current_speed, tide.current_speed_ms != null ? tide.current_speed_ms : env.current_speed_ms),
    current_direction: currentDirDeg,
    wave_height: pickNum(norm && norm.wave_height, env.wave_height_m),
    wave_direction: waveDirDeg,
    wave_period: wavePeriod,
    wind_speed: pickNum(norm && norm.wind_speed, env.wind_speed_kmh),
    wind_direction: windCompass.code,
    tide_state: tideState,
    tide_level: tideLevel
  };

  var om = 'open_meteo_marine';
  var quality = {
    sea_surface_temperature: fieldQuality(values.sea_surface_temperature, meta, om),
    current_speed: fieldQuality(values.current_speed, meta, om),
    current_direction: fieldQuality(values.current_direction, meta, om),
    wave_height: fieldQuality(values.wave_height, meta, om),
    wave_direction: fieldQuality(values.wave_direction, meta, om),
    wave_period: fieldQuality(values.wave_period, meta, om),
    wind_speed: fieldQuality(values.wind_speed, meta, om),
    wind_direction: fieldQuality(windDirDeg, meta, om),
    tide_state: fieldQuality(tideState !== 'unknown' ? tideState : null, meta, 'derived_tide'),
    tide_level: fieldQuality(values.tide_level, meta, om)
  };

  return {
    marine_variables: {
      sea_surface_temperature: values.sea_surface_temperature,
      current_speed: values.current_speed,
      current_direction: values.current_direction,
      wave_height: values.wave_height,
      wave_direction: values.wave_direction,
      wave_period: values.wave_period,
      wind_speed: values.wind_speed,
      wind_direction: values.wind_direction,
      tide_state: values.tide_state,
      tide_level: values.tide_level
    },
    marine_variables_quality: quality,
    marine_variables_display: {
      sea_surface_temperature: values.sea_surface_temperature,
      current_speed: values.current_speed,
      current_direction: values.current_direction,
      wave_height: values.wave_height,
      wave_direction: values.wave_direction,
      wave_period: values.wave_period,
      wind_speed: values.wind_speed,
      wind_direction: windCompass.label_ar || values.wind_direction,
      tide_state: tideStateLabelAr(values.tide_state),
      tide_level: values.tide_level
    }
  };
}

module.exports = {
  COMPASS: COMPASS,
  degToCompass: degToCompass,
  mapTideStateHamalFasad: mapTideStateHamalFasad,
  extractFromDto: extractFromDto
};
