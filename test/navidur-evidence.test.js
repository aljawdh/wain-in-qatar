'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../serverless_api/_lib/navidur-evidence-service');
const { createEvidenceHandler } = require('../serverless_api/navidur-evidence-handler');
const fixtures = require('./fixtures/navidur-evidence-fixtures');

const NOW = Date.parse('2026-10-26T01:00:00.000Z');

function makeStorage(snapshots, options) {
  const opts = options || {};
  const byId = new Map(snapshots.map(function (record) {
    return [record.snapshot_id, record];
  }));
  const indexIds = Array.isArray(opts.indexIds)
    ? opts.indexIds.slice()
    : snapshots.map(function (record) { return record.snapshot_id; });
  const rawRecords = opts.rawRecords || {};
  const calls = { lrange: 0, mget: 0, writes: 0, revisions: 0 };
  const storage = {
    lrange: async function (key, start, stop) {
      calls.lrange += 1;
      if (opts.lrangeError) throw opts.lrangeError;
      assert.equal(key, 'navidur_station_snapshot_index');
      if (typeof opts.lrangeResult === 'function') {
        return opts.lrangeResult({ key: key, start: start, stop: stop, call: calls.lrange, indexIds: indexIds });
      }
      return indexIds.slice(start, stop + 1);
    },
    mget: async function () {
      calls.mget += 1;
      if (opts.mgetError) throw opts.mgetError;
      return Array.from(arguments).map(function (key) {
        const id = key.slice('navidur_station_snapshot:'.length);
        if (Object.prototype.hasOwnProperty.call(rawRecords, id)) return rawRecords[id];
        const record = byId.get(id);
        return record ? JSON.stringify(record) : null;
      });
    },
    getIndexRevision: typeof opts.getIndexRevision === 'function'
      ? async function (key) {
        calls.revisions += 1;
        return opts.getIndexRevision({ key: key, call: calls.revisions });
      }
      : undefined,
    get: async function () { throw new Error('unexpected direct storage GET'); },
    set: function () { calls.writes += 1; throw new Error('storage writes prohibited in test'); },
    lpush: function () { calls.writes += 1; throw new Error('storage writes prohibited in test'); },
    ltrim: function () { calls.writes += 1; throw new Error('storage writes prohibited in test'); },
    del: function () { calls.writes += 1; throw new Error('storage writes prohibited in test'); }
  };
  return { storage: storage, calls: calls };
}

function makeResponse() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader: function (key, value) { this.headers[key] = value; },
    status: function (code) { this.statusCode = code; return this; },
    json: function (value) { this.body = value; return this; }
  };
}

test('retrieves exact saved station/date record without invoking analysis', async function () {
  const store = makeStorage(fixtures.SAVED_SNAPSHOTS);
  let analysisCalls = 0;
  const result = await evidence.getSnapshotByStationDate({
    storage: store.storage,
    stationId: 'station-north',
    date: '2026-10-20',
    analysis: function () { analysisCalls += 1; throw new Error('analysis forbidden'); }
  });

  assert.equal(result.found, true);
  assert.equal(result.record.snapshot_id, 'snapshot-north-2026-10-20');
  assert.equal(result.record.analysis_date, '2026-10-20');
  assert.equal(analysisCalls, 0);
  assert.deepEqual(store.calls, { lrange: 1, mget: 1, writes: 0, revisions: 0 });
});

test('missing station/date returns explicit missing result without seeding a key', async function () {
  const store = makeStorage(fixtures.SAVED_SNAPSHOTS);
  const result = await evidence.getSnapshotByStationDate({
    storage: store.storage,
    stationId: 'station-north',
    date: '2026-10-18',
    readJsonFile: function () { throw new Error('seed-capable reader forbidden'); }
  });

  assert.deepEqual(result, { found: false, reason: 'not_found' });
  assert.equal(store.calls.writes, 0);
  assert.equal(store.calls.lrange, 1);
  assert.equal(store.calls.mget, 1);
});

