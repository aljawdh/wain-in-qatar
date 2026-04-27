'use strict';

const { readJsonFile, writeJsonFile } = require('./data-store');
const { cleanString, toNumber } = require('./security');

/** Shown when sky/condition cannot be derived (UI only; analysis still uses numeric fallbacks). */
var WEATHER_UNAVAILABLE_AR = 'الحالة الجوية غير متاحة حالياً';

/** Mild defaults (non-null) when both API and cache miss — analysis still runs. Tide is never fabricated. */
var DEFAULT_LIVE = {
  temp_c: 28,
  wind_speed_kmh: 12,
  wind_direction_deg: 200,
  wave_height_m: 0.6,
  current_speed_ms: 0.5
};

/** ~2 cm MSL change across the prev→next window → treat as flat (خامل). */
var TIDE_FLAT_DELTA_M = 0.02;

function findMarineHourlyIndexForInstant(timeStrings, instantMs) {
  if (!Array.isArray(timeStrings) || !timeStrings.length) return -1;
  var best = -1;
  for (var i = 0; i < timeStrings.length; i += 1) {
    var ts = Date.parse(timeStrings[i]);
    if (Number.isNaN(ts)) continue;
    if (ts <= instantMs) best = i;
    else break;
  }
  if (best >= 0) return best;
  return 0;
}

/**
 * @returns {{ tide: object, tide_debug: object }}
 */
