'use strict';

var { readJsonFile, writeJsonFile, nowIso } = require('./data-store');
var { cleanString } = require('./security');
var { normalizeStationInput } = require('./stations');
var promotionStore = require('./reference-station-promotion-store');
var calendar = require('./reference-station-promotion-calendar');

var MODES = calendar.CALENDAR_MODES;

function findStationById(list, id) {
  var safe = cleanString(id, 80);
  if (!safe) return null;
  for (var i = 0; i < list.length; i += 1) {
    if (list[i] && String(list[i].id) === safe) return list[i];
  }
  return null;
}

function resolveLinkedReference(station, stationsList) {
  var refId = cleanString(station.reference_station_id, 80);
  if (refId) {
    var linked = findStationById(stationsList, refId);
    if (linked) {
      return {
        station: linked,
        station_id: linked.id,
        station_name: calendar.stationNameAr(linked),
        via: 'reference_station_id'
      };
    }
  }
  var durRef = cleanString(station.dur_reference_station, 120);
  if (durRef && /^st_[0-9a-zA-Z_-]+$/.test(durRef)) {
    var byDurId = findStationById(stationsList, durRef);
    if (byDurId) {
      return {
        station: byDurId,
        station_id: byDurId.id,
        station_name: calendar.stationNameAr(byDurId),
        via: 'dur_reference_station'
      };
    }
  }
  var refName = cleanString(station.reference_station_name_ar, 120);
  if (refName) {
    return { station: null, station_id: '', station_name: refName, via: 'reference_station_name_ar' };
  }
  return null;
}

function resolveSourceReference(station, stationsList, explicitSourceId, trueFinalDoc) {
  if (explicitSourceId) {
    var explicit = findStationById(stationsList, explicitSourceId);
    if (!explicit) {
      return { ok: false, error: 'invalid_source_reference', hint: 'source_reference_station_id not found' };
    }
    var explicitCheck = calendar.isValidCalendarSourceStation(explicit, trueFinalDoc);
    if (!explicitCheck.ok) return { ok: false, error: explicitCheck.error, hint: explicitCheck.hint };
    return {
      ok: true,
      station: explicit,
      station_id: explicit.id,
      station_name: calendar.stationNameAr(explicit),
      via: 'explicit_source_reference_station_id'
    };
  }

  var linked = resolveLinkedReference(station, stationsList);
  if (!linked || !linked.station_name) {
    return { ok: false, error: 'source_reference_required', hint: 'Provide source_reference_station_id' };
  }

  if (linked.station) {
    var linkedCheck = calendar.isValidCalendarSourceStation(linked.station, trueFinalDoc);
    if (!linkedCheck.ok) {
      return { ok: false, error: linkedCheck.error, hint: linkedCheck.hint };
    }
    return {
      ok: true,
      station: linked.station,
      station_id: linked.station_id,
      station_name: linked.station_name,
      via: linked.via
    };
  }

  if (calendar.countAnnualRows(trueFinalDoc, linked.station_name) < 1) {
    return { ok: false, error: 'source_missing_annual_flat_rows' };
  }
  return {
    ok: true,
    station: null,
    station_id: linked.station_id || '',
    station_name: linked.station_name,
    via: linked.via
  };
}

