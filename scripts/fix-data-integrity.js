'use strict';
/**
 * Data integrity migration script.
 * Fixes:
 *   1. Assigns fishing_mode to all stations missing it
 *   2. Backfills event_type = "analysis_complete" on old tracking records
 *   3. Corrects wrong station_id references in tracking records
 *
 * Run from repo root:
 *   KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/fix-data-integrity.js
 */

var rootDir = require('path').join(__dirname, '..');
process.chdir(rootDir);
var ds = require(require('path').join(rootDir, 'api/_lib/data-store'));

// ---- PART 1: fishing_mode assignment plan ----
// Decision basis:
//   coastal = shallow/enclosed/gulf/protected waters — shore fishing focus
//   deep    = open ocean / Gulf of Oman / Red Sea south / Arabian Sea — offshore focus

var FISHING_MODE_MAP = {
  // Qatar (Gulf — shallow, enclosed)
  st_001: 'coastal',  // الدوحة
  st_002: 'coastal',  // الخور
  st_003: 'coastal',  // الوكرة
  st_004: 'coastal',  // الرويس

  // Kuwait (Gulf — very shallow bay)
  st_005: 'coastal',  // الكويت
  st_006: 'coastal',  // الجهراء

  // Saudi Arabia — Gulf coast (shallow)
  st_007: 'coastal',  // الخبر
  st_008: 'coastal',  // الجبيل
  st_009: 'coastal',  // الدمام
  st_010: 'coastal',  // العقير

  // Saudi Arabia — Red Sea north (sheltered/coastal)
  st_011: 'coastal',  // حقل
  st_012: 'coastal',  // ضبا
  st_013: 'coastal',  // الوجه
  st_014: 'coastal',  // أملج
  st_015: 'coastal',  // ينبع
  st_016: 'coastal',  // رابغ
  st_017: 'coastal',  // جدة

  // Saudi Arabia — Red Sea south (open ocean access — deeper offshore)
  st_018: 'deep',     // الليث
  st_019: 'deep',     // القنفذة
  st_020: 'deep',     // جازان

  // Bahrain (Gulf — shallow)
  st_021: 'coastal',  // المنامة

  // UAE — Gulf side (shallow)
  st_022: 'coastal',  // دبي
  st_023: 'coastal',  // أبوظبي
  st_024: 'coastal',  // الشارقة
  st_025: 'coastal',  // رأس الخيمة
  st_026: 'coastal',  // أم القيوين

  // UAE — Gulf of Oman / Indian Ocean (deep access)
  st_027: 'deep',     // الفجيرة

  // Oman — Arabian Sea / open ocean
  st_028: 'deep',     // مسقط
  st_029: 'coastal',  // صحار (Gulf of Oman coast, protected)
  st_030: 'deep',     // مسندم (خصب) — Strait of Hormuz deep waters
  st_031: 'deep',     // الدقم — Arabian Sea open ocean

  // Iran (Gulf)
  st_032: 'coastal',  // بوشهر

  // Custom station added via admin
  st_mnortx4qnalrt5nq: 'coastal'  // العقير - ساحل القصار
};

// ---- PART 2: tracking station_id corrections ----
// station_id=st_002 with station="العقير - ساحل القصار - المسرح الروماني"
//   → correct station_id is st_mnortx4qnalrt5nq
// station_id=st_009 with station="الجبيل"
//   → correct station_id is st_008

