'use strict';

const config = require('./normalization-config');
const cache = require('./cache');
const {
  assertNotNull,
  assertRecentTimestamp,
  unitToCanonical,
  normalize01,
  isFiniteNumber
} = require('./validators');
const { fetchCopernicus } = require('./connectors/copernicus');
const { fetchNOAA } = require('./connectors/noaa');
const { fetchGEBCO } = require('./connectors/gebco');
const { fetchTidal } = require('./connectors/tidal');

function degDiff(a, b) {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

function alignmentBoost(currentDir, otherDir) {
  if (!isFiniteNumber(currentDir) || !isFiniteNumber(otherDir)) return 0.5;
  const diff = degDiff(currentDir, otherDir);
  if (diff <= 30) return 1.0;
  if (diff <= 75) return 0.8;
  if (diff <= 120) return 0.55;
  return 0.3;
}

function computeCurrentComponent(input) {
  const speedN = input.norm.currentSpeed;
  const aw = alignmentBoost(input.current.direction, input.wind.direction);
  const av = alignmentBoost(input.current.direction, input.wave.direction);
  return Math.max(0, Math.min(1, speedN * ((aw * 0.5) + (av * 0.5))));
}

function computeEnvironmentComponent(input) {
  return Math.max(0, Math.min(1,
    (input.norm.temperature * 0.28) +
    (input.norm.salinity * 0.18) +
    (input.norm.oxygen * 0.34) +
    (input.norm.chlorophyll * 0.20)
  ));
}

function computeTopographyComponent(input) {
  const depthN = input.norm.depth;
  const slopeN = input.norm.slope;
  return Math.max(0, Math.min(1, (depthN * 0.65) + ((1 - slopeN) * 0.35)));
}

function classify(score) {
  if (score >= 75) return 'HIGH_ACTIVITY';
  if (score >= 45) return 'MEDIUM_ACTIVITY';
  return 'LOW_ACTIVITY';
}

function buildCacheKey(lat, lon) {
  return 'navidur:v2:' + Number(lat).toFixed(4) + ':' + Number(lon).toFixed(4);
}

function toUnifiedMarineData(lat, lon, data) {
  return {
    location: { lat, lon },
    timestamp: data.timestamp,
    current: {
      speed: data.current.speed,
      direction: data.current.direction
    },
    wave: {
      height: data.wave.height,
      direction: data.wave.direction
    },
    wind: {
      speed: data.wind.speed,
      direction: data.wind.direction
    },
    environment: {
      temperature: data.environment.temperature,
      salinity: data.environment.salinity,
      oxygen: data.environment.oxygen,
      chlorophyll: data.environment.chlorophyll
    },
    topography: {
      depth: data.topography.depth,
      slope: data.topography.slope,
      seabedStructure: data.topography.seabedStructure
    },
    sources: {
      current: 'NOAA',
      environment: 'Copernicus',
      topography: 'GEBCO',
      tidal: 'ExternalTidalAPI'
    }
  };
}

function normalizeAndValidate(unified, tidal, maxAgeHours) {
  const missing = [];
  const stale = [];

  assertNotNull('current_speed', unified.current.speed, missing);
  assertNotNull('current_direction', unified.current.direction, missing);
  assertNotNull('wave_height', unified.wave.height, missing);
  assertNotNull('wave_direction', unified.wave.direction, missing);
  assertNotNull('wind_speed', unified.wind.speed, missing);
  assertNotNull('wind_direction', unified.wind.direction, missing);

  assertNotNull('temperature', unified.environment.temperature, missing);
  assertNotNull('salinity', unified.environment.salinity, missing);
  assertNotNull('oxygen', unified.environment.oxygen, missing);
  assertNotNull('chlorophyll', unified.environment.chlorophyll, missing);

  assertNotNull('depth', unified.topography.depth, missing);
  assertNotNull('slope', unified.topography.slope, missing);

  assertNotNull('tidal', tidal, missing);

  if (!assertRecentTimestamp(unified.timestamp, maxAgeHours)) stale.push('timestamp');
  if (!assertRecentTimestamp(tidal.timestamp, maxAgeHours)) stale.push('tidal_timestamp');

  if (missing.length || stale.length) {
    return { ok: false, missing: missing.concat(stale) };
  }

  const cv = {
    currentSpeed: unitToCanonical(unified.current.speed, unified.current.speedUnit, config.currentSpeed.unit),
    waveHeight: unitToCanonical(unified.wave.height, unified.wave.heightUnit, config.waveHeight.unit),
    windSpeed: unitToCanonical(unified.wind.speed, unified.wind.speedUnit, config.windSpeed.unit),
    temperature: unitToCanonical(unified.environment.temperature, unified.environment.temperatureUnit, config.temperature.unit),
    salinity: unitToCanonical(unified.environment.salinity, unified.environment.salinityUnit, config.salinity.unit),
    oxygen: unitToCanonical(unified.environment.oxygen, unified.environment.oxygenUnit, config.oxygen.unit),
    chlorophyll: unitToCanonical(unified.environment.chlorophyll, unified.environment.chlorophyllUnit, config.chlorophyll.unit),
    depth: unitToCanonical(unified.topography.depth, unified.topography.depthUnit, config.depth.unit),
    slope: unitToCanonical(unified.topography.slope, unified.topography.slopeUnit, config.slope.unit),
    tidal: unitToCanonical(tidal.value, tidal.unit, config.tidal.unit)
  };

  const badUnits = Object.keys(cv).filter((k) => Number.isNaN(cv[k]));
  if (badUnits.length) {
    return { ok: false, missing: badUnits.map((k) => k + '_unit_inconsistent') };
  }

  const norm = {
    currentSpeed: normalize01(cv.currentSpeed, config.currentSpeed.min, config.currentSpeed.max),
    waveHeight: normalize01(cv.waveHeight, config.waveHeight.min, config.waveHeight.max),
    windSpeed: normalize01(cv.windSpeed, config.windSpeed.min, config.windSpeed.max),
    temperature: normalize01(cv.temperature, config.temperature.min, config.temperature.max),
    salinity: normalize01(cv.salinity, config.salinity.min, config.salinity.max),
    oxygen: normalize01(cv.oxygen, config.oxygen.min, config.oxygen.max),
    chlorophyll: normalize01(cv.chlorophyll, config.chlorophyll.min, config.chlorophyll.max),
    depth: normalize01(cv.depth, config.depth.min, config.depth.max),
    slope: normalize01(cv.slope, config.slope.min, config.slope.max),
    tidal: normalize01(cv.tidal, config.tidal.min, config.tidal.max)
  };

  const nullNorm = Object.keys(norm).filter((k) => norm[k] == null);
  if (nullNorm.length) {
    return { ok: false, missing: nullNorm.map((k) => k + '_normalize_failed') };
  }

  return {
    ok: true,
    canonical: cv,
    norm
  };
}

async function fetchAllSources(lat, lon) {
  const [copernicus, noaa, gebco, tidal] = await Promise.all([
    fetchCopernicus(lat, lon),
    fetchNOAA(lat, lon),
    fetchGEBCO(lat, lon),
    fetchTidal(lat, lon)
  ]);

  return { copernicus, noaa, gebco, tidal };
}

function buildUnifiedFromSources(lat, lon, fetched) {
  if (!fetched.noaa.ok || !fetched.copernicus.ok || !fetched.gebco.ok || !fetched.tidal.ok) {
    const missing = [];
    if (!fetched.noaa.ok) missing.push('noaa_connector');
    if (!fetched.copernicus.ok) missing.push('copernicus_connector');
    if (!fetched.gebco.ok) missing.push('gebco_connector');
    if (!fetched.tidal.ok) missing.push('tidal_connector');
    return { ok: false, missing };
  }

  const n = fetched.noaa;
  const c = fetched.copernicus;
  const g = fetched.gebco;

  const unified = {
    location: { lat, lon },
    timestamp: n.timestamp || c.timestamp || g.timestamp,
    current: {
      speed: n.current.speed.value,
      speedUnit: n.current.speed.unit,
      direction: n.current.direction.value
    },
    wave: {
      height: n.wave.height.value,
      heightUnit: n.wave.height.unit,
      direction: n.wave.direction.value
    },
    wind: {
      speed: n.wind.speed.value,
      speedUnit: n.wind.speed.unit,
      direction: n.wind.direction.value
    },
    environment: {
      temperature: c.environment.temperature.value,
      temperatureUnit: c.environment.temperature.unit,
      salinity: c.environment.salinity.value,
      salinityUnit: c.environment.salinity.unit,
      oxygen: c.environment.oxygen.value,
      oxygenUnit: c.environment.oxygen.unit,
      chlorophyll: c.environment.chlorophyll.value,
      chlorophyllUnit: c.environment.chlorophyll.unit
    },
    topography: {
      depth: g.topography.depth.value,
      depthUnit: g.topography.depth.unit,
      slope: g.topography.slope.value,
      slopeUnit: g.topography.slope.unit,
      seabedStructure: g.topography.seabedStructure
    }
  };

  return {
    ok: true,
    unified,
    tidal: {
      timestamp: fetched.tidal.timestamp,
      value: fetched.tidal.tidalScore.value,
      unit: fetched.tidal.tidalScore.unit
    }
  };
}

async function runNavidurV2Pipeline(lat, lon, debug) {
  const ttlSeconds = 300;
  const key = buildCacheKey(lat, lon);
  const cached = await cache.get(key);
  if (cached) {
    return Object.assign({}, cached, { cache: 'HIT' });
  }

  const fetched = await fetchAllSources(lat, lon);
  const unifiedPack = buildUnifiedFromSources(lat, lon, fetched);
  if (!unifiedPack.ok) {
    return {
      status: 'INSUFFICIENT_DATA',
      missing: unifiedPack.missing,
      cache: 'MISS'
    };
  }

  const validatePack = normalizeAndValidate(unifiedPack.unified, unifiedPack.tidal, 6);
  if (!validatePack.ok) {
    return {
      status: 'INSUFFICIENT_DATA',
      missing: validatePack.missing,
      cache: 'MISS'
    };
  }

  const unified = unifiedPack.unified;
  const tidalNorm = validatePack.norm.tidal;

  const input = {
    current: {
      speed: unified.current.speed,
      direction: unified.current.direction
    },
    wave: {
      height: unified.wave.height,
      direction: unified.wave.direction
    },
    wind: {
      speed: unified.wind.speed,
      direction: unified.wind.direction
    },
    environment: {
      temperature: unified.environment.temperature,
      salinity: unified.environment.salinity,
      oxygen: unified.environment.oxygen,
      chlorophyll: unified.environment.chlorophyll
    },
    topography: {
      depth: unified.topography.depth,
      slope: unified.topography.slope
    },
    norm: validatePack.norm
  };

  const currentComponent = computeCurrentComponent(input);
  const environmentComponent = computeEnvironmentComponent(input);
  const topographyComponent = computeTopographyComponent(input);

  const index01 =
    (0.30 * currentComponent) +
    (0.25 * tidalNorm) +
    (0.25 * environmentComponent) +
    (0.20 * topographyComponent);

  const score = Math.round(Math.max(0, Math.min(1, index01)) * 100);
  const confidence = Number((0.88 + (Math.max(0, Math.min(1, index01)) * 0.1)).toFixed(2));

  const result = {
    NAVIDUR_INDEX: score,
    classification: classify(score),
    confidence: confidence,
    data_quality: 'REAL_VERIFIED',
    status: 'OK',
    marineData: toUnifiedMarineData(lat, lon, {
      timestamp: unified.timestamp,
      current: input.current,
      wave: input.wave,
      wind: input.wind,
      environment: input.environment,
      topography: {
        depth: input.topography.depth,
        slope: input.topography.slope,
        seabedStructure: unified.topography.seabedStructure
      }
    }),
    cache: 'MISS'
  };

  if (debug) {
    result.debug = {
      trace: {
        temperature: input.environment.temperature,
        temp_source: 'Copernicus',
        current_speed: input.current.speed,
        current_source: 'NOAA',
        depth: input.topography.depth,
        depth_source: 'GEBCO',
        tidal_score: unifiedPack.tidal.value,
        tidal_source: 'ExternalTidalAPI'
      },
      normalized: validatePack.norm,
      components: {
        Current: Number(currentComponent.toFixed(4)),
        Tidal: Number(tidalNorm.toFixed(4)),
        Environment: Number(environmentComponent.toFixed(4)),
        Topography: Number(topographyComponent.toFixed(4))
      }
    };
  }

  await cache.set(key, result, ttlSeconds);
  return result;
}

module.exports = {
  runNavidurV2Pipeline
};