test('scan-limit exhaustion is incomplete, not confirmed missing', async function () {
  const snapshots = fixtures.SAVED_SNAPSHOTS.concat([
    { snapshot_id: 'synthetic-extra-1', station_id: 'other', analysis_date: '2026-01-01' },
    { snapshot_id: 'synthetic-extra-2', station_id: 'other', analysis_date: '2026-01-01' }
  ]);
  const store = makeStorage(snapshots);
  const result = await evidence.getSnapshotByStationDate({
    storage: store.storage,
    stationId: 'station-north',
    date: '2026-10-18',
    scanLimit: 3
  });
  assert.deepEqual(result, { found: false, status: 'incomplete', reason: 'search_limit_reached' });
});

test('dangling index entries and malformed index data are incomplete', async function () {
  const dangling = makeStorage([], { indexIds: ['missing-snapshot-record'] });
  const danglingResult = await evidence.getSnapshotByStationDate({
    storage: dangling.storage,
    stationId: 'station-north',
    date: '2026-10-20'
  });
  assert.deepEqual(danglingResult, { found: false, status: 'incomplete', reason: 'dangling_index_entry' });

  const malformedIndex = makeStorage([], { indexIds: [null] });
  const malformedResult = await evidence.getSnapshotByStationDate({
    storage: malformedIndex.storage,
    stationId: 'station-north',
    date: '2026-10-20'
  });
  assert.deepEqual(malformedResult, { found: false, status: 'incomplete', reason: 'malformed_index_data' });
});

test('malformed snapshot records are incomplete rather than missing', async function () {
  const store = makeStorage([], {
    indexIds: ['bad-json'],
    rawRecords: { 'bad-json': '{not-json' }
  });
  const result = await evidence.getSnapshotByStationDate({
    storage: store.storage,
    stationId: 'station-north',
    date: '2026-10-20'
  });
  assert.deepEqual(result, { found: false, status: 'incomplete', reason: 'malformed_snapshot_record' });
});

test('pagination without a consistency token cannot confirm absence', async function () {
  const snapshots = [];
  for (let i = 0; i < 501; i += 1) {
    snapshots.push({ snapshot_id: 'page-item-' + i, station_id: 'other', analysis_date: '2026-01-01' });
  }
  const store = makeStorage(snapshots);
  const result = await evidence.getSnapshotByStationDate({
    storage: store.storage,
    stationId: 'station-north',
    date: '2026-10-20'
  });
  assert.deepEqual(result, { found: false, status: 'incomplete', reason: 'pagination_consistency_unverified' });
});

test('pagination revision changes are incomplete', async function () {
  const snapshots = [];
  for (let i = 0; i < 501; i += 1) {
    snapshots.push({ snapshot_id: 'revision-item-' + i, station_id: 'other', analysis_date: '2026-01-01' });
  }
  const store = makeStorage(snapshots, {
    getIndexRevision: function (state) { return state.call === 1 ? 'revision-a' : 'revision-b'; }
  });
  const result = await evidence.getSnapshotByStationDate({
    storage: store.storage,
    stationId: 'station-north',
    date: '2026-10-20'
  });
  assert.deepEqual(result, { found: false, status: 'incomplete', reason: 'index_changed_during_scan' });
});

test('pagination detects a changed first page even when revision token is unchanged', async function () {
  const snapshots = [];
  for (let i = 0; i < 501; i += 1) {
    snapshots.push({ snapshot_id: 'mutation-item-' + i, station_id: 'other', analysis_date: '2026-01-01' });
  }
  const store = makeStorage(snapshots, {
    getIndexRevision: function () { return 'same-revision'; },
    lrangeResult: function (state) {
      const ids = state.indexIds.slice(state.start, state.stop + 1);
      if (state.call === 3 && ids.length) ids[0] = 'new-head-record';
      return ids;
    }
  });
  const result = await evidence.getSnapshotByStationDate({
    storage: store.storage,
    stationId: 'station-north',
    date: '2026-10-20'
  });
  assert.deepEqual(result, { found: false, status: 'incomplete', reason: 'index_changed_during_scan' });
});

test('storage read errors remain explicit errors, not confirmed missing', async function () {
  const store = makeStorage([], { lrangeError: new Error('synthetic-read-failure') });
  await assert.rejects(
    evidence.getSnapshotByStationDate({
      storage: store.storage,
      stationId: 'station-north',
      date: '2026-10-20'
    }),
    /synthetic-read-failure/
  );
});

