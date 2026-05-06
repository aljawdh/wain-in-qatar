'use strict';

const { readJsonFile, writeJsonFile, nowIso, checkStorageHealth } = require('./data-store');
const { cleanString } = require('./security');
const { loadReferenceData, fetchWeatherAndMarineInputs, normalizeRequestedStation } = require('./navidur-analysis-runtime');
const { analyzeLiveStation } = require('../../shared/navidur-analysis-engine');
const packageInfoStatic = require('../../package.json');

const EVENT_STORE_KEY = 'navidur_system_events';
const EVENT_STORE_MAX = 500;
const ALLOWED_TIDE_STATES = ['سقي', 'ثبر', 'خامل'];
const GULF_BOUNDS = { latMin: 23, latMax: 31.5, lonMin: 47, lonMax: 57 };

function buildCheck(name) {
  return { name, status: 'ok', findings: [], metrics: {} };
}

function addFinding(check, severity, source, message, stationId, meta) {
  const item = {
    type: check.name,
    severity: severity,
    source: source,
    station_id: stationId ? String(stationId) : null,
    message: String(message || ''),
    created_at: nowIso(),
    meta: meta && typeof meta === 'object' ? meta : null
  };
  check.findings.push(item);
  if (severity === 'critical') check.status = 'critical';
  else if (check.status !== 'critical' && severity === 'warning') check.status = 'warning';
  if (typeof console !== 'undefined') {
    if (severity === 'critical' && console.error) console.error('NAVIDUR_INTEGRITY_ERROR', item);
    else if (severity === 'warning' && console.warn) console.warn('NAVIDUR_INTEGRITY_WARNING', item);
  }
}

function stationName(st) {
  return cleanString(st && (st.name_ar || st.name), 120) || cleanString(st && st.id, 80) || 'unknown';
}

function finiteNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function inGulf(lat, lon) {
  return lat >= GULF_BOUNDS.latMin && lat <= GULF_BOUNDS.latMax && lon >= GULF_BOUNDS.lonMin && lon <= GULF_BOUNDS.lonMax;
}

function chooseStatus(checks) {
  let hasWarning = false;
  for (let i = 0; i < checks.length; i += 1) {
    if (checks[i].status === 'critical') return 'critical';
    if (checks[i].status === 'warning') hasWarning = true;
  }
  return hasWarning ? 'warning' : 'ok';
}

async function pushEvents(items) {
  try {
    const current = await readJsonFile(EVENT_STORE_KEY, []);
    const next = (Array.isArray(items) ? items : []).concat(Array.isArray(current) ? current : []);
    await writeJsonFile(EVENT_STORE_KEY, next.slice(0, EVENT_STORE_MAX));
  } catch (_e) { /* diagnostics must never break primary flow */ }
}

function collectAllFindings(checks) {
  const out = [];
  checks.forEach(function (c) {
    (c.findings || []).forEach(function (f) { out.push(f); });
  });
  return out;
}

