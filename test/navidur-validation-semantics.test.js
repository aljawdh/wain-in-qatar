'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../shared/navidur-snapshot-validation');
const matching = require('../serverless_api/_lib/navidur-durur-trait-matching');
const durIntelligence = require('../serverless_api/_lib/dur-intelligence');
const dataStore = require('../serverless_api/_lib/data-store');
const traitLongTerm = require('../serverless_api/_lib/navidur-trait-long-term');

function dtoFor(traits, environment, tide) {
  return {
    dur: {
      reference: { general_traits: [], weather_traits: traits, marine_traits: [] },
      active_phase_reference: null
    },
    environment: environment || {},
    tide: tide || {}
  };
}

test('complete observation matching an explicit existing rule scores the evaluable denominator', function () {
  const result = validation.buildValidationResult(
    dtoFor(['جو بارد'], { temp_c: 12, measurement_kind: 'observation' }),
    null,
    null
  );
  assert.equal(result.validation_status, 'matched');
  assert.equal(result.validation_score, 100);
  assert.equal(result.evaluable_trait_count, 1);
  assert.equal(result.total_expected_traits, 1);
  assert.deepEqual(result.matched_traits, ['جو بارد']);
});

test('complete observation outside an explicit rule is a confirmed mismatch', function () {
  const result = validation.buildValidationResult(
    dtoFor(['جو بارد'], { temp_c: 29, measurement_kind: 'observation' }),
    null,
    null
  );
  assert.equal(result.validation_status, 'failed');
  assert.equal(result.validation_score, 0);
  assert.equal(result.evaluable_trait_count, 1);
  assert.deepEqual(result.failed_traits, ['جو بارد']);
});

test('missing observations are insufficient evidence and never a confirmed mismatch', function () {
  const result = validation.buildValidationResult(dtoFor(['جو بارد'], {}), null, null);
  assert.equal(result.validation_status, 'insufficient_evidence');
  assert.equal(result.validation_score, null);
  assert.equal(result.evaluable_trait_count, 0);
  assert.deepEqual(result.failed_traits, []);
  assert.deepEqual(result.insufficient_traits, ['جو بارد']);
});

test('explicit null measurements remain missing instead of becoming numeric zero', function () {
  const result = validation.buildValidationResult(
    dtoFor(['جو بارد'], { temp_c: null, measurement_kind: 'observation' }),
    null,
    null
  );
  assert.equal(result.validation_status, 'insufficient_evidence');
  assert.equal(result.validation_score, null);
  assert.deepEqual(result.failed_traits, []);
  assert.deepEqual(result.insufficient_traits, ['جو بارد']);
});

test('model or provider values without explicit observation provenance are not scored', function () {
  const result = validation.buildValidationResult(
    dtoFor(['جو بارد'], { temp_c: 12 }),
    null,
    null
  );
  assert.equal(result.validation_score, null);
  assert.deepEqual(result.failed_traits, []);
  assert.deepEqual(result.insufficient_traits, ['جو بارد']);
});

test('long-term trait learning rejects forecasts and non-evaluable validation records', async function () {
  const record = {
    comparison_mode: 'reference',
    evaluable_trait_count: 1,
    validation_score: 100,
    matched_traits: ['جو بارد']
  };
  const baseContext = {
    reference_bucket_id: 'station-1',
    dur_name_ar: 'winter',
    evidence_meta: { source: 'field' },
    environment: { measurement_kind: 'observation' }
  };

  assert.equal(await traitLongTerm.bumpTraitCyclesFromValidationRecord(record, {
    ...baseContext,
    evidence_meta: { source: 'forecast' }
  }), null);
  assert.equal(await traitLongTerm.bumpTraitCyclesFromValidationRecord(record, {
    ...baseContext,
    environment: { measurement_kind: 'forecast' }
  }), null);
  assert.equal(await traitLongTerm.bumpTraitCyclesFromValidationRecord({
    ...record,
    evaluable_trait_count: 0,
    validation_score: null
  }, baseContext), null);
});

test('heritage traits without an explicit verification rule are reported unsupported', function () {
  const result = validation.buildValidationResult(
    dtoFor(['جو حار وجاف'], { temp_c: 38, measurement_kind: 'observation' }),
    null,
    null
  );
  assert.equal(result.validation_score, null);
  assert.deepEqual(result.unsupported_traits, ['جو حار وجاف']);
  assert.deepEqual(result.failed_traits, []);
});

test('seasonal matcher does not use text overlap or score unsupported traits', function () {
  const result = matching.matchDururTraitsWithMonitoringData({
    frameworkTraits: [
      { id: 'unsupported', trait_name: 'رياح متقلبة', expected_range: {} }
    ],
    openMeteoValues: { windSpeed: 80 },
    measurementKind: 'observation'
  });
  assert.equal(result.trait_match_score, null);
  assert.equal(result.denominator, 0);
  assert.equal(result.unsupported_traits.length, 1);
  assert.equal(result.failed_traits.length, 0);
});

