'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const PROVIDER_PATH = require.resolve('../serverless_api/_lib/stormglass-tide-provider');
const DATA_STORE_PATH = require.resolve('../serverless_api/_lib/data-store');
const TEST_API_KEY = 'stormglass-unit-test-key';

async function withProvider(run) {
  const previousProviderModule = require.cache[PROVIDER_PATH];
  const previousDataStoreModule = require.cache[DATA_STORE_PATH];
  const previousFetch = globalThis.fetch;
  const hadOwnFetch = Object.prototype.hasOwnProperty.call(globalThis, 'fetch');
  const previousApiKey = process.env.STORMGLASS_API_KEY;
  const hadApiKey = Object.prototype.hasOwnProperty.call(process.env, 'STORMGLASS_API_KEY');
  const previousConsole = {
    debug: console.debug,
    warn: console.warn
  };
  const storageCalls = { reads: [], writes: [] };
  const requests = [];

  const dataStoreStub = {
    readJsonFile: async function (key, fallback) {
      storageCalls.reads.push(key);
      return { version: 1, entries: {} };
    },
    writeJsonFile: async function (key, value) {
      storageCalls.writes.push({ key: key, value: value });
    }
  };

  try {
    process.env.STORMGLASS_API_KEY = TEST_API_KEY;
    console.debug = function () {};
    console.warn = function () {};
    globalThis.fetch = async function (url, options) {
      requests.push({ url: String(url), options: options });
      throw new Error('Unexpected HTTP request in test');
    };

    delete require.cache[PROVIDER_PATH];
    require.cache[DATA_STORE_PATH] = {
      id: DATA_STORE_PATH,
      filename: DATA_STORE_PATH,
      loaded: true,
      exports: dataStoreStub
    };

    const provider = require(PROVIDER_PATH);
    await run({ provider: provider, requests: requests, storageCalls: storageCalls });
  } finally {
    if (previousProviderModule) require.cache[PROVIDER_PATH] = previousProviderModule;
    else delete require.cache[PROVIDER_PATH];

    if (previousDataStoreModule) require.cache[DATA_STORE_PATH] = previousDataStoreModule;
    else delete require.cache[DATA_STORE_PATH];

    if (hadOwnFetch) globalThis.fetch = previousFetch;
    else delete globalThis.fetch;

    if (hadApiKey) process.env.STORMGLASS_API_KEY = previousApiKey;
    else delete process.env.STORMGLASS_API_KEY;

    console.debug = previousConsole.debug;
    console.warn = previousConsole.warn;
  }
}

function mockResponse(status, body, contentType) {
  return {
    status: status,
    ok: status >= 200 && status < 300,
    headers: {
      get: function (name) {
        return name.toLowerCase() === 'content-type' ? contentType || 'application/json' : null;
      }
    },
    text: async function () {
      return body;
    }
  };
}

test('returns normalized tide extremes and sends the documented request shape', async function () {
  await withProvider(async function (context) {
    globalThis.fetch = async function (url, options) {
      context.requests.push({ url: String(url), options: options });
      return mockResponse(200, JSON.stringify({
        data: [
          { time: '2026-10-31T12:00:00+00:00', height: 1.4, type: 'high' },
          { time: '2026-10-31T06:00:00+00:00', height: 0.3, type: 'low' }
        ]
      }));
    };

    const result = await context.provider.getTideData({
      lat: 25.3,
      lng: 51.5,
      date: '2026-10-31',
      station_id: 'test-station'
    });

    assert.equal(result.ok, true);
    assert.equal(result.cached, false);
    assert.equal(result.source, 'stormglass');
    assert.deepEqual(result.timeline.map(function (point) {
      return { time: point.time, height_m: point.height_m, type: point.type };
    }), [
      { time: '2026-10-31T06:00:00+00:00', height_m: 0.3, type: 'جزر' },
      { time: '2026-10-31T12:00:00+00:00', height_m: 1.4, type: 'مد' }
    ]);

    assert.equal(context.requests.length, 1);
    const request = context.requests[0];
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://api.stormglass.io');
    assert.equal(url.pathname, '/v2/tide/extremes/point');
    assert.deepEqual(Array.from(url.searchParams.keys()).sort(), ['end', 'lat', 'lng', 'start']);
    assert.equal(url.searchParams.get('lat'), '25.3');
    assert.equal(url.searchParams.get('lng'), '51.5');
    assert.equal(url.searchParams.get('start'), '2026-10-31T00:00:00+00:00');
    assert.equal(url.searchParams.get('end'), '2026-10-31T23:59:59+00:00');
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.headers.Authorization, TEST_API_KEY);
    assert.equal(context.storageCalls.writes.length, 1);
    assert.equal(context.storageCalls.writes[0].key, 'stormglass_tide_cache_v1');
  });
});

test('reports invalid_json for an HTML 404 response without caching it', async function () {
  await withProvider(async function (context) {
    globalThis.fetch = async function () {
      return mockResponse(404, '<html><body>Not found</body></html>', 'text/html');
    };

    const result = await context.provider.getTideData({
      lat: 25.3,
      lng: 51.5,
      date: '2026-10-31',
      station_id: 'html-404'
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_json');
    assert.equal(context.storageCalls.writes.length, 0);
  });
});

test('reports invalid_json for a successful response with invalid JSON', async function () {
  await withProvider(async function (context) {
    globalThis.fetch = async function () {
      return mockResponse(200, '{not-json');
    };

    const result = await context.provider.getTideData({
      lat: 25.3,
      lng: 51.5,
      date: '2026-10-31',
      station_id: 'invalid-json'
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_json');
    assert.equal(context.storageCalls.writes.length, 0);
  });
});

test('reports empty_extremes for an empty data array', async function () {
  await withProvider(async function (context) {
    globalThis.fetch = async function () {
      return mockResponse(200, JSON.stringify({ data: [] }));
    };

    const result = await context.provider.getTideData({
      lat: 25.3,
      lng: 51.5,
      date: '2026-10-31',
      station_id: 'empty-data'
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'empty_extremes');
    assert.equal(context.storageCalls.writes.length, 0);
  });
});

test('reports empty_extremes when no data item has a valid timestamp', async function () {
  await withProvider(async function (context) {
    globalThis.fetch = async function () {
      return mockResponse(200, JSON.stringify({
        data: [
          { time: 'not-a-date', height: 1.2, type: 'high' },
          { height: 0.4, type: 'low' }
        ]
      }));
    };

    const result = await context.provider.getTideData({
      lat: 25.3,
      lng: 51.5,
      date: '2026-10-31',
      station_id: 'malformed-data'
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'empty_extremes');
    assert.equal(context.storageCalls.writes.length, 0);
  });
});