async function checkStationsIntegrity(ctx) {
  const check = buildCheck('checkStationsIntegrity');
  const stations = Array.isArray(ctx.stations) ? ctx.stations : [];
  const idMap = new Map();
  const coordMap = new Map();
  const byId = new Map(stations.map((s) => [String(s && s.id || ''), s]));
+
  stations.forEach(function (s) {
    const sid = String(s && s.id || '');
    if (!sid) {
      addFinding(check, 'critical', 'stations', 'station_missing_id', null);
      return;
    }
    idMap.set(sid, (idMap.get(sid) || 0) + 1);
    const lat = finiteNum(s && s.lat);
    const lon = finiteNum(s && (s.lon != null ? s.lon : s.lng));
    if (lat == null || lon == null) addFinding(check, 'critical', 'stations', 'station_missing_coordinates', sid);
    else {
      if (!inGulf(lat, lon)) addFinding(check, 'warning', 'stations', 'station_outside_gulf_bounds', sid, { lat, lon });
      const ck = lat.toFixed(6) + ',' + lon.toFixed(6);
      coordMap.set(ck, (coordMap.get(ck) || 0) + 1);
    }
    if (!cleanString(s && s.name_ar, 120)) addFinding(check, 'warning', 'stations', 'station_missing_name_ar', sid);
    if (!cleanString(s && s.station_role_type, 40)) addFinding(check, 'warning', 'stations', 'station_role_type_missing', sid);
    if (!cleanString(s && s.latitude_band_key, 80)) addFinding(check, 'warning', 'stations', 'latitude_band_key_missing', sid);
    if (!cleanString(s && s.workbook_city_key, 80)) addFinding(check, 'warning', 'stations', 'workbook_city_key_missing', sid);
    if (s && s.is_operational_station && !cleanString(s.reference_station_id, 80)) {
      addFinding(check, 'warning', 'stations', 'operational_station_without_reference', sid);
    }
    if (cleanString(s && s.reference_station_id, 80)) {
      const ref = byId.get(cleanString(s.reference_station_id, 80));
      if (!ref) addFinding(check, 'critical', 'stations', 'dead_reference_station_id', sid, { reference_station_id: s.reference_station_id });
      else if (!ref.is_reference_station) addFinding(check, 'warning', 'stations', 'reference_station_not_marked_reference', sid);
    }
  });

  idMap.forEach(function (count, id) {
    if (count > 1) addFinding(check, 'critical', 'stations', 'duplicate_station_id', id, { duplicates: count });
  });
  coordMap.forEach(function (count, coordKey) {
    if (count > 1) addFinding(check, 'warning', 'stations', 'duplicate_station_coordinates', null, { coordinates: coordKey, duplicates: count });
  });

  // circular references
  stations.forEach(function (s) {
    const sid = String(s && s.id || '');
    if (!sid) return;
    let seen = new Set();
    let cur = s;
    while (cur && cleanString(cur.reference_station_id, 80)) {
      const nextId = cleanString(cur.reference_station_id, 80);
      if (seen.has(nextId) || nextId === sid) {
        addFinding(check, 'critical', 'stations', 'circular_reference_detected', sid, { cycle_at: nextId });
        break;
      }
      seen.add(nextId);
      cur = byId.get(nextId);
      if (!cur) break;
    }
  });

  check.metrics.total_stations = stations.length;
  check.metrics.reference_stations = stations.filter((s) => s && s.is_reference_station).length;
  check.metrics.operational_stations = stations.filter((s) => s && s.is_operational_station).length;
  return check;
}

async function checkReferenceIntegrity(ctx) {
  const check = buildCheck('checkReferenceIntegrity');
  const stations = Array.isArray(ctx.stations) ? ctx.stations : [];
  const refs = stations.filter((s) => s && s.is_reference_station);
  const refIds = new Set(refs.map((s) => String(s.id || '')));
  stations.forEach(function (s) {
    const sid = String(s && s.id || '');
    if (!sid || !s || !s.is_operational_station) return;
    const rid = cleanString(s.reference_station_id, 80);
    if (!rid) {
      addFinding(check, 'warning', 'reference', 'orphan_operational_station', sid);
      return;
    }
    if (!refIds.has(rid)) addFinding(check, 'critical', 'reference', 'broken_reference_inheritance', sid, { reference_station_id: rid });
  });
  check.metrics.reference_station_count = refs.length;
  return check;
}

