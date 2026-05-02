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
    return Promise.reject(new Error('navidur_hotspot_disabled_use_analysis_api'));
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
    return Promise.reject(new Error('navidur_hotspot_disabled_use_analysis_api'));
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

  function normalizeAnalysisDateFromOptions(options) {
    var opts = options || {};
    var raw = '';
    if (opts.analysis_date) raw = String(opts.analysis_date);
    else if (opts.as_of_iso) raw = String(opts.as_of_iso);
    else if (opts.datetime) raw = String(opts.datetime);
    if (!raw) return new Date().toISOString().slice(0, 10);
    var m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : new Date().toISOString().slice(0, 10);
  }

  function liveCacheKeyForStation(station, analysisDate) {
    var sid = station && station.id != null && String(station.id).trim() !== '' ? String(station.id).trim() : null;
    var d = analysisDate && /^\d{4}-\d{2}-\d{2}$/.test(String(analysisDate))
      ? String(analysisDate)
      : new Date().toISOString().slice(0, 10);
    return sid ? 'navidur_last_live_inputs:' + sid + ':' + d : null;
  }

  async function getStationAnalysis(station, options) {
    if (!station || typeof station !== 'object') throw new Error('station_required');
    var opts = options || {};
    var analysisDate = normalizeAnalysisDateFromOptions(opts);
    var datetime = opts.datetime || (analysisDate + 'T12:00:00Z');
    var asOfIso = opts.as_of_iso || datetime;
    var cacheKey = !opts.live_inputs ? liveCacheKeyForStation(station, analysisDate) : null;
    var body = {
      station: station,
      station_id: station.id || null,
      analysis_date: analysisDate,
      as_of_iso: asOfIso,
      datetime: datetime,
      overrides: opts.overrides || null,
      live_inputs: opts.live_inputs || null
    };
    if (opts.field_validation != null && typeof opts.field_validation === 'object') {
      body.field_validation = opts.field_validation;
    }
    if (opts.debug_log === true || opts.debug_analysis === true) {
      body.debug_log = true;
      body.debug_analysis = true;
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

  function getBrowserTimeZone() {
    try {
      if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      }
    } catch (_e) { /* ignore */ }
    return 'UTC';
  }

  function formatDateKeyInZone(date, tz) {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(date);
      var map = {};
      for (var i = 0; i < parts.length; i += 1) {
        if (parts[i].type !== 'literal') map[parts[i].type] = parts[i].value;
      }
      if (map.year && map.month && map.day) return map.year + '-' + map.month + '-' + map.day;
    } catch (_e) { /* ignore */ }
    return new Date(date).toISOString().slice(0, 10);
  }

  function getLocalHourInZone(iso, tz) {
    var ms = Date.parse(String(iso));
    if (Number.isNaN(ms)) return null;
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        hour: '2-digit',
        hour12: false
      }).formatToParts(new Date(ms));
      for (var i = 0; i < parts.length; i += 1) {
        if (parts[i].type === 'hour') return parseInt(parts[i].value, 10);
      }
    } catch (_e) { /* ignore */ }
    return null;
  }

  function isDaytimeLocalSixToSix(iso, tz) {
    var h = getLocalHourInZone(iso, tz);
    if (h == null || Number.isNaN(h)) return true;
    return h >= 6 && h < 18;
  }

  /**
   * وقت مؤشر لعرض «صافي/مشمس» فقط: إذا كان يوم التحليل = اليوم المحلي للمستخدم نستخدم الساعة الحالية
   * (لأن الطلب غالبًا يثبت الوقت عند 12:00Z فيخالف تجربة الليل).
   */
  function resolveInstantIsoForSkyDisplay(meta) {
    var m = meta && typeof meta === 'object' ? meta : {};
    var tz = getBrowserTimeZone();
    var now = new Date();
    var todayKey = formatDateKeyInZone(now, tz);
    if (m.as_of_iso && String(m.as_of_iso).indexOf('T') > 0) return String(m.as_of_iso);
    if (m.analysis_timestamp) return String(m.analysis_timestamp);
    var dateKey = '';
    if (m.analysis_date && /^\d{4}-\d{2}-\d{2}$/.test(String(m.analysis_date))) {
      dateKey = String(m.analysis_date);
    } else if (m.as_of_iso && /^\d{4}-\d{2}-\d{2}/.test(String(m.as_of_iso))) {
      dateKey = String(m.as_of_iso).slice(0, 10);
    } else if (m.as_of && /^\d{4}-\d{2}-\d{2}$/.test(String(m.as_of))) {
      dateKey = String(m.as_of);
    }
    if (dateKey && dateKey === todayKey) return now.toISOString();
    if (dateKey) return dateKey + 'T12:00:00.000Z';
    return now.toISOString();
  }

  /**
   * WMO weather_code (Open-Meteo) → عربي دقيق. المصدر الوحيد للنص المعروض (طبقة العرض).
   * @param {boolean} isDaytimeForClear — يُستخدم فقط للرمز 0 (نهار: مشمس | ليل: صافي)
   */
  function openMeteoWeatherCodeToArabicLabel(code, isDaytimeForClear) {
    var c = Math.round(Number(code));
    if (!Number.isFinite(c)) return null;
    if (c === 0) return isDaytimeForClear ? 'مشمس' : 'صافي';
    if (c === 1) return 'صحو غالباً';
    if (c === 2) return 'غائم جزئياً';
    if (c === 3) return 'غائم';
    if (c === 45 || c === 48) return 'ضباب';
    if (c === 51) return 'رذاذ خفيف';
    if (c === 53) return 'رذاذ متوسط';
    if (c === 55) return 'رذاذ غزير';
    if (c === 61) return 'أمطار خفيفة';
    if (c === 63) return 'أمطار متوسطة';
    if (c === 65) return 'أمطار غزيرة';
    if (c === 71 || c === 73 || c === 75) return 'ثلوج';
    if (c === 80) return 'زخات مطر خفيفة';
    if (c === 81) return 'زخات مطر متوسطة';
    if (c === 82) return 'زخات مطر غزيرة';
    if (c === 95) return 'عاصفة رعدية';
    return null;
  }

  /** ليل إذا ساعة التحليل (محليًا) أو الساعة المحلية الحالية ضمن [18..23]∪[0..5] — لا «مشمس» عند الليل. */
  function isDaytimeForClearCodeZeroFromMeta(skyMeta) {
    var analysisTimeIso = resolveInstantIsoForSkyDisplay(skyMeta);
    var tz = getBrowserTimeZone();
    var hAnalysis = getLocalHourInZone(analysisTimeIso, tz);
    if (hAnalysis == null || Number.isNaN(hAnalysis)) {
      var ms = Date.parse(String(analysisTimeIso));
      hAnalysis = Number.isNaN(ms) ? null : new Date(ms).getHours();
    }
    var localHour = new Date().getHours();
    if (hAnalysis == null || Number.isNaN(hAnalysis)) hAnalysis = localHour;
    var isNight = (hAnalysis >= 18 || hAnalysis < 6) || (localHour >= 18 || localHour < 6);
    return !isNight;
  }

  function appendMarineWindNotesArabic(baseLabel, windKmh, waveM) {
    var base = String(baseLabel == null ? '' : baseLabel).trim();
    if (!base) return base;
    var parts = [base];
    var wv = toFiniteNumber(waveM);
    var wk = toFiniteNumber(windKmh);
    if (wv != null && wv >= 1.5) parts.push('البحر مضطرب');
    if (wk != null && wk >= 30) parts.push('رياح نشطة');
    return parts.join(' · ');
  }

  function buildAccurateSkyConditionLabel(n) {
    var skyMeta = n.__display_sky && typeof n.__display_sky === 'object' ? n.__display_sky : {};
    var analysisTimeIso = resolveInstantIsoForSkyDisplay(skyMeta);
    var tz = getBrowserTimeZone();
    var hAnalysis = getLocalHourInZone(analysisTimeIso, tz);
    if (hAnalysis == null || Number.isNaN(hAnalysis)) {
      var msA = Date.parse(String(analysisTimeIso));
      hAnalysis = Number.isNaN(msA) ? new Date().getHours() : new Date(msA).getHours();
    }
    var isDaytimeGeneric = hAnalysis >= 6 && hAnalysis < 18;
    var codeRaw = n.weather_code != null ? n.weather_code : skyMeta.weather_code;
    var code = codeRaw != null ? Math.round(Number(codeRaw)) : NaN;
    var isClearDay = isDaytimeForClearCodeZeroFromMeta(skyMeta);
    var base;
    if (!Number.isFinite(code)) {
      base = 'حالة جوية غير واضحة';
    } else if (code === 0) {
      base = openMeteoWeatherCodeToArabicLabel(0, isClearDay);
    } else {
      base = openMeteoWeatherCodeToArabicLabel(code, true);
    }
    if (base == null) base = 'حالة جوية غير واضحة';
    var withHints = appendMarineWindNotesArabic(base, n.wind_speed_kmh, n.wave_height_m);
    try {
      if (typeof console !== 'undefined' && console && typeof console.debug === 'function') {
        console.debug('NAVIDUR_WEATHER_ACCURACY', {
          weather_code: Number.isFinite(code) ? code : null,
          label_ar: withHints,
          is_daytime: code === 0 ? isClearDay : isDaytimeGeneric,
          wind_speed: n.wind_speed_kmh,
          wave_height: n.wave_height_m,
          source: 'open-meteo'
        });
      }
    } catch (_accDbg) { /* ignore */ }
    return withHints;
  }

  function getAccurateWeatherLabelForDto(dto) {
    var n = normalizeDisplayEnv(dto);
    if (!n) return ENV_UNAVAILABLE;
    return buildAccurateSkyConditionLabel(n);
  }

  /**
   * Normalizes /api?route=analysis DTO environment + tide for display.
   * @returns {object|null}
   */
  function normalizeDisplayEnv(dto) {
    if (!dto || typeof dto !== 'object') return null;
    var e = dto.environment || {};
    var t = dto.tide || {};
    var envTide = e.tide && typeof e.tide === 'object' ? e.tide : null;
    var tideMerged = envTide && (envTide.state || envTide.height_m != null)
      ? Object.assign({}, t, envTide)
      : (t && typeof t === 'object' ? t : null);
    var temp = e.temperature_c != null ? e.temperature_c : e.temp_c;
    var hum = e.humidity_pct != null ? e.humidity_pct : e.relative_humidity_2m;
    return {
      weather_status_ar: e.weather_status_ar != null ? String(e.weather_status_ar).trim() : null,
      weather_code: toFiniteNumber(e.weather_code),
      temp: toFiniteNumber(temp),
      wind_speed_kmh: toFiniteNumber(e.wind_speed_kmh),
      wind_direction_deg: toFiniteNumber(e.wind_direction_deg),
      humidity: toFiniteNumber(hum),
      precipitation_mm: toFiniteNumber(
        e.precipitation_mm != null ? e.precipitation_mm : e.precipitation
      ),
      wave_height_m: toFiniteNumber(e.wave_height_m),
      current_speed_ms: toFiniteNumber(t.current_speed_ms),
      tide: tideMerged,
      __display_sky: {
        weather_code: toFiniteNumber(e.weather_code),
        analysis_timestamp: dto.analysis_timestamp != null ? String(dto.analysis_timestamp) : null,
        as_of_iso: dto.as_of_iso != null ? String(dto.as_of_iso) : null,
        analysis_date: dto.analysis_date != null ? String(dto.analysis_date) : null,
        as_of: e.as_of != null ? String(e.as_of) : null
      }
    };
  }

  function tideStateArabic(tide) {
    if (!tide) return null;
    var st = tide.state != null ? String(tide.state).trim() : '';
    if (st === 'سقي' || st === 'ثبر' || st === 'خامل') return st;
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
    var wsky = buildAccurateSkyConditionLabel(n);
    set('skyConditionVal', wsky || ENV_UNAVAILABLE);

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
    buildWeatherByDayFromDto: buildWeatherByDayFromDto,
    getAccurateWeatherLabelForDto: getAccurateWeatherLabelForDto
  };
})(typeof window !== 'undefined' ? window : globalThis);
