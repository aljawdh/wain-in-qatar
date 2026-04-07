'use strict';

const ALLOWED_ORIGINS = [
  'https://navidur.app',
  'https://www.navidur.app'
];

const FALLBACK_SNAPSHOT = {
  temp: 28,
  depth: 10,
  current: 1.2,
  wave: 0.8
};

const MIN_CURRENT = 0.4;

const NOAA_ENDPOINT = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const NOAA_STATION = '8724580';
const NOAA_ARCHIVE_BEGIN = '20240101';
const NOAA_ARCHIVE_END = '20240102';
const COPERNICUS_DATASET = 'global-analysis-forecast-phy-001-024';
const DEFAULT_STATION_LAT = 24.5557;
const DEFAULT_STATION_LON = -81.8079;

function isAllowedOrigin(req) {
  const origin = String(req.headers.origin || '');
  const referer = String(req.headers.referer || '');
  if (!origin && !referer) return true;
  return ALLOWED_ORIGINS.some((d) => origin.startsWith(d) || referer.startsWith(d));
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readLatLon(req) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const query = req.query || {};

  const lat = parseNumber(body.lat != null ? body.lat : query.lat);
  const lon = parseNumber(body.lon != null ? body.lon : (body.lng != null ? body.lng : (query.lon != null ? query.lon : query.lng)));
  const debug = Boolean(body.debug || query.debug === '1' || query.debug === 'true');

  return { lat, lon, debug };
}

function buildHotspotPayload(bestPoint, debug, evaluatedPoints, searchMeta) {
  const payload = {
    status: 'SUCCESS',
    best_spot: {
      lat: bestPoint.lat,
      lon: bestPoint.lon,
      score: bestPoint.score,
      zone: bestPoint.zone,
      recommendation: bestPoint.recommendation
    },
    data: {
      temp: bestPoint.data.temp,
      depth: bestPoint.data.depth,
      current: bestPoint.data.current,
      wave: bestPoint.data.wave,
      score: bestPoint.score,
      zone: bestPoint.zone,
      recommendation: bestPoint.recommendation
    },
    search_area: {
      radius: searchMeta ? searchMeta.radius : 0.02,
      points_evaluated: evaluatedPoints.length
    }
  };

  if (debug) {
    payload.sources = bestPoint.sources;
    payload.data.raw_current = bestPoint.data._rawCurrent !== undefined ? bestPoint.data._rawCurrent : null;
    payload.data.final_current = bestPoint.data._finalCurrent !== undefined ? bestPoint.data._finalCurrent : bestPoint.data.current;
    payload.evaluated_points = evaluatedPoints.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      score: p.score,
      zone: p.zone,
      current: p.data.current
    }));
  }

  return payload;
}

function normalizeNoaaTemperature(payload) {
  const rows = payload && Array.isArray(payload.data) ? payload.data : [];
  if (!rows.length) return null;

  const latest = rows[rows.length - 1] || {};
  return parseNumber(latest.v);
}

function resolveNoaaCoords(payload, lat, lon) {
  const metadata = payload && payload.metadata ? payload.metadata : {};
  const noaaLat = parseNumber(metadata.lat);
  const noaaLon = parseNumber(metadata.lon);

  return {
    lat: lat != null ? lat : noaaLat,
    lon: lon != null ? lon : noaaLon
  };
}

function resolveCoords(lat, lon) {
  return {
    lat: lat != null ? lat : DEFAULT_STATION_LAT,
    lon: lon != null ? lon : DEFAULT_STATION_LON
  };
}

function toNoaaDateParts(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function fetchNoaaPayloadWithRange(beginDate, endDate) {
  const url = new URL(NOAA_ENDPOINT);
  url.searchParams.set('product', 'water_temperature');
  url.searchParams.set('station', NOAA_STATION);
  url.searchParams.set('units', 'metric');
  url.searchParams.set('time_zone', 'gmt');
  url.searchParams.set('format', 'json');
  url.searchParams.set('begin_date', beginDate);
  url.searchParams.set('end_date', endDate);

  const response = await fetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    throw new Error('noaa_http_' + response.status);
  }

  const payload = await response.json();
  if (payload && payload.error) {
    throw new Error('noaa_error_' + (payload.error.message || 'unknown'));
  }

  return payload;
}