function buildOperationalTideFromHourly(timeStrings, mslValues, instantMs) {
  var debug = {
    has_hourly: Array.isArray(mslValues) && mslValues.length > 0,
    values_sample: [],
    computed_state: '',
    trend: '',
    index: -1
  };
  var emptyTide = { state: null, height_m: null, trend: null };
  if (!Array.isArray(mslValues) || !mslValues.length) {
    return { tide: emptyTide, tide_debug: debug };
  }
  if (!Array.isArray(timeStrings) || timeStrings.length !== mslValues.length) {
    return { tide: emptyTide, tide_debug: debug };
  }
  var idx = findMarineHourlyIndexForInstant(timeStrings, instantMs);
  debug.index = idx;
  var n = mslValues.length;
  var prev = idx > 0 ? toNumber(mslValues[idx - 1]) : null;
  var cur = toNumber(mslValues[idx]);
  var next = idx < n - 1 ? toNumber(mslValues[idx + 1]) : null;
  var lo = Math.max(0, idx - 1);
  debug.values_sample = mslValues.slice(lo, Math.min(n, lo + 5)).map(function (v) {
    return toNumber(v);
  });

  if (cur == null) {
    return { tide: emptyTide, tide_debug: debug };
  }

  var delta = null;
  if (prev != null && next != null) delta = next - prev;
  else if (prev != null) delta = cur - prev;
  else if (next != null) delta = next - cur;
  else {
    return { tide: emptyTide, tide_debug: debug };
  }

  var state;
  var trend;
  if (!Number.isFinite(delta) || Math.abs(delta) < TIDE_FLAT_DELTA_M) {
    state = 'خامل';
    trend = 'stable';
  } else if (delta > 0) {
    state = 'سقي';
    trend = 'rising';
  } else {
    state = 'ثبر';
    trend = 'falling';
  }
  debug.computed_state = state;
  debug.trend = trend;

  return {
    tide: {
      state: state,
      height_m: cur,
      trend: trend,
      previous: prev,
      current: cur,
      next: next
    },
    tide_debug: debug
  };
}

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

  // Persisted manual link must win when the client omits the field or sends a placeholder
  // empty string. Public `mapApiStationToBase` used to always set reference_station_id: "",
  // which made hasOwnProperty("reference_station_id") true and incorrectly cleared the
  // merged id — bypassing the datastore link and falling back to nearest / same-band.
  // Non-empty client values still win; to clear a link in one shot, save via admin first
  // or send reference_station_id: null (treated as explicit clear when paired with hasOwn).
  var referenceStationId;
  if (requestedStation && Object.prototype.hasOwnProperty.call(requestedStation, 'reference_station_id')) {
    if (requestedStation.reference_station_id === null) {
      referenceStationId = '';
    } else {
      var reqRef = cleanString(requestedStation.reference_station_id, 80);
      if (reqRef) {
        referenceStationId = reqRef;
      } else {
        referenceStationId = cleanString(
          (storedStation && storedStation.reference_station_id) || raw.reference_station_id,
          80
        );
      }
    }
  } else {
    referenceStationId = cleanString(
      (storedStation && storedStation.reference_station_id) || raw.reference_station_id,
      80
    );
  }

  var lat = toNumber(raw.lat != null ? raw.lat : body && body.lat);
  var lon = toNumber(raw.lon != null ? raw.lon : (raw.lng != null ? raw.lng : (body && (body.lon != null ? body.lon : body.lng))));

  return {
    id: storedStation ? storedStation.id : (cleanString(raw.id, 80) || null),
    name: cleanString(raw.name, 120),
    name_ar: cleanString(raw.name_ar != null ? raw.name_ar : raw.name, 200),
    lat: lat,
    lon: lon,
    depth: toNumber(raw.depth),
    zoneType: cleanString(raw.zoneType != null ? raw.zoneType : raw.zone, 40),
    country: cleanString(raw.country, 80),
    region: cleanString(raw.region, 80),
    station_role_type: cleanString(raw.station_role_type, 40),
    reference_station_id: referenceStationId,
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

/**
 * Maps Open-Meteo `current` fields (WMO weather_code + helpers) to allowed Arabic labels only.
 * @param {object} cur — `current` object from forecast API
 * @returns {string}
 */
function mapOpenMeteoCurrentToArabicSky(cur) {
  var c = cur && typeof cur === 'object' ? cur : {};
  var code = toNumber(c.weather_code);
  var isDay = c.is_day === 1 || c.is_day === true;
  var cloud = toNumber(c.cloud_cover);
  var precip = toNumber(c.precipitation);
  var rain = toNumber(c.rain);
  var vis = toNumber(c.visibility);
  var rh = toNumber(c.relative_humidity_2m);

  var totalRain = rain != null ? rain : precip;

  if (code == null || !Number.isFinite(code)) {
    if (totalRain != null && totalRain >= 0.3) {
      if (totalRain < 2) return 'أمطار خفيفة';
      if (totalRain < 8) return 'أمطار';
      return 'أمطار غزيرة';
    }
    if (cloud != null) {
      if (cloud >= 85) return 'غائم';
      if (cloud >= 40) return 'غائم جزئياً';
      return isDay ? 'مشمس' : 'صافي';
    }
    return WEATHER_UNAVAILABLE_AR;
  }

  if (code === 95 || code === 96 || code === 99) return 'عواصف رعدية';
  if (code === 97 || code === 98) return 'عواصف رعدية';

  if (code === 45 || code === 48) return 'ضباب';

  if (code === 51 || code === 53 || code === 55 || code === 56 || code === 57) return 'رذاذ';

  if (code === 61) return 'أمطار خفيفة';
  if (code === 63 || code === 66 || code === 67) return 'أمطار';
  if (code === 65) return 'أمطار غزيرة';

  if (code === 80) return 'أمطار خفيفة';
  if (code === 81) return 'أمطار';
  if (code === 82) return 'أمطار غزيرة';

  if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) return 'غائم';

  if (code === 3) return 'غائم';
  if (code === 2) return 'غائم جزئياً';
  if (code === 1) return 'غائم جزئياً';

  if (code === 0) {
    if (
      vis != null &&
      vis < 2000 &&
      (totalRain == null || totalRain < 0.05) &&
      (rh == null || rh < 75)
    ) {
      return 'مغبر';
    }
    return isDay ? 'مشمس' : 'صافي';
  }

  if (vis != null && vis < 800 && (code === 0 || code === 1 || code === 2)) {
    return 'ضباب';
  }
  if (
    vis != null &&
    vis < 3000 &&
    vis >= 800 &&
    (totalRain == null || totalRain < 0.05) &&
    (code === 0 || code === 1 || code === 2) &&
    rh != null &&
    rh < 70
  ) {
    return 'مغبر';
  }

  return WEATHER_UNAVAILABLE_AR;
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

function weatherCacheKey(station) {
  var id = cleanString(station && station.id, 80);
  if (id) return 'id:' + id;
  var la = toNumber(station && station.lat);
  var lo = toNumber(station && station.lon);
  if (la == null || lo == null) return 'll:unknown';
  return 'll:' + la.toFixed(4) + ',' + lo.toFixed(4);
}

async function readWeatherCacheStore() {
  return readJsonFile('live_weather_cache', { version: 1, entries: {} });
}

async function saveWeatherCacheEntry(key, liveInputs, weatherStatusAr) {
  var doc = await readWeatherCacheStore();
  doc.entries = doc.entries || {};
  doc.entries[key] = {
    live_inputs: liveInputs,
    weather_status_ar: cleanString(weatherStatusAr, 200) || '',
    saved_at: new Date().toISOString()
  };
  try {
    await writeJsonFile('live_weather_cache', doc);
  } catch (_e) {
    /* read-only or disabled store */
  }
}

/**
 * Fetches live forecast/marine (Open-Meteo) for the station. Never throws.
 * On API failure: uses file-backed last reading, then mild non-null defaults.
 * DUR is untouched — caller only uses this for live_inputs / environment.
 * @param {object} station — must include lat, lon
 * @param {string} [asOfDate] — YYYY-MM-DD (optional; current forecast used for today)
 * @param {string} [asOfInstantIso] — ISO instant for hourly tide alignment (defaults to now)
 */
async function getWeatherData(station, asOfDate, asOfInstantIso) {
  var out = {
    ok: false,
    from_cache: false,
    from_defaults: false,
    live_inputs: null,
    weather_status_ar: '',
    tide_debug: {
      has_hourly: false,
      values_sample: [],
      computed_state: '',
      trend: ''
    }
  };
  var la = toNumber(station && station.lat);
  var lo = toNumber(station && station.lon);
  if (la == null || lo == null) {
    out.ok = true;
    out.from_defaults = true;
    out.live_inputs = Object.assign({}, DEFAULT_LIVE, {
      tide: { state: null, height_m: null, trend: null }
    });
    out.tide_debug = {
      has_hourly: false,
      values_sample: [],
      computed_state: '',
      trend: '',
      no_coordinates: true
    };
    out.weather_status_ar = WEATHER_UNAVAILABLE_AR;
    return out;
  }

  try {
    var weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
    weatherUrl.searchParams.set('latitude', String(la));
    weatherUrl.searchParams.set('longitude', String(lo));
    weatherUrl.searchParams.set(
      'current',
      'wind_speed_10m,wind_direction_10m,relative_humidity_2m,is_day,weather_code,cloud_cover,precipitation,rain,visibility'
    );
    weatherUrl.searchParams.set('wind_speed_unit', 'kmh');
    weatherUrl.searchParams.set('timezone', 'GMT');
    if (asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate))) {
      weatherUrl.searchParams.set('start_date', String(asOfDate));
      weatherUrl.searchParams.set('end_date', String(asOfDate));
    }

    var marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine');
    marineUrl.searchParams.set('latitude', String(la));
    marineUrl.searchParams.set('longitude', String(lo));
    marineUrl.searchParams.set('current', 'sea_surface_temperature,ocean_current_velocity,wave_height');
    marineUrl.searchParams.set('hourly', 'sea_level_height_msl');
    marineUrl.searchParams.set('timezone', 'GMT');
    if (asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate))) {
      marineUrl.searchParams.set('start_date', String(asOfDate));
      marineUrl.searchParams.set('end_date', String(asOfDate));
    }

    var responses = await Promise.all([
      fetch(weatherUrl.toString(), { method: 'GET' }),
      fetch(marineUrl.toString(), { method: 'GET' })
    ]);
    if (!responses[0].ok || !responses[1].ok) {
      throw new Error('open_meteo_http');
    }
    var weatherPayload = await responses[0].json();
    var marinePayload = await responses[1].json();
    var weatherCurrent = weatherPayload && weatherPayload.current ? weatherPayload.current : {};
    var marineCurrent = marinePayload && marinePayload.current ? marinePayload.current : {};
    var hourly = marinePayload && marinePayload.hourly ? marinePayload.hourly : {};
    var tideArray = Array.isArray(hourly.sea_level_height_msl) ? hourly.sea_level_height_msl : [];
    var timeArray = Array.isArray(hourly.time) ? hourly.time : [];

    var instantMs = Date.now();
    if (asOfInstantIso && String(asOfInstantIso).length >= 10) {
      var parsedInst = Date.parse(String(asOfInstantIso));
      if (!Number.isNaN(parsedInst)) instantMs = parsedInst;
    }

    var tidePack = buildOperationalTideFromHourly(timeArray, tideArray, instantMs);
    out.tide_debug = Object.assign({}, out.tide_debug, tidePack.tide_debug, {
      has_hourly: tideArray.length > 0 && timeArray.length === tideArray.length
    });

    var li = {
      temp_c: toNumber(marineCurrent.sea_surface_temperature),
      wind_speed_kmh: toNumber(weatherCurrent.wind_speed_10m),
      wind_direction_deg: toNumber(weatherCurrent.wind_direction_10m),
      wave_height_m: toNumber(marineCurrent.wave_height),
      current_speed_ms: toNumber(marineCurrent.ocean_current_velocity),
      relative_humidity_2m: toNumber(weatherCurrent.relative_humidity_2m),
      weather_code: toNumber(weatherCurrent.weather_code),
      tide: tidePack.tide
    };
    if (
      li.wind_speed_kmh == null &&
      li.temp_c == null &&
      li.wave_height_m == null &&
      li.current_speed_ms == null
    ) {
      throw new Error('empty_weather_marine');
    }
    out.ok = true;
    out.live_inputs = li;
    out.weather_status_ar = mapOpenMeteoCurrentToArabicSky(weatherCurrent);
    if (out.weather_status_ar === WEATHER_UNAVAILABLE_AR && toNumber(weatherCurrent.weather_code) != null) {
      out.weather_status_ar = mapOpenMeteoCurrentToArabicSky({ weather_code: toNumber(weatherCurrent.weather_code) });
    }
    return out;
  } catch (_e) {
    var key = weatherCacheKey(station);
    var doc;
    try {
      doc = await readWeatherCacheStore();
    } catch (_r) {
      doc = { entries: {} };
    }
    var ent = doc.entries && doc.entries[key];
    if (ent && ent.live_inputs) {
      out.ok = true;
      out.from_cache = true;
      out.live_inputs = ent.live_inputs;
      var cTide = ent.live_inputs.tide && typeof ent.live_inputs.tide === 'object' ? ent.live_inputs.tide : {};
      out.tide_debug = {
        has_hourly: false,
        values_sample: [],
        computed_state: cTide.state != null ? String(cTide.state) : '',
        trend: cTide.trend != null ? String(cTide.trend) : '',
        from_cache: true
      };
      var cachedAr = cleanString(ent.weather_status_ar, 200);
      if (cachedAr) {
        out.weather_status_ar = cachedAr;
      } else {
        out.weather_status_ar = mapOpenMeteoCurrentToArabicSky({
          weather_code: ent.live_inputs && ent.live_inputs.weather_code,
          is_day: 1
        });
        if (out.weather_status_ar === WEATHER_UNAVAILABLE_AR) {
          out.weather_status_ar = WEATHER_UNAVAILABLE_AR;
        }
      }
      return out;
    }
    out.ok = true;
    out.from_defaults = true;
    out.live_inputs = Object.assign({}, DEFAULT_LIVE, {
      tide: { state: null, height_m: null, trend: null }
    });
    out.tide_debug = {
      has_hourly: false,
      values_sample: [],
      computed_state: '',
      trend: '',
      from_defaults: true
    };
    out.weather_status_ar = WEATHER_UNAVAILABLE_AR;
    return out;
  }
}

