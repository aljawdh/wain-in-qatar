'use strict';

var { readJsonFile, writeJsonFile, nowIso } = require('./data-store');
var { cleanString } = require('./security');
var { normalizeStationInput } = require('./stations');
var promotionStore = require('./reference-station-promotion-store');
var tfLookup = require('../../shared/true-final-station-reference-lookup');

function stationNameAr(station) {
  return cleanString(station && (station.name_ar || station.name), 120);
}

function stationNameMatches(rowName, wantName) {
  var wantExact = tfLookup.nfcString ? tfLookup.nfcString(wantName) : String(wantName || '').trim();
  var wantNorm = tfLookup.normalizeArabicName(wantName);
  var rowExact = tfLookup.nfcString ? tfLookup.nfcString(rowName) : String(rowName || '').trim();
  if (rowExact === wantExact) return true;
  if (wantNorm && tfLookup.normalizeArabicName(rowName) === wantNorm) return true;
  return false;
}

function hasTrueFinalStationEntry(doc, nameAr) {
  var list = Array.isArray(doc && doc.stations) ? doc.stations : [];
  for (var i = 0; i < list.length; i += 1) {
    if (stationNameMatches(list[i] && list[i].station_name_ar, nameAr)) return true;
  }
  return false;
}

function hasAnnualFlatRows(doc, nameAr) {
  var annual = Array.isArray(doc && doc.annual_flat_rows) ? doc.annual_flat_rows : [];
  for (var i = 0; i < annual.length; i += 1) {
    if (stationNameMatches(annual[i] && annual[i].station_name_ar, nameAr)) return true;
  }
  return false;
}

function findStationById(list, id) {
  var safe = cleanString(id, 80);
  if (!safe) return null;
  for (var i = 0; i < list.length; i += 1) {
    if (list[i] && String(list[i].id) === safe) return list[i];
  }
  return null;
}

