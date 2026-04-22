'use strict';

const path = require('path');
const fs = require('fs/promises');

const DEFAULT_OPER_FILENAME = 'navidur_operational_durur_2025_2026.xlsx';

let _cache = { mtimeMs: null, rows: null, filePath: null, err: null };

function getOperationalWorkbookPath() {
  return process.env.NAVIDUR_OPERATIONAL_DURUR_XLSX
    ? String(process.env.NAVIDUR_OPERATIONAL_DURUR_XLSX)
    : path.join(__dirname, '..', '..', 'data', DEFAULT_OPER_FILENAME);
}

function excelSerialToUtcIso(serial) {
  if (serial == null || !Number.isFinite(Number(serial))) return null;
  const base = Date.UTC(1899, 11, 30);
  const d = new Date(base + Number(serial) * 86400000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isoToExcelSerial(iso) {
  if (!iso || typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const p = iso.split('-').map(Number);
  const utc = Date.UTC(p[0], p[1] - 1, p[2]);
  const base = Date.UTC(1899, 11, 30);
  return Math.round((utc - base) / 86400000);
}

/**
 * @param {object} row from sheet نوافذ_الدرور
 * @returns {object}
 */
function normalizeWindowRow(row) {
  const startS = row['بداية الدُّر'];
  const endS = row['نهاية الدُّر'];
  const startIso = excelSerialToUtcIso(startS);
  const endIso = excelSerialToUtcIso(endS);
  const nextStartS = row['بداية الدُّر التالي'];
  return {
    cycle: String(row['الدورة'] != null ? row['الدورة'] : '').trim(),
    order: Number.isFinite(Number(row['الترتيب'])) ? Number(row['الترتيب']) : 0,
    dur_name_ar: String(row['اسم الدُّر'] != null ? row['اسم الدُّر'] : '').trim(),
    duration_days: Number.isFinite(Number(row['المدة (يوم)'])) ? Number(row['المدة (يوم)']) : 0,
    start_serial: Number(startS),
    end_serial: Number(endS),
    start_date: startIso,
    end_date: endIso,
    next_dur_name_ar: String(row['الدُّر التالي'] != null ? row['الدُّر التالي'] : '').trim(),
    next_dur_start_serial: nextStartS != null && nextStartS !== '' ? Number(nextStartS) : null,
    next_dur_start_date: nextStartS != null && nextStartS !== '' ? excelSerialToUtcIso(nextStartS) : null
  };
}

/**
 * @param {string} iso YYYY-MM-DD
 * @param {Array<object>} allWindows normalized rows
 * @returns {object | null} { cycle, window, indexInCycle, cycleRows }
 */
function findWindowContainingDate(iso, allWindows) {
  if (!iso || !Array.isArray(allWindows) || !allWindows.length) return null;
  const sn = isoToExcelSerial(iso);
  if (sn == null) return null;
  for (var i = 0; i < allWindows.length; i += 1) {
    var w = allWindows[i];
    if (!w || w.start_date == null || w.end_date == null) continue;
    if (sn >= w.start_serial && sn <= w.end_serial) {
      var c = w.cycle;
      var cycleRows = allWindows
        .filter(function (r) {
          return r && r.cycle === c;
        })
        .sort(function (a, b) {
          return a.order - b.order;
        });
      var idx = cycleRows.findIndex(function (r) {
        return r.order === w.order;
      });
      return { cycle: c, window: w, indexInCycle: idx, cycleRows: cycleRows };
    }
  }
  return null;
}

/**
 * @param {string} eventDateIso
 * @param {Array<object>} allWindows
 * @returns {object | null}
 */
function resolveDurStateAtDate(eventDateIso, allWindows) {
  var found = findWindowContainingDate(eventDateIso, allWindows);
  if (!found || !found.window) return null;
  var w = found.window;
  var sn = isoToExcelSerial(eventDateIso);
  if (sn == null) return null;
  var dayIn = sn - w.start_serial + 1;
  var daysRem = w.end_serial - sn;
  var nextName = w.next_dur_name_ar || null;
  return {
    operational_cycle_label: found.cycle,
    dur_name_ar: w.dur_name_ar,
    day_in_dur: dayIn,
    days_elapsed_in_dur: dayIn - 1,
    days_remaining_in_dur: daysRem,
    next_dur_name_ar: nextName,
    current_dur_start_iso: w.start_date,
    current_dur_end_iso: w.end_date,
    next_dur_start_iso: w.next_dur_start_date,
    full_cycle_rows: found.cycleRows
  };
}

/**
 * @param {Array<object>} cycleRows 28 rows sorted by order
 * @returns {Array<object>} same shape as station_dur_windows items
 */
function cycleRowsToStationWindows(cycleRows) {
  if (!Array.isArray(cycleRows) || !cycleRows.length) return [];
  return cycleRows.map(function (r) {
    return {
      dur_id: 'dur_' + String(r.order).padStart(2, '0'),
      dur_name_ar: r.dur_name_ar,
      sequence_index: r.order,
      start_date: r.start_date,
      end_date: r.end_date,
      days: r.duration_days,
      source_mode: 'operational_workbook'
    };
  });
}

async function loadOperationalWindowsFromXlsxFile(xlsxPath) {
  const st = await fs.stat(xlsxPath);
  if (_cache.mtimeMs === st.mtimeMs && _cache.filePath === xlsxPath && _cache.rows) {
    return { ok: true, file: xlsxPath, windows: _cache.rows };
  }
  const XLSX = require('xlsx');
  const buf = await fs.readFile(xlsxPath);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sn = 'نوافذ_الدرور';
  if (!wb.SheetNames || wb.SheetNames.indexOf(sn) < 0) {
    return { ok: false, reason: 'sheet_not_found', file: xlsxPath };
  }
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
  const windows = raw.map(normalizeWindowRow).filter(function (r) {
    return r.cycle && r.dur_name_ar && r.start_date && r.end_date;
  });
  _cache = { mtimeMs: st.mtimeMs, filePath: xlsxPath, rows: windows, err: null };
  return { ok: true, file: xlsxPath, windows: windows };
}

async function getOperationalWindows() {
  const p = getOperationalWorkbookPath();
  try {
    return await loadOperationalWindowsFromXlsxFile(p);
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message : 'read_failed', file: p };
  }
}

module.exports = {
  getOperationalWorkbookPath,
  DEFAULT_OPER_FILENAME,
  excelSerialToUtcIso,
  isoToExcelSerial,
  getOperationalWindows,
  findWindowContainingDate,
  resolveDurStateAtDate,
  cycleRowsToStationWindows
};
