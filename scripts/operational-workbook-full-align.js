#!/usr/bin/env node
/**
 * Full operational workbook alignment (see script header in repo docs).
 * Does not modify the xlsx. Does not enable operational-station inheritance.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { readJsonFile, writeJsonFile, getKv } = require('../serverless_api/_lib/data-store');
const wb = require('../shared/workbook-dur-lookup');
const { getResolvedLocalDurSnapshot } = require('../shared/resolved-station-dur-snapshot');
const { verifyOperDoc, OUT_PATH } = require('./rebuild-dur-windows-from-operational-xlsx.js');

const REPO = path.join(__dirname, '..');
const ALIGN_REPORT = path.join(REPO, 'data', 'workbook_full_alignment_report.json');
const REBUILD_SCRIPT = path.join(__dirname, 'rebuild-dur-windows-from-operational-xlsx.js');
const AS_OF = new Date().toISOString().slice(0, 10);

function nfc(s) {
  var t = String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  try {
    return t.normalize('NFC');
  } catch (_e) {
    return t;
  }
}

function isManualMapping(st) {
  var m = String(st.workbook_match_mode || '').toLowerCase();
  var a = String(st.workbook_assignment_status || '').toLowerCase();
  return m === 'manual' && a === 'manual_confirmed';
}

function exactWorkbookMatch(station, catalog) {
  if (isManualMapping(station)) {
    var mk = station.workbook_city_key && wb.normalizeWorkbookCityKey(String(station.workbook_city_key));
    if (mk && catalog[mk]) {
      return { kind: 'preserve_manual', key: mk, canonical: catalog[mk] };
    }
    return { kind: 'manual_orphan' };
  }
  var names = [station.name_ar, station.name, station.name_en].filter(Boolean);
  for (var i = 0; i < names.length; i += 1) {
    var k = wb.normalizeWorkbookCityKey(nfc(names[i]));
    if (k && catalog[k]) {
      return {
        kind: 'exact',
        key: k,
        canonical: catalog[k],
        matched_field: i === 0 ? 'name_ar' : i === 1 ? 'name' : 'name_en'
      };
    }
  }
  return { kind: 'unmapped' };
}

function validateMappedReference(st, workbookWindows) {
  var snap = getResolvedLocalDurSnapshot({
    station: st,
    stationId: String(st.id || ''),
    asOfIso: AS_OF,
    durur_reference: [],
    workbook_windows: workbookWindows
  });
  if (snap && snap.error) {
    return { ok: false, error: snap.error };
  }
  if (!snap || !snap.resolved_window_snapshot) {
    return { ok: false, error: { code: 'NO_SNAPSHOT' } };
  }
  return { ok: true, current_dur: snap.resolved_window_snapshot.dur_name_ar };
}

async function run() {
  var report = {
    as_of: AS_OF,
    dur_windows_rebuilt_from_excel: false,
    kv_dur_windows_updated: false,
    kv_key: 'navidur_store_dur_windows',
    total_reference_stations: 0,
    mapped_reference_stations: 0,
    unmapped_reference_stations: 0,
    failed_workbook_lookups: [],
    operational_inheritance_enabled: false,
    workbook_cities: [],
    reference_details: [],
    unmapped_list: [],
    manual_preserved: [],
    rejected_ambiguous: [],
    ambiguous_matches: []
  };

  execFileSync(process.execPath, [REBUILD_SCRIPT], {
    stdio: 'inherit',
    cwd: REPO,
    env: Object.assign({}, process.env, { NAVIDUR_REBUILD_QUIET: '1' })
  });
  report.dur_windows_rebuilt_from_excel = true;

  var doc = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  var v = verifyOperDoc(doc);
  if (!v.ok) {
    console.error('VERIFY_FAILED', v);
    process.exit(1);
  }

  await writeJsonFile('dur_windows', doc);
  report.kv_dur_windows_updated = !!getKv();
  if (!getKv()) {
    report.kv_note = 'KV not configured: dur_windows persisted to data/ only.';
  }

  var wwin = Array.isArray(doc.workbook_windows) ? doc.workbook_windows : [];
  var catalog = wb.buildWorkbookCityCatalog(wwin);
  var ord = Array.isArray(doc.workbook_import && doc.workbook_import.workbook_city_list_ordered)
    ? doc.workbook_import.workbook_city_list_ordered
    : Object.keys(catalog).map(function (k) { return catalog[k]; });
  report.workbook_cities = ord;

  var stations = await readJsonFile('stations', []);
  if (!Array.isArray(stations)) stations = [];

  var out = [];
  for (var i = 0; i < stations.length; i += 1) {
    var st = stations[i];
    if (!st.is_reference_station) {
      out.push(st);
      continue;
    }

    report.total_reference_stations += 1;
    var match = exactWorkbookMatch(st, catalog);

    if (match.kind === 'preserve_manual') {
      report.manual_preserved.push({ id: st.id, name: st.name_ar || st.name, workbook_city: match.canonical });
      out.push(st);
      var valM = validateMappedReference(st, wwin);
      report.reference_details.push({
        station_id: st.id,
        station_name: st.name_ar || st.name,
        workbook_city: st.workbook_city_name,
        workbook_match_mode: 'manual',
        current_workbook_lookup_today: valM.ok ? valM.current_dur : null,
        analysis_path_ok: valM.ok,
        workbook_only_timing: true
      });
      if (!valM.ok) report.failed_workbook_lookups.push({ id: st.id, name: st.name_ar || st.name, err: valM.error });
      continue;
    }

    if (match.kind === 'manual_orphan') {
      report.manual_preserved.push({ id: st.id, name: st.name_ar || st.name, note: 'manual_key_not_in_catalog' });
      out.push(st);
      report.reference_details.push({
        station_id: st.id,
        station_name: st.name_ar || st.name,
        workbook_city: st.workbook_city_name,
        analysis_path_ok: false,
        workbook_only_timing: false,
        note: 'manual_mapping_key_absent_from_workbook_catalog'
      });
      continue;
    }

    if (match.kind === 'exact') {
      var next = Object.assign({}, st, {
        workbook_city_key: match.key,
        workbook_city_name: match.canonical,
        workbook_match_mode: 'exact_normalized',
        workbook_assignment_status: 'workbook_operational_matched',
        updated_at: new Date().toISOString()
      });
      out.push(next);
      report.mapped_reference_stations += 1;
      var val = validateMappedReference(next, wwin);
      if (!val.ok) {
        report.failed_workbook_lookups.push({ id: st.id, name: st.name_ar || st.name, err: val.error });
      }
      report.reference_details.push({
        station_id: next.id,
        station_name: next.name_ar || next.name,
        workbook_city: next.workbook_city_name,
        workbook_match_mode: next.workbook_match_mode,
        current_workbook_lookup_today: val.ok ? val.current_dur : null,
        analysis_path_ok: val.ok,
        workbook_only_timing: true
      });
      continue;
    }

    report.unmapped_reference_stations += 1;
    report.unmapped_list.push({ id: st.id, name: st.name_ar || st.name, reason: 'no_exact_workbook_city_name' });
    var cleared = Object.assign({}, st, {
      workbook_city_key: null,
      workbook_city_name: null,
      workbook_match_mode: null,
      workbook_assignment_status: 'unmapped',
      updated_at: new Date().toISOString()
    });
    out.push(cleared);
    report.reference_details.push({
      station_id: st.id,
      station_name: st.name_ar || st.name,
      workbook_city: null,
      analysis_path_ok: false,
      workbook_only_timing: false
    });
  }

  await writeJsonFile('stations', out);

  fs.writeFileSync(ALIGN_REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
