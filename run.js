'use strict';

const { runNavidurV2Pipeline } = require('./server/navidur-v2/pipeline');

const DEFAULT_COORDINATES = {
  lat: 25.2854,
  lon: 51.5310
};

function parseArgs(argv) {
  const out = {
    lat: null,
    lon: null,
    debug: false,
    strictMissingCoordinates: false
  };

  for (const raw of argv) {
    const arg = String(raw || '').trim();
    if (!arg.startsWith('--')) continue;

    const eq = arg.indexOf('=');
    const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const value = eq >= 0 ? arg.slice(eq + 1) : 'true';

    if (key === 'lat') out.lat = toFiniteNumber(value);
    if (key === 'lon' || key === 'lng') out.lon = toFiniteNumber(value);
    if (key === 'debug') out.debug = toBoolean(value);
    if (key === 'strict-missing-coordinates') out.strictMissingCoordinates = toBoolean(value);
  }

  return out;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBoolean(value) {
  const v = String(value || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  const hasLat = parsed.lat != null;
  const hasLon = parsed.lon != null;

  if (parsed.strictMissingCoordinates && (!hasLat || !hasLon)) {
    console.log(
      JSON.stringify(
        {
          status: 'INSUFFICIENT_DATA',
          reason: 'missing_coordinates'
        },
        null,
        2
      )
    );
    process.exitCode = 2;
    return;
  }

  const lat = hasLat ? parsed.lat : DEFAULT_COORDINATES.lat;
  const lon = hasLon ? parsed.lon : DEFAULT_COORDINATES.lon;

  try {
    const result = await runNavidurV2Pipeline(lat, lon, parsed.debug);
    console.log(JSON.stringify(result, null, 2));

    if (result && result.status === 'INSUFFICIENT_DATA') {
      process.exitCode = 2;
    }
  } catch (err) {
    console.log(
      JSON.stringify(
        {
          status: 'NO_DATA_AVAILABLE',
          error: 'PIPELINE_FAILURE',
          message: err && err.message ? err.message : 'unknown_error'
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
}

main();
