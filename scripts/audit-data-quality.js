'use strict';
/**
 * NAVIDUR Data Quality Audit Script
 * Runs against https://navidur.app (production)
 * 
 * Tasks covered:
 *   1. End-to-end logging (varied scenarios)
 *   2. Fetch last 10 KV records + inspect fields
 *   3. Data quality report (valid / defective)
 *   4. Dedup behavior test
 *   5. Snapshot consistency test
 *   6. compute-decision → snapshot → payload consistency
 */

const BASE = 'https://navidur.app';
const ORIGIN = 'https://navidur.app';

const STATIONS = [
  { id: 'st_001', name: 'الدوحة', lat: 25.2854, lng: 51.531 },
  { id: 'st_002', name: 'الخور', lat: 25.6804, lng: 51.4968 }
];

const METHODS = ['عراعير', 'قصبة', 'دوالي', 'طراد'];
const SPECIES_LIST = ['كنعد', 'هامور', 'سبيط', 'زبيدي', 'بياح'];

let passed = 0;
let failed = 0;
const issues = [];

function log(msg) { process.stdout.write(msg + '\n'); }
function ok(label) { passed++; log(`  ✓ ${label}`); }
function fail(label, detail) { failed++; issues.push({ label, detail }); log(`  ✗ ${label} — ${detail}`); }
function section(title) { log(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`); }

async function post(path, body, extraHeaders) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(extraHeaders || {}) },
    body: JSON.stringify(body)
  });
  let data;
  try { data = await r.json(); } catch (_) { data = {}; }
  return { status: r.status, data };
}

async function get(path) {
  const r = await fetch(BASE + path, { headers: { Origin: ORIGIN } });
  let data;
  try { data = await r.json(); } catch (_) { data = {}; }
  return { status: r.status, data };
}

// Build a realistic catch log payload simulating client behaviour
function buildPayload(overrides) {
  const base = {
    station_id: 'st_001',
    lat: 25.2854,
    lng: 51.531,
    analysis_timestamp: new Date(Date.now() - Math.floor(Math.random() * 5 * 60 * 1000)).toISOString(),
    prediction_snapshot_id: 'snap_' + Math.random().toString(36).slice(2, 12),
    source: 'public_ui',
    wind_speed: 18.5,
    wind_direction: 135,
    tide_current: 0.42,
    tide_previous: 0.31,
    tide_next: 0.55,
    temperature: 28.2,
    water_state_predicted: 'صاعد',
    tidal_coefficient_predicted: 67,
    activity_score_predicted: 78,
    fishing_mode_predicted: 'فعّال',
    species_predicted: ['كنعد', 'هامور', 'سبيط'],
    compute_source: 'local',
    catch_success: true,
    actual_species: ['كنعد'],
    catch_quantity: 3,
    fishing_method: 'عراعير'
  };
  return { ...base, ...overrides };
}

// ─────────────────────────────────────────────
// SECTION 1: End-to-end logging scenarios
// ─────────────────────────────────────────────

async function testE2EScenarios() {
  section('1 — End-to-end logging scenarios');

  const scenarios = [
    // Basic yes
    { label: 'نعم — صيد ناجح (st_001)', payload: buildPayload({ analysis_timestamp: new Date(Date.now() - 60000).toISOString() }) },
    // No catch
    { label: 'لا — لم أصطد (st_001)', payload: buildPayload({ analysis_timestamp: new Date(Date.now() - 120000).toISOString(), catch_success: false, actual_species: [], catch_quantity: null, fishing_method: null }) },
    // Different station
    { label: 'نعم — محطة st_002', payload: buildPayload({ station_id: 'st_002', lat: 25.6804, lng: 51.4968, station_name: 'الخور', analysis_timestamp: new Date(Date.now() - 180000).toISOString() }) },
    // catch_quantity = 0
    { label: 'نعم — catch_quantity=0', payload: buildPayload({ analysis_timestamp: new Date(Date.now() - 240000).toISOString(), catch_quantity: 0 }) },
    // Multiple species
    { label: 'نعم — actual_species متعددة', payload: buildPayload({ analysis_timestamp: new Date(Date.now() - 300000).toISOString(), actual_species: ['زبيدي', 'بياح', 'سبيط'], catch_quantity: 5 }) },
    // Different method
    { label: 'نعم — fishing_method=قصبة', payload: buildPayload({ analysis_timestamp: new Date(Date.now() - 360000).toISOString(), fishing_method: 'قصبة', catch_quantity: 1 }) },
    // Server compute source
    { label: 'نعم — compute_source=server', payload: buildPayload({ analysis_timestamp: new Date(Date.now() - 420000).toISOString(), compute_source: 'server', water_state_predicted: 'نازل', tidal_coefficient_predicted: 45, activity_score_predicted: 55 }) },
    // No actual species (just method)
    { label: 'نعم — actual_species=[] method=دوالي', payload: buildPayload({ analysis_timestamp: new Date(Date.now() - 480000).toISOString(), actual_species: [], fishing_method: 'دوالي', catch_quantity: 2 }) }
  ];

  const sentIds = [];

  for (const s of scenarios) {
    const { status, data } = await post('/api/log-catch', s.payload);
    if (status === 200 && data.ok && data.id) {
      ok(`${s.label} → id=${data.id}`);
      sentIds.push(data.id);
    } else {
      fail(s.label, `HTTP ${status}: ${JSON.stringify(data)}`);
    }
  }

  return sentIds;
}

// ─────────────────────────────────────────────
// SECTION 2: Fetch and inspect last 10 records
// ─────────────────────────────────────────────

const REQUIRED_FIELDS = [
  'id', 'created_at', 'source',
  'station_id', 'lat', 'lng',
  'analysis_timestamp', 'prediction_snapshot_id',
  'catch_success',
  'species_predicted', 'actual_species',
  'water_state_predicted', 'activity_score_predicted',
  'compute_source',
  'tidal_coefficient_predicted'
];

const NULLABLE_OK = new Set([
  'catch_quantity', 'fishing_method', 'prediction_snapshot_id',
  'water_state_predicted', 'wind_speed', 'wind_direction', 'temperature',
  'tide_current', 'tide_previous', 'tide_next',
  'tidal_coefficient_predicted', 'activity_score_predicted',
  'fishing_mode_predicted',
  'actual_species'  // empty array [] is valid when catch_success=false
]);

async function inspectRecords() {
  section('2 — Inspect last 10 KV records');

  const { status, data } = await get('/api/catch-data');
  if (status !== 200 || !data.ok) {
    fail('fetch /api/catch-data', `HTTP ${status}: ${JSON.stringify(data)}`);
    return [];
  }

  const all = data.logs || [];
  const sample = all.slice(0, 10);
  log(`  Total records in KV: ${all.length}`);
  log(`  Inspecting latest ${sample.length}:`);

  for (let i = 0; i < sample.length; i++) {
    const r = sample[i];
    log(`\n  Record #${i + 1}: id=${r.id || '?'} station=${r.station_id || '?'} success=${r.catch_success}`);
    for (const f of REQUIRED_FIELDS) {
      const val = r[f];
      if (val === undefined) {
        log(`    [MISSING] ${f}`);
      } else if (val === null && !NULLABLE_OK.has(f)) {
        log(`    [NULL-STRICT] ${f}`);
      } else {
        const display = Array.isArray(val) ? JSON.stringify(val) : String(val).slice(0, 50);
        log(`    ${f}: ${display}`);
      }
    }
  }

  return all;
}

