'use strict';

const {
  getOperationalWindows,
  resolveDurStateAtDate,
  cycleRowsToStationWindows,
  DEFAULT_OPER_FILENAME
} = require('./operational-durur-workbook');
const { nowIso } = require('./data-store');

/**
 * Regenerates station-local dur windows from the operational workbook + manual anchor date.
 * Does not use city-specific hardcoded anchor rules.
 *
 * @returns {Promise<{ ok: boolean, reason?: string, skipped?: boolean, station_id?: string }>}
 */
async function regenerateStationLocalDurWindows(station, readJsonFile, writeJsonFile) {
  const stationId = station && String(station.id || '').trim();
  const doc = await readJsonFile('station_dur_windows', { version: 1, stations: {} });
  if (!doc.stations || typeof doc.stations !== 'object') doc.stations = {};

  if (!stationId) {
    return { ok: false, reason: 'missing_station_id' };
  }

  const anchorDate = station && station.manual_suhail_anchor_date
    ? String(station.manual_suhail_anchor_date).trim()
    : '';

  if (!anchorDate) {
    if (doc.stations[stationId]) {
      delete doc.stations[stationId];
      await writeJsonFile('station_dur_windows', doc);
    }
    return { ok: true, skipped: true, station_id: stationId };
  }

  const loaded = await getOperationalWindows();
  if (!loaded.ok || !Array.isArray(loaded.windows)) {
    if (doc.stations[stationId]) {
      delete doc.stations[stationId];
      await writeJsonFile('station_dur_windows', doc);
    }
    return Object.assign({ ok: false, station_id: stationId }, loaded);
  }

  const state = resolveDurStateAtDate(anchorDate, loaded.windows);
  if (!state || !Array.isArray(state.full_cycle_rows) || !state.full_cycle_rows.length) {
    if (doc.stations[stationId]) {
      delete doc.stations[stationId];
      await writeJsonFile('station_dur_windows', doc);
    }
    return {
      ok: false,
      reason: 'anchor_date_outside_operational_workbook',
      station_id: stationId
    };
  }

  const windows = cycleRowsToStationWindows(state.full_cycle_rows);

  doc.stations[stationId] = {
    station_id: stationId,
    anchor_date: anchorDate,
    anchor_dur_name_ar: state.dur_name_ar,
    anchor_day_in_dur: state.day_in_dur,
    operational_cycle_label: state.operational_cycle_label,
    operational_workbook_file: DEFAULT_OPER_FILENAME,
    source: 'operational_workbook',
    generated_at: nowIso(),
    generation_ok: true,
    windows: windows
  };

  await writeJsonFile('station_dur_windows', doc);
  return { ok: true, station_id: stationId };
}

async function removeStationLocalDurWindowsRecord(stationId, readJsonFile, writeJsonFile) {
  const sid = String(stationId || '').trim();
  if (!sid) return;
  const doc = await readJsonFile('station_dur_windows', { version: 1, stations: {} });
  if (!doc.stations || typeof doc.stations !== 'object') return;
  if (!doc.stations[sid]) return;
  delete doc.stations[sid];
  await writeJsonFile('station_dur_windows', doc);
}

module.exports = {
  regenerateStationLocalDurWindows,
  removeStationLocalDurWindowsRecord
};
