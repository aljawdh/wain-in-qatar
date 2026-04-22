'use strict';

const { buildFullStationCycleFromInCycleAnchor } = require('./station-local-dur-generator');
const { getManualAnchorRuleForStation } = require('./station-local-dur-anchor-config');
const { nowIso } = require('./data-store');

/**
 * Regenerates and merges station-local dur windows when manual Suhail anchor is set.
 * On invalid inputs or missing sequence/rule, removes the station entry (no broken windows).
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

  const anchorRule = getManualAnchorRuleForStation(station);
  if (!anchorRule) {
    if (doc.stations[stationId]) {
      delete doc.stations[stationId];
      await writeJsonFile('station_dur_windows', doc);
    }
    return { ok: false, reason: 'no_anchor_rule_for_workbook_city', station_id: stationId };
  }

  const sequenceDoc = await readJsonFile('dur_sequence_map', { rules: [] });
  const built = buildFullStationCycleFromInCycleAnchor(anchorDate, anchorRule, sequenceDoc);
  if (!built.ok || !Array.isArray(built.windows)) {
    if (doc.stations[stationId]) {
      delete doc.stations[stationId];
      await writeJsonFile('station_dur_windows', doc);
    }
    return Object.assign({ station_id: stationId }, built);
  }

  doc.stations[stationId] = {
    station_id: stationId,
    anchor_date: anchorDate,
    anchor_dur_name_ar: anchorRule.anchor_dur_name_ar,
    anchor_day_in_dur: anchorRule.anchor_day_in_dur,
    source: 'manual_anchor',
    generated_at: nowIso(),
    generation_ok: true,
    windows: built.windows
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
