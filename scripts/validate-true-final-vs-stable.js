/**
 * Local comparison: true_final_station_reference (candidate) vs dur_windows (active stable).
 * Not used by production.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { getTrueFinalDurState } = require('../shared/true-final-station-reference-lookup');
const { getResolvedLocalDurSnapshot } = require('../shared/resolved-station-dur-snapshot');

const REPO = path.join(__dirname, '..');
const AS_OF = '2026-04-22';

const LABELS = {
  'Abu Dhabi': 'أبوظبي',
  'Jeddah': 'جدة',
  'Dubai': 'دبي',
  'Duqm': 'الدقم'
};

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
}

function stableSnapshot(cityNameAr, windows) {
  var station = {
    id: 'validate_' + cityNameAr,
    workbook_city_name: cityNameAr
  };
  return getResolvedLocalDurSnapshot({
    station: station,
    stationId: station.id,
    asOfIso: AS_OF,
    workbook_windows: windows,
    durur_reference: []
  });
}

function formatStable(snap) {
  if (!snap) return { error: 'no_snapshot' };
  if (snap.error) {
    return { error: snap.error };
  }
  var rw = snap.resolved_window_snapshot;
  if (!rw) {
    return { error: { code: 'NO_RW', message: 'missing resolved_window_snapshot' } };
  }
  return {
    current_dur_name_ar: rw.dur_name_ar,
    current_dur_start: rw.start_date,
    current_dur_end: rw.end_date,
    day_in_dur: rw.day_in_dur,
    days_remaining_in_dur: rw.days_remaining_in_dur,
    next_dur_name_ar: rw.next_dur_name_ar
  };
}

function main() {
  var doc = loadJson('data/true_final_station_reference.json');
  var durWindows = loadJson('data/dur_windows.json');
  var windows = Array.isArray(durWindows.workbook_windows) ? durWindows.workbook_windows : [];

  var out = { as_of: AS_OF, by_station: {} };

  Object.keys(LABELS).forEach(function (label) {
    var ar = LABELS[label];
    var tf = getTrueFinalDurState(doc, { station_name_ar: ar, asOfIso: AS_OF });
    var st = stableSnapshot(ar, windows);
    var stFmt = formatStable(st);
    out.by_station[label] = { arabic: ar, true_final: tf, stable_dur_windows: stFmt };
  });

  console.log(JSON.stringify(out, null, 2));
}

main();