function buildCalendar(doc, targetStation, sourceStation, sourceName, mode, trueFinalDoc) {
  var shiftMeta = {
    shift_days: null,
    source_suhail_date: null,
    target_suhail_date: null,
    anchor_method: null
  };

  if (mode === MODES.generate_from_coordinates) {
    return { ok: false, error: 'coordinate_generation_not_available' };
  }

  if (mode === MODES.copy_and_shift_by_suhail_anchor) {
    var sourceSuhail = calendar.resolveSuhailMdFromTrueFinal(trueFinalDoc, sourceName);
    if (!sourceSuhail.md) {
      sourceSuhail = calendar.resolveSuhailMdFromCoordinates(
        sourceStation && sourceStation.lat,
        sourceStation && sourceStation.lon
      );
    }
    var targetSuhail = calendar.resolveSuhailMdFromCoordinates(targetStation.lat, targetStation.lon);
    if (!sourceSuhail.md || !targetSuhail.md) {
      return {
        ok: false,
        error: 'suhail_anchor_unresolved',
        source: sourceSuhail,
        target: targetSuhail
      };
    }
    var shift = calendar.computeSuhailShift(sourceSuhail.md, targetSuhail.md);
    if (!shift.ok) return { ok: false, error: shift.error, shift: shift };
    shiftMeta.shift_days = shift.shift_days;
    shiftMeta.source_suhail_date = shift.source_suhail_date;
    shiftMeta.target_suhail_date = shift.target_suhail_date;
    shiftMeta.anchor_method = 'mode_astronomical_suhail_entry';
  }

  var meta = {
    copied_from_reference_station_id: (sourceStation && sourceStation.id) || '',
    calendar_generation_mode: mode,
    calibration_status:
      mode === MODES.copy_from_reference ? 'initial_copied_reference' : 'initial_shifted_reference',
    shift_days: shiftMeta.shift_days,
    source_suhail_date: shiftMeta.source_suhail_date,
    target_suhail_date: shiftMeta.target_suhail_date,
    anchor_method: shiftMeta.anchor_method
  };

  var annualRowsCreated = calendar.copyAnnualFlatRows(doc, {
    source_name_ar: sourceName,
    target_station: targetStation,
    calendar_generation_mode: mode,
    shift_days: shiftMeta.shift_days || 0,
    metadata: meta
  });

  if (annualRowsCreated < 1) {
    return { ok: false, error: 'annual_flat_rows_copy_failed', annual_rows_created: 0 };
  }

  var stationEntry = calendar.upsertTrueFinalStationEntry(doc, targetStation, sourceStation || { name: sourceName }, {
    reference_calendar_status: calendar.calendarStatusForMode(mode),
    copied_from_reference_station_id: meta.copied_from_reference_station_id,
    calendar_generation_mode: mode,
    shift_days: shiftMeta.shift_days,
    source_suhail_date: shiftMeta.source_suhail_date,
    target_suhail_date: shiftMeta.target_suhail_date,
    anchor_method: shiftMeta.anchor_method
  });

  return {
    ok: true,
    annual_rows_created: annualRowsCreated,
    station_entry: stationEntry,
    shift_days: shiftMeta.shift_days,
    source_suhail_date: shiftMeta.source_suhail_date,
    target_suhail_date: shiftMeta.target_suhail_date,
    anchor_method: shiftMeta.anchor_method
  };
}