test('duplicate station/date records with conflicting data return conflict', async function () {
  const first = fixtures.SAVED_SNAPSHOTS[0];
  const second = Object.assign({}, first, {
    snapshot_id: 'conflicting-duplicate',
    timestamp: '2026-10-20T12:05:00.000Z',
    observed_marine: { wave_height_m: 2.4 }
  });
  const store = makeStorage([first, second]);
  const result = await evidence.getSnapshotByStationDate({
    storage: store.storage,
    stationId: 'station-north',
    date: '2026-10-20'
  });
  assert.deepEqual(result, { found: false, status: 'conflict', reason: 'duplicate_records_conflict' });
});

test('does not match another station or another historical date', async function () {
  const store = makeStorage(fixtures.SAVED_SNAPSHOTS);
  const wrongStation = await evidence.getSnapshotByStationDate({
    storage: store.storage,
    stationId: 'station-south',
    date: '2026-10-19'
  });
  const wrongDate = await evidence.getSnapshotByStationDate({
    storage: store.storage,
    stationId: 'station-south',
    date: '2026-10-20'
  });
  assert.equal(wrongStation.found, false);
  assert.equal(wrongDate.found, true);
  assert.equal(wrongDate.record.snapshot_id, 'snapshot-south-2026-10-20');
});

test('scans the bounded snapshot index in read-only pages for older saved records', async function () {
  const snapshots = [];
  for (let i = 0; i < 500; i += 1) {
    snapshots.push({
      snapshot_id: 'synthetic-' + i,
      station_id: 'other-station',
      analysis_date: '2026-01-01'
    });

    test('finds saved snapshots beyond the former 20,000-index scan window', async function () {
      const count = 20005;
      const ids = Array.from({ length: count }, function (_unused, index) {
        return 'snapshot-' + index;
      });
      const revision = 'stable-index-revision';
      const storage = {
        lrange: async function (key, start, stop) {
          assert.equal(key, 'navidur_station_snapshot_index');
          return ids.slice(start, stop + 1);
        },
        mget: async function () {
          return Array.from(arguments).map(function (key) {
            const index = Number(key.slice('navidur_station_snapshot:'.length).replace('snapshot-', ''));
            if (index !== 20004) return JSON.stringify({
              snapshot_id: 'snapshot-' + index,
              station_id: 'other-station',
              analysis_date: '2020-01-01',
              observed_weather: {}
            });
            return JSON.stringify({
              snapshot_id: 'snapshot-' + index,
              station_id: 'station-north',
              analysis_date: '2026-10-20',
              observed_weather: { temp_c: 20 }
            });
          });
        },
        getIndexRevision: async function () { return revision; }
      };
      const result = await evidence.getSnapshotByStationDate({
        storage: storage,
        stationId: 'station-north',
        date: '2026-10-20'
      });

      assert.equal(result.found, true);
      assert.equal(result.record.snapshot_id, 'snapshot-20004');
    });
  }
  snapshots.push(fixtures.SAVED_SNAPSHOTS[0]);
  const store = makeStorage(snapshots);
  store.storage.getIndexRevision = async function () { return 'stable-index'; };
  const result = await evidence.getSnapshotByStationDate({
    storage: store.storage,
    stationId: 'station-north',
    date: '2026-10-20'
  });
  assert.equal(result.found, true);
  assert.equal(result.record.snapshot_id, 'snapshot-north-2026-10-20');
  assert.equal(store.calls.lrange, 3);
  assert.equal(store.calls.mget, 2);
  assert.equal(store.calls.writes, 0);
});

test('rejects invalid requests and storage adapters without read methods', async function () {
  await assert.rejects(
    evidence.getSnapshotByStationDate({ storage: {}, stationId: 'station-north', date: '2026-10-20' }),
    /readonly_snapshot_storage_required/
  );
  const store = makeStorage([]);
  await assert.rejects(
    evidence.getSnapshotByStationDate({ storage: store.storage, stationId: '', date: '2026-10-20' }),
    /station_id_invalid/
  );
  await assert.rejects(
    evidence.getSnapshotByStationDate({ storage: store.storage, stationId: 'station-north', date: '2026-02-30' }),
    /date_invalid/
  );
});

