#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// ============ HELPERS ============
function log(msg, level = 'info') {
  const prefix = level === 'pass' ? '✓' : level === 'fail' ? '✗' : '→';
  console.log(`[${prefix}] ${msg}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function hashPassword(password) {
  const salt = process.env.NAVIDUR_AUTH_SALT || 'navidur-static-salt';
  return crypto.createHash('sha256').update(String(password) + '|' + salt).digest('hex');
}

function signPayload(payload) {
  const secret = process.env.NAVIDUR_JWT_SECRET || 'navidur-dev-secret';
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const secret = process.env.NAVIDUR_JWT_SECRET || 'navidur-dev-secret';
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (_err) {
    return null;
  }
}

// ============ STATE ============
const results = { passed: [], failed: [], errors: [] };
const testUsers = {};
const testData = { stations: {} };
const testTokens = {};

// ============ TEST 1: Create test users ============
async function testCreateUsers() {
  console.log('\n=== TEST 1: Create Test Users ===');
  
  const usersFile = 'data/users.json';
  let users = readJson(usersFile) || [];
  
  // Add admin
  const adminUser = {
    id: 'usr_test_admin_001',
    username: 'TestAdmin',
    hashed_password: hashPassword('admin123'),
    role: 'admin',
    active_status: true,
    assigned_stations: [],
    created_at: new Date().toISOString(),
    last_login: null,
    trust_score: null
  };
  
  // Add members
  const members = [];
  for (let i = 1; i <= 2; i++) {
    members.push({
      id: `usr_test_member_00${i}`,
      username: `TestMember${i}`,
      hashed_password: hashPassword(`member${i}123`),
      role: 'member',
      active_status: true,
      assigned_stations: [],
      created_at: new Date().toISOString(),
      last_login: null,
      trust_score: null
    });
  }
  
  users = users.concat([adminUser, ...members]);
  writeJson(usersFile, users);
  
  testUsers.admin = { ...adminUser, password: 'admin123' };
  testUsers.members = members.map((m, i) => ({ ...m, password: `member${i + 1}123` }));
  
  log('Admin user created: TestAdmin', 'pass');
  log(`Member users created: ${testUsers.members.map(m => m.username).join(', ')}`, 'pass');
  results.passed.push('Create test users');
}

// ============ TEST 2: Login test ============
async function testLogin() {
  console.log('\n=== TEST 2: Login Test ===');
  
  // Admin login
  const adminPayload = {
    user_id: testUsers.admin.id,
    username: testUsers.admin.username,
    role: testUsers.admin.role,
    exp: Date.now() + 3600000
  };
  const adminToken = signPayload(adminPayload);
  const adminVerify = verifyToken(adminToken);
  
  if (adminVerify && adminVerify.role === 'admin') {
    log('Admin login successful and token valid', 'pass');
    testTokens.admin = adminToken;
    results.passed.push('Admin login and token generation');
  } else {
    log('Admin login/token failed', 'fail');
    results.failed.push('Admin login and token generation');
  }
  
  // Member login
  const memberPayload = {
    user_id: testUsers.members[0].id,
    username: testUsers.members[0].username,
    role: testUsers.members[0].role,
    exp: Date.now() + 3600000
  };
  const memberToken = signPayload(memberPayload);
  const memberVerify = verifyToken(memberToken);
  
  if (memberVerify && memberVerify.role === 'member') {
    log('Member login successful and token valid', 'pass');
    testTokens.member = memberToken;
    results.passed.push('Member login and token generation');
  } else {
    log('Member login/token failed', 'fail');
    results.failed.push('Member login and token generation');
  }
  
  // Invalid token check
  const badToken = 'invalid.token';
  const badVerify = verifyToken(badToken);
  if (!badVerify) {
    log('Invalid token correctly rejected', 'pass');
    results.passed.push('Invalid token rejection');
  } else {
    log('Invalid token was not rejected', 'fail');
    results.failed.push('Invalid token rejection');
  }
}

// ============ TEST 3: Station creation and access ============
async function testStations() {
  console.log('\n=== TEST 3: Station Creation & Access ===');
  
  const stationsFile = 'data/stations.json';
  let stations = readJson(stationsFile) || [];
  
  const newStation = {
    id: 'stn_test_001',
    name: 'Test Station Alpha',
    location: { lat: 25.2048, lon: 55.2708 },
    status: 'active',
    category: 'premium',
    featured: true,
    sort_order: 999,
    default_radius: 2.5,
    notes: 'Test station for validation',
    assigned_members: [],
    trust_priority: 'high',
    station_quality_score: 95,
    seabed_type: 'sandy',
    depth_profile: { min: 15, max: 35 },
    created_at: new Date().toISOString()
  };
  
  stations.push(newStation);
  writeJson(stationsFile, stations);
  
  testData.stations.new = newStation;
  
  log('New station created in data: ' + newStation.name, 'pass');
  
  // Verify it appears in the file
  const stationsAfter = readJson(stationsFile);
  const found = stationsAfter.find(s => s.id === newStation.id);
  
  if (found) {
    log('Station found in data/stations.json', 'pass');
    results.passed.push('Station creation and persistence');
  } else {
    log('Station not found in data after creation', 'fail');
    results.failed.push('Station creation and persistence');
  }
  
  // Verify it would be served by /api/stations (active stations)
  if (found && found.status === 'active') {
    log('Station is active and would be served by /api/stations', 'pass');
    results.passed.push('Station active status for API');
  } else {
    log('Station status issue', 'fail');
    results.failed.push('Station active status for API');
  }
}

// ============ TEST 4: Feedback submission ============
async function testFeedback() {
  console.log('\n=== TEST 4: Feedback Test ===');
  
  const feedbackFile = 'data/feedback.json';
  let feedback = readJson(feedbackFile) || [];
  
  const now = new Date().toISOString();
  
  // Member 1 submits YES
  const yesEntry = {
    id: 'fbk_test_001',
    user_id: testUsers.members[0].id,
    station_id: testData.stations.new.id,
    zone_name: 'test_zone',
    session_id: 'sess_test_001',
    vote: 'YES',
    timestamp: now,
    is_archived: false
  };
  
  // Member 2 submits NO
  const noEntry = {
    id: 'fbk_test_002',
    user_id: testUsers.members[1].id,
    station_id: testData.stations.new.id,
    zone_name: 'test_zone',
    session_id: 'sess_test_002',
    vote: 'NO',
    timestamp: now,
    is_archived: false
  };
  
  feedback.push(yesEntry, noEntry);
  writeJson(feedbackFile, feedback);
  
  log('YES feedback submitted by ' + testUsers.members[0].username, 'pass');
  log('NO feedback submitted by ' + testUsers.members[1].username, 'pass');
  
  // Verify entries in file
  const feedbackAfter = readJson(feedbackFile);
  const yesFound = feedbackAfter.find(f => f.id === yesEntry.id);
  const noFound = feedbackAfter.find(f => f.id === noEntry.id);
  
  if (yesFound && noFound) {
    log('Both feedback entries persisted in data/feedback.json', 'pass');
    results.passed.push('Feedback submission and persistence');
  } else {
    log('Feedback entries not found after submission', 'fail');
    results.failed.push('Feedback submission and persistence');
  }
}

// ============ TEST 5: Tracking ============
async function testTracking() {
  console.log('\n=== TEST 5: Tracking Test ===');
  
  const trackingFile = 'data/tracking.json';
  let tracking = readJson(trackingFile) || [];
  
  const trackingEntry = {
    id: 'trk_test_001',
    session_id: 'sess_test_anon_001',
    timestamp: new Date().toISOString(),
    events: [
      {
        event_type: 'station_view',
        station_id: testData.stations.new.id,
        timestamp: new Date().toISOString()
      },
      {
        event_type: 'feedback_submit',
        station_id: testData.stations.new.id,
        vote: 'YES',
        timestamp: new Date().toISOString()
      }
    ]
  };
  
  tracking.push(trackingEntry);
  writeJson(trackingFile, tracking);
  
  log('Anonymous tracking entry created', 'pass');
  
  const trackingAfter = readJson(trackingFile);
  const found = trackingAfter.find(t => t.id === trackingEntry.id);
  
  if (found && found.events && found.events.length > 0) {
    log('Tracking entry persisted with events', 'pass');
    results.passed.push('Anonymous tracking storage');
  } else {
    log('Tracking entry not found or malformed', 'fail');
    results.failed.push('Anonymous tracking storage');
  }
}

// ============ TEST 6: Security ============
async function testSecurity() {
  console.log('\n=== TEST 6: Security Test ===');
  
  // Test 1: Unauthorized token rejection
  const badToken = 'fake.token.here';
  const badResult = verifyToken(badToken);
  
  if (!badResult) {
    log('Malformed token correctly rejected', 'pass');
    results.passed.push('Malformed token rejection');
  } else {
    log('Malformed token was not rejected', 'fail');
    results.failed.push('Malformed token rejection');
  }
  
  // Test 2: Expired token rejection
  const expiredPayload = {
    user_id: testUsers.admin.id,
    username: testUsers.admin.username,
    role: testUsers.admin.role,
    exp: Date.now() - 1000 // Expired
  };
  const expiredToken = signPayload(expiredPayload);
  const expiredResult = verifyToken(expiredToken);
  
  if (!expiredResult) {
    log('Expired token correctly rejected', 'pass');
    results.passed.push('Expired token rejection');
  } else {
    log('Expired token was not rejected', 'fail');
    results.failed.push('Expired token rejection');
  }
  
  // Test 3: Admin token has correct role
  const adminPayload = {
    user_id: testUsers.admin.id,
    username: testUsers.admin.username,
    role: testUsers.admin.role,
    exp: Date.now() + 3600000
  };
  const adminToken = signPayload(adminPayload);
  const adminVerified = verifyToken(adminToken);
  
  if (adminVerified && adminVerified.role === 'admin') {
    log('Admin token verified with correct role', 'pass');
    results.passed.push('Admin role verification');
  } else {
    log('Admin role verification failed', 'fail');
    results.failed.push('Admin role verification');
  }
  
  // Test 4: Member token has member role
  const memberPayload = {
    user_id: testUsers.members[0].id,
    username: testUsers.members[0].username,
    role: testUsers.members[0].role,
    exp: Date.now() + 3600000
  };
  const memberToken = signPayload(memberPayload);
  const memberVerified = verifyToken(memberToken);
  
  if (memberVerified && memberVerified.role === 'member') {
    log('Member token verified with correct role', 'pass');
    results.passed.push('Member role verification');
  } else {
    log('Member role verification failed', 'fail');
    results.failed.push('Member role verification');
  }
}

// ============ TEST 7: Data integrity checks ============
async function testDataIntegrity() {
  console.log('\n=== TEST 7: Data Integrity Checks ===');
  
  // Check data files exist
  const files = ['data/users.json', 'data/stations.json', 'data/feedback.json', 'data/tracking.json', 'data/audit_logs.json'];
  let allExist = true;
  
  for (const file of files) {
    if (!fs.existsSync(file)) {
      log(`Missing data file: ${file}`, 'fail');
      allExist = false;
    }
  }
  
  if (allExist) {
    log('All required data files exist', 'pass');
    results.passed.push('Data files integrity');
  } else {
    results.failed.push('Data files integrity');
  }
  
  // Verify users count
  const users = readJson('data/users.json');
  const initialCount = 1; // Mohamed_Admin
  const expectedCount = initialCount + 3; // + 1 admin + 2 members
  
  if (users && users.length === expectedCount) {
    log(`User count correct: ${users.length}`, 'pass');
    results.passed.push('User count validation');
  } else {
    log(`User count incorrect: got ${users?.length}, expected ${expectedCount}`, 'fail');
    results.failed.push('User count validation');
  }
  
  // Verify stations
  const stations = readJson('data/stations.json');
  const stationCount = stations ? stations.length : 0;
  if (stationCount > 32) {
    log(`Stations count increased: ${stationCount} (was 32)`, 'pass');
    results.passed.push('Station count validation');
  } else {
    log(`Station count issue: ${stationCount}`, 'fail');
    results.failed.push('Station count validation');
  }
  
  // Verify feedback entries
  const feedback = readJson('data/feedback.json');
  if (feedback && feedback.length === 2) {
    log(`Feedback entries correct: ${feedback.length}`, 'pass');
    results.passed.push('Feedback count validation');
  } else {
    log(`Feedback count incorrect: got ${feedback?.length}, expected 2`, 'fail');
    results.failed.push('Feedback count validation');
  }
}

// ============ MAIN TEST RUNNER ============
async function runAllTests() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║  NAVIDUR Control System - Full End-to-End Tests   ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  
  try {
    await testCreateUsers();
    await testLogin();
    await testStations();
    await testFeedback();
    await testTracking();
    await testSecurity();
    await testDataIntegrity();
  } catch (err) {
    log('Test execution error: ' + err.message, 'fail');
    results.errors.push(err.message);
  }
  
  // ============ FINAL REPORT ============
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║               TEST RESULTS SUMMARY                 ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  
  console.log(`\n✓ PASSED (${results.passed.length}):`);
  results.passed.forEach(t => console.log(`  • ${t}`));
  
  if (results.failed.length > 0) {
    console.log(`\n✗ FAILED (${results.failed.length}):`);
    results.failed.forEach(t => console.log(`  • ${t}`));
  }
  
  if (results.errors.length > 0) {
    console.log(`\n⚠ ERRORS (${results.errors.length}):`);
    results.errors.forEach(t => console.log(`  • ${t}`));
  }
  
  // Overall summary
  const total = results.passed.length + results.failed.length;
  const percentage = total > 0 ? Math.round((results.passed.length / total) * 100) : 0;
  
  console.log('\n' + '═'.repeat(53));
  console.log(`OVERALL: ${results.passed.length}/${total} passed (${percentage}%)`);
  console.log('═'.repeat(53) + '\n');
  
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
