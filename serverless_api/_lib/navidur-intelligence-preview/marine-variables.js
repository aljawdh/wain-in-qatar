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

function resolveSource(meta, fieldSource) {
  if (fieldSource) return fieldSource;
  var m = meta || {};
  if (m.from_defaults) return 'defaults';
  if (m.from_cache) return 'cache';
  if (m.forecast_source) return String(m.forecast_source);
  return 'unknown';
}

function fieldQuality(value, meta, fieldSource) {
  var available = value !== null && value !== undefined;
  return {
    available: available,
    missing: !available,
    source: available ? resolveSource(meta, fieldSource) : 'missing'
  };
}

function degToCompass(deg) {
  var n = toNum(deg);
  if (n == null) return { code: null, label_ar: null };
  var idx = Math.round(((n % 360) + 360) % 360 / 45) % 8;
  return COMPASS[idx];
}

function mapTideStateHamalFasad(raw) {
  var s = String(raw == null ? '' : raw).trim().toUpperCase();
  if (!s) return 'unknown';
  if (s === 'LOAD' || s === 'HAMAL' || s.indexOf('حمل') >= 0 || s === 'سقي' || s === 'RISING') return 'hamal';
  if (s === 'FASAD' || s.indexOf('فساد') >= 0 || s === 'ثبر' || s === 'FALLING') return 'fasad';
  if (s === 'خامل' || s === 'STABLE' || s === 'UNKNOWN') return 'unknown';
  return 'unknown';
}

function tideStateLabelAr(state) {
  if (state === 'hamal') return 'حمل';
  if (state === 'fasad') return 'فساد';
  return 'غير معروف';
}

function extractFromDto(dto, weatherMeta) {
  var env = dto && dto.environment ? dto.environment : {};
  var tide = dto && dto.tide ? dto.tide : {};
  var envTide = env.tide && typeof env.tide === 'object' ? env.tide : {};
  var meta = weatherMeta || {};

  var tideLevel = toNum(envTide.height_m);
  if (tideLevel == null) tideLevel = toNum(tide.height_m);

  var tideState = mapTideStateHamalFasad(tide.state != null ? tide.state : env.explicit_tide_state);

  var windDir = degToCompass(env.wind_direction_deg);
  var currentDir = degToCompass(env.current_direction_deg || env.ocean_current_direction_deg);

  var values = {
    sea_surface_temperature: toNum(env.temp_c),
    current_speed: toNum(tide.current_speed_ms != null ? tide.current_speed_ms : env.current_speed_ms),
    current_direction: currentDir.code,
    current_direction_deg: toNum(env.current_direction_deg || env.ocean_current_direction_deg),
    current_direction_ar: currentDir.label_ar,
    wave_height: toNum(env.wave_height_m),
    wave_direction: degToCompass(env.wave_direction_deg).code,
    wave_direction_ar: degToCompass(env.wave_direction_deg).label_ar,
    wave_period: toNum(env.wave_period_s),
    wind_speed: toNum(env.wind_speed_kmh),
    wind_direction: windDir.code,
    wind_direction_deg: toNum(env.wind_direction_deg),
    wind_direction_ar: windDir.label_ar,
    tide_state: tideState,
    tide_state_ar: tideStateLabelAr(tideState),
    tide_level: tideLevel
  };

  var openMeteo = resolveSource(meta, 'open_meteo_hourly');
  var quality = {
    sea_surface_temperature: fieldQuality(values.sea_surface_temperature, meta, openMeteo),
    current_speed: fieldQuality(values.current_speed, meta, openMeteo),
    current_direction: fieldQuality(values.current_direction, meta, 'not_in_current_dto'),
    wave_height: fieldQuality(values.wave_height, meta, openMeteo),
    wave_direction: fieldQuality(values.wave_direction, meta, 'not_in_current_dto'),
    wave_period: fieldQuality(values.wave_period, meta, 'not_in_current_dto'),
    wind_speed: fieldQuality(values.wind_speed, meta, openMeteo),
    wind_direction: fieldQuality(values.wind_direction, meta, openMeteo),
    tide_state: fieldQuality(values.tide_state !== 'unknown' ? values.tide_state : null, meta, 'derived_tide'),
    tide_level: fieldQuality(values.tide_level, meta, openMeteo)
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
      current_direction: values.current_direction_ar || values.current_direction,
      wave_height: values.wave_height,
      wave_direction: values.wave_direction_ar || values.wave_direction,
      wave_period: values.wave_period,
      wind_speed: values.wind_speed,
      wind_direction: values.wind_direction_ar || values.wind_direction,
      tide_state: values.tide_state_ar || values.tide_state,
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