/**
 * Merges explicit body live_inputs, or fetches live Open-Meteo. Never throws.
 * @returns {{ live_inputs: object, weather_meta: object }}
 */
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
    (liveInputs.tide && typeof liveInputs.tide === 'object' && (
      liveInputs.tide.height_m != null ||
      liveInputs.tide.state != null ||
      liveInputs.tide.trend != null ||
      liveInputs.tide.current != null ||
      liveInputs.tide.previous != null ||
      liveInputs.tide.next != null
    ));
  if (hasExplicitValues) {
    return {
      live_inputs: liveInputs,
      weather_meta: { from_request_body: true, weather_status_ar: '', humidity_pct: null }
    };
  }
  if (station.lat == null || station.lon == null) {
    return {
      live_inputs: Object.assign({}, DEFAULT_LIVE, {
        tide: { state: null, height_m: null, trend: null }
      }),
      weather_meta: { from_defaults: true, weather_status_ar: WEATHER_UNAVAILABLE_AR, humidity_pct: null },
      tide_debug: {
        has_hourly: false,
        values_sample: [],
        computed_state: '',
        trend: '',
        no_coordinates: true
      }
    };
  }
  var asOf = '';
  var asOfInstant = '';
  if (body && body.datetime) {
    var ds = String(body.datetime);
    if (ds.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(ds)) {
      asOf = ds.slice(0, 10);
      asOfInstant = ds;
    }
  }
  if (!asOfInstant) {
    asOfInstant = new Date().toISOString();
  }
  if (!asOf) {
    asOf = asOfInstant.slice(0, 10);
  }
  var pack = await getWeatherData(station, asOf, asOfInstant);
  var li = pack.live_inputs || Object.assign({}, DEFAULT_LIVE, {
    tide: { state: null, height_m: null, trend: null }
  });
  if (pack.ok && !pack.from_cache && !pack.from_defaults) {
    await saveWeatherCacheEntry(weatherCacheKey(station), li, pack.weather_status_ar);
  }
  var hum = toNumber(li.relative_humidity_2m);
  return {
    live_inputs: li,
    weather_meta: {
      from_cache: !!pack.from_cache,
      from_defaults: !!pack.from_defaults,
      weather_status_ar: cleanString(pack.weather_status_ar, 200) || '',
      as_of: asOf || null,
      humidity_pct: hum != null ? hum : null
    },
    tide_debug: pack.tide_debug || {
      has_hourly: false,
      values_sample: [],
      computed_state: '',
      trend: ''
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
    readJsonFile('true_final_station_reference', { version: 0, stations: [] }),
    readJsonFile('gulf_fish_database', { version: 0, species: [] }),
    readJsonFile('navidur_learning_adjustments', { version: 1, adjustments: [] }),
    readJsonFile('navidur_learning_settings', { version: 1, learning_layer_enabled: false }),
    readJsonFile('field_session_reviews', { version: 1, reviews: [] })
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
    true_final_station_reference: rows[9] && typeof rows[9] === 'object' ? rows[9] : { version: 0, stations: [] },
    gulf_fish_database: rows[10] && typeof rows[10] === 'object' ? rows[10] : { version: 0, species: [] },
    learning_adjustments: rows[11] && typeof rows[11] === 'object' ? rows[11] : { version: 1, adjustments: [] },
    learning_settings: rows[12] && typeof rows[12] === 'object' ? rows[12] : { version: 1, learning_layer_enabled: false },
    field_session_reviews: rows[13] && typeof rows[13] === 'object' ? rows[13] : { version: 1, reviews: [] }
  };
}

module.exports = {
  normalizeRequestedStation: normalizeRequestedStation,
  deriveWaterTraits: deriveWaterTraits,
  getWeatherData: getWeatherData,
  fetchWeatherAndMarineInputs: fetchWeatherAndMarineInputs,
  loadReferenceData: loadReferenceData
};