// ─────────────────────────────────────────────
// SECTION 3: Data quality check
// ─────────────────────────────────────────────

function checkRecordQuality(r) {
  const problems = [];

  if (!r.station_id) problems.push('station_id missing');
  if (!r.id) problems.push('id missing');
  if (!r.prediction_snapshot_id) problems.push('prediction_snapshot_id missing/null');
  if (!r.analysis_timestamp) problems.push('analysis_timestamp missing');
  if (r.catch_success === undefined || r.catch_success === null) problems.push('catch_success missing');
  if (!Array.isArray(r.species_predicted)) problems.push('species_predicted not array');
  if (!Array.isArray(r.actual_species)) problems.push('actual_species not array');
  if (r.catch_quantity !== null && typeof r.catch_quantity === 'number' && r.catch_quantity < 0) problems.push(`catch_quantity negative: ${r.catch_quantity}`);
  if (r.compute_source && !['local', 'server'].includes(r.compute_source)) problems.push(`compute_source invalid: ${r.compute_source}`);
  // analysis_timestamp should be a valid ISO string
  if (r.analysis_timestamp && isNaN(Date.parse(r.analysis_timestamp))) problems.push('analysis_timestamp not valid ISO');
  // created_at should be valid ISO
  if (r.created_at && isNaN(Date.parse(r.created_at))) problems.push('created_at not valid ISO');
  // species_predicted consistency: if catch_success=true and species_predicted empty, flag warning (not error)
  if (r.catch_success && Array.isArray(r.species_predicted) && r.species_predicted.length === 0) {
    problems.push('WARN:species_predicted empty while catch_success=true');
  }

  return problems;
}

