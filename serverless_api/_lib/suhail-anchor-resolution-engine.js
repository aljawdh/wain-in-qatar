'use strict';

const { normalizeWorkbookCityName } = require('./workbook-city-index');
const { resolveDurStateAtDate, cycleRowsToStationWindows, getOperationalWindows } = require('./operational-durur-workbook');

const ENGINE_VERSION = 'suhail_operational_v1';

function findSuhailStarEvent(starEventsDoc, cityName, year) {
  var normCity = normalizeWorkbookCityName(cityName || '');
  if (!normCity || !Number.isFinite(Number(year))) return null;
  var list = Array.isArray(starEventsDoc && starEventsDoc.events) ? starEventsDoc.events : [];
  return (
    list.find(function (ev) {
      if (!ev || !ev.city) return false;
      if (String(ev.star_key || '').toLowerCase() !== 'suhail') return false;
      if (ev.calendar_profile !== 'operational_v1') return false;
      if (Number(ev.year) !== Number(year)) return false;
      return normalizeWorkbookCityName(ev.city) === normCity;
    }) || null
  );
}

/**
 * Full resolve: astronomical Suhail + operational workbook placement (single pipeline).
 *
 * @returns {Promise<object>}
 */
async function resolveSuhailAnchorFromSources(opts) {
  opts = opts || {};
  var starEventsDoc = opts.star_events_doc || opts.starEventsDoc || {};
  var operationalWindows = opts.operational_windows || opts.operationalWindows;
  var cityName = opts.city_name || opts.cityName || '';
  var year = Number(opts.year);

  if (!Number.isFinite(year)) {
    return { ok: false, reason: 'year_invalid', engine_version: ENGINE_VERSION };
  }

  var loadOwn = false;
  if (!operationalWindows) {
    loadOwn = true;
    var loaded = await getOperationalWindows();
    if (!loaded.ok || !Array.isArray(loaded.windows)) {
      return Object.assign({ ok: false, engine_version: ENGINE_VERSION }, loaded);
    }
    operationalWindows = loaded.windows;
  }

  var hit = findSuhailStarEvent(starEventsDoc, cityName, year);
  if (!hit || !hit.event_date) {
    return {
      ok: false,
      reason: 'star_event_not_found',
      engine_version: ENGINE_VERSION,
      workbook_city_name: String(cityName || '').trim(),
      year: year
    };
  }

  var eventIso = String(hit.event_date).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventIso)) {
    return { ok: false, reason: 'bad_event_date', engine_version: ENGINE_VERSION };
  }

  var op = resolveDurStateAtDate(eventIso, operationalWindows);
  if (!op) {
    return {
      ok: false,
      reason: 'date_outside_operational_workbook',
      engine_version: ENGINE_VERSION,
      astronomical_event_date: eventIso,
      operational_workbook: loadOwn ? 'data/navidur_operational_durur_2025_2026.xlsx' : null
    };
  }

  var stationWindows = cycleRowsToStationWindows(op.full_cycle_rows);

  return {
    ok: true,
    engine_version: ENGINE_VERSION,
    star_event: {
      city: hit.city,
      year: hit.year,
      event_date: eventIso,
      time_utc: hit.time_utc != null && String(hit.time_utc).trim() !== '' ? String(hit.time_utc).trim() : null,
      star_alt_deg: hit.star_alt_deg != null ? Number(hit.star_alt_deg) : null,
      source: hit.source || 'workbook_import',
      source_sheet: hit.source_sheet || null
    },
    operational: {
      cycle_label: op.operational_cycle_label,
      dur_name_ar: op.dur_name_ar,
      day_in_dur: op.day_in_dur,
      days_elapsed_in_dur: op.days_elapsed_in_dur,
      days_remaining_in_dur: op.days_remaining_in_dur,
      next_dur_name_ar: op.next_dur_name_ar,
      current_dur_start_iso: op.current_dur_start_iso,
      current_dur_end_iso: op.current_dur_end_iso,
      next_dur_start_iso: op.next_dur_start_iso,
      windows_28: stationWindows
    }
  };
}

module.exports = {
  ENGINE_VERSION,
  findSuhailStarEvent,
  resolveSuhailAnchorFromSources
};