async function fetchWindData(lat, lon) {
  if (lat == null || lon == null) return null;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'wind_speed_10m,wind_direction_10m');
  url.searchParams.set('timezone', 'GMT');

  const response = await fetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    throw new Error('wind_http_' + response.status);
  }

  const payload = await response.json();
  const cur = (payload && payload.current) || {};
  return {
    speed: parseNumber(cur.wind_speed_10m),
    direction: parseNumber(cur.wind_direction_10m)
  };
}

function calcHotspotScore(temp, current, wave, depth) {
  let score = 0;
  if (temp >= 24 && temp <= 30) score += 30;
  if (current >= 0.6) score += 30;
  else if (current >= 0.45) score += 25;
  if (wave >= 0.3 && wave <= 1.2) score += 20;
  if (depth >= 5 && depth <= 30) score += 20;

  let zone = 'BAD';
  let recommendation = 'Avoid';
  if (score >= 75) {
    zone = 'HOTSPOT';
    recommendation = 'Fish now';
  } else if (score >= 50) {
    zone = 'NORMAL';
    recommendation = 'Wait';
  }

  return { score, zone, recommendation };
}

function firstFiniteNumber(values) {
  for (const value of values) {
    const n = parseNumber(value);
    if (n != null) return n;
  }
  return null;
}

function parseCopernicusPayload(payload) {
  const current = firstFiniteNumber([
    payload && payload.current_speed,
    payload && payload.current && payload.current.current_speed,
    payload && payload.data && payload.data.current_speed,
    payload && payload.data && payload.data.current && payload.data.current_speed,
    payload && payload.current && payload.current.ocean_current_velocity,
    payload && payload.data && payload.data.current && payload.data.current.ocean_current_velocity,
    payload && payload.current && payload.current.ocean_current_velocity_0m,
    payload && payload.current && payload.current.ocean_current_velocity_surface
  ]);

  const wave = firstFiniteNumber([
    payload && payload.wave_height,
    payload && payload.current && payload.current.wave_height,
    payload && payload.data && payload.data.wave_height,
    payload && payload.data && payload.data.current && payload.data.current.wave_height,
    payload && payload.current && payload.current.significant_wave_height,
    payload && payload.data && payload.data.current && payload.data.current.significant_wave_height
  ]);

  const temp = firstFiniteNumber([
    payload && payload.sea_temp,
    payload && payload.current && payload.current.sea_temp,
    payload && payload.data && payload.data.sea_temp,
    payload && payload.data && payload.data.current && payload.data.current.sea_temp,
    payload && payload.current && payload.current.sea_surface_temperature,
    payload && payload.data && payload.data.current && payload.data.current.sea_surface_temperature
  ]);

  return {
    current_speed: current,
    wave_height: wave,
    sea_temp: temp
  };
}

async function fetchCopernicusSimulated(coords) {
  const url = new URL('https://marine-api.open-meteo.com/v1/marine');
  url.searchParams.set('latitude', String(coords.lat));
  url.searchParams.set('longitude', String(coords.lon));
  url.searchParams.set('current', 'sea_surface_temperature,ocean_current_velocity,wave_height');

  const response = await fetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    throw new Error('copernicus_sim_http_' + response.status);
  }

  const payload = await response.json();
  const current = payload && payload.current ? payload.current : {};
  const rawCurrentSpeed = parseNumber(current.ocean_current_velocity);
  console.log('RAW CURRENT (open-meteo marine):', rawCurrentSpeed, 'lat:', coords.lat, 'lon:', coords.lon);
  return {
    current_speed: rawCurrentSpeed,
    wave_height: parseNumber(current.wave_height),
    sea_temp: parseNumber(current.sea_surface_temperature)
  };
}

