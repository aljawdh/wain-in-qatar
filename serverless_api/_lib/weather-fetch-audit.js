'use strict';

const { readJsonFile } = require('./data-store');
const { toNumber, cleanString } = require('./security');
const { getWeatherData } = require('./navidur-analysis-runtime');

const CONCURRENCY = 4;

/**
 * Read-only: weather fetch audit for all stations (getWeatherData only — no cache writes).
 */
function parseCoordStatus(s) {
  if (!s) {
    return { coordinates_status: 'missing', la: null, lo: null };
  }
  const rawLa = s.lat;
  const rawLo = s.lon != null ? s.lon : s.lng;
  const hasLa = rawLa != null && String(rawLa).trim() !== '';
  const hasLo = rawLo != null && String(rawLo).trim() !== '';
  if (!hasLa && !hasLo) {
    return { coordinates_status: 'missing', la: null, lo: null };
  }
  const la = toNumber(rawLa);
  const lo = toNumber(rawLo);
  if (la == null || lo == null) {
    return { coordinates_status: 'invalid_format', la: null, lo: null };
  }
  if (la < -90 || la > 90 || lo < -180 || lo > 180) {
    return { coordinates_status: 'invalid_format', la, lo };
  }
  return { coordinates_status: 'valid', la, lo };
}

function buildApiResponseSummary(pack) {
  const li = pack && pack.live_inputs ? pack.live_inputs : null;
  if (!li) {
    return {
      has_current: false,
      has_temperature: false,
      has_wind: false,
      has_wave: false
    };
  }
  return {
    has_current:
      toNumber(li.weather_code) != null ||
      (li.tide && (li.tide.current != null || li.tide.previous != null)) ||
      toNumber(li.wind_speed_kmh) != null,
    has_temperature: toNumber(li.temp_c) != null,
    has_wind: toNumber(li.wind_speed_kmh) != null,
    has_wave: toNumber(li.wave_height_m) != null
  };
}

function mapFailureReason(coordsStatus, pack, wasAttempted) {
  if (coordsStatus === 'missing') {
    return 'missing_coordinates';
  }
  if (coordsStatus === 'invalid_format') {
    return 'invalid_coordinates';
  }
  if (!wasAttempted) {
    return 'unknown';
  }
  if (!pack) {
    return 'unknown';
  }
  if (pack.from_cache) {
    return null;
  }
  if (pack.from_defaults) {
    return 'api_error';
  }
  if (pack.ok) {
    return null;
  }
  return 'unknown';
}

function computeDataAndFetchStatus(pack, coordsStatus, wasAttempted) {
  if (!wasAttempted) {
    return {
      data_status: 'failed',
      weather_fetch_status: 'skipped',
      weather_fetch_attempted: false
    };
  }
  if (pack.from_cache) {
    return {
      data_status: 'partial',
      weather_fetch_status: 'success',
      weather_fetch_attempted: true
    };
  }
  if (pack.from_defaults) {
    return {
      data_status: 'failed',
      weather_fetch_status: 'failed',
      weather_fetch_attempted: true
    };
  }
  if (pack.ok && !pack.from_cache && !pack.from_defaults) {
    return {
      data_status: 'working',
      weather_fetch_status: 'success',
      weather_fetch_attempted: true
    };
  }
  return {
    data_status: 'failed',
    weather_fetch_status: 'failed',
    weather_fetch_attempted: true
  };
}

