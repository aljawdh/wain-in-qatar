'use strict';

/**
 * Admin-only monitoring API for the geo-astronomical temporal layer (Phase 1).
 * Does not alter public routes or legacy analysis.
 */

const { getAuthUser } = require('./_lib/auth');
const { readJsonFile } = require('./_lib/data-store');
const { getStationBandKey, deriveCurrentDurStateFromWindows } = require('./_lib/geo-astro-dur');
const {
  buildWorkbookCityIndex,
  suggestWorkbookCityForStation,
  summarizeWorkbookMappingStats,
  normalizeWorkbookCityName
} = require('./_lib/workbook-city-index');
const { deriveWorkbookDurPreviewAcrossCityCycles } = require('./_lib/workbook-dur-preview');

function applyCorsHeaders(res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function isPrivilegedAdmin(user) {
  if (!user) return false;
  var r = String(user.role || '').toLowerCase();
  return r === 'admin' || r === 'super_admin';
}

function isoTodayUtc() {
  var d = new Date();
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function summarizeAnchors(starDoc, durWindowsDoc) {
  var events = Array.isArray(starDoc.events) ? starDoc.events : [];
  var bandsWin = durWindowsDoc.bands && typeof durWindowsDoc.bands === 'object' ? durWindowsDoc.bands : {};

  var byBand = {};
  events.forEach(function (ev) {
    if (!ev || !ev.latitude_band_key) return;
    var bk = String(ev.latitude_band_key).trim();
    if (!bk) return;
    if (!byBand[bk]) byBand[bk] = [];
    byBand[bk].push({
      year: ev.year != null ? Number(ev.year) : null,
      event_date: ev.event_date || null,
      star_key: ev.star_key || null,
      source: ev.source || null,
      is_verified: !!ev.is_verified,
      station_id: ev.station_id || null
    });
  });

  var keys = Object.keys(byBand);
  keys.sort();

  var bandStatuses = keys.map(function (bk) {
    var evs = byBand[bk];
    var hasVerified = evs.some(function (e) {
      return e.event_date && e.is_verified;
    });
    var hasAnyDate = evs.some(function (e) {
      return !!e.event_date;
    });
    var winBand = bandsWin[bk];
    var generated = !!(winBand && winBand.years && Object.keys(winBand.years).length);

    var anchorState = !hasAnyDate ? 'missing' : hasVerified ? 'verified' : 'generated_or_unverified';

    return {
      latitude_band_key: bk,
      anchor_state: anchorState,
      event_rows: evs.length,
      dur_windows_generated: generated,
      band_payload_incomplete: !!(winBand && winBand.incomplete)
    };
  });

  return {
    bands_tracked_from_star_events: bandStatuses,
    known_keys_from_registry: Array.isArray(starDoc.known_latitude_band_keys) ? starDoc.known_latitude_band_keys : []
  };
}

module.exports = async function astroDurApiHandler(req, res) {
  applyCorsHeaders(res);
  req.query = req.query || {};

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    var user = await getAuthUser(req);
    if (!isPrivilegedAdmin(user)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    var path = String(req.query.path || 'status').toLowerCase();

    var durWindows = await readJsonFile('dur_windows', {});
    var starEvents = await readJsonFile('star_events', {});
    var sequenceMap = await readJsonFile('dur_sequence_map', {});
    var audit = await readJsonFile('dur_generation_audit', {});
    var stationsAll = await readJsonFile('stations', []);
    var workbookIndex = buildWorkbookCityIndex(durWindows, starEvents);

    if (path === 'status') {
      var anchorSummary = summarizeAnchors(starEvents, durWindows);
      var mappingStats = summarizeWorkbookMappingStats(stationsAll, workbookIndex);

      var wbImp = durWindows.workbook_import && typeof durWindows.workbook_import === 'object'
        ? durWindows.workbook_import
        : null;
      var wbWin = Array.isArray(durWindows.workbook_windows) ? durWindows.workbook_windows : [];
      var cityStarCount = Array.isArray(starEvents.events)
        ? starEvents.events.filter(function (ev) {
            return ev && ev.city && ev.calendar_profile === 'operational_v1';
          }).length
        : 0;

      return res.status(200).json({
        ok: true,
        path: 'status',
        sequence_map_version: sequenceMap.version,
        dur_windows_incomplete: !!durWindows.incomplete,
        dur_windows_reason: durWindows.incomplete_reason || null,
        star_events_version: starEvents.version,
        last_audit_runs: Array.isArray(audit.runs) ? audit.runs.slice(-5) : [],
        anchors: anchorSummary,
        workbook_import_monitoring: wbImp
          ? {
              source_label: 'workbook_import',
              source_file_path:
                wbImp.source_file_path ||
                'data_sources/workbooks/navidur_durur_master_workbook_v1.xlsx',
              imported_at: wbImp.imported_at || null,
              import_version: wbImp.import_version || null,
              partial: wbImp.partial === true,
              imported_cities:
                wbImp.stats && wbImp.stats.imported_cities != null
                  ? wbImp.stats.imported_cities
                  : null,
              imported_years:
                wbImp.stats && wbImp.stats.imported_years != null ? wbImp.stats.imported_years : null,
              imported_dur_windows:
                wbImp.stats && wbImp.stats.imported_dur_windows != null
                  ? wbImp.stats.imported_dur_windows
                  : wbWin.length,
              workbook_windows_row_count: wbWin.length,
              star_events_city_rows_operational_v1: cityStarCount,
              warnings_count: Array.isArray(wbImp.warnings) ? wbImp.warnings.length : 0
            }
          : {
              source_label: null,
              source_file_path: 'data_sources/workbooks/navidur_durur_master_workbook_v1.xlsx',
              note: 'no_workbook_import_metadata_on_dur_windows'
            },
        star_events_import_summary: starEvents.import || null,
        dur_sequence_import_summary: sequenceMap.import || null,
        workbook_station_mapping_stats: mappingStats
      });
    }

    if (path === 'workbook-cities') {
      return res.status(200).json({
        ok: true,
        path: 'workbook-cities',
        source: 'workbook_import',
        cities: workbookIndex.cities.map(function (c) {
          return {
            workbook_city_key: c.key,
            workbook_city_name: c.name,
            lat: c.lat,
            lon: c.lon
          };
        })
      });
    }

    if (path === 'workbook-suggest') {
      var sid = req.query.station_id ? String(req.query.station_id).trim() : '';
      if (!sid) return res.status(400).json({ error: 'station_id_required' });
      var stRow = Array.isArray(stationsAll)
        ? stationsAll.find(function (s) {
            return s && String(s.id) === sid;
          })
        : null;
      if (!stRow) return res.status(404).json({ error: 'station_not_found' });
      var suggestion = suggestWorkbookCityForStation(stRow, workbookIndex);
      return res.status(200).json({
        ok: true,
        path: 'workbook-suggest',
        source: 'workbook_import',
        station_id: sid,
        suggestion: suggestion
      });
    }

    if (path === 'workbook-preview') {
      var previewSid = req.query.station_id ? String(req.query.station_id).trim() : '';
      /** Optional: restrict search to one workbook cycle year column (admin browse). Omit for Gregorian date resolution across cycles. */
      var browseCycleYearRaw = req.query.workbook_cycle_year != null ? Number(req.query.workbook_cycle_year) : NaN;
      var browseCycleYear = Number.isFinite(browseCycleYearRaw) ? browseCycleYearRaw : null;
      var previewDate = req.query.date ? String(req.query.date).trim() : isoTodayUtc();
      if (!previewSid) return res.status(400).json({ error: 'station_id_required' });
      var pst = Array.isArray(stationsAll)
        ? stationsAll.find(function (s) {
            return s && String(s.id) === previewSid;
          })
        : null;
      if (!pst) return res.status(404).json({ error: 'station_not_found' });

      var cityLookup =
        pst.workbook_city_key != null && String(pst.workbook_city_key).trim() !== ''
          ? normalizeWorkbookCityName(pst.workbook_city_key)
          : '';
      var cityName =
        pst.workbook_city_name != null && String(pst.workbook_city_name).trim() !== ''
          ? String(pst.workbook_city_name).trim()
          : '';
      if (cityLookup && workbookIndex.byKey.has(cityLookup)) {
        cityName = workbookIndex.byKey.get(cityLookup).name;
      } else if (cityLookup && !cityName) {
        cityName = cityLookup;
      }

      if (!cityName) {
        return res.status(200).json({
          ok: true,
          path: 'workbook-preview',
          source: 'workbook_import',
          preview_engine: 'admin_workbook_only',
          state: 'unmapped',
          message_ar: 'المحطة غير مربوطة بمدينة من المصنف.',
          station_id: previewSid,
          iso_date: previewDate,
          gregorian_preview_date: previewDate,
          workbook_cycle_year: null,
          gregorian_year_of_preview_date: null,
          cycle_year_differs_from_gregorian_year: false
        });
      }

      var wbRows = Array.isArray(durWindows.workbook_windows) ? durWindows.workbook_windows : [];

      var cityOnly = wbRows.filter(function (w) {
        return (
          w &&
          String(w.city || '')
            .trim()
            .normalize('NFC') === String(cityName || '').trim().normalize('NFC')
        );
      });
      if (!cityOnly.length) {
        return res.status(200).json({
          ok: true,
          path: 'workbook-preview',
          source: 'workbook_import',
          preview_engine: 'admin_workbook_only',
          state: 'no_windows_for_city',
          message_ar: 'لا توجد نوافذ مصنف لهذه المدينة في البيانات المستوردة.',
          station_id: previewSid,
          workbook_city_name: cityName,
          gregorian_preview_date: previewDate,
          iso_date: previewDate,
          workbook_cycle_year: null,
          gregorian_year_of_preview_date: null,
          cycle_year_differs_from_gregorian_year: false,
          workbook_cycle_year_browse_restricted: browseCycleYear != null
        });
      }

      var derived = deriveWorkbookDurPreviewAcrossCityCycles(wbRows, cityName, previewDate, browseCycleYear);
      var active = derived.active;
      var next = derived.next;

      var gregY = null;
      var ym = String(previewDate || '').trim().match(/^(\d{4})-/);
      if (ym) gregY = Number(ym[1]);

      var wCycleY = derived.workbook_cycle_year;
      var differs =
        gregY != null && wCycleY != null && Number.isFinite(gregY) && Number.isFinite(wCycleY)
          ? gregY !== wCycleY
          : false;

      var stateOk = derived.ok === true;
      var stateReason = stateOk ? 'ok' : derived.reason || 'unknown';

      return res.status(200).json({
        ok: true,
        path: 'workbook-preview',
        source: 'workbook_import',
        preview_engine: 'admin_workbook_only',
        lookup_mode: browseCycleYear != null ? 'restricted_workbook_cycle_year' : 'gregorian_date_across_cycles',
        workbook_cycle_year_browse_restricted: browseCycleYear != null,
        requested_workbook_cycle_year: browseCycleYear,
        state: stateReason,
        message_ar: stateOk
          ? null
          : derived.reason === 'date_outside_workbook_windows'
            ? 'التاريخ خارج جميع نوافذ المصنف لهذه المدينة.'
            : derived.reason === 'no_windows_for_workbook_cycle'
              ? 'لا توجد نوافذ لهذه السنة ضمن المصنف (بحث مقيّد بدورة).'
              : derived.reason === 'bad_iso_date'
                ? 'تاريخ غير صالح.'
                : derived.reason === 'no_windows_for_city'
                  ? 'لا توجد نوافذ لهذه المدينة.'
                  : null,
        station_id: previewSid,
        workbook_city_key: cityLookup || null,
        workbook_city_name: cityName,
        gregorian_preview_date: previewDate,
        iso_date: previewDate,
        gregorian_year_of_preview_date: Number.isFinite(gregY) ? gregY : null,
        workbook_cycle_year: wCycleY,
        cycle_year_differs_from_gregorian_year: differs,
        year: wCycleY,
        current_dur: active
          ? {
              dur_index: active.dur_index,
              dur_name_ar: active.dur_name_ar,
              dur_length_days: active.dur_length_days,
              dur_start: active.dur_start,
              dur_end: active.dur_end,
              day_in_dur: derived.day_in_dur
            }
          : null,
        next_dur: next
          ? {
              dur_index: next.dur_index,
              dur_name_ar: next.dur_name_ar,
              dur_start: next.dur_start,
              dur_end: next.dur_end
            }
          : null,
        derived: derived
      });
    }

    if (path === 'preview') {
      var bandParam = req.query.band ? String(req.query.band).trim() : '';
      var yearParam = req.query.year != null ? Number(req.query.year) : new Date().getUTCFullYear();
      var stationId = req.query.station_id ? String(req.query.station_id).trim() : '';

      var bandKey = bandParam;
      if (stationId) {
        var stations = await readJsonFile('stations', []);
        var st = Array.isArray(stations) ? stations.find(function (s) {
          return s && String(s.id) === stationId;
        }) : null;
        bandKey = getStationBandKey(st || {}) || '';
      }

      var yStr = String(Number.isFinite(yearParam) ? yearParam : new Date().getUTCFullYear());
      var isoDate = req.query.date ? String(req.query.date).trim() : isoTodayUtc();

      var bandPayload =
        durWindows.bands && bandKey && durWindows.bands[bandKey]
          ? durWindows.bands[bandKey]
          : null;
      var windowsForYear =
        bandPayload && bandPayload.years && bandPayload.years[yStr]
          ? bandPayload.years[yStr].windows || []
          : [];

      var derived = deriveCurrentDurStateFromWindows(durWindows, bandKey || null, Number(yStr), isoDate);

      return res.status(200).json({
        ok: true,
        path: 'preview',
        latitude_band_key: bandKey || null,
        year: Number(yStr),
        iso_date: isoDate,
        station_id_resolved: stationId || null,
        windows_preview: windowsForYear,
        derived_current_state: derived,
        sequence_offsets_complete:
          Array.isArray(sequenceMap.rules) &&
          sequenceMap.rules.length > 0 &&
          sequenceMap.rules.every(function (r) {
            return r && r.offset_days_from_anchor != null && r.duration_days != null;
          })
      });
    }

    return res.status(400).json({
      error: 'unknown_path',
      hint: 'status|preview|workbook-cities|workbook-suggest|workbook-preview'
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : 'astro_dur_api_failed'
    });
  }
};