async function promoteReferenceStation(input) {
  var stationId = cleanString(input && input.station_id, 80);
  var reason = cleanString(input && input.reason, 800);
  var actor = cleanString(input && input.actor, 80) || 'admin';
  var mode = cleanString(input && input.calendar_generation_mode, 60) || MODES.copy_from_reference;
  var explicitSourceId = cleanString(input && input.source_reference_station_id, 80);

  if (!stationId) return { ok: false, error: 'station_id_required' };
  if (!reason || reason.length < 10) {
    return { ok: false, error: 'reason_required', hint: 'reason must be at least 10 characters' };
  }
  if (!MODES[mode]) {
    return { ok: false, error: 'invalid_calendar_generation_mode' };
  }

  var stations = await readJsonFile('stations', []);
  var list = Array.isArray(stations) ? stations : [];
  var idx = list.findIndex(function (s) {
    return s && String(s.id) === stationId;
  });
  if (idx < 0) return { ok: false, error: 'station_not_found', station_id: stationId };

  var station = list[idx];
  if (station.is_reference_station === true) {
    return { ok: false, error: 'already_reference_station', station_id: stationId };
  }

  var targetName = calendar.stationNameAr(station);
  var prevRefId = cleanString(station.reference_station_id, 80) || null;
  var prevRefRow = prevRefId ? findStationById(list, prevRefId) : null;
  var prevRefName = prevRefRow
    ? calendar.stationNameAr(prevRefRow)
    : cleanString(station.reference_station_name_ar, 120) || '';

  var trueFinalBefore = await readJsonFile('true_final_station_reference', {
    version: 0,
    stations: [],
    annual_flat_rows: []
  });
  var trueFinalDoc = JSON.parse(JSON.stringify(trueFinalBefore));

  var sourceResolved = resolveSourceReference(station, list, explicitSourceId, trueFinalDoc);
  if (!sourceResolved.ok) return sourceResolved;

  var sourceStation = sourceResolved.station;
  var sourceName = sourceResolved.station_name;
  if (!sourceStation) {
    sourceStation = {
      id: sourceResolved.station_id || explicitSourceId || prevRefId || '',
      name: sourceName,
      name_ar: sourceName
    };
  }

  var stationsBefore = JSON.parse(JSON.stringify(list));
  var backup = await promotionStore.saveBackupSnapshot({
    stations: stationsBefore,
    true_final_station_reference: JSON.parse(JSON.stringify(trueFinalBefore))
  });

  calendar.removeTargetCalendar(trueFinalDoc, targetName);
  var built = buildCalendar(trueFinalDoc, station, sourceStation, sourceName, mode, trueFinalBefore);
  if (!built.ok) {
    return Object.assign({ ok: false, station_id: stationId }, built);
  }

  trueFinalDoc._reference_promotion_updated_at = nowIso();
  trueFinalDoc._reference_promotion_station_id = stationId;

  var promotedAt = nowIso();
  var calendarStatus = calendar.calendarStatusForMode(mode);

  var nextStation = normalizeStationInput(
    Object.assign({}, station, {
      is_reference_station: true,
      is_operational_station: false,
      operational_visibility: false,
      station_role_type: 'primary_reference',
      primary_reference: true,
      reference_station_id: '',
      reference_station_name_ar: '',
      dur_reference_station: '',
      reference_inheritance: null,
      id: station.id
    }),
    station
  );

  nextStation.reference_promotion_status = 'promoted_independent_reference';
  nextStation.reference_promotion_at = promotedAt;
  nextStation.reference_calendar_status = calendarStatus;
  nextStation.requires_calibration = true;
  nextStation.reference_station_name = calendar.stationNameAr(station);

  list[idx] = nextStation;
  await writeJsonFile('stations', list);
  await writeJsonFile('true_final_station_reference', trueFinalDoc);

  var auditRecord = {
    station_id: stationId,
    station_name: targetName,
    previous: {
      is_reference_station: !!station.is_reference_station,
      reference_station_id: prevRefId,
      reference_station_name: prevRefName
    },
    next: {
      is_reference_station: true,
      reference_station_id: null,
      reference_station_name: targetName
    },
    calendar_generation_mode: mode,
    source_reference_station_id: sourceResolved.station_id || explicitSourceId || prevRefId || '',
    source_reference_station_name: sourceName,
    annual_flat_rows_created: built.annual_rows_created,
    shift_days: built.shift_days,
    source_suhail_date: built.source_suhail_date,
    target_suhail_date: built.target_suhail_date,
    requires_calibration: true,
    reason: reason,
    changed_by: actor,
    changed_at: promotedAt,
    source: 'promote_operational_station_to_reference',
    backup_key: backup.key
  };

  var savedAudit = await promotionStore.appendAudit(auditRecord);

  return {
    ok: true,
    station_id: stationId,
    station_name: targetName,
    station: nextStation,
    audit: savedAudit,
    backup_key: backup.key,
    calendar_generation_mode: mode,
    reference_calendar_status: calendarStatus,
    annual_flat_rows_created: built.annual_rows_created,
    shift_days: built.shift_days,
    source_suhail_date: built.source_suhail_date,
    target_suhail_date: built.target_suhail_date,
    copied_from_reference_station_id: sourceResolved.station_id || explicitSourceId || prevRefId || '',
    copied_from_reference_station_name: sourceName,
    requires_calibration: true,
    calibration_notice:
      mode === MODES.copy_from_reference
        ? 'تقويم أولي منسوخ — يحتاج معايرة'
        : 'تقويم مزاح بسهيل — يحتاج معايرة'
  };
}

module.exports = {
  promoteReferenceStation: promoteReferenceStation,
  CALENDAR_MODES: MODES
};