test('seasonal matcher reuses existing explicit heritage validation rules only', function () {
  const trait = { id: 'cold', trait_name: 'جو بارد', expected_range: {} };
  const matched = matching.matchDururTraitsWithMonitoringData({
    frameworkTraits: [trait],
    openMeteoValues: { airTemperature: 12 },
    measurementKind: 'observation'
  });
  assert.equal(matched.trait_match_score, 100);
  assert.equal(matched.matched_traits[0].validation_rule_fields[0], 'temp_c');

  const mismatch = matching.matchDururTraitsWithMonitoringData({
    frameworkTraits: [trait],
    openMeteoValues: { airTemperature: 25 },
    measurementKind: 'observation'
  });
  assert.equal(mismatch.trait_match_score, 0);
  assert.equal(mismatch.failed_traits.length, 1);

  const unsupported = matching.matchDururTraitsWithMonitoringData({
    frameworkTraits: [{ id: 'medium-current', trait_name: 'تيارات متوسطة', expected_range: {} }],
    openMeteoValues: { currentSpeed: 0.6 },
    measurementKind: 'observation'
  });
  assert.equal(unsupported.trait_match_score, null);
  assert.equal(unsupported.unsupported_traits.length, 1);
});

test('heritage validation rules distinguish non-observations, missing measurements, and source conflicts', function () {
  const trait = { id: 'moderate-wind', trait_name: 'رياح متوسطة', expected_range: {} };
  const forecast = matching.matchDururTraitsWithMonitoringData({
    frameworkTraits: [trait],
    openMeteoValues: { windSpeed: 22 },
    measurementKind: 'forecast'
  });
  assert.equal(forecast.insufficient_traits.length, 1);
  assert.equal(forecast.failed_traits.length, 0);
  assert.match(forecast.insufficient_traits[0].diagnostic_ar, /ليست رصدًا ميدانيًا/);

  const missing = matching.matchDururTraitsWithMonitoringData({
    frameworkTraits: [trait],
    openMeteoValues: {},
    measurementKind: 'observation'
  });
  assert.equal(missing.insufficient_traits.length, 1);
  assert.equal(missing.failed_traits.length, 0);

  const conflict = matching.matchDururTraitsWithMonitoringData({
    frameworkTraits: [trait],
    openMeteoValues: { windSpeed: 22 },
    measurementKind: 'observation',
    sourceAgreement: { pairs: [{ key: 'windSpeed', pass: false }] }
  });
  assert.equal(conflict.conflicting_traits.length, 1);
  assert.equal(conflict.failed_traits.length, 0);
  assert.equal(conflict.trait_match_score, null);
});

test('year comparisons are marked partial for cursor, offset, or additional pages', function () {
  assert.deepEqual(matching.getYearComparisonCompleteness({ has_more: false, is_partial: false, offset: 0 }), {
    year_comparison_complete: true,
    year_comparison_status: 'complete'
  });
  [
    { has_more: true, is_partial: true, offset: 0 },
    { has_more: false, is_partial: true, offset: 0 },
    { has_more: false, is_partial: false, offset: 10 }
  ].forEach(function (page) {
    assert.deepEqual(matching.getYearComparisonCompleteness(page), {
      year_comparison_complete: false,
      year_comparison_status: 'partial'
    });
  });
});

test('seasonal range mismatch needs complete, explicitly observed evidence', function () {
  const trait = {
    id: 'wind-range',
    trait_name: 'رياح قوية',
    expected_range: { wind_speed_kmh_min: 30 }
  };
  const observed = matching.matchDururTraitsWithMonitoringData({
    frameworkTraits: [trait],
    openMeteoValues: { windSpeed: 40 },
    measurementKind: 'observation'
  });
  assert.equal(observed.trait_match_score, 100);
  assert.equal(observed.denominator, 1);

  const forecast = matching.matchDururTraitsWithMonitoringData({
    frameworkTraits: [trait],
    openMeteoValues: { windSpeed: 40 },
    measurementKind: 'forecast'
  });
  assert.equal(forecast.trait_match_score, null);
  assert.equal(forecast.insufficient_traits.length, 1);

  const missing = matching.matchDururTraitsWithMonitoringData({
    frameworkTraits: [trait],
    openMeteoValues: {},
    measurementKind: 'observation'
  });
  assert.equal(missing.trait_match_score, null);
  assert.equal(missing.failed_traits.length, 0);
  assert.equal(missing.insufficient_traits.length, 1);
});