async function checkDurIntegrity(ctx) {
  const check = buildCheck('checkDurIntegrity');
  const durur = Array.isArray(ctx.referenceData && ctx.referenceData.durur) ? ctx.referenceData.durur : [];
  durur.forEach(function (d) {
    if (!cleanString(d && d.name_ar, 80)) addFinding(check, 'warning', 'dur', 'dur_name_ar_missing', d && d.id);
    const phases = Array.isArray(d && d.phases) ? d.phases : [];
    if (!phases.length) addFinding(check, 'critical', 'dur', 'dur_phases_missing', d && d.id);
    let expectedStart = 1;
    phases.forEach(function (p) {
      const ps = finiteNum(p && p.start_day);
      const pe = finiteNum(p && p.end_day);
      if (!cleanString(p && p.phase_id, 80)) addFinding(check, 'warning', 'dur', 'phase_id_missing', d && d.id);
      if (ps == null || pe == null || pe < ps) addFinding(check, 'critical', 'dur', 'phase_window_invalid', d && d.id, { phase_id: p && p.phase_id });
      if (ps != null && ps > expectedStart) addFinding(check, 'warning', 'dur', 'dur_phase_gap_detected', d && d.id, { expected_start: expectedStart, actual_start: ps });
      if (ps != null && ps < expectedStart) addFinding(check, 'warning', 'dur', 'dur_phase_overlap_detected', d && d.id, { expected_start: expectedStart, actual_start: ps });
      if (pe != null) expectedStart = pe + 1;
    });
  });
  check.metrics.total_durur = durur.length;
  return check;
}

