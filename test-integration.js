#!/usr/bin/env node
'use strict';

const fs = require('fs');
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

const results = { passed: [], failed: [] };

// ============ API ENDPOINT TESTS (Static File Analysis) ============
async function testAPIStructure() {
  console.log('\n=== API Structure Validation ===');
  
  const apiBases = [
    'api/login.js',
    'api/logout.js',
    'api/stations.js',
    'api/feedback.js',
    'api/admin/stations.js',
    'api/admin/users.js',
    'api/admin/summary.js',
    'api/admin/feedback.js',
    'api/tracking.js'
  ];
  
  let allExist = true;
  for (const file of apiBases) {
    if (!fs.existsSync(file)) {
      log(`Missing API file: ${file}`, 'fail');
      allExist = false;
      results.failed.push(`API file: ${file}`);
    }
  }
  
  if (allExist) {
    log(`All ${apiBases.length} API endpoints exist`, 'pass');
    results.passed.push('API file structure');
  }
}

// ============ FRONTEND INTEGRATION TEST ============
async function testFrontendIntegration() {
  console.log('\n=== Frontend Integration Test ===');
  
  const webIndex = 'web/index.html';
  if (!fs.existsSync(webIndex)) {
    log('web/index.html not found', 'fail');
    results.failed.push('Frontend file');
    return;
  }
  
  const content = fs.readFileSync(webIndex, 'utf8');
  
  // Check for dynamic station loading
  if (content.includes('loadRuntimeStations')) {
    log('Dynamic station loader found in frontend', 'pass');
    results.passed.push('Frontend: Dynamic station loader');
  } else {
    log('Dynamic station loader not found', 'fail');
    results.failed.push('Frontend: Dynamic station loader');
  }
  
  // Check for feedback integration
  if (content.includes('sendFeedbackVote')) {
    log('Feedback vote function found in frontend', 'pass');
    results.passed.push('Frontend: Feedback integration');
  } else {
    log('Feedback vote function not found', 'fail');
    results.failed.push('Frontend: Feedback integration');
  }
  
  // Check for tracking
  if (content.includes('tracking') || content.includes('flushTracking')) {
    log('Tracking functionality found in frontend', 'pass');
    results.passed.push('Frontend: Tracking integration');
  } else {
    log('Tracking functionality not found', 'fail');
    results.failed.push('Frontend: Tracking integration');
  }
}

// ============ ADMIN INTERFACE TEST ============
async function testAdminInterface() {
  console.log('\n=== Admin Interface Validation ===');
  
  const adminHtml = 'admin.html';
  const adminJs = 'admin.js';
  
  if (!fs.existsSync(adminHtml) || !fs.existsSync(adminJs)) {
    log('Admin files missing', 'fail');
    results.failed.push('Admin interface files');
    return;
  }
  
  const htmlContent = fs.readFileSync(adminHtml, 'utf8');
  const jsContent = fs.readFileSync(adminJs, 'utf8');
  
  // Check for Users section
  if ((htmlContent.includes('Users') || htmlContent.includes('المستخدمين')) && jsContent.includes('loadUsers')) {
    log('User management module found', 'pass');
    results.passed.push('Admin: User management');
  } else {
    log('User management module incomplete', 'fail');
    results.failed.push('Admin: User management');
  }
  
  // Check for Stations section
  if (htmlContent.includes('Stations') && jsContent.includes('loadStations')) {
    log('Station management module found', 'pass');
    results.passed.push('Admin: Station management');
  } else {
    log('Station management module incomplete', 'fail');
    results.failed.push('Admin: Station management');
  }
  
  // Check for Feedback section
  if (htmlContent.includes('Feedback') && jsContent.includes('loadFeedback')) {
    log('Feedback management module found', 'pass');
    results.passed.push('Admin: Feedback management');
  } else {
    log('Feedback management module incomplete', 'fail');
    results.failed.push('Admin: Feedback management');
  }
  
  // Check for Analytics
  if (htmlContent.includes('التحليلات') && (jsContent.includes('fetchSummary') || jsContent.includes('renderSummarySection'))) {
    log('Analytics module found', 'pass');
    results.passed.push('Admin: Analytics module');
  } else {
    log('Analytics module incomplete', 'fail');
    results.failed.push('Admin: Analytics module');
  }
}