(async function run() {
  console.log('=== Data Integrity Fix ===\n');

  // ---- Fix stations ----
  var stations = await ds.readJsonFile('stations', []);
  console.log('Stations before:', stations.length);

  var stationChanges = 0;
  stations = stations.map(function(s) {
    var newMode = FISHING_MODE_MAP[String(s.id || '')];
    if (!newMode) {
      console.warn('  WARNING: no mode mapping for station', s.id, '—', s.name, '→ defaulting to coastal');
      newMode = 'coastal';
    }
    if (s.fishing_mode !== newMode) {
      console.log('  STATION:', s.id, s.name, '|', JSON.stringify(s.fishing_mode), '→', newMode);
      stationChanges++;
      return Object.assign({}, s, { fishing_mode: newMode });
    }
    return s;
  });
  console.log('\nStation fishing_mode changes:', stationChanges);

  // Detect duplicate IDs
  var idSeen = {};
  var duplicates = [];
  stations.forEach(function(s) {
    if (idSeen[s.id]) duplicates.push(s.id);
    idSeen[s.id] = true;
  });
  if (duplicates.length) {
    console.warn('DUPLICATE station IDs found:', duplicates);
  } else {
    console.log('No duplicate station IDs found. ✓');
  }

  await ds.writeJsonFile('stations', stations);
  console.log('Stations saved to KV. ✓\n');

  // ---- Fix tracking ----
  var tracking = await ds.readJsonFile('tracking', []);
  console.log('Tracking records before:', tracking.length);

  var backfillCount = 0;
  var stationIdFixes = 0;

  tracking = tracking.map(function(r) {
    var updated = Object.assign({}, r);

    // Backfill missing event_type
    if (!updated.event_type && updated.station && updated.country && updated.fishing_mode) {
      updated.event_type = 'analysis_complete';
      backfillCount++;
    }

    // Fix wrong station_id: st_002 used for العقير
    if (String(updated.station_id) === 'st_002' &&
        String(updated.station || '').indexOf('العقير') !== -1) {
      console.log('  FIX station_id: st_002 → st_mnortx4qnalrt5nq for record', updated.id || '?', 'ts:', updated.timestamp);
      updated.station_id = 'st_mnortx4qnalrt5nq';
      stationIdFixes++;
    }

    // Fix wrong station_id: st_009 used for الجبيل
    if (String(updated.station_id) === 'st_009' &&
        String(updated.station || '').trim() === 'الجبيل') {
      console.log('  FIX station_id: st_009 → st_008 for record', updated.id || '?', 'ts:', updated.timestamp);
      updated.station_id = 'st_008';
      stationIdFixes++;
    }

    return updated;
  });

  console.log('\nTracking event_type backfill count:', backfillCount);
  console.log('Tracking station_id fixes:', stationIdFixes);

  await ds.writeJsonFile('tracking', tracking);
  console.log('Tracking saved to KV. ✓\n');

  // ---- Final report ----
  console.log('=== POST-FIX VERIFICATION ===\n');

  var stationsAfter = await ds.readJsonFile('stations', []);
  var missingMode = stationsAfter.filter(function(s){ return !s.fishing_mode; });
  console.log('Stations without fishing_mode:', missingMode.length, missingMode.length === 0 ? '✓' : '✗');
  var modeCount = {};
  stationsAfter.forEach(function(s){ modeCount[s.fishing_mode] = (modeCount[s.fishing_mode]||0)+1; });
  console.log('Mode distribution:', JSON.stringify(modeCount));

  var trackingAfter = await ds.readJsonFile('tracking', []);
  var byEvent = {};
  trackingAfter.forEach(function(r){ var k=r.event_type||'MISSING'; byEvent[k]=(byEvent[k]||0)+1; });
  console.log('\nTracking event_type distribution:', JSON.stringify(byEvent));

  var stMap = {};
  trackingAfter.filter(function(r){return r.event_type==='analysis_complete';}).forEach(function(r){
    var n=r.station||r.station_id||'?';
    stMap[n]=(stMap[n]||0)+1;
  });
  var stTotal=Object.values(stMap).reduce(function(a,b){return a+b;},0);
  console.log('\nTop stations (analysis_complete events, total='+stTotal+'):');
  Object.entries(stMap).sort(function(a,b){return b[1]-a[1];}).slice(0,10).forEach(function(p,i){
    console.log('  '+(i+1)+'. '+p[0]+' | '+p[1]+' ('+(stTotal>0?((p[1]/stTotal)*100).toFixed(1):0)+'%)');
  });

  var cMap = {};
  trackingAfter.forEach(function(r){ if(r.country){ cMap[r.country]=(cMap[r.country]||0)+1; } });
  var cTotal=Object.values(cMap).reduce(function(a,b){return a+b;},0);
  console.log('\nCountry distribution (all events, total='+cTotal+'):');
  Object.entries(cMap).sort(function(a,b){return b[1]-a[1];}).forEach(function(p){
    console.log('  '+p[1]+' ('+(cTotal>0?((p[1]/cTotal)*100).toFixed(1):0)+'%) '+p[0]);
  });

  var mMode={};
  trackingAfter.forEach(function(r){ if(r.fishing_mode){ mMode[r.fishing_mode]=(mMode[r.fishing_mode]||0)+1; } });
  var mTotal=Object.values(mMode).reduce(function(a,b){return a+b;},0);
  console.log('\nFishing mode split (all events, total='+mTotal+'):');
  Object.entries(mMode).sort(function(a,b){return b[1]-a[1];}).forEach(function(p){
    console.log('  '+p[1]+' ('+(mTotal>0?((p[1]/mTotal)*100).toFixed(1):0)+'%) '+p[0]);
  });

  // Funnel using analysis_complete as proxy since old records had no per-step events
  var ac = byEvent.analysis_complete || 0;
  var ss = byEvent.station_select || 0;
  var ms = byEvent.mode_select || 0;
  var cs = byEvent.country_select || 0;
  console.log('\nFunnel (new-style events only):');
  console.log('  country_select:    '+cs);
  console.log('  mode_select:       '+ms);
  console.log('  station_select:    '+ss);
  console.log('  analysis_complete: '+ac+'  (includes '+backfillCount+' backfilled from legacy records)');
  console.log('  Total analyses (ac): '+ac);

  console.log('\n=== Done ===');
})().catch(function(e){ console.error('FATAL:', e.message, e.stack); process.exit(1); });
