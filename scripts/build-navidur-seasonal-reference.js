/**
 * One-shot: recompute data/true_final_station_reference.json from:
 * - real Canopus+Sun (astronomy-engine) per station, years 2025–2050, mode MM-DD
 * - internal anchor (lat,lon) for offset (identity not in output)
 * - fixed dur framework in shared/navdur-seasonal-core.js
 * Reference snapshot date: 23-04
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const suhail = require('../shared/suhail-canopus-calc');
const core = require('../shared/navdur-seasonal-core');

const REPO = path.join(__dirname, '..');
const XLSX_IN = path.join(REPO, 'data', 'navidur_true_final_station_reference.xlsx');
const JSON_OUT = path.join(REPO, 'data', 'true_final_station_reference.json');
const VALIDATION_OUT = path.join(REPO, 'data', 'navidur_seasonal_validation_log.json');

/** Internal only — not written to per-row public metadata */
const INTERNAL_ANCHOR_LAT = 25.285;
const INTERNAL_ANCHOR_LON = 51.531;
const HERITAGE_BASE_ANCHOR_DDMM = '15-08';
const REFERENCE_DDMM = '23-04';
const YEAR0 = 2025;
const YEAR1 = 2050;

function trim(v) {
  return String(v == null ? '' : v).trim();
}
function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function cell(row, key) {
  if (!row) return '';
  return row[key] != null ? row[key] : '';
}

function doyOfDdMm(ddmm) {
  const p = core.parseDdMm(ddmm);
  if (!p) return -1;
  return core.dayOfYearNonLeap2001(p.m, p.d);
}

function posAtDdMm(ddmm, t0) {
  const d = doyOfDdMm(ddmm);
  if (d < 0) return null;
  return core.positionInFrameworkAtDoy(d, t0);
}

function posAtDoy(doy, t0) {
  if (doy < 1) return null;
  return core.positionInFrameworkAtDoy(doy, t0);
}

function durLengthAtIndex(i) {
  return core.getFrameworkParams().lengths[i] || 13;
}

const _modeByLoc = new Map();
function getModeCached(lat, lon) {
  const k = String(lat) + ',' + String(lon);
  if (_modeByLoc.has(k)) return _modeByLoc.get(k);
  const m = suhail.modeAstronomicalSuhailEntry(lat, lon, YEAR0, YEAR1, false);
  _modeByLoc.set(k, m);
  return m;
}

function buildStationRow(sheetRow, modeA, doyAstroA) {
  const nameAr = trim(cell(sheetRow, 'Station'));
  const region = trim(cell(sheetRow, 'Region'));
  const lat = toNum(cell(sheetRow, 'Latitude'));
  const lon = toNum(cell(sheetRow, 'Longitude'));
  if (!nameAr || lat == null || lon == null) return { skip: true };

  const t0 = core.getFrameworkParams().t0;
  const modeSt = getModeCached(lat, lon);
  if (!modeSt.modeDdMm || !modeA.modeDdMm) {
    return {
      err: { station: nameAr, error: 'astronomical_suhail_unresolved' }
    };
  }
  const doyAstroS = doyOfDdMm(modeSt.modeDdMm);
  const offset = core.signedOffsetDays(doyAstroS, doyAstroA);
  const her_ddmm = suhail.heritageDdMm(HERITAGE_BASE_ANCHOR_DDMM, doyAstroS, doyAstroA, core);

  const t0Station = core.addDaysToDoy1Based(t0, -offset);

  const pAstro = posAtDdMm(modeSt.modeDdMm, t0Station);
  const pHer = posAtDdMm(her_ddmm, t0Station);
  if (!pAstro || !pHer) {
    return { err: { station: nameAr, error: 'framework_position_error' } };
  }

  const wA = core.currentDurWindowAndNext(doyAstroS, t0Station);
  const doyHer = doyOfDdMm(her_ddmm);
  if (doyHer < 1) {
    return { err: { station: nameAr, error: 'heritage_ddmm_invalid' } };
  }
  const wH = core.currentDurWindowAndNext(doyHer, t0Station);

  const refDoy = core.doyFromDdMm(REFERENCE_DDMM);
  const nowMeta = posAtDoy(refDoy, t0Station);
  if (!nowMeta) {
    return { err: { station: nameAr, error: 'reference_date_unmapped' } };
  }
  const win = core.currentDurWindowAndNext(refDoy, t0Station);
  const wStartDoy = doyOfDdMm(win.startDdMm);
  const wEndDoy = doyOfDdMm(win.endDdMm);
  if (wStartDoy < 1 || wEndDoy < 1) {
    return { err: { station: nameAr, error: 'ref_window_doy' } };
  }
  if (wStartDoy <= wEndDoy) {
    if (refDoy < wStartDoy || refDoy > wEndDoy) {
      return { err: { station: nameAr, error: 'reference_outside_dur' } };
    }
  } else {
    return { err: { station: nameAr, error: 'ref_wrap_unsupported' } };
  }
  const dayIn = refDoy - wStartDoy + 1;
  const dlen = wEndDoy - wStartDoy + 1;
  const rem = dlen - dayIn;
  const el = { elapsed: dayIn, remaining: rem };

  return {
    row: {
      station_name_ar: nameAr,
      region: region,
      lat: lat,
      lon: lon,
      astronomical_suhail_entry_md: modeSt.modeDdMm,
      heritage_suhail_entry_md: her_ddmm,
      astronomical_offset_days: offset,
      dur_at_astronomical_entry: pAstro.name,
      dur_day_at_astronomical_entry: pAstro.dayInDur,
      dur_start_at_astronomical_entry_md: wA.startDdMm,
      dur_end_at_astronomical_entry_md: wA.endDdMm,
      dur_at_heritage_entry: pHer.name,
      dur_day_at_heritage_entry: pHer.dayInDur,
      reference_date_md: REFERENCE_DDMM,
      current_dur_name_ar: nowMeta.name,
      current_dur_day_sheet: el.elapsed,
      elapsed_days_sheet: el.elapsed,
      remaining_days_sheet: el.remaining,
      next_dur_name_ar: win.nextName,
      current_dur_start_md: win.startDdMm,
      current_dur_end_md: win.endDdMm,
      seasonal_model: 'NAVIDUR_SEASONAL_V1',
      _build_meta: {
        suhail_mode_tally: modeSt.byYear,
        suhail_anchor_mode: modeA.modeDdMm
      }
    }
  };
}

