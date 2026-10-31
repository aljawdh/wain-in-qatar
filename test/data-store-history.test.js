'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dataStore = require('../serverless_api/_lib/data-store');

function makeIndexedStorage(records) {
  const index = records.map((record) => record.id);
  const byId = new Map(records.map((record) => [record.id, record]));
  const calls = { lrange: 0, mget: 0 };
  return {
    calls: calls,
    kv: {
      lrange: async function (key, start, stop) {
        assert.equal(key, 'history:index');
        calls.lrange += 1;
        return index.slice(start, stop + 1);
      },
      mget: async function () {
        calls.mget += 1;
        return Array.from(arguments).map((key) => JSON.stringify(byId.get(key.slice('history:record:'.length))));
      }
    }
  };
}

test('indexed history pages older than the former 20,000-entry window in newest-first order', async function () {
  const records = Array.from({ length: 20007 }, function (_unused, index) {
    return { id: 'record-' + index, ordinal: index };
  });
  const storage = makeIndexedStorage(records);
  const config = {
    indexKey: 'history:index',
    recordPrefix: 'history:record:',
    idField: 'id'
  };

  const first = await dataStore.getIndexedRecordsPageFromStorage(storage.kv, config, {
    offset: 20000,
    limit: 3
  });
  assert.deepEqual(first.items.map((row) => row.ordinal), [20000, 20001, 20002]);
  assert.equal(first.has_more, true);

  const next = await dataStore.getIndexedRecordsPageFromStorage(storage.kv, config, {
    cursor: first.next_cursor,
    limit: 3
  });
  assert.deepEqual(next.items.map((row) => row.ordinal), [20003, 20004, 20005]);
  assert.equal(next.has_more, true);
  assert.ok(storage.calls.lrange > 40);
});

test('indexed pagination suppresses duplicate IDs and fails closed for a missing cursor', async function () {
  const records = [
    { id: 'a', ordinal: 1 },
    { id: 'b', ordinal: 2 },
    { id: 'b', ordinal: 2 },
    { id: 'c', ordinal: 3 }
  ];
  const storage = makeIndexedStorage(records);
  const config = {
    indexKey: 'history:index',
    recordPrefix: 'history:record:',
    idField: 'id'
  };

  const first = await dataStore.getIndexedRecordsPageFromStorage(storage.kv, config, { limit: 2 });
  assert.deepEqual(first.items.map((row) => row.id), ['a', 'b']);
  const second = await dataStore.getIndexedRecordsPageFromStorage(storage.kv, config, {
    cursor: first.next_cursor,
    limit: 2
  });
  assert.deepEqual(second.items.map((row) => row.id), ['c']);
  await assert.rejects(
    dataStore.getIndexedRecordsPageFromStorage(storage.kv, config, { cursor: 'missing', limit: 2 }),
    /indexed_record_cursor_not_found/
  );
});

test('indexed pagination suppresses duplicate IDs spanning index pages', async function () {
  const records = Array.from({ length: 499 }, function (_unused, index) {
    return { id: 'record-' + index, ordinal: index };
  });
  records.push(
    { id: 'duplicate', ordinal: 499 },
    { id: 'duplicate', ordinal: 499 },
    { id: 'after-duplicate', ordinal: 500 }
  );
  const storage = makeIndexedStorage(records);
  const config = {
    indexKey: 'history:index',
    recordPrefix: 'history:record:',
    idField: 'id'
  };
  const first = await dataStore.getIndexedRecordsPageFromStorage(storage.kv, config, { limit: 500 });
  const next = await dataStore.getIndexedRecordsPageFromStorage(storage.kv, config, {
    cursor: first.next_cursor,
    limit: 10
  });

  assert.equal(first.items.filter((row) => row.id === 'duplicate').length, 1);
  assert.deepEqual(next.items.map((row) => row.id), ['after-duplicate']);
});

test('indexed pagination reports missing record keys as a typed incomplete-history error', async function () {
  const kv = {
    lrange: async function () { return ['missing-record']; },
    mget: async function () { return [null]; }
  };
  await assert.rejects(
    dataStore.getIndexedRecordsPageFromStorage(kv, {
      indexKey: 'history:index',
      recordPrefix: 'history:record:',
      idField: 'id'
    }, { limit: 10 }),
    function (error) {
      assert.equal(error.code, 'indexed_record_missing');
      return true;
    }
  );
});

test('indexed appends keep the record and add its ID without trimming the history index', async function () {
  const calls = [];
  const kv = {
    set: async function (key, value) { calls.push(['set', key, JSON.parse(value)]); },
    lpush: async function (key, value) { calls.push(['lpush', key, value]); },
    ltrim: async function () { calls.push(['ltrim']); }
  };

  await dataStore.appendIndexedRecordToStorage(kv, {
    idField: 'snapshot_id',
    indexKey: 'navidur_station_snapshot_index',
    recordPrefix: 'navidur_station_snapshot:'
  }, { snapshot_id: 'snapshot-old', timestamp: '2020-01-01T00:00:00.000Z' });

  assert.deepEqual(calls, [
    ['set', 'navidur_station_snapshot:snapshot-old', { snapshot_id: 'snapshot-old', timestamp: '2020-01-01T00:00:00.000Z' }],
    ['lpush', 'navidur_station_snapshot_index', 'snapshot-old']
  ]);
});