test('conflicting source values are excluded from the score denominator', function () {
  const result = matching.matchDururTraitsWithMonitoringData({
    frameworkTraits: [{
      id: 'wind-range',
      trait_name: 'رياح قوية',
      expected_range: { wind_speed_kmh_min: 30 }
    }],
    openMeteoValues: { windSpeed: 40 },
    measurementKind: 'observation',
    sourceAgreement: { pairs: [{ key: 'windSpeed', pass: false }] }
  });
  assert.equal(result.trait_match_score, null);
  assert.equal(result.denominator, 0);
  assert.equal(result.conflicting_traits.length, 1);
  assert.equal(result.failed_traits.length, 0);
});

test('seasonal history deduplicates identical evidence and preserves corrected revisions', async function () {
  let doc = { version: 1, entries: [] };
  const writeJsonFile = async function (key, value) {
    assert.equal(key, 'navidur_seasonal_validation_history');
    doc = JSON.parse(JSON.stringify(value));
  };
  const readJsonFile = async function (key) {
    assert.equal(key, 'navidur_seasonal_validation_history');
    return JSON.parse(JSON.stringify(doc));
  };
  const record = {
    station_id: 'station-1',
    dur_id: 'dur-1',
    date: '2026-10-31',
    verification_rule_version: 'expected-range-v1',
    observation_evidence: { values: { windSpeed: 30 }, measurement_kind: 'observation' },
    expected_traits: [{ id: 'trait-1', expected_range: { wind_speed_kmh_min: 25 } }],
    matched_traits: [{ trait_id: 'trait-1' }]
  };
  const first = await matching.appendSeasonalHistory(readJsonFile, writeJsonFile, record);
  assert.equal(first.duplicate, false);
  assert.equal(first.record.revision_number, 1);
  assert.equal(doc.entries.length, 1);

  const duplicate = await matching.appendSeasonalHistory(readJsonFile, writeJsonFile, Object.assign({}, record, {
    observation_evidence: Object.assign({}, record.observation_evidence, {
      retrieved_at: '2026-10-31T12:05:00.000Z'
    })
  }));
  assert.equal(duplicate.duplicate, true);
  assert.equal(doc.entries.length, 1);

  const corrected = Object.assign({}, record, {
    observation_evidence: { values: { windSpeed: 10 }, measurement_kind: 'observation' },
    failed_traits: [{ trait_id: 'trait-1' }]
  });
  const revision = await matching.appendSeasonalHistory(readJsonFile, writeJsonFile, corrected);
  assert.equal(revision.duplicate, false);
  assert.equal(revision.record.revision_number, 2);
  assert.equal(revision.record.supersedes_validation_id, first.record.validation_id);
  assert.equal(doc.entries.length, 2);
  assert.deepEqual(doc.entries[1].observation_evidence.values, { windSpeed: 30 });
});

test('seasonal deduplication scans paged history beyond the former 2,500-entry limit', async function () {
  const legacyDoc = { version: 1, entries: [] };
  const readJsonFile = async function (key) {
    assert.equal(key, 'navidur_seasonal_validation_history');
    return JSON.parse(JSON.stringify(legacyDoc));
  };
  const writeJsonFile = async function () { throw new Error('indexed seasonal history must not rewrite the legacy document'); };
  const record = {
    station_id: 'station-1',
    dur_id: 'dur-1',
    date: '2026-10-31',
    verification_rule_version: 'expected-range-v1',
    observation_evidence: { values: { windSpeed: 30 }, measurement_kind: 'observation' },
    expected_traits: [{ id: 'trait-1', expected_range: { wind_speed_kmh_min: 25 } }],
    matched_traits: [{ trait_id: 'trait-1' }]
  };
  const pagedRecords = [];
  const byId = new Map();
  let indexReads = 0;
  const kv = {
    lrange: async function (_key, start, stop) {
      indexReads += 1;
      return pagedRecords.slice(start, stop + 1);
    },
    mget: async function () {
      return Array.from(arguments).map((key) => JSON.stringify(byId.get(key.slice('navidur_seasonal_validation:'.length))));
    }
  };
  let appends = 0;
  const historyStore = {
    getSeasonalValidationHistoryPage: function (query) {
      return dataStore.getSeasonalValidationHistoryPage(query, {
        kv: kv,
        legacyDoc: { version: 1, entries: [] }
      });
    },
    appendSeasonalValidationRecord: async function (entry) {
      appends += 1;
      byId.set(entry.validation_id, entry);
      pagedRecords.unshift(entry.validation_id);
    }
  };

  const created = await matching.appendSeasonalHistory(readJsonFile, writeJsonFile, record, historyStore);
  pagedRecords.shift();
  for (let index = 0; index < 2504; index += 1) {
    const revision = {
      station_id: record.station_id,
      dur_id: record.dur_id,
      date: record.date,
      verification_rule_version: record.verification_rule_version,
      validation_id: 'revision-' + index,
      revision_number: 2 + index,
      evidence_signature: 'different-' + index
    };
    byId.set(revision.validation_id, revision);
    pagedRecords.push(revision.validation_id);
  }
  pagedRecords.push(created.record.validation_id);
  appends = 0;
  indexReads = 0;
  const duplicate = await matching.appendSeasonalHistory(readJsonFile, writeJsonFile, record, historyStore);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.record.validation_id, created.record.validation_id);
  assert.equal(appends, 0);
  assert.ok(indexReads >= 6);
});