test('normalizes forecast, fresh observation, cached, default, stale, and missing data distinctly', function () {
  const context = { nowMs: NOW, staleAfterSeconds: 3600 };
  const forecast = evidence.normalizeEvidenceValue(fixtures.PROVENANCE_CASES.forecast, context);
  const observation = evidence.normalizeEvidenceValue(fixtures.PROVENANCE_CASES.observation, context);
  const cached = evidence.normalizeEvidenceValue(fixtures.PROVENANCE_CASES.cached, context);
  const defaulted = evidence.normalizeEvidenceValue(fixtures.PROVENANCE_CASES.defaulted, context);
  const stale = evidence.normalizeEvidenceValue(fixtures.PROVENANCE_CASES.stale, context);
  const missing = evidence.normalizeEvidenceValue(fixtures.PROVENANCE_CASES.missing, context);

  assert.equal(forecast.measurement_kind, 'forecast');
  assert.equal(forecast.freshness.status, 'fresh');
  assert.equal(forecast.is_current_measurement, false);
  assert.equal(observation.measurement_kind, 'observation');
  assert.equal(observation.is_current_measurement, true);
  assert.equal(cached.availability_status, 'cached');
  assert.equal(cached.provenance.cached, true);
  assert.equal(defaulted.availability_status, 'default');
  assert.equal(defaulted.quality.status, 'degraded');
  assert.equal(stale.freshness.status, 'stale');
  assert.equal(stale.quality.status, 'degraded');
  assert.equal(missing.availability_status, 'missing');
  assert.equal(missing.value, null);
  assert.equal(missing.quality.status, 'unusable');
});

test('invalid measurement values become missing rather than usable evidence', function () {
  const normalized = evidence.normalizeEvidenceValue({
    field: 'wave_height_m',
    value: 'not-a-number',
    measurement_kind: 'observation',
    observed_at: '2026-10-26T00:30:00.000Z'
  }, { nowMs: NOW });
  assert.equal(normalized.value, null);
  assert.equal(normalized.availability_status, 'missing');
  assert.equal(normalized.is_current_measurement, false);
});

test('unknown provenance stays unknown and historical evidence is never current', function () {
  const normalized = evidence.normalizeEvidenceValue(
    fixtures.PROVENANCE_CASES.missingProvenance,
    { nowMs: NOW, historical: true, retrievedAt: '2026-10-26T01:00:00.000Z' }
  );
  assert.equal(normalized.source.provider, 'unknown');
  assert.equal(normalized.measurement_kind, 'unknown');
  assert.equal(normalized.freshness.status, 'unknown');
  assert.equal(normalized.temporal_context, 'historical');
  assert.equal(normalized.is_current_measurement, false);
  assert.equal(normalized.availability_status, 'historical_record');
});

test('cached and unusable observations are never marked current', function () {
  const cached = evidence.normalizeEvidenceValue({
    field: 'temp_c',
    value: 27,
    provider: 'open-meteo',
    dataset: 'open-meteo-weather',
    measurement_kind: 'observation',
    observed_at: '2026-10-26T00:30:00.000Z',
    cached: true
  }, { nowMs: NOW });
  const unusable = evidence.normalizeEvidenceValue({
    field: 'wind_speed_kmh',
    value: 12,
    provider: 'stormglass',
    dataset: 'stormglass-point',
    measurement_kind: 'observation',
    observed_at: '2026-10-26T00:30:00.000Z',
    quality_status: 'unusable'
  }, { nowMs: NOW });
  assert.equal(cached.is_current_measurement, false);
  assert.equal(unusable.is_current_measurement, false);
});

test('does not mark future-dated observations fresh or current', function () {
  const normalized = evidence.normalizeEvidenceValue({
    field: 'temp_c',
    value: 25,
    measurement_kind: 'observation',
    observed_at: '2026-10-26T02:00:00.000Z'
  }, { nowMs: NOW });
  assert.equal(normalized.freshness.status, 'unknown');
  assert.equal(normalized.quality.status, 'degraded');
  assert.equal(normalized.is_current_measurement, false);
});