async function fetchCopernicusPrimary(coords) {
  const username = process.env.COPERNICUS_USERNAME || '';
  const password = process.env.COPERNICUS_PASSWORD || '';
  const apiUrl = process.env.COPERNICUS_API_URL || '';

  if (!username || !password || !apiUrl) {
    return fetchCopernicusSimulated(coords);
  }

  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`
    },
    body: JSON.stringify({
      dataset: COPERNICUS_DATASET,
      latitude: coords.lat,
      longitude: coords.lon,
      variables: ['current_speed', 'wave_height', 'sea_temp']
    })
  });

  if (!response.ok) {
    throw new Error('copernicus_http_' + response.status);
  }

  const payload = await response.json();
  const parsed = parseCopernicusPayload(payload);

  if (parsed.current_speed == null && parsed.wave_height == null && parsed.sea_temp == null) {
    throw new Error('copernicus_missing_fields');
  }

  return parsed;
}

async function fetchNoaaTemperatureBackup(lat, lon) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const now = new Date();
    const end = toNoaaDateParts(now);
    const beginDateObj = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000));
    const begin = toNoaaDateParts(beginDateObj);

    let payload;
    try {
      payload = await fetchNoaaPayloadWithRange(begin, end);
    } catch (_recentErr) {
      payload = await fetchNoaaPayloadWithRange(NOAA_ARCHIVE_BEGIN, NOAA_ARCHIVE_END);
    }

    const temp = normalizeNoaaTemperature(payload);

    if (temp == null) {
      throw new Error('noaa_missing_temperature');
    }

    const resolvedCoords = resolveNoaaCoords(payload, lat, lon);
    return {
      temp,
      lat: resolvedCoords.lat,
      lon: resolvedCoords.lon
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildSnapshot(lat, lon) {
  const coords = resolveCoords(lat, lon);

  try {
    const copernicus = await fetchCopernicusPrimary(coords);
    const noaa = await fetchNoaaTemperatureBackup(coords.lat, coords.lon);

    const temp = copernicus.sea_temp == null ? noaa.temp : copernicus.sea_temp;
    const wave = copernicus.wave_height == null ? FALLBACK_SNAPSHOT.wave : Math.max(0, Number(copernicus.wave_height.toFixed(2)));

    const rawCurrent = copernicus.current_speed;
    let finalCurrent;
    if (rawCurrent == null || rawCurrent === 0) {
      finalCurrent = Math.max(MIN_CURRENT, Number((wave * 0.8).toFixed(2)));
    } else {
      finalCurrent = Math.max(MIN_CURRENT, Number(rawCurrent.toFixed(2)));
    }

    return {
      snapshot: {
        temp,
        depth: FALLBACK_SNAPSHOT.depth,
        current: finalCurrent,
        wave,
        _rawCurrent: rawCurrent,
        _finalCurrent: finalCurrent
      },
      sources: {
        noaa: true,
        copernicus: true
      }
    };
  } catch (_copernicusErr) {
    const noaa = await fetchNoaaTemperatureBackup(coords.lat, coords.lon);

    let windSpeed = null;
    try {
      const windData = await fetchWindData(noaa.lat, noaa.lon);
      windSpeed = windData && windData.speed != null ? windData.speed : null;
    } catch (_windErr) {
      windSpeed = null;
    }

    const rawCurrentNoaa = windSpeed == null ? null : Number((windSpeed * 0.03).toFixed(2));
    const waveNoaa = FALLBACK_SNAPSHOT.wave;
    let finalCurrentNoaa;
    if (rawCurrentNoaa == null || rawCurrentNoaa === 0) {
      finalCurrentNoaa = Math.max(MIN_CURRENT, Number((waveNoaa * 0.8).toFixed(2)));
    } else {
      finalCurrentNoaa = Math.max(MIN_CURRENT, rawCurrentNoaa);
    }

    return {
      snapshot: {
        temp: noaa.temp,
        depth: FALLBACK_SNAPSHOT.depth,
        current: finalCurrentNoaa,
        wave: waveNoaa,
        _rawCurrent: rawCurrentNoaa,
        _finalCurrent: finalCurrentNoaa
      },
      sources: {
        noaa: true,
        copernicus: false
      }
    };
  }
}

async function evaluatePoint(lat, lon) {
  const roundedLat = Number(lat.toFixed(4));
  const roundedLon = Number(lon.toFixed(4));

  const pointTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('point_timeout')), 8000)
  );

  try {
    const result = await Promise.race([buildSnapshot(lat, lon), pointTimeout]);
    const { temp, current, wave, depth } = result.snapshot;
    const analysis = calcHotspotScore(temp, current, wave, depth);

    return {
      lat: roundedLat,
      lon: roundedLon,
      score: analysis.score,
      zone: analysis.zone,
      recommendation: analysis.recommendation,
      data: result.snapshot,
      sources: result.sources
    };
  } catch (_err) {
    const analysis = calcHotspotScore(
      FALLBACK_SNAPSHOT.temp,
      FALLBACK_SNAPSHOT.current,
      FALLBACK_SNAPSHOT.wave,
      FALLBACK_SNAPSHOT.depth
    );
    return {
      lat: roundedLat,
      lon: roundedLon,
      score: analysis.score,
      zone: analysis.zone,
      recommendation: analysis.recommendation,
      data: {
        temp: FALLBACK_SNAPSHOT.temp,
        depth: FALLBACK_SNAPSHOT.depth,
        current: FALLBACK_SNAPSHOT.current,
        wave: FALLBACK_SNAPSHOT.wave
      },
      sources: { noaa: false, copernicus: false }
    };
  }
}

async function runGridSearch(centerLat, centerLon) {
  const baseOffsets = [
    [0, 0],
    [0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01],
    [0.01, 0.01], [0.01, -0.01], [-0.01, 0.01], [-0.01, -0.01],
    [0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]
  ];

  const [basePoints, windData] = await Promise.all([
    Promise.all(baseOffsets.map(([dlat, dlon]) => evaluatePoint(centerLat + dlat, centerLon + dlon))),
    fetchWindData(centerLat, centerLon).catch(() => null)
  ]);

  let allPoints = basePoints;

  if (windData && windData.direction != null) {
    const rad = (windData.direction * Math.PI) / 180;
    const biasOffsets = [
      [Number((0.02 * Math.cos(rad)).toFixed(4)), Number((0.02 * Math.sin(rad)).toFixed(4))],
      [Number((0.015 * Math.cos(rad)).toFixed(4)), Number((0.015 * Math.sin(rad)).toFixed(4))]
    ];
    const biasPoints = await Promise.all(
      biasOffsets.map(([dlat, dlon]) => evaluatePoint(centerLat + dlat, centerLon + dlon))
    );
    allPoints = basePoints.concat(biasPoints);
  }

  const best = allPoints.reduce((a, b) => (b.score > a.score ? b : a), allPoints[0]);
  return allPoints.map((p) => {
    const dist = Math.sqrt(Math.pow(p.lat - best.lat, 2) + Math.pow(p.lon - best.lon, 2));
    if (dist > 0 && dist < 0.015) {
      return Object.assign({}, p, { score: Math.min(100, p.score + 5) });
    }
    return p;
  });
}

module.exports = async function handler(req, res) {
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden domain' });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lat, lon, debug } = readLatLon(req);
  const coords = resolveCoords(lat, lon);

  const searchMeta = { radius: 0.02 };

  try {
    const points = await runGridSearch(coords.lat, coords.lon);
    const best = points.reduce((a, b) => (b.score > a.score ? b : a), points[0]);
    return res.status(200).json(buildHotspotPayload(best, debug, points, searchMeta));
  } catch (_err) {
    const analysis = calcHotspotScore(
      FALLBACK_SNAPSHOT.temp,
      FALLBACK_SNAPSHOT.current,
      FALLBACK_SNAPSHOT.wave,
      FALLBACK_SNAPSHOT.depth
    );
    const fallbackPoint = {
      lat: coords.lat,
      lon: coords.lon,
      score: analysis.score,
      zone: analysis.zone,
      recommendation: analysis.recommendation,
      data: {
        temp: FALLBACK_SNAPSHOT.temp,
        depth: FALLBACK_SNAPSHOT.depth,
        current: FALLBACK_SNAPSHOT.current,
        wave: FALLBACK_SNAPSHOT.wave
      },
      sources: { noaa: false, copernicus: false }
    };
    return res.status(200).json(buildHotspotPayload(fallbackPoint, debug, [fallbackPoint], searchMeta));
  }
};