async function runQualityCheck(allRecords) {
  section('3 — Data quality check');

  if (!allRecords || allRecords.length === 0) {
    log('  No records to check (empty dataset).');
    return;
  }

  let clean = 0;
  let defective = 0;
  const defects = [];

  for (const r of allRecords) {
    const problems = checkRecordQuality(r);
    const warnings = problems.filter(p => p.startsWith('WARN:'));
    const errors = problems.filter(p => !p.startsWith('WARN:'));
    if (errors.length === 0) {
      clean++;
    } else {
      defective++;
      defects.push({ id: r.id, station: r.station_id, problems: errors });
    }
    if (warnings.length > 0) {
      log(`  [WARNING] id=${r.id}: ${warnings.map(w => w.replace('WARN:', '')).join(', ')}`);
    }
  }

  log(`\n  Total records:   ${allRecords.length}`);
  log(`  Clean:           ${clean} (${((clean / allRecords.length) * 100).toFixed(1)}%)`);
  log(`  Defective:       ${defective}`);

  if (defective > 0) {
    log('\n  Defect breakdown:');
    for (const d of defects) {
      log(`    id=${d.id} station=${d.station}: ${d.problems.join(' | ')}`);
      fail(`quality: id=${d.id}`, d.problems.join(', '));
    }
  } else {
    ok(`All ${clean} records pass quality check`);
  }

  // Field presence statistics
  const fields = REQUIRED_FIELDS;
  log('\n  Field presence stats (% of records having value):');
  for (const f of fields) {
    const present = allRecords.filter(r => r[f] !== undefined && r[f] !== null && !(Array.isArray(r[f]) && r[f].length === 0 && !NULLABLE_OK.has(f))).length;
    const pct = ((present / allRecords.length) * 100).toFixed(1);
    const warn = parseFloat(pct) < 80 && !NULLABLE_OK.has(f) ? ' ⚠' : '';
    log(`    ${f.padEnd(38)} ${pct}%${warn}`);
  }
}

// ─────────────────────────────────────────────
// SECTION 4: Dedup behavior
// ─────────────────────────────────────────────

