;(function (root) {
  'use strict';

  function toNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function getConfidenceMeta(score) {
    var n = Number(score || 0);
    if (n >= 75) return { label: 'High', cls: 'high' };
    if (n >= 50) return { label: 'Medium', cls: 'medium' };
    return { label: 'Low', cls: 'low' };
  }

  async function fetchHotspotByCoords(lat, lon) {
    var safeLat = toNumber(lat);
    var safeLon = toNumber(lon);
    if (safeLat == null || safeLon == null) throw new Error('station_coords_missing');
    var url = '/api?route=fishing-engine&lat=' + encodeURIComponent(safeLat) + '&lon=' + encodeURIComponent(safeLon) + '&debug=true';
    var response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw new Error('live_analysis_http_' + response.status);
    return response.json();
  }

  async function fetchSharedAnalysis(payload) {
    var response = await fetch('/api?route=analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    if (!response.ok) throw new Error('shared_analysis_http_' + response.status);
    return response.json();
  }

  async function getHotspotForStation(station) {
    if (!station || typeof station !== 'object') throw new Error('station_required');
    var lat = station.lat;
    var lon = station.lon != null ? station.lon : station.lng;
    return fetchHotspotByCoords(lat, lon);
  }

  function buildLiveInputsFromLastDto(dto) {
    if (!dto) return null;
    var e = dto.environment || {};
    var t = dto.tide || {};
    if (
      e.temp_c == null &&
      e.wind_speed_kmh == null &&
      e.wave_height_m == null &&
      t.current_speed_ms == null
    ) {
      return null;
    }
    return {
      temp_c: e.temp_c,
      wind_speed_kmh: e.wind_speed_kmh,
      wind_direction_deg: e.wind_direction_deg,
      wave_height_m: e.wave_height_m,
      current_speed_ms: t.current_speed_ms
    };
  }

  function liveCacheKeyForStation(station) {
    var sid = station && station.id != null && String(station.id).trim() !== '' ? String(station.id).trim() : null;
    return sid ? 'navidur_last_live_inputs:' + sid : null;
  }

  async function getStationAnalysis(station, options) {
    if (!station || typeof station !== 'object') throw new Error('station_required');
    var opts = options || {};
    var cacheKey = !opts.live_inputs ? liveCacheKeyForStation(station) : null;
    var body = {
      station: station,
      station_id: station.id || null,
      datetime: opts.datetime || new Date().toISOString(),
      overrides: opts.overrides || null,
      live_inputs: opts.live_inputs || null
    };
    if (opts.field_validation != null && typeof opts.field_validation === 'object') {
      body.field_validation = opts.field_validation;
    }
    var attemptFetch = function (b) {
      return fetchSharedAnalysis(b);
    };
    try {
      var dto = await attemptFetch(body);
      if (cacheKey && typeof localStorage !== 'undefined') {
        var li = buildLiveInputsFromLastDto(dto);
        if (li) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify(li));
          } catch (_se) { /* quota / private mode */ }
        }
      }
      return dto;
    } catch (err) {
      if (!cacheKey || typeof localStorage === 'undefined') throw err;
      var raw;
      try {
        raw = localStorage.getItem(cacheKey);
      } catch (_ge) {
        throw err;
      }
      if (!raw) throw err;
      var stored;
      try {
        stored = JSON.parse(raw);
      } catch (_pe) {
        throw err;
      }
      if (!stored || typeof stored !== 'object') throw err;
      return await attemptFetch(
        Object.assign({}, body, { live_inputs: Object.assign({}, stored, body.live_inputs || {}) })
      );
    }
  }

  async function getPreviewAnalysis(point, options) {
    if (!point || typeof point !== 'object') throw new Error('point_required');
    var lat = toNumber(point.lat);
    var lon = toNumber(point.lon != null ? point.lon : point.lng);
    if (lat == null || lon == null) throw new Error('station_coords_missing');
    var opts = options || {};
    var previewBody = {
      station: {
        id: null,
        name: point.name || '',
        lat: lat,
        lon: lon,
        country: point.country || '',
        region: point.region || ''
      },
      datetime: opts.datetime || new Date().toISOString(),
      overrides: opts.overrides || null,
      live_inputs: opts.live_inputs || null
    };
    if (opts.field_validation != null && typeof opts.field_validation === 'object') {
      previewBody.field_validation = opts.field_validation;
    }
    return fetchSharedAnalysis(previewBody);
  }

  async function getStationLiveSummary(station, options) {
    return getStationAnalysis(station, options);
  }

  var ENV_UNAVAILABLE = 'غير متاح حالياً';

  function toFiniteNumber(v) {
    if (v == null) return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function windDirText8(deg) {
    if (deg == null) return '';
    var d = ['شمال', 'شمال شرقي', 'شرق', 'جنوب شرقي', 'جنوب', 'جنوب غربي', 'غرب', 'شمال غربي'];
    return d[Math.round((((Number(deg) % 360) + 360) % 360) / 45) % 8];
  }

  /**
   * Normalizes /api?route=analysis DTO environment + tide for display.
   * @returns {object|null}
   */
  function normalizeDisplayEnv(dto) {
    if (!dto || typeof dto !== 'object') return null;
    var e = dto.environment || {};
    var t = dto.tide || {};
    var temp = e.temperature_c != null ? e.temperature_c : e.temp_c;
    var hum = e.humidity_pct != null ? e.humidity_pct : e.relative_humidity_2m;
    return {
      weather_status_ar: e.weather_status_ar != null ? String(e.weather_status_ar).trim() : null,
      temp: toFiniteNumber(temp),
      wind_speed_kmh: toFiniteNumber(e.wind_speed_kmh),
      wind_direction_deg: toFiniteNumber(e.wind_direction_deg),
      humidity: toFiniteNumber(hum),
      precipitation_mm: toFiniteNumber(
        e.precipitation_mm != null ? e.precipitation_mm : e.precipitation
      ),
      wave_height_m: toFiniteNumber(e.wave_height_m),
      current_speed_ms: toFiniteNumber(t.current_speed_ms),
      tide: t && typeof t === 'object' ? t : null
    };
  }

  function tideStateArabic(tide) {
    if (!tide) return null;
    if (tide.state === 'LOAD' || String(tide.state) === 'LOAD') return 'حمل';
    if (tide.state === 'FASAD' || String(tide.state) === 'FASAD') return 'فساد';
    return null;
  }

  function formatTideMsl(meters) {
    if (meters == null) return null;
    var m = toFiniteNumber(meters);
    if (m == null) return null;
    return m.toFixed(2) + ' م';
  }

  /**
   * Binds known weather / marine cards (by id) from one normalized env object.
   * Missing ids are skipped. Null/undefined fields → "غير متاح حالياً".
   * @param {object|null|undefined} env — from normalizeDisplayEnv, or null
   */
  function renderEnvironment(env) {
    var n = env && typeof env === 'object' ? env : null;
    function set(id, text) {
      var el = typeof document !== 'undefined' ? document.getElementById(id) : null;
      if (el) el.textContent = text;
    }
    if (!n) {
      set('skyConditionVal', ENV_UNAVAILABLE);
      set('tempVal', ENV_UNAVAILABLE);
      set('windVal', ENV_UNAVAILABLE);
      set('envWindDirVal', ENV_UNAVAILABLE);
      set('envHumidityVal', ENV_UNAVAILABLE);
      set('envPrecipVal', ENV_UNAVAILABLE);
      set('envWaveVal', ENV_UNAVAILABLE);
      set('waveHeightVal', ENV_UNAVAILABLE);
      set('envCurrentVal', ENV_UNAVAILABLE);
      set('oceanCurrentVal', ENV_UNAVAILABLE);
      set('tideHeightVal', ENV_UNAVAILABLE);
      set('moonVal', ENV_UNAVAILABLE);
      return;
    }
    var wsky = n.weather_status_ar;
    if (!wsky) set('skyConditionVal', ENV_UNAVAILABLE);
    else set('skyConditionVal', wsky);

    if (n.temp == null) set('tempVal', ENV_UNAVAILABLE);
    else set('tempVal', n.temp.toFixed(1) + '°م');

    if (n.wind_speed_kmh == null) set('windVal', ENV_UNAVAILABLE);
    else set('windVal', String(n.wind_speed_kmh) + ' كم/س');

    if (n.wind_direction_deg == null) set('envWindDirVal', ENV_UNAVAILABLE);
    else {
      set('envWindDirVal', windDirText8(n.wind_direction_deg) + ' — ' + Math.round(n.wind_direction_deg) + '°');
    }

    if (n.humidity == null) set('envHumidityVal', ENV_UNAVAILABLE);
    else set('envHumidityVal', String(n.humidity) + '%');

    if (n.precipitation_mm == null) set('envPrecipVal', ENV_UNAVAILABLE);
    else set('envPrecipVal', n.precipitation_mm.toFixed(1) + ' مم');

    if (n.wave_height_m == null) {
      set('envWaveVal', ENV_UNAVAILABLE);
      set('waveHeightVal', ENV_UNAVAILABLE);
    } else {
      var waveT = n.wave_height_m.toFixed(2) + ' م';
      set('envWaveVal', waveT);
      set('waveHeightVal', waveT);
    }

    if (n.current_speed_ms == null) {
      set('envCurrentVal', ENV_UNAVAILABLE);
      set('oceanCurrentVal', ENV_UNAVAILABLE);
    } else {
      var curT = String(n.current_speed_ms) + ' م/ث';
      set('envCurrentVal', curT);
      set('oceanCurrentVal', curT);
    }

    var t = n.tide;
    var msl = t && (t.msl_m != null ? t.msl_m : t.height_m);
    if (t && msl != null) {
      set('tideHeightVal', formatTideMsl(msl));
    } else {
      set('tideHeightVal', ENV_UNAVAILABLE);
    }
    if (t) {
      var ts = tideStateArabic(t);
      var cur = t.current_speed_ms != null ? String(t.current_speed_ms) : null;
      if (ts && cur) set('moonVal', ts + ' — تيار ' + cur + ' م/ث');
      else if (ts) set('moonVal', ts);
      else if (cur) set('moonVal', 'تيار ' + cur + ' م/ث');
      else set('moonVal', ENV_UNAVAILABLE);
    } else {
      set('moonVal', ENV_UNAVAILABLE);
    }
  }

  function groupHoursByWeekDates(hours, targetWeekDates, getDayKey) {
    if (typeof getDayKey !== 'function') {
      getDayKey = function (d) {
        return new Date(d).toISOString().slice(0, 10);
      };
    }
    var map = {};
    var todayKey = getDayKey(new Date());
    (targetWeekDates || []).forEach(function (d) {
      map[getDayKey(d)] = [];
    });
    (hours || []).forEach(function (h) {
      var key = getDayKey(new Date(h.time));
      if (key < todayKey || !map[key]) return;
      map[key].push(h);
    });
    return (targetWeekDates || []).map(function (d) {
      var key = getDayKey(d);
      var sorted = (map[key] || []).sort(function (a, b) {
        return new Date(a.time).getTime() - new Date(b.time).getTime();
      });
      return sorted.length ? sorted.slice(0, 24) : [];
    });
  }

  function hourFieldsFromDto(dto) {
    var n = normalizeDisplayEnv(dto) || {};
    var windKmh = n.wind_speed_kmh;
    var windMs = windKmh != null && Number.isFinite(windKmh) ? windKmh / 3.6 : null;
    var wtemp = n.temp;
    var wh = n.wave_height_m;
    var wd = n.wind_direction_deg;
    var sea = 0.5;
    return {
      windMs: windMs != null ? +windMs.toFixed(2) : null,
      windGustMs: windMs != null ? +windMs.toFixed(2) : null,
      windDir: wd,
      seaLevel: sea,
      waterTemp: wtemp,
      waveHeight: wh
    };
  }

  /**
   * Synthetic hourly series from a single analysis snapshot (no browser weather APIs).
   */
  function buildWeatherByDayFromDto(dto, weekDates, getDayKey) {
    var f = hourFieldsFromDto(dto);
    var merged = [];
    (weekDates || []).forEach(function (d) {
      for (var h = 0; h < 24; h++) {
        var t = new Date(d.getTime());
        t.setUTCHours(h, 0, 0, 0);
        merged.push({
          time: t.toISOString(),
          windSpeed: { sg: f.windMs },
          windDirection: { sg: f.windDir != null && Number.isFinite(f.windDir) ? f.windDir : null },
          windGust: { sg: f.windGustMs },
          seaLevel: { sg: f.seaLevel != null ? +f.seaLevel.toFixed(2) : null },
          waterTemperature: {
            sg: f.waterTemp != null && Number.isFinite(f.waterTemp) ? +f.waterTemp.toFixed(1) : null
          },
          waveHeight: f.waveHeight != null && Number.isFinite(f.waveHeight) ? f.waveHeight : null,
          wavePeriod: null
        });
      }
    });
    var hoursByDay = groupHoursByWeekDates(merged, weekDates, getDayKey);
    return {
      hoursByDay: hoursByDay,
      meta: {
        source: 'navidur_analysis_dto',
        sourceLabel: 'NAVIDUR (تحليل)',
        isLive: true,
        weatherModelProfile: 'analysis_dto',
        updatedAt: new Date().toISOString()
      }
    };
  }

  root.NavidurLiveAnalysis = {
    getHotspotForStation: getHotspotForStation,
    getStationAnalysis: getStationAnalysis,
    getPreviewAnalysis: getPreviewAnalysis,
    getStationLiveSummary: getStationLiveSummary,
    getConfidenceMeta: getConfidenceMeta,
    normalizeDisplayEnv: normalizeDisplayEnv,
    renderEnvironment: renderEnvironment,
    buildWeatherByDayFromDto: buildWeatherByDayFromDto
  };
})(typeof window !== 'undefined' ? window : globalThis);