test('unsupported seasonal traits do not update learned verification evidence', function () {
  const framework = {
    version: 1,
    traits: [{
      id: 'trait-1',
      evidence_count: 0,
      evidence_history: [],
      regions_verified: [],
      regions_failed: [],
      validation_status: 'pending'
    }]
  };
  const updated = matching.updateFrameworkAfterRun(framework, {
    matched_traits: [],
    partial_traits: [],
    failed_traits: [],
    unknown_traits: [{ trait_id: 'trait-1', status: 'unsupported' }]
  }, { id: 'station-1' }, 2026, '2026-10-31', 'region-1');
  assert.equal(updated.traits[0].evidence_count, 0);
  assert.deepEqual(updated.traits[0].evidence_history, []);
});

test('historical summaries exclude insufficient evidence from accuracy and failure denominators', function () {
  const result = durIntelligence.aggregateValidationRecords([
    {
      dur_id: 'dur-1',
      comparison_mode: 'reference',
      validation_score: 100,
      validation_status: 'matched',
      evaluable_trait_count: 1,
      total_expected_traits: 1,
      matched_traits: ['جو بارد'],
      failed_traits: []
    },
    {
      dur_id: 'dur-1',
      comparison_mode: 'reference',
      validation_score: null,
      validation_status: 'insufficient_evidence',
      evaluable_trait_count: 0,
      total_expected_traits: 2,
      matched_traits: [],
      failed_traits: [],
      insufficient_traits: ['رياح قوية']
    }
  ]);
  const summary = result.items.find(function (item) { return item.phase_id == null; });
  assert.equal(summary.total_runs, 2);
  assert.equal(summary.evaluable_runs, 1);
  assert.equal(summary.avg_score, 100);
  assert.equal(summary.success_rate, 100);
  assert.equal(summary.failure_rate, 0);
  assert.equal(summary.evaluable_trait_count, 1);
  assert.equal(summary.total_expected_traits, 3);

  const unavailable = durIntelligence.aggregateValidationRecords([{
    dur_id: 'dur-2',
    comparison_mode: 'reference',
    validation_score: null,
    validation_status: 'insufficient_evidence',
    evaluable_trait_count: 0,
    total_expected_traits: 1
  }]).items[0];
  assert.equal(unavailable.avg_score, null);
  assert.equal(unavailable.success_rate, null);
  assert.equal(unavailable.failure_rate, null);
});

test('historical snapshot filters apply dates, calendar fields, station, region, trait, category and status', function () {
  const record = {
    station_id: 'station-1',
    region_id: 'north',
    analysis_date: '2024-10-31',
    timestamp: '2024-10-31T12:00:00.000Z',
    dur_id: 'dur-1',
    dur_name: 'Dur one',
    verification_status: 'confirmed_mismatch',
    expected_reference_summary: { expected_traits: ['جو بارد'] },
    observed_weather: { temp_c: 29, humidity_pct: 50 },
    observed_marine: { wave_height_m: 1.2, current_speed_ms: 0.4 },
    observed_tide: { height_m: 1.1 }
  };
  assert.equal(dataStore.recordMatchesQuery(record, {
    stationId: 'station-1',
    region: 'north',
    startDate: '2024-10-01',
    endDate: '2024-10-31',
    month: 10,
    year: 2024,
    trait: 'جو بارد',
    category: 'meteorological',
    status: 'confirmed_mismatch'
  }), true);
  assert.equal(dataStore.recordMatchesQuery(record, { category: 'currents' }), true);
  assert.equal(dataStore.recordMatchesQuery(record, { category: 'tides' }), true);
  assert.equal(dataStore.recordMatchesQuery(record, { startDate: '2025-01-01' }), false);
  assert.equal(dataStore.recordMatchesQuery(record, { region: 'south' }), false);
  assert.equal(dataStore.recordMatchesQuery(record, { trait: 'رياح قوية' }), false);
  assert.equal(dataStore.recordMatchesQuery(record, { status: 'matched' }), false);
});