async function testDedup() {
  section('4 — Dedup behavior');

  const baseTs = new Date(Date.now() - 600000).toISOString(); // 10 min ago, outside 2-min window
  const freshTs = new Date().toISOString();

  const payloadA = buildPayload({ analysis_timestamp: freshTs, actual_species: ['كنعد'], prediction_snapshot_id: 'snap_dedup_test_1' });

  // First submission — should succeed
  const r1 = await post('/api/log-catch', payloadA);
  if (r1.status === 200 && r1.data.ok) {
    ok('First submission accepted (status 200)');
  } else {
    fail('First submission should be 200', `Got ${r1.status}: ${JSON.stringify(r1.data)}`);
    return;
  }

  // Exact duplicate within 120s — should be rejected
  const payloadDup = { ...payloadA };
  const r2 = await post('/api/log-catch', payloadDup);
  if (r2.status === 409) {
    ok('Duplicate within 120s rejected (status 409) ✓');
  } else {
    fail('Duplicate within 120s should be 409', `Got ${r2.status}: ${JSON.stringify(r2.data)}`);
  }

  // Different actual_species — should NOT be blocked (different fingerprint)
  const payloadDiff = buildPayload({ analysis_timestamp: freshTs, actual_species: ['زبيدي'], prediction_snapshot_id: 'snap_dedup_test_2' });
  const r3 = await post('/api/log-catch', payloadDiff);
  if (r3.status === 200 && r3.data.ok) {
    ok('Different actual_species accepted (different fingerprint) ✓');
  } else {
    fail('Different actual_species should succeed', `Got ${r3.status}: ${JSON.stringify(r3.data)}`);
  }

  // Different catch_success (no catch) — different fingerprint
  const payloadNoCatch = buildPayload({ analysis_timestamp: freshTs, catch_success: false, actual_species: [], catch_quantity: null, fishing_method: null, prediction_snapshot_id: 'snap_dedup_test_3' });
  const r4 = await post('/api/log-catch', payloadNoCatch);
  if (r4.status === 200 && r4.data.ok) {
    ok('catch_success=false with same TS accepted (different fingerprint) ✓');
  } else {
    fail('catch_success=false should succeed', `Got ${r4.status}: ${JSON.stringify(r4.data)}`);
  }
}

// ─────────────────────────────────────────────
// SECTION 5: Snapshot consistency
// ─────────────────────────────────────────────

async function testSnapshotConsistency() {
  section('5 — Snapshot field consistency (server-side validation)');

  // Test: is analysis_timestamp from snapshot preserved exactly?
  const snapTs = '2026-04-10T06:30:00.000Z';
  const snapId = 'snap_consistency_test';
  const payload = buildPayload({
    analysis_timestamp: snapTs,
    prediction_snapshot_id: snapId,
    catch_success: true,
    actual_species: ['هامور'],
    catch_quantity: 2
  });

  const { status, data } = await post('/api/log-catch', payload);
  if (status !== 200 || !data.ok) {
    fail('Snapshot consistency submission', `HTTP ${status}: ${JSON.stringify(data)}`);
    return;
  }

  // Fetch the saved record
  const { status: s2, data: d2 } = await get('/api/catch-data');
  if (s2 !== 200) { fail('fetch records for consistency check', `HTTP ${s2}`); return; }

  const saved = (d2.logs || []).find(r => r.prediction_snapshot_id === snapId);
  if (!saved) {
    fail('Find record by snapshot_id', `record with snap_id=${snapId} not found in last ${d2.logs ? d2.logs.length : 0} records`);
    return;
  }

  // Check analysis_timestamp preserved
  if (saved.analysis_timestamp === snapTs) {
    ok(`analysis_timestamp preserved exactly: ${snapTs}`);
  } else {
    fail('analysis_timestamp preserved', `Expected ${snapTs}, got ${saved.analysis_timestamp}`);
  }

  // Check prediction_snapshot_id preserved
  if (saved.prediction_snapshot_id === snapId) {
    ok(`prediction_snapshot_id preserved: ${snapId}`);
  } else {
    fail('prediction_snapshot_id preserved', `Expected ${snapId}, got ${saved.prediction_snapshot_id}`);
  }

  // Check source field
  if (saved.source === 'public_ui') {
    ok(`source field = 'public_ui'`);
  } else {
    fail('source field', `Expected public_ui, got ${saved.source}`);
  }

  // Check environment fields preserved
  const envFields = ['wind_speed', 'wind_direction', 'tide_current', 'tide_previous', 'tide_next', 'temperature'];
  for (const f of envFields) {
    if (saved[f] !== undefined && saved[f] !== null) {
      ok(`environment field ${f} = ${saved[f]}`);
    } else {
      fail(`environment field ${f}`, `is ${saved[f]}`);
    }
  }
}

// ─────────────────────────────────────────────
// SECTION 6: compute-decision → snapshot → payload consistency
// ─────────────────────────────────────────────