test('historical bundle applies an explicit allowlist and unknown provenance to legacy snapshots', function () {
  const snapshot = fixtures.SAVED_SNAPSHOTS[0];
  const bundle = evidence.buildHistoricalEvidenceBundle({
    snapshot: snapshot,
    requestedDate: '2026-10-20',
    retrievedAt: '2026-10-26T01:00:00.000Z'
  });
  const serialized = JSON.stringify(bundle);

  assert.equal(bundle.station.station_id, 'station-north');
  assert.equal(bundle.requested_date, '2026-10-20');
  assert.equal(bundle.record.analysis_date, '2026-10-20');
  assert.equal(bundle.analysis_engine.version, 'unknown');
  assert.equal(bundle.evidence[0].source.provider, 'unknown');
  assert.equal(bundle.evidence[0].measurement_kind, 'unknown');
  assert.equal(bundle.evidence[0].temporal_context, 'historical');
  assert.equal(bundle.evidence[0].is_current_measurement, false);
  assert.equal(serialized.includes('must-not-leak'), false);
  assert.equal(serialized.includes('must not appear'), false);
  assert.equal(serialized.includes('synthetic-decoy-never-return'), false);
});

test('historical bundle preserves missing values instead of substituting defaults', function () {
  const snapshot = fixtures.SAVED_SNAPSHOTS[1];
  const bundle = evidence.buildHistoricalEvidenceBundle({
    snapshot: snapshot,
    requestedDate: '2026-10-19'
  });
  const wave = bundle.evidence.find(function (item) { return item.field === 'wave_height_m'; });
  assert.equal(wave.value, null);
  assert.equal(wave.availability_status, 'missing');
  assert.equal(wave.provenance.defaulted, false);
});

test('handler rejects unauthenticated, insufficient-role, and non-GET requests', async function () {
  let serviceCalls = 0;
  const handler = createEvidenceHandler({
    authorize: async function (req) { return req.actor || null; },
    getSnapshot: async function () { serviceCalls += 1; return { found: false }; }
  });

  const unauthenticated = makeResponse();
  await handler({ method: 'GET', query: { station_id: 'station-north', date: '2026-10-20' } }, unauthenticated);
  assert.equal(unauthenticated.statusCode, 401);

  const viewer = makeResponse();
  await handler({
    method: 'GET',
    query: { station_id: 'station-north', date: '2026-10-20' },
    actor: { role: 'viewer' }
  }, viewer);
  assert.equal(viewer.statusCode, 401);

  const post = makeResponse();
  await handler({ method: 'POST', query: {}, actor: { role: 'admin' } }, post);
  assert.equal(post.statusCode, 405);
  assert.equal(serviceCalls, 0);
});