function runValidation(stations) {
  const need = ['أبوظبي', 'دبي', 'جدة', 'الدقم'];
  const out = {};
  for (const n of need) {
    const st = stations.find((s) => s.station_name_ar === n);
    if (!st) {
      out[n] = { error: 'missing' };
      continue;
    }
    out[n] = {
      astronomical_suhail_entry: st.astronomical_suhail_entry_md,
      heritage_suhail_entry: st.heritage_suhail_entry_md,
      current_dur: st.current_dur_name_ar,
      current_dur_day: st.current_dur_day_sheet,
      elapsed_days: st.elapsed_days_sheet,
      remaining_days: st.remaining_days_sheet,
      next_dur: st.next_dur_name_ar,
      current_dur_start: st.current_dur_start_md,
      current_dur_end: st.current_dur_end_md
    };
  }
  return out;
}

function main() {
  if (!fs.existsSync(XLSX_IN)) {
    console.error('Missing:', XLSX_IN);
    process.exit(1);
  }
  const modeA = suhail.modeAstronomicalSuhailEntry(INTERNAL_ANCHOR_LAT, INTERNAL_ANCHOR_LON, YEAR0, YEAR1, true);
  if (!modeA.modeDdMm) {
    console.error('Anchor astronomical Suhail failed');
    process.exit(1);
  }
  const doyAstroA = doyOfDdMm(modeA.modeDdMm);
  console.log('Internal anchor (not exposed) mode Suhail', modeA.modeDdMm, 'doyA', doyAstroA);

  const wb = XLSX.readFile(XLSX_IN, { cellDates: false });
  const sn = 'Station_Reference';
  if (wb.SheetNames.indexOf(sn) < 0) {
    console.error('Need sheet', sn);
    process.exit(1);
  }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
  const stations = [];
  const errors = [];
  const modeTallySuhail = new Map();
  for (const r of rows) {
    const b = buildStationRow(r, modeA, doyAstroA);
    if (b.skip) continue;
    if (b.err) {
      errors.push(b.err);
      continue;
    }
    if (b.row) {
      const m = b.row.astronomical_suhail_entry_md;
      modeTallySuhail.set(m, (modeTallySuhail.get(m) || 0) + 1);
      delete b.row._build_meta;
      stations.push(b.row);
    }
  }
  if (errors.length) {
    console.error('Build errors', errors);
    process.exit(1);
  }
  if (!stations.length) {
    console.error('No stations');
    process.exit(1);
  }
  if (new Set(stations.map((s) => s.astronomical_suhail_entry_md)).size === 1) {
    console.error('VALIDATION: all stations same astronomical Suhail — likely wrong');
    process.exit(1);
  }
  const val = { reference_date: REFERENCE_DDMM, at_23_04: runValidation(stations) };
  const doc = {
    version: 2,
    reference_mode: 'navidur_seasonal_engine_v1',
    source_xlsx: 'data/navidur_true_final_station_reference.xlsx',
    authoritative_sheet: 'Station_Reference',
    generated_at: new Date().toISOString(),
    season_engine: {
      suhail_range_years: [YEAR0, YEAR1],
      star_alt_min_deg: 2,
      sun_alt_max_deg: -10,
      frame_t0_muqaddam_doy1: core.getFrameworkParams().t0
    },
    note:
      'Authoritative station-specific seasonal state from NAVIDUR seasonal engine (Canopus+Sun, fixed dur frame). current_dur_* and next_dur are DD-MM; runtime month-day only via true-final lookup.',
    stations: stations
  };
  fs.writeFileSync(JSON_OUT, JSON.stringify(doc, null, 2), 'utf8');
  fs.writeFileSync(VALIDATION_OUT, JSON.stringify(val, null, 2), 'utf8');
  console.log('Wrote', JSON_OUT, 'n=', stations.length);
  console.log('Validation 23-04', JSON.stringify(val.at_23_04, null, 2));
}

main();
