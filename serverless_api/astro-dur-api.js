'use strict';

/**
 * Admin-only monitoring API for the geo-astronomical temporal layer (Phase 1).
 * Does not alter public routes or legacy analysis.
 */

const { getAuthUser } = require('./_lib/auth');
const { readJsonFile } = require('./_lib/data-store');
const { getStationBandKey, deriveCurrentDurStateFromWindows } = require('./_lib/geo-astro-dur');

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

    if (path === 'status') {
      var anchorSummary = summarizeAnchors(starEvents, durWindows);

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
        dur_sequence_import_summary: sequenceMap.import || null
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

    return res.status(400).json({ error: 'unknown_path', hint: 'status|preview' });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : 'astro_dur_api_failed'
    });
  }
};