async function testComputeConsistency() {
  section('6 — compute-decision → snapshot → payload consistency');

  // Call compute-decision
  const computePayload = { stationId: 'st_001', lat: 25.2854, lng: 51.531, date: '2026-04-10' };
  const { status: cs, data: cd } = await post('/api/compute-decision', computePayload);
  if (cs !== 200) {
    fail('compute-decision call', `HTTP ${cs}: ${JSON.stringify(cd)}`);
    return;
  }
  log(`  compute-decision response fields: ${Object.keys(cd).join(', ')}`);

  // Simulate snapshot enriched with server result (as client does in tryServerComputeDecision).
  // Note: the field sent to the server is prediction_snapshot_id (not snapshot_id).
  const computeSnapId = 'snap_compute_cons_test';
  const fullPayload = {
    prediction_snapshot_id: computeSnapId,
    station_id: 'st_001',
    lat: 25.2854,
    lng: 51.531,
    analysis_timestamp: new Date(Date.now() - 30000).toISOString(),
    source: 'public_ui',
    wind_speed: 18.5,
    wind_direction: 135,
    tide_current: 0.42,
    tide_previous: 0.31,
    tide_next: 0.55,
    temperature: 28.2,
    compute_source: 'server',
    water_state_predicted: cd.waterState || null,
    tidal_coefficient_predicted: cd.tidalCoefficient != null ? cd.tidalCoefficient : null,
    activity_score_predicted: cd.activityScore != null ? cd.activityScore : null,
    fishing_mode_predicted: cd.mode || null,
    species_predicted: Array.isArray(cd.fish) ? cd.fish.slice(0, 5) : ['كنعد','هامور'],
    catch_success: true,
    actual_species: ['كنعد'],
    catch_quantity: 1,
    fishing_method: 'عراعير'
  };

  const { status: ls, data: ld } = await post('/api/log-catch', fullPayload);
  if (ls !== 200 || !ld.ok) {
    fail('log-catch with server-compute snapshot', `HTTP ${ls}: ${JSON.stringify(ld)}`);
    return;
  }
  ok('log-catch accepted with server compute data');

  // Verify saved record has server fields
  const { status: fs, data: fd } = await get('/api/catch-data');
  const saved = (fd.logs || []).find(r => r.prediction_snapshot_id === computeSnapId);
  if (!saved) { fail('find compute-consistency record', `snap_id=${computeSnapId} not found`); return; }

  if (saved.compute_source === 'server') {
    ok(`compute_source stored as 'server'`);
  } else {
    fail('compute_source', `Expected server, got ${saved.compute_source}`);
  }

  const serverFields = ['water_state_predicted', 'tidal_coefficient_predicted', 'activity_score_predicted'];
  for (const f of serverFields) {
    if (saved[f] !== undefined && saved[f] !== null) {
      ok(`${f} = ${saved[f]}`);
    } else {
      fail(`${f} missing in saved record`, `got ${saved[f]}`);
    }
  }
}

// ─────────────────────────────────────────────
// SECTION 7: Dataset readiness
// ─────────────────────────────────────────────