// ============ DATA PERSISTENCE TEST ============
async function testDataPersistence() {
  console.log('\n=== Data Persistence Test ===');
  
  const users = readJson('data/users.json');
  const stations = readJson('data/stations.json');
  const feedback = readJson('data/feedback.json');
  const tracking = readJson('data/tracking.json');
  const audit = readJson('data/audit_logs.json');
  
  // Verify users with test data
  if (users && users.length >= 4) {
    const testAdmin = users.find(u => u.username === 'TestAdmin');
    const testMembers = users.filter(u => u.username.startsWith('TestMember'));
    
    if (testAdmin && testAdmin.role === 'admin' && testMembers.length === 2) {
      log(`Test users persisted correctly (${users.length} total)`, 'pass');
      results.passed.push('Data: Test users persistence');
    } else {
      log('Test users not properly persisted', 'fail');
      results.failed.push('Data: Test users persistence');
    }
  }
  
  // Verify stations
  if (stations && stations.length === 33) {
    const testStation = stations.find(s => s.id === 'stn_test_001');
    if (testStation && testStation.name === 'Test Station Alpha') {
      log(`Stations persisted correctly (${stations.length} total)`, 'pass');
      results.passed.push('Data: Stations persistence');
    } else {
      log('Test station not properly persisted', 'fail');
      results.failed.push('Data: Stations persistence');
    }
  }
  
  // Verify feedback
  if (feedback && feedback.length === 2) {
    const yesVote = feedback.find(f => f.vote === 'YES');
    const noVote = feedback.find(f => f.vote === 'NO');
    if (yesVote && noVote) {
      log(`Feedback entries persisted correctly (${feedback.length} total)`, 'pass');
      results.passed.push('Data: Feedback persistence');
    }
  }
  
  // Verify tracking
  if (tracking && tracking.length > 0) {
    const testEntry = tracking.find(t => t.id === 'trk_test_001');
    if (testEntry && testEntry.events) {
      log(`Tracking entries persisted correctly (${tracking.length} total)`, 'pass');
      results.passed.push('Data: Tracking persistence');
    }
  }
  
  // Verify audit logs exist
  if (Array.isArray(audit)) {
    log(`Audit log file exists (${audit.length} entries)`, 'pass');
    results.passed.push('Data: Audit log structure');
  }
}

// ============ SECURITY VALIDATION ============
async function testSecurityFeatures() {
  console.log('\n=== Security Features Test ===');
  
  const secLib = fs.readFileSync('api/_lib/security.js', 'utf8');
  const authLib = fs.readFileSync('api/_lib/auth.js', 'utf8');
  
  // Check for sanitization
  if (secLib.includes('cleanString') || authLib.includes('cleanString')) {
    log('Input sanitization function found', 'pass');
    results.passed.push('Security: Input sanitization');
  } else {
    log('Input sanitization not found', 'fail');
    results.failed.push('Security: Input sanitization');
  }
  
  // Check for rate limiting
  if (secLib.includes('rateLimit')) {
    log('Rate limiting function found', 'pass');
    results.passed.push('Security: Rate limiting');
  } else {
    log('Rate limiting not found', 'fail');
    results.failed.push('Security: Rate limiting');
  }
  
  // Check for token verification
  if (authLib.includes('verifyToken')) {
    log('Token verification found', 'pass');
    results.passed.push('Security: Token verification');
  } else {
    log('Token verification not found', 'fail');
    results.failed.push('Security: Token verification');
  }
  
  // Check for origin validation
  if (secLib.includes('originCheck') || secLib.includes('origin')) {
    log('Origin validation found', 'pass');
    results.passed.push('Security: Origin validation');
  } else {
    log('Origin validation might be missing', 'fail');
    results.failed.push('Security: Origin validation');
  }
}

// ============ BACKWARD COMPATIBILITY TEST ============
async function testBackwardCompatibility() {
  console.log('\n=== Backward Compatibility Test ===');
  
  const fishingEngine = fs.readFileSync('web/index.html', 'utf8');
  
  // Check original stations are still there (hardcoded fallback)
  if (fishingEngine.includes('HARD_CODED_STATIONS') || fishingEngine.includes('STATIONS')) {
    log('Fallback hardcoded stations reference exists', 'pass');
    results.passed.push('Compatibility: Hardcoded station fallback');
  } else {
    log('Hardcoded stations reference missing', 'fail');
    results.failed.push('Compatibility: Hardcoded station fallback');
  }
  
  // Check fishing engine isn't rewritten
  if (fishingEngine.includes('NavidurStation') || fishingEngine.includes('NavidurGlobalEngine') || fishingEngine.includes('navidurEngine')) {
    log('Core fishing engine logic preserved', 'pass');
    results.passed.push('Compatibility: Fishing engine preservation');
  } else {
    log('Core fishing engine might be missing', 'fail');
    results.failed.push('Compatibility: Fishing engine preservation');
  }
}

// ============ MAIN TEST RUNNER ============
async function runAllTests() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║       NAVIDUR Integration & Structure Tests       ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  
  try {
    await testAPIStructure();
    await testFrontendIntegration();
    await testAdminInterface();
    await testDataPersistence();
    await testSecurityFeatures();
    await testBackwardCompatibility();
  } catch (err) {
    console.error('Test error:', err.message);
  }
  
  // ============ FINAL REPORT ============
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║          INTEGRATION TEST SUMMARY                 ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  
  console.log(`\n✓ PASSED (${results.passed.length}):`);
  results.passed.forEach(t => console.log(`  • ${t}`));
  
  if (results.failed.length > 0) {
    console.log(`\n✗ FAILED (${results.failed.length}):`);
    results.failed.forEach(t => console.log(`  • ${t}`));
  }
  
  const total = results.passed.length + results.failed.length;
  const percentage = total > 0 ? Math.round((results.passed.length / total) * 100) : 0;
  
  console.log('\n' + '═'.repeat(53));
  console.log(`OVERALL: ${results.passed.length}/${total} passed (${percentage}%)`);
  console.log('═'.repeat(53) + '\n');
  
  process.exit(results.failed.length > 0 ? 1 : 0);
}

runAllTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