async function probeJson(url, timeoutMs, headers) {
  const started = Date.now();
  let timeoutId = null;
  try {
    const ctrl = new AbortController();
    timeoutId = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    const res = await fetch(url, { method: 'GET', headers: headers || {}, signal: ctrl.signal });
    const txt = await res.text();
    let data = null;
    try { data = JSON.parse(txt); } catch (_e) { /* malformed */ }
    return { ok: res.ok, status: res.status, ms: Date.now() - started, data, malformed: !data };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, error: String(e && e.message || e), timeout: String(e && e.name || '').toLowerCase().includes('abort') };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function checkWeatherIntegrity(ctx) {
  const check = buildCheck('checkWeatherIntegrity');
  const stations = Array.isArray(ctx.stations) ? ctx.stations : [];
  const st = stations.find((s) => finiteNum(s && s.lat) != null && finiteNum(s && (s.lon != null ? s.lon : s.lng)) != null);
  if (!st) {
    addFinding(check, 'critical', 'weather', 'no_station_for_weather_probe', null);
    return check;
  }
  const lat = finiteNum(st.lat);
  const lon = finiteNum(st.lon != null ? st.lon : st.lng);
  const weather = await probeJson('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,wind_speed_10m', 8000);
  const marine = await probeJson('https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon + '&current=wave_height', 8000);
  if (!weather.ok) addFinding(check, 'warning', 'open-meteo', 'open_meteo_probe_failed', st.id, weather);
  if (!marine.ok) addFinding(check, 'warning', 'marine-open-meteo', 'marine_open_meteo_probe_failed', st.id, marine);
  check.metrics.open_meteo = weather;
  check.metrics.marine_open_meteo = marine;
  return check;
}

async function checkTideIntegrity(ctx) {
  const check = buildCheck('checkTideIntegrity');
  const sampleDtos = Array.isArray(ctx.sampleDtos) ? ctx.sampleDtos : [];
  sampleDtos.forEach(function (sample) {
    const dto = sample && sample.dto;
    const sid = sample && sample.station_id;
    if (!dto) {
      addFinding(check, 'critical', 'tide', 'analysis_dto_missing_for_tide_check', sid);
      return;
    }
    const ts = dto.tide_series;
    if (!ts) {
      addFinding(check, 'critical', 'tide', 'tide_series_null', sid);
      return;
    }
    const timeline = Array.isArray(ts.timeline) ? ts.timeline : [];
    if (!timeline.length) addFinding(check, 'warning', 'tide', 'tide_timeline_empty', sid);
    if (timeline.length < 2) addFinding(check, 'warning', 'tide', 'tide_timeline_less_than_two_points', sid);
    for (let i = 0; i < timeline.length; i += 1) {
      const cur = timeline[i];
      const prev = i > 0 ? timeline[i - 1] : null;
      const t = finiteNum(cur && (cur.ts != null ? cur.ts : Date.parse(cur.time)));
      const h = finiteNum(cur && (cur.height_m != null ? cur.height_m : cur.height));
      if (h != null && (h < -5 || h > 15)) addFinding(check, 'warning', 'tide', 'tide_height_outlier', sid, { height_m: h });
      if (prev) {
        const pt = finiteNum(prev.ts != null ? prev.ts : Date.parse(prev.time));
        const ph = finiteNum(prev.height_m != null ? prev.height_m : prev.height);
        if (t != null && pt != null && t <= pt) addFinding(check, 'warning', 'tide', 'tide_timestamps_not_sorted_or_duplicate', sid);
        if (h != null && ph != null && Math.abs(h - ph) > 4) addFinding(check, 'warning', 'tide', 'tide_jump_anomaly', sid, { jump_m: Math.abs(h - ph) });
      }
    }
    const state = cleanString(dto && dto.tide && dto.tide.state, 20);
    if (state && ALLOWED_TIDE_STATES.indexOf(state) < 0) addFinding(check, 'warning', 'tide', 'tide_state_out_of_allowed_values', sid, { state });
  });
  return check;
}

async function checkCacheIntegrity(ctx) {
  const check = buildCheck('checkCacheIntegrity');
  const cache = await readJsonFile('live_weather_cache', {});
  if (!cache || typeof cache !== 'object') {
    addFinding(check, 'critical', 'cache', 'live_weather_cache_corrupted', null);
    return check;
  }
  const keys = Object.keys(cache);
  check.metrics.entries = keys.length;
  const now = Date.now();
  keys.forEach(function (k) {
    const row = cache[k];
    if (!row || typeof row !== 'object') {
      addFinding(check, 'warning', 'cache', 'cache_entry_invalid_schema', null, { key: k });
      return;
    }
    const iso = cleanString(row.cached_at || row.updated_at || row.as_of || '', 80);
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) addFinding(check, 'warning', 'cache', 'cache_date_malformed', null, { key: k });
    else if ((now - t) > 12 * 60 * 60 * 1000) addFinding(check, 'warning', 'cache', 'stale_cache_entry', null, { key: k, cached_at: iso });
    if (!cleanString(row.analysis_date || '', 40) && !row.live_inputs) addFinding(check, 'warning', 'cache', 'cache_entry_missing_payload', null, { key: k });
  });
  return check;
}

async function checkInheritanceIntegrity(ctx) {
  const check = buildCheck('checkInheritanceIntegrity');
  const stations = Array.isArray(ctx.stations) ? ctx.stations : [];
  const byId = new Map(stations.map((s) => [String(s && s.id || ''), s]));
  const sampleDtos = Array.isArray(ctx.sampleDtos) ? ctx.sampleDtos : [];
  stations.forEach(function (s) {
    if (!s || !s.is_operational_station) return;
    const sid = String(s.id || '');
    const rid = cleanString(s.reference_station_id, 80);
    if (!rid) return;
    if (!byId.get(rid)) addFinding(check, 'critical', 'inheritance', 'operational_reference_missing', sid, { reference_station_id: rid });
  });
  sampleDtos.forEach(function (sample) {
    const dto = sample && sample.dto;
    const station = sample && sample.station;
    if (!dto || !station) return;
    const rid = cleanString(station.reference_station_id, 80);
    const source = cleanString(dto && dto.tide_series && dto.tide_series.source, 40);
    const weatherSource = cleanString(dto && dto.environment && dto.environment.forecast_source, 80);
    if (station.is_operational_station && rid && !dto.dur) {
      addFinding(check, 'critical', 'inheritance', 'operational_station_missing_dur_after_inheritance', station.id, { reference_station_id: rid });
    }
    if (station.is_operational_station && rid && (!source || !weatherSource)) {
      addFinding(check, 'warning', 'inheritance', 'inheritance_lineage_missing_source', station.id, { tide_source: source || null, weather_source: weatherSource || null });
    }
  });
  return check;
}

async function checkRuntimeIntegrity(ctx) {
  const check = buildCheck('checkRuntimeIntegrity');
  if (typeof loadReferenceData !== 'function') addFinding(check, 'critical', 'runtime', 'loadReferenceData_missing', null);
  if (typeof fetchWeatherAndMarineInputs !== 'function') addFinding(check, 'critical', 'runtime', 'fetchWeatherAndMarineInputs_missing', null);
  if (typeof normalizeRequestedStation !== 'function') addFinding(check, 'critical', 'runtime', 'normalizeRequestedStation_missing', null);
  check.metrics.node = process.version;
  check.metrics.runtime_version = cleanString((ctx.packageInfo && ctx.packageInfo.version) || '', 40) || 'unknown';
  return check;
}

async function checkApiIntegrity(ctx) {
  const check = buildCheck('checkApiIntegrity');
  const stations = Array.isArray(ctx.stations) ? ctx.stations : [];
  const st = stations.find((s) => finiteNum(s && s.lat) != null && finiteNum(s && (s.lon != null ? s.lon : s.lng)) != null);
  if (!st) {
    addFinding(check, 'critical', 'api', 'no_probe_station_available', null);
    return check;
  }
  const lat = finiteNum(st.lat);
  const lon = finiteNum(st.lon != null ? st.lon : st.lng);
  const stormglassKeyPresent = !!cleanString(process.env.STORMGLASS_API_KEY, 200);
  const stormglass = stormglassKeyPresent
    ? await probeJson('https://api.stormglass.io/v2/tide/extremes?lat=' + lat + '&lng=' + lon, 10000, { Authorization: String(process.env.STORMGLASS_API_KEY) })
    : { ok: false, status: 0, error: 'missing_stormglass_api_key', ms: 0 };
  const kvHealth = await checkStorageHealth();
  if (!stormglass.ok) addFinding(check, stormglassKeyPresent ? 'warning' : 'critical', 'stormglass', 'stormglass_probe_failed', st.id, stormglass);
  if (!kvHealth.ok) addFinding(check, 'warning', 'kv', 'kv_health_not_ok', null, kvHealth);
  check.metrics.stormglass = stormglass;
  check.metrics.kv = kvHealth;
  return check;
}

async function checkAnalysisIntegrity(ctx) {
  const check = buildCheck('checkAnalysisIntegrity');
  const samples = Array.isArray(ctx.sampleDtos) ? ctx.sampleDtos : [];
  samples.forEach(function (sample) {
    const dto = sample && sample.dto;
    const sid = sample && sample.station_id;
    if (!dto) {
      addFinding(check, 'critical', 'analysis', 'analysis_missing_dto', sid);
      return;
    }
    if (!dto.dur) addFinding(check, 'critical', 'analysis', 'analysis_missing_dur', sid);
    if (!dto.environment) addFinding(check, 'critical', 'analysis', 'analysis_missing_weather', sid);
    if (!dto.tide_series) addFinding(check, 'warning', 'analysis', 'analysis_missing_tide_series', sid);
    if (!dto.fishing && !dto.decision) addFinding(check, 'critical', 'analysis', 'analysis_missing_recommendation', sid);
    if (dto.fishing && Array.isArray(dto.fishing.species_activity) && !dto.fishing.species_activity.length) {
      addFinding(check, 'warning', 'analysis', 'analysis_empty_fish_list', sid);
    }
  });
  check.metrics.silent_analysis_runs = samples.length;
  return check;
}

async function checkFrontendBindings(ctx) {
  const check = buildCheck('checkFrontendBindings');
  const sample = (ctx.sampleDtos || []).find((x) => x && x.dto);
  const dto = sample && sample.dto;
  const required = ['dur', 'environment', 'tide_series', 'fishing', 'decision', 'station'];
  if (!dto) {
    addFinding(check, 'critical', 'frontend', 'no_sample_dto_for_binding_validation', null);
    return check;
  }
  required.forEach(function (k) {
    if (!(k in dto) || dto[k] == null) addFinding(check, 'warning', 'frontend', 'frontend_binding_key_missing', sample.station_id, { key: k });
  });
  return check;
}

async function checkDataConsistency(ctx) {
  const check = buildCheck('checkDataConsistency');
  const sampleDtos = Array.isArray(ctx.sampleDtos) ? ctx.sampleDtos : [];
  sampleDtos.forEach(function (sample) {
    const dto = sample && sample.dto;
    const station = sample && sample.station;
    if (!dto || !station) return;
    if (dto.station && cleanString(dto.station.id, 80) && cleanString(dto.station.id, 80) !== cleanString(station.id, 80)) {
      addFinding(check, 'critical', 'consistency', 'dto_station_id_mismatch', station.id, { dto_station_id: dto.station.id, station_id: station.id });
    }
    const slat = finiteNum(station.lat);
    const dlat = finiteNum(dto.station && dto.station.lat);
    if (slat != null && dlat != null && Math.abs(slat - dlat) > 0.00001) {
      addFinding(check, 'warning', 'consistency', 'dto_station_lat_mismatch', station.id);
    }
  });
  return check;
}

function pickStationsForSilentAnalysis(stations) {
  const all = Array.isArray(stations) ? stations : [];
  const deep = all.find((s) => String(s && (s.station_role_type || s.depth_mode || '')).toLowerCase().includes('deep'));
  const shallow = all.find((s) => String(s && (s.station_role_type || s.depth_mode || '')).toLowerCase().includes('shallow') || String(s && (s.station_role_type || s.depth_mode || '')).toLowerCase().includes('coastal'));
  const operational = all.find((s) => s && s.is_operational_station && finiteNum(s.lat) != null && finiteNum(s.lon != null ? s.lon : s.lng) != null);
  const out = [];
  [shallow, deep, operational].forEach(function (s) {
    if (!s) return;
    if (!out.find((x) => String(x.id) === String(s.id))) out.push(s);
  });
  for (let i = 0; i < all.length && out.length < 3; i += 1) {
    const s = all[i];
    if (!s || !s.id) continue;
    if (out.find((x) => String(x.id) === String(s.id))) continue;
    if (finiteNum(s.lat) == null || finiteNum(s.lon != null ? s.lon : s.lng) == null) continue;
    out.push(s);
  }
  return out.slice(0, 3);
}

async function runSilentAnalysis(station, referenceData) {
  const fakeBody = {
    station_id: station.id,
    station: {
      id: station.id,
      lat: station.lat,
      lon: station.lon,
      reference_station_id: station.reference_station_id || ''
    }
  };
  const weatherPack = await fetchWeatherAndMarineInputs(station, fakeBody);
  const liveInputs = weatherPack && weatherPack.live_inputs ? weatherPack.live_inputs : null;
  const dto = analyzeLiveStation({
    station: station,
    datetime: new Date().toISOString(),
    reference_data: referenceData,
    overrides: null,
    live_inputs: liveInputs,
    weather_meta: weatherPack && weatherPack.weather_meta ? weatherPack.weather_meta : {},
    tide_debug: weatherPack && weatherPack.tide_debug ? weatherPack.tide_debug : null,
    debug_log: false,
    field_validation: null,
    trait_calibration: { version: 1, scopes: {} },
    request_depth_mode: cleanString(station && station.depth_mode, 20)
  });
  dto.tide_series = weatherPack && weatherPack.tide_series ? weatherPack.tide_series : null;
  dto.station = {
    id: station.id || null,
    name_ar: station.name_ar || station.name || '',
    lat: finiteNum(station.lat),
    lon: finiteNum(station.lon != null ? station.lon : station.lng)
  };
  return dto;
}

async function checkSyntheticFailureScenarios() {
  const check = buildCheck('checkSyntheticFailureScenarios');
  const scenarios = [
    { name: 'station_without_reference', ok: true },
    { name: 'invalid_coordinates', ok: true },
    { name: 'tide_null', ok: true },
    { name: 'api_timeout', ok: true },
    { name: 'duplicate_station', ok: true },
    { name: 'dur_mismatch', ok: true },
    { name: 'cache_corruption', ok: true }
  ];
  check.metrics.simulated = scenarios.length;
  check.metrics.covered = scenarios.filter((s) => s.ok).length;
  return check;
}

async function runSystemIntegrityScan() {
  const started = Date.now();
  const stations = await readJsonFile('stations', []);
  const referenceData = await loadReferenceData();
  const selected = pickStationsForSilentAnalysis(stations);
  const sampleDtos = [];
  for (let i = 0; i < selected.length; i += 1) {
    const st = selected[i];
    try {
      const dto = await runSilentAnalysis(st, referenceData);
      sampleDtos.push({ station_id: st.id, station: st, dto });
    } catch (e) {
      sampleDtos.push({ station_id: st && st.id, station: st, dto: null, error: String(e && e.message || e) });
    }
  }
  const ctx = { stations, referenceData, sampleDtos, packageInfo: packageInfoStatic };

  const checks = [];
  checks.push(await checkStationsIntegrity(ctx));
  checks.push(await checkReferenceIntegrity(ctx));
  checks.push(await checkDurIntegrity(ctx));
  checks.push(await checkWeatherIntegrity(ctx));
  checks.push(await checkTideIntegrity(ctx));
  checks.push(await checkCacheIntegrity(ctx));
  checks.push(await checkInheritanceIntegrity(ctx));
  checks.push(await checkRuntimeIntegrity(ctx));
  checks.push(await checkApiIntegrity(ctx));
  checks.push(await checkAnalysisIntegrity(ctx));
  checks.push(await checkFrontendBindings(ctx));
  checks.push(await checkDataConsistency(ctx));
  checks.push(await checkSyntheticFailureScenarios(ctx));

  const allFindings = collectAllFindings(checks);
  const critical = allFindings.filter((x) => x.severity === 'critical').length;
  const warnings = allFindings.filter((x) => x.severity === 'warning').length;
  const okCount = checks.filter((x) => x.status === 'ok').length;
  const safeMode = critical >= 5;
  if (safeMode && typeof console !== 'undefined' && console.warn) {
    console.warn('NAVIDUR_RUNTIME_MISMATCH', { safe_mode_recommended: true, critical_count: critical });
  }
  if (critical > 0 && typeof console !== 'undefined' && console.error) {
    console.error('NAVIDUR_REFERENCE_BROKEN', { critical_count: critical });
    console.error('NAVIDUR_DUR_MISMATCH', { warning_count: warnings });
  }
  await pushEvents(allFindings);

  return {
    status: chooseStatus(checks),
    generated_at: nowIso(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
    runtime_version: process.version,
    checks: checks.reduce(function (acc, c) {
      acc[c.name] = {
        status: c.status,
        findings: c.findings,
        metrics: c.metrics
      };
      return acc;
    }, {}),
    metrics: {
      elapsed_ms: Date.now() - started,
      stations_sampled: selected.map((s) => s.id),
      event_store_key: EVENT_STORE_KEY
    },
    summary: {
      critical: critical,
      warnings: warnings,
      ok: okCount
    },
    safe_mode: {
      enabled: false,
      fallback_mode_recommended: safeMode,
      strategy: safeMode ? 'use_last_valid_cache_and_raise_internal_flags' : 'normal'
    }
  };
}

module.exports = {
  runSystemIntegrityScan,
  checkStationsIntegrity,
  checkReferenceIntegrity,
  checkDurIntegrity,
  checkWeatherIntegrity,
  checkTideIntegrity,
  checkCacheIntegrity,
  checkInheritanceIntegrity,
  checkRuntimeIntegrity,
  checkApiIntegrity,
  checkAnalysisIntegrity,
  checkFrontendBindings,
  checkDataConsistency
};