function resolveCopySourceStation(station, stationsList) {
  var refId = cleanString(station.reference_station_id, 80);
  if (refId) {
    var linked = findStationById(stationsList, refId);
    if (linked) {
      return {
        station: linked,
        station_id: linked.id,
        station_name: stationNameAr(linked),
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
        station_name: stationNameAr(byDurId),
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

function copyTrueFinalStationEntry(doc, sourceNameAr, targetStation) {
  var list = Array.isArray(doc.stations) ? doc.stations : [];
  var targetName = stationNameAr(targetStation);
  var src = null;
  for (var i = 0; i < list.length; i += 1) {
    if (stationNameMatches(list[i] && list[i].station_name_ar, sourceNameAr)) {
      src = list[i];
      break;
    }
  }
  if (!src) return { copied: false, reason: 'source_station_entry_missing' };
  var entry = Object.assign({}, src, {
    station_name_ar: targetName,
    lat: targetStation.lat != null ? targetStation.lat : src.lat,
    lon: targetStation.lon != null ? targetStation.lon : src.lon,
    region: cleanString(targetStation.region, 80) || src.region || 'الخليج'
  });
  list.push(entry);
  doc.stations = list;
  return { copied: true, entry: entry };
}

function copyAnnualFlatRows(doc, sourceNameAr, targetStation, copiedFromId) {
  var annual = Array.isArray(doc.annual_flat_rows) ? doc.annual_flat_rows : [];
  var targetName = stationNameAr(targetStation);
  var added = 0;
  for (var i = 0; i < annual.length; i += 1) {
    var row = annual[i];
    if (!row || !stationNameMatches(row.station_name_ar, sourceNameAr)) continue;
    var clone = Object.assign({}, row, {
      station_name_ar: targetName,
      copied_from_reference_station_id: copiedFromId || '',
      calibration_status: 'initial_copied_reference'
    });
    annual.push(clone);
    added += 1;
  }
  doc.annual_flat_rows = annual;
  return added;
}

async function promoteReferenceStation(input) {
  var stationId = cleanString(input && input.station_id, 80);
  var reason = cleanString(input && input.reason, 800) || '';
  var actor = cleanString(input && input.actor, 80) || 'admin';
  if (!stationId) {
    return { ok: false, error: 'station_id_required' };
  }

  var stations = await readJsonFile('stations', []);
  var list = Array.isArray(stations) ? stations : [];
  var idx = list.findIndex(function (s) {
    return s && String(s.id) === stationId;
  });
  if (idx < 0) {
    return { ok: false, error: 'station_not_found', station_id: stationId };
  }

  var station = list[idx];
  if (station.is_reference_station === true) {
    return { ok: false, error: 'already_reference_station', station_id: stationId };
  }

  var targetName = stationNameAr(station);
  var prevRefId = cleanString(station.reference_station_id, 80) || null;
  var prevRefRow = prevRefId ? findStationById(list, prevRefId) : null;
  var prevRefName = prevRefRow ? stationNameAr(prevRefRow) : cleanString(station.reference_station_name_ar, 120) || '';

  var copySource = resolveCopySourceStation(station, list);
  if (!copySource || !copySource.station_name) {
    return {
      ok: false,
      error: 'reference_source_unresolved',
      station_id: stationId,
      hint: 'Set reference_station_id or reference_station_name_ar before promotion'
    };
  }

  var trueFinalBefore = await readJsonFile('true_final_station_reference', {
    version: 0,
    stations: [],
    annual_flat_rows: []
  });
  var stationsBefore = JSON.parse(JSON.stringify(list));

  var backup = await promotionStore.saveBackupSnapshot({
    stations: stationsBefore,
    true_final_station_reference: JSON.parse(JSON.stringify(trueFinalBefore))
  });

  var trueFinalDoc = JSON.parse(JSON.stringify(trueFinalBefore));
  var hadStationEntry = hasTrueFinalStationEntry(trueFinalDoc, targetName);
  var hadAnnual = hasAnnualFlatRows(trueFinalDoc, targetName);

  var trueFinalAction = 'unchanged';
  var annualRowsCopied = 0;

  if (!hadStationEntry) {
    var stationCopy = copyTrueFinalStationEntry(
      trueFinalDoc,
      copySource.station_name,
      station
    );
    if (stationCopy.copied) {
      trueFinalAction = 'copied_from_existing_reference';
    } else {
      trueFinalAction = 'station_entry_copy_failed';
    }
  } else {
    trueFinalAction = 'station_entry_already_present';
  }

  if (!hadAnnual) {
    annualRowsCopied = copyAnnualFlatRows(
      trueFinalDoc,
      copySource.station_name,
      station,
      copySource.station_id || prevRefId || ''
    );
    if (annualRowsCopied > 0 && trueFinalAction.indexOf('copy') < 0) {
      trueFinalAction = 'copied_annual_flat_from_reference';
    }
  }

  trueFinalDoc._reference_promotion_updated_at = nowIso();
  trueFinalDoc._reference_promotion_station_id = stationId;

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
    true_final_action: trueFinalAction,
    copied_from_reference_station_id: copySource.station_id || prevRefId || '',
    copied_from_reference_station_name: copySource.station_name,
    annual_flat_rows_copied: annualRowsCopied,
    had_true_final_station_entry: hadStationEntry,
    had_annual_flat_rows: hadAnnual,
    reason: reason,
    changed_by: actor,
    changed_at: nowIso(),
    source: 'promote_reference_station_panel',
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
    true_final_action: trueFinalAction,
    annual_flat_rows_copied: annualRowsCopied,
    copied_from_reference_station_id: copySource.station_id || prevRefId || '',
    copied_from_reference_station_name: copySource.station_name
  };
}

module.exports = {
  promoteReferenceStation: promoteReferenceStation,
  stationNameAr: stationNameAr,
  hasAnnualFlatRows: hasAnnualFlatRows,
  hasTrueFinalStationEntry: hasTrueFinalStationEntry
};