test('handler rejects unknown roles even when explicitly allowed', async function () {
  let storageCalls = 0;
  const handler = createEvidenceHandler({
    authorize: async function () { return { role: 'operator' }; },
    allowedRoles: ['operator'],
    getSnapshot: async function () { storageCalls += 1; return { found: false }; }
  });
  const response = makeResponse();
  await handler({
    method: 'GET',
    query: { station_id: 'station-north', date: '2026-10-20' }
  }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(storageCalls, 0);
});

test('handler validates station and date before storage access', async function () {
  let storageCalls = 0;
  const handler = createEvidenceHandler({
    authorize: async function () { return { role: 'admin' }; },
    getSnapshot: async function () { storageCalls += 1; return { found: false }; }
  });
  const invalidDate = makeResponse();
  await handler({
    method: 'GET',
    query: { station_id: 'station-north', date: '2026-02-30' }
  }, invalidDate);
  assert.equal(invalidDate.statusCode, 400);
  assert.deepEqual(invalidDate.body, { ok: false, error: 'date_invalid' });

  const invalidStation = makeResponse();
  await handler({
    method: 'GET',
    query: { station_id: 'bad station/id', date: '2026-10-20' }
  }, invalidStation);
  assert.equal(invalidStation.statusCode, 400);
  assert.deepEqual(invalidStation.body, { ok: false, error: 'station_id_invalid' });
  assert.equal(storageCalls, 0);
});

test('handler permits only injected authorized admin and returns only service result', async function () {
  const handler = createEvidenceHandler({
    authorize: async function () { return { role: 'admin' }; },
    getSnapshot: async function (request) {
      assert.equal(request.stationId, 'station-north');
      assert.equal(request.date, '2026-10-20');
      return { found: true, record: fixtures.SAVED_SNAPSHOTS[0] };
    },
    now: function () { return '2026-10-26T01:00:00.000Z'; }
  });
  const response = makeResponse();
  await handler({
    method: 'GET',
    query: { station_id: 'station-north', date: '2026-10-20' }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.evidence.found, true);
  assert.equal(response.body.evidence.bundle.record.record_id, 'snapshot-north-2026-10-20');
  assert.equal(response.body.evidence.bundle.evidence[0].is_current_measurement, false);
  assert.equal(JSON.stringify(response.body).includes('synthetic-decoy-never-return'), false);
});

test('handler rejects injected getter results with a mismatched station or date', async function () {
  let storageCalls = 0;
  const handler = createEvidenceHandler({
    authorize: async function () { return { role: 'admin' }; },
    getSnapshot: async function () {
      storageCalls += 1;
      return { found: true, record: fixtures.SAVED_SNAPSHOTS[2] };
    }
  });
  const response = makeResponse();
  await handler({
    method: 'GET',
    query: { station_id: 'station-north', date: '2026-10-20' }
  }, response);
  assert.equal(storageCalls, 1);
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { ok: false, status: 'conflict', reason: 'snapshot_request_mismatch' });
});

test('handler surfaces incomplete retrieval instead of reporting not found', async function () {
  const handler = createEvidenceHandler({
    authorize: async function () { return { role: 'admin' }; },
    getSnapshot: async function () {
      return { found: false, status: 'incomplete', reason: 'search_limit_reached' };
    }
  });
  const response = makeResponse();
  await handler({
    method: 'GET',
    query: { station_id: 'station-north', date: '2026-10-20' }
  }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { ok: false, status: 'incomplete', reason: 'search_limit_reached' });
});

test('handler does not expose arbitrary storage result reasons', async function () {
  const handler = createEvidenceHandler({
    authorize: async function () { return { role: 'admin' }; },
    getSnapshot: async function () {
      return {
        found: false,
        status: 'incomplete',
        reason: 'private-storage-key-or-backend-detail'
      };
    }
  });
  const response = makeResponse();
  await handler({
    method: 'GET',
    query: { station_id: 'station-north', date: '2026-10-20' }
  }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { ok: false, status: 'incomplete', reason: 'search_incomplete' });
});

test('handler reports timestamp/date conflicts explicitly', async function () {
  const handler = createEvidenceHandler({
    authorize: async function () { return { role: 'admin' }; },
    getSnapshot: async function () {
      return {
        found: true,
        record: Object.assign({}, fixtures.SAVED_SNAPSHOTS[0], {
          timestamp: '2026-10-21T00:30:00.000Z'
        })
      };
    }
  });
  const response = makeResponse();
  await handler({
    method: 'GET',
    query: { station_id: 'station-north', date: '2026-10-20' }
  }, response);
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, {
    ok: false,
    status: 'conflict',
    reason: 'snapshot_timestamp_date_conflict'
  });
});

test('ambiguous timestamps remain absent and are disclosed as a limitation', function () {
  const snapshot = Object.assign({}, fixtures.SAVED_SNAPSHOTS[0], {
    timestamp: '2026-10-20T11:55:00'
  });
  const bundle = evidence.buildHistoricalEvidenceBundle({
    snapshot: snapshot,
    stationId: 'station-north',
    requestedDate: '2026-10-20',
    retrievedAt: '2026-10-26T01:00:00.000Z'
  });
  assert.equal(bundle.record.timestamp, null);
  assert.equal(bundle.limitations.includes('saved snapshot timestamp is malformed or timezone-ambiguous'), true);
});

test('handler does not expose backend error details', async function () {
  const handler = createEvidenceHandler({
    authorize: async function () { return { role: 'admin' }; },
    getSnapshot: async function () { throw new Error('synthetic-secret-backend-detail'); }
  });
  const response = makeResponse();
  await handler({
    method: 'GET',
    query: { station_id: 'station-north', date: '2026-10-20' }
  }, response);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { ok: false, error: 'evidence_retrieval_failed' });
  assert.equal(JSON.stringify(response.body).includes('synthetic-secret'), false);
});

test('read path never calls injected write, network, analysis, or learning hooks', async function () {
  const store = makeStorage(fixtures.SAVED_SNAPSHOTS);
  let forbiddenCalls = 0;
  function forbidden() {
    forbiddenCalls += 1;
    throw new Error('forbidden side effect');
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = forbidden;
  try {
    await evidence.getSnapshotByStationDate({
      storage: store.storage,
      stationId: 'station-north',
      date: '2026-10-20'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(forbiddenCalls, 0);
  assert.equal(store.calls.writes, 0);
});