test('seasonal history filters by status and deduplicates IDs across index pages', async function () {
  const records = Array.from({ length: 499 }, function (_unused, index) {
    return {
      validation_id: 'seasonal-' + index,
      station_id: 'station-1',
      dur_id: 'dur-1',
      date: '2026-10-31',
      verification_status: 'confirmed_mismatch'
    };
  });
  records.push(
    { validation_id: 'failed-duplicate', station_id: 'station-1', dur_id: 'dur-1', date: '2026-10-31', verification_status: 'confirmed_mismatch' },
    { validation_id: 'failed-duplicate', station_id: 'station-1', dur_id: 'dur-1', date: '2026-10-31', verification_status: 'confirmed_mismatch' },
    { validation_id: 'failed-after', station_id: 'station-1', dur_id: 'dur-1', date: '2026-10-31', verification_status: 'confirmed_mismatch' }
  );
  const ids = records.map((record) => record.validation_id);
  const byId = new Map(records.map((record) => [record.validation_id, record]));
  const kv = {
    lrange: async function (key, start, stop) {
      assert.equal(key, 'navidur_seasonal_validation_index');
      return ids.slice(start, stop + 1);
    },
    mget: async function () {
      return Array.from(arguments).map((key) => JSON.stringify(byId.get(key.slice('navidur_seasonal_validation:'.length))));
    }
  };
  const first = await dataStore.getSeasonalValidationHistoryPage({
    stationId: 'station-1',
    durId: 'dur-1',
    date: '2026-10-31',
    status: 'confirmed_mismatch',
    limit: 500
  }, { kv: kv, legacyDoc: { version: 1, entries: [] } });
  const next = await dataStore.getSeasonalValidationHistoryPage({
    stationId: 'station-1',
    durId: 'dur-1',
    date: '2026-10-31',
    status: 'confirmed_mismatch',
    cursor: first.next_cursor,
    limit: 10
  }, { kv: kv, legacyDoc: { version: 1, entries: [] } });

  assert.equal(first.items.filter((row) => row.validation_id === 'failed-duplicate').length, 1);
  assert.equal(first.total, 501);
  assert.deepEqual(next.items.map((row) => row.validation_id), ['failed-after']);
});

test('seasonal history reports missing indexed records as a typed incomplete-history error', async function () {
  const kv = {
    lrange: async function () { return ['missing-seasonal']; },
    mget: async function () { return [null]; }
  };
  await assert.rejects(
    dataStore.getSeasonalValidationHistoryPage({}, {
      kv: kv,
      legacyDoc: { version: 1, entries: [] }
    }),
    function (error) {
      assert.equal(error.code, 'seasonal_history_record_missing');
      return true;
    }
  );
});

test('seasonal history pages include records beyond 2,500 and then legacy-format entries', async function () {
  const records = Array.from({ length: 2507 }, function (_unused, index) {
    return {
      validation_id: 'seasonal-' + index,
      station_id: 'station-1',
      dur_id: 'dur-1',
      date: '2026-10-31',
      year: 2026,
      verification_rule_version: 'expected-range-v1'
    };
  });
  const ids = records.map((record) => record.validation_id);
  const byId = new Map(records.map((record) => [record.validation_id, record]));
  const kv = {
    lrange: async function (key, start, stop) {
      assert.equal(key, 'navidur_seasonal_validation_index');
      return ids.slice(start, stop + 1);
    },
    mget: async function () {
      return Array.from(arguments).map((key) => JSON.stringify(byId.get(key.slice('navidur_seasonal_validation:'.length))));
    }
  };
  const legacyDoc = {
    version: 1,
    entries: [
      {
        validation_id: 'seasonal-0',
        station_id: 'station-1',
        dur_id: 'dur-1',
        date: '2026-10-31',
        year: 2020,
        matched_traits: ['duplicate legacy representation']
      },
      {
        validation_id: 'legacy-old-format',
        station_id: 'station-1',
        dur_id: 'dur-1',
        date: '2026-10-31',
        year: 2024,
        matched_traits: ['legacy-trait']
      }
    ]
  };

  const first = await dataStore.getSeasonalValidationHistoryPage(
    { stationId: 'station-1', durId: 'dur-1', limit: 500 },
    { kv: kv, legacyDoc: legacyDoc }
  );
  assert.equal(first.total, 2508);
  assert.equal(first.items.length, 500);
  assert.equal(first.items[0].validation_id, 'seasonal-0');
  assert.equal(first.items[499].validation_id, 'seasonal-499');
  assert.equal(first.next_cursor, 'seasonal-499');

  const lastIndexed = await dataStore.getSeasonalValidationHistoryPage(
    { stationId: 'station-1', durId: 'dur-1', cursor: 'seasonal-2506', limit: 10 },
    { kv: kv, legacyDoc: legacyDoc }
  );
  assert.deepEqual(lastIndexed.items.map((row) => row.validation_id), ['legacy-old-format']);
  assert.equal(lastIndexed.years.includes(2024), true);
  assert.equal(lastIndexed.has_more, false);
});