async function assessDatasetReadiness(allRecords) {
  section('7 — Dataset readiness assessment');

  const n = allRecords.length;
  log(`  Sample size: ${n} records`);
  if (n < 30) {
    log(`\n  ⚠ SAMPLE TOO SMALL FOR STATISTICAL INFERENCE`);
    log(`  Current: ${n} records — need ≥30 for baseline analytics, ≥200 for supervised learning.`);
    log(`  Structural quality check proceeds regardless.`);
  }

  // Features
  const features = [
    'station_id', 'lat', 'lng',
    'analysis_timestamp',
    'wind_speed', 'wind_direction',
    'tide_current', 'tide_previous', 'tide_next',
    'temperature',
    'water_state_predicted', 'tidal_coefficient_predicted',
    'activity_score_predicted', 'fishing_mode_predicted',
    'species_predicted', 'compute_source'
  ];
  // Labels
  const labels = ['catch_success', 'actual_species', 'catch_quantity', 'fishing_method'];

  const featureCoverage = {};
  const labelCoverage = {};

  for (const f of features) {
    const count = allRecords.filter(r => r[f] !== undefined && r[f] !== null && !(Array.isArray(r[f]) && r[f].length === 0)).length;
    featureCoverage[f] = n > 0 ? (count / n * 100).toFixed(1) : '0';
  }
  for (const l of labels) {
    const count = allRecords.filter(r => r[l] !== undefined && r[l] !== null).length;
    labelCoverage[l] = n > 0 ? (count / n * 100).toFixed(1) : '0';
  }

  log('\n  Feature coverage:');
  for (const [f, pct] of Object.entries(featureCoverage)) {
    const flag = parseFloat(pct) < 70 ? ' ⚠ LOW' : '';
    log(`    ${f.padEnd(38)} ${pct}%${flag}`);
  }

  log('\n  Label coverage:');
  for (const [l, pct] of Object.entries(labelCoverage)) {
    const flag = parseFloat(pct) < 70 ? ' ⚠ LOW' : '';
    log(`    ${l.padEnd(38)} ${pct}%${flag}`);
  }

  // Class balance for primary label
  const successCount = allRecords.filter(r => r.catch_success === true).length;
  const failCount = allRecords.filter(r => r.catch_success === false).length;
  log(`\n  catch_success balance: true=${successCount} false=${failCount}${n > 0 ? ` (${(successCount/n*100).toFixed(0)}% positive)` : ''}`);

  // Verdict
  log('\n  ─── VERDICT ───────────────────────────────────────');
  const lowFeatures = Object.entries(featureCoverage).filter(([, pct]) => parseFloat(pct) < 70);
  const lowLabels = Object.entries(labelCoverage).filter(([, pct]) => parseFloat(pct) < 70);

  if (n < 30) {
    log('  Supervised learning:    ✗ NOT READY (insufficient sample size)');
    log('  Baseline analytics:     ✗ NOT READY (insufficient sample size)');
  } else if (lowFeatures.length > 2 || parseFloat(labelCoverage.catch_success) < 90) {
    log('  Supervised learning:    ✗ NOT READY (feature/label gaps)');
    log('  Baseline analytics:     ⚠  PARTIAL (schema ready, gaps in some fields)');
  } else {
    log('  Supervised learning:    ⚠  CONDITIONAL (schema valid, need ≥200 labelled records)');
    log('  Baseline analytics:     ✓ READY (structure and coverage sufficient)');
  }

  if (lowFeatures.length > 0) {
    log(`\n  Features with low coverage (<70%): ${lowFeatures.map(([f]) => f).join(', ')}`);
  }
  if (lowLabels.length > 0) {
    log(`\n  Labels with low coverage (<70%): ${lowLabels.map(([l]) => l).join(', ')}`);
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  log('\n══════════════════════════════════════════════════════════');
  log('  NAVIDUR DATA QUALITY AUDIT — ' + new Date().toISOString());
  log('══════════════════════════════════════════════════════════');

  // 0. Health check first
  section('0 — Storage health check');
  const health = await get('/api/system-storage-health');
  if (health.status === 200 && health.data.ok) {
    ok(`KV healthy: ${JSON.stringify(health.data)}`);
  } else {
    fail('Storage health', `HTTP ${health.status}: ${JSON.stringify(health.data)}`);
    log('  ABORT: KV not healthy — cannot run audit meaningfully.');
    process.exit(1);
  }

  // 1. E2E scenarios
  await testE2EScenarios();

  // 2+3. Fetch + inspect + quality check
  const allRecords = await inspectRecords();
  await runQualityCheck(allRecords);

  // 4. Dedup
  await testDedup();

  // 5. Snapshot consistency
  await testSnapshotConsistency();

  // 6. compute-decision consistency
  await testComputeConsistency();

  // 7. Dataset readiness
  const { data: latestData } = await get('/api/catch-data');
  await assessDatasetReadiness(latestData.logs || []);

  // ─── Final summary ───
  section('8 — Final summary');
  log(`  Checks passed:  ${passed}`);
  log(`  Checks failed:  ${failed}`);
  if (issues.length > 0) {
    log('\n  Issues requiring attention:');
    for (const i of issues) {
      log(`    • ${i.label}: ${i.detail}`);
    }
  } else {
    log('\n  No issues found — system structurally sound.');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