async function auditOneStation(s) {
  const checkedAt = new Date().toISOString();
  const stationId = s && s.id != null ? cleanString(String(s.id), 80) || String(s.id) : '';
  const stationName = s ? cleanString(s.name, 120) || '' : '';
  const isRef = !!(s && s.is_reference_station);
  const country = s && s.country != null ? cleanString(s.country, 80) || null : null;
  const region = s && s.region != null ? cleanString(s.region, 80) || null : null;
  const status = s && s.status != null ? cleanString(String(s.status), 20) : 'active';
  const coord = parseCoordStatus(s);
  const { coordinates_status, la, lo } = {
    coordinates_status: coord.coordinates_status,
    la: coord.la,
    lo: coord.lo
  };
  if (coord.coordinates_status !== 'valid') {
    const { data_status, weather_fetch_status, weather_fetch_attempted } = computeDataAndFetchStatus(
      null,
      coord.coordinates_status,
      false
    );
    return {
      station_id: stationId,
      station_name: stationName,
      station_type: isRef ? 'reference' : 'operational',
      status,
      country,
      region,
      lat: la,
      lon: lo,
      coordinates_status: coordinates_status,
      weather_fetch_attempted: weather_fetch_attempted,
      weather_fetch_status: weather_fetch_status,
      failure_reason: mapFailureReason(coord.coordinates_status, null, false),
      api_response_summary: buildApiResponseSummary({}),
      data_status: data_status,
      result_source: 'none',
      last_checked_at: checkedAt
    };
  }

  const forWeather = { id: stationId, name: stationName, lat: la, lon: lo };
  const pack = await getWeatherData(forWeather, '');

  const { data_status, weather_fetch_status, weather_fetch_attempted } = computeDataAndFetchStatus(
    pack,
    'valid',
    true
  );
  var resultSource = 'defaults';
  if (pack && !pack.from_cache && !pack.from_defaults) {
    resultSource = 'live';
  } else if (pack && pack.from_cache) {
    resultSource = 'cache';
  } else if (pack && pack.from_defaults) {
    resultSource = 'defaults';
  }
  return {
    station_id: stationId,
    station_name: stationName,
    station_type: isRef ? 'reference' : 'operational',
    status,
    country,
    region,
    lat: la,
    lon: lo,
    coordinates_status: 'valid',
    weather_fetch_attempted: weather_fetch_attempted,
    weather_fetch_status: weather_fetch_status,
    failure_reason: mapFailureReason('valid', pack, true),
    api_response_summary: buildApiResponseSummary(pack),
    data_status: data_status,
    result_source: resultSource,
    last_checked_at: new Date().toISOString()
  };
}

async function buildWeatherFetchAudit() {
  const raw = await readJsonFile('stations', []);
  const list = Array.isArray(raw) ? raw : [];
  const rows = [];
  var i;
  for (i = 0; i < list.length; i += CONCURRENCY) {
    const chunk = list.slice(i, i + CONCURRENCY);
    const part = await Promise.all(chunk.map((s) => auditOneStation(s)));
    for (var j = 0; j < part.length; j += 1) {
      rows.push(part[j]);
    }
  }

  let working = 0;
  let partial = 0;
  let failed = 0;
  let missCoord = 0;
  let invCoord = 0;
  const reasonMap = {};
  for (i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.coordinates_status === 'missing') missCoord += 1;
    if (r.coordinates_status === 'invalid_format') invCoord += 1;
    if (r.data_status === 'working') working += 1;
    else if (r.data_status === 'partial') partial += 1;
    else failed += 1;
    const fr = r.failure_reason;
    if (fr) {
      reasonMap[fr] = (reasonMap[fr] || 0) + 1;
    }
  }
  const top_failure_reasons = Object.keys(reasonMap)
    .map(function (k) {
      return { reason: k, count: reasonMap[k] };
    })
    .sort(function (a, b) {
      return b.count - a.count;
    });

  return {
    generated_at: new Date().toISOString(),
    audit: 'read_only_no_writes',
    summary: {
      total_stations: rows.length,
      working_stations: working,
      partial_stations: partial,
      failed_stations: failed,
      missing_coordinates_count: missCoord,
      invalid_coordinates_count: invCoord,
      top_failure_reasons: top_failure_reasons
    },
    stations: rows,
    failed_stations_list: rows.filter(function (r) {
      return r.weather_fetch_status === 'failed' || (r.data_status === 'failed' && r.coordinates_status === 'valid');
    }),
    no_coordinates_stations: rows.filter(function (r) {
      return r.coordinates_status === 'missing' || r.coordinates_status === 'invalid_format';
    })
  };
}

module.exports = {
  buildWeatherFetchAudit
};
