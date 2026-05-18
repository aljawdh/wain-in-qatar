'use strict';

var { readJsonFile, writeJsonFile, createId, nowIso, getKv } = require('./data-store');
var auditStore = require('./reference-dur-audit-store');
var tfLookup = require('../../shared/true-final-station-reference-lookup');
var { utcTodayIso } = require('./station-local-dur-resolver');

var DUR_NAME_LIST = [
  'المقدم', 'المؤخر', 'الرشاء', 'الشرطين', 'البطين', 'الثريا',
  'الدبران', 'الهقعة', 'الهنعة', 'الذراع', 'النثرة', 'الطرفة',
  'الجبهة', 'الزبرة', 'الصرفة', 'العواء', 'السماك', 'الغفر',
  'الزبانا', 'الإكليل', 'القلب', 'الشولة', 'النعايم', 'البلدة',
  'سعد الذابح', 'سعد بلع', 'سعد السعود', 'سعد الأخبية'
];

function nfcStringAr(value) {
  var raw = String(value == null ? '' : value).trim();
  try {
    return raw.normalize ? raw.normalize('NFC') : raw;
  } catch (_e) {
    return raw;
  }
}

function buildDurAllowSet() {
  var set = new Set();
  DUR_NAME_LIST.forEach(function (n) {
    set.add(nfcStringAr(n));
  });
  return set;
}

var DUR_ALLOW_SET = buildDurAllowSet();

function canonicalDurName(input) {
  var n = nfcStringAr(input);
  if (!n || !DUR_ALLOW_SET.has(n)) return null;
  for (var i = 0; i < DUR_NAME_LIST.length; i += 1) {
    if (nfcStringAr(DUR_NAME_LIST[i]) === n) return DUR_NAME_LIST[i];
  }
  return null;
}

function parseMonthDayFlexible(s) {
  var p = tfLookup.parseDayMonthDdMm(s);
  if (p) return p;
  var t = String(s == null ? '' : s).trim();
  var m = t.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  var mo = Number(m[1]);
  var day = Number(m[2]);
  if (!day || !mo || mo > 12 || day > 31) return null;
  return { d: day, m: mo };
}

function toDdMmFromIso(iso) {
  var d = new Date(String(iso).trim() + 'T12:00:00.000Z');
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getUTCDate()).padStart(2, '0') + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function addDaysIso(iso, delta) {
  var d = new Date(String(iso).trim() + 'T12:00:00.000Z');
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function isAsOfInWindowKeys(sKey, eKey, aKey) {
  if (sKey == null || eKey == null || aKey == null) return false;
  if (sKey <= eKey) return aKey >= sKey && aKey <= eKey;
  return aKey >= sKey || aKey <= eKey;
}

function stationNameMatches(rowName, wantName) {
  var wantExact = nfcStringAr(wantName);
  var wantNorm = tfLookup.normalizeArabicName(wantName);
  if (nfcStringAr(rowName) === wantExact) return true;
  if (wantNorm && tfLookup.normalizeArabicName(rowName) === wantNorm) return true;
  return false;
}

function findAnnualFlatCurrentNextGlobalIndices(doc, stationNameAr, asOfIso) {
  var annual = Array.isArray(doc.annual_flat_rows) ? doc.annual_flat_rows : [];
  var matched = [];
  for (var i = 0; i < annual.length; i += 1) {
    var row = annual[i];
    if (!row) continue;
    if (stationNameMatches(row.station_name_ar, stationNameAr)) {
      matched.push({ globalIdx: i, row: row });
    }
  }
  if (!matched.length) return { error: 'station_not_in_annual' };
  var asDate = new Date(String(asOfIso).trim() + 'T12:00:00.000Z');
  if (Number.isNaN(asDate.getTime())) return { error: 'bad_as_of' };
  var asM = asDate.getUTCMonth() + 1;
  var asD = asDate.getUTCDate();
  var aKey = asM * 100 + asD;
  var localIdx = -1;
  for (var k = 0; k < matched.length; k += 1) {
    var rowK = matched[k].row;
    var pStart = parseMonthDayFlexible(rowK.start_md);
    var pEnd = parseMonthDayFlexible(rowK.end_md);
    if (!pStart || !pEnd) continue;
    var sKey = pStart.m * 100 + pStart.d;
    var eKey = pEnd.m * 100 + pEnd.d;
    if (isAsOfInWindowKeys(sKey, eKey, aKey)) {
      localIdx = k;
      break;
    }
  }
  if (localIdx < 0) return { error: 'no_window_for_date', matched_len: matched.length };
  var nextLocal = (localIdx + 1) % matched.length;
  return {
    currentGlobalIdx: matched[localIdx].globalIdx,
    nextGlobalIdx: matched[nextLocal].globalIdx,
    localIdx: localIdx,
    nextLocalIdx: nextLocal
  };
}

function isReferenceStation(station, nameNormSet) {
  if (!station) return false;
  if (station.is_reference_station === true) return true;
  if (String(station.role_type || station.station_role || '') === 'primary_reference') return true;
  var key = tfLookup.normalizeArabicName(station.name_ar || station.name || '');
  return !!(key && nameNormSet && nameNormSet.has(key));
}

function snapshotFromTfState(tf, stationNameAr) {
  if (!tf || !tf.ok) {
    return {
      current_dur: '',
      dur_day: null,
      elapsed_days: null,
      remaining_days: null,
      next_dur: ''
    };
  }
  return {
    current_dur: tf.current_dur_name_ar || tf.current_dur || '',
    dur_day: tf.day_in_dur != null ? tf.day_in_dur : tf.current_dur_day,
    elapsed_days: tf.day_in_dur != null ? tf.day_in_dur : null,
    remaining_days: tf.remaining_days != null ? tf.remaining_days : tf.days_remaining_in_dur,
    next_dur: tf.next_dur_name_ar || tf.next_dur || '',
    station_name_ar: tf.station_name_ar || stationNameAr
  };
}

function findStationRowInDoc(doc, station) {
  var list = Array.isArray(doc.stations) ? doc.stations : [];
  var nameAr = station.name_ar || station.name || '';
  var idx = -1;
  if (station.id) {
    idx = list.findIndex(function (r) {
      return r && String(r.station_id || '') === String(station.id);
    });
  }
  if (idx < 0 && nameAr) {
    idx = list.findIndex(function (r) {
      return r && stationNameMatches(r.station_name_ar, nameAr);
    });
  }
  return { idx: idx, list: list };
}

function syncStationsSheetRow(doc, station, patch) {
  var found = findStationRowInDoc(doc, station);
  var list = found.list;
  if (found.idx < 0) return false;
  var row = Object.assign({}, list[found.idx], patch);
  list[found.idx] = row;
  doc.stations = list;
  return true;
}

function computeWindowMdFromMetrics(asOfIso, durDay, remainingDays) {
  var dDay = Math.round(Number(durDay));
  var rem = Math.round(Number(remainingDays));
  var totalLen = dDay + rem;
  var startIso = addDaysIso(asOfIso, -(dDay - 1));
  var endIso = addDaysIso(startIso, totalLen - 1);
  return {
    start_md: toDdMmFromIso(startIso),
    end_md: toDdMmFromIso(endIso),
    length_days: totalLen
  };
}

async function loadTrueFinalDoc() {
  return readJsonFile('true_final_station_reference', { version: 0, stations: [], annual_flat_rows: [] });
}

async function getReferenceDurHealthList(asOfIso) {
  asOfIso = asOfIso && /^\d{4}-\d{2}-\d{2}$/.test(asOfIso) ? asOfIso : utcTodayIso();
  var stations = await readJsonFile('stations', []);
  var doc = await loadTrueFinalDoc();
  var nameSet = tfLookup.buildTrueFinalStationNameNormSet(doc);
  var refs = stations.filter(function (s) {
    return isReferenceStation(s, nameSet);
  });
  var auditsByStation = {};
  var rows = [];
  for (var i = 0; i < refs.length; i += 1) {
    var st = refs[i];
    var nameAr = String(st.name_ar || st.name || '').trim();
    var tf = tfLookup.getTrueFinalDurState(doc, { station_name_ar: nameAr, asOfIso: asOfIso });
    var audits = auditsByStation[st.id];
    if (!audits) {
      audits = await auditStore.listAuditsForStation(st.id, 1);
      auditsByStation[st.id] = audits;
    }
    var lastAudit = audits[0] || null;
    rows.push({
      station_id: st.id,
      station_name: nameAr,
      station_name_ar: nameAr,
      country: st.country || '',
      region: st.region || st.latitude_band_key || '',
      as_of_iso: asOfIso,
      current_dur: tf.ok ? (tf.current_dur_name_ar || '') : '',
      dur_day: tf.ok ? (tf.day_in_dur != null ? tf.day_in_dur : null) : null,
      elapsed_days: tf.ok ? (tf.day_in_dur != null ? tf.day_in_dur : null) : null,
      remaining_days: tf.ok ? (tf.remaining_days != null ? tf.remaining_days : null) : null,
      next_dur: tf.ok ? (tf.next_dur_name_ar || '') : '',
      lookup_ok: !!tf.ok,
      lookup_error: tf.ok ? null : (tf.code || tf.message || 'lookup_failed'),
      timing_source: 'true_final_station_reference',
      kv_store_key: 'navidur_store_true_final_station_reference',
      last_audit: lastAudit
        ? {
            id: lastAudit.id,
            changed_at: lastAudit.changed_at,
            changed_by: lastAudit.changed_by,
            reason: lastAudit.reason
          }
        : null,
      status: tf.ok ? 'ok' : 'lookup_error'
    });
  }
  return {
    ok: true,
    as_of_iso: asOfIso,
    total: rows.length,
    dur_name_list: DUR_NAME_LIST.slice(),
    rows: rows
  };
}

function validateSavePayload(body, station, nameNormSet) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body_required' };
  }
  if (!station) {
    return { ok: false, error: 'station_not_found' };
  }
  if (!isReferenceStation(station, nameNormSet)) {
    return { ok: false, error: 'not_reference_station' };
  }
  var currentDur = canonicalDurName(body.current_dur);
  var nextDur = canonicalDurName(body.next_dur);
  if (!currentDur) return { ok: false, error: 'invalid_current_dur' };
  if (!nextDur) return { ok: false, error: 'invalid_next_dur' };
  var durDay = Number(body.dur_day);
  var elapsed = body.elapsed_days != null && body.elapsed_days !== '' ? Number(body.elapsed_days) : durDay;
  var remaining = Number(body.remaining_days);
  if (!Number.isFinite(durDay) || durDay < 1 || durDay > 400) {
    return { ok: false, error: 'invalid_dur_day' };
  }
  if (!Number.isFinite(elapsed) || elapsed < 1) {
    return { ok: false, error: 'invalid_elapsed_days' };
  }
  if (!Number.isFinite(remaining) || remaining < 0) {
    return { ok: false, error: 'invalid_remaining_days' };
  }
  var reason = String(body.reason || '').trim();
  if (reason.length < 10) {
    return { ok: false, error: 'reason_too_short' };
  }
  var asOfIso = String(body.as_of_iso || utcTodayIso()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) {
    return { ok: false, error: 'invalid_as_of_iso' };
  }
  return {
    ok: true,
    currentDur: currentDur,
    nextDur: nextDur,
    durDay: Math.round(durDay),
    elapsed: Math.round(elapsed),
    remaining: Math.round(remaining),
    reason: reason,
    asOfIso: asOfIso
  };
}

async function savePrimaryReferenceDur(body, actor) {
  if (!actor || !String(actor).trim()) {
    return { ok: false, error: 'admin_user_required' };
  }
  if (!getKv() && process.env.VERCEL) {
    return { ok: false, error: 'kv_required_for_primary_save' };
  }
  var stationId = String(body.station_id || '').trim();
  if (!stationId) return { ok: false, error: 'station_id_required' };
  var stations = await readJsonFile('stations', []);
  var station = stations.find(function (s) { return s && s.id === stationId; });
  var doc = await loadTrueFinalDoc();
  var nameSet = tfLookup.buildTrueFinalStationNameNormSet(doc);
  var v = validateSavePayload(body, station, nameSet);
  if (!v.ok) return v;

  var stationNameAr = String(station.name_ar || station.name || '').trim();
  var loc = findAnnualFlatCurrentNextGlobalIndices(doc, stationNameAr, v.asOfIso);
  if (loc.error) {
    return { ok: false, error: loc.error, detail: loc };
  }

  var beforeTf = tfLookup.getTrueFinalDurState(doc, { station_name_ar: stationNameAr, asOfIso: v.asOfIso });
  var previous = snapshotFromTfState(beforeTf, stationNameAr);
  previous._annual_indices = { current: loc.currentGlobalIdx, next: loc.nextGlobalIdx };

  var backup = await auditStore.saveBackupSnapshot(JSON.parse(JSON.stringify(doc)));

  var window = computeWindowMdFromMetrics(v.asOfIso, v.durDay, v.remaining);
  var curRow = doc.annual_flat_rows[loc.currentGlobalIdx];
  var nextRow = doc.annual_flat_rows[loc.nextGlobalIdx];
  if (!curRow || !nextRow) {
    return { ok: false, error: 'annual_flat_index_corrupt' };
  }

  doc.annual_flat_rows[loc.currentGlobalIdx] = Object.assign({}, curRow, {
    dur_name_ar: v.currentDur,
    start_md: window.start_md,
    end_md: window.end_md,
    length_days: window.length_days
  });
  doc.annual_flat_rows[loc.nextGlobalIdx] = Object.assign({}, nextRow, {
    dur_name_ar: v.nextDur
  });

  syncStationsSheetRow(doc, station, {
    reference_date_md: toDdMmFromIso(v.asOfIso),
    current_dur_name_ar: v.currentDur,
    current_dur_day_sheet: v.durDay,
    elapsed_days_sheet: v.elapsed,
    remaining_days_sheet: v.remaining,
    next_dur_name_ar: v.nextDur,
    current_dur_start_md: window.start_md,
    current_dur_end_md: window.end_md,
    _reference_dur_health_edited_at: nowIso(),
    _reference_dur_health_edited_by: String(actor)
  });

  doc._reference_dur_health_last_edit_at = nowIso();
  doc._reference_dur_health_last_edit_by = String(actor);
  await writeJsonFile('true_final_station_reference', doc);

  var afterDoc = await loadTrueFinalDoc();
  var afterTf = tfLookup.getTrueFinalDurState(afterDoc, { station_name_ar: stationNameAr, asOfIso: v.asOfIso });
  var nextSnap = snapshotFromTfState(afterTf, stationNameAr);

  var auditRec = await auditStore.appendAudit({
    id: createId('rda'),
    station_id: stationId,
    station_name: stationNameAr,
    previous: {
      current_dur: previous.current_dur,
      dur_day: previous.dur_day,
      elapsed_days: previous.elapsed_days,
      remaining_days: previous.remaining_days,
      next_dur: previous.next_dur,
      annual_indices: previous._annual_indices,
      current_row: curRow,
      next_row: nextRow
    },
    next: {
      current_dur: v.currentDur,
      dur_day: v.durDay,
      elapsed_days: v.elapsed,
      remaining_days: v.remaining,
      next_dur: v.nextDur,
      start_md: window.start_md,
      end_md: window.end_md,
      annual_indices: { current: loc.currentGlobalIdx, next: loc.nextGlobalIdx }
    },
    reason: v.reason,
    changed_by: String(actor),
    changed_at: nowIso(),
    source: 'reference_dur_health_panel',
    applied_as_primary: true,
    backup_key: backup.key,
    kv_primary_key: 'navidur_store_true_final_station_reference'
  });

  return {
    ok: true,
    audit: auditRec,
    backup_key: backup.key,
    analysis_after_save: afterTf,
    primary_store: {
      file: 'true_final_station_reference.json',
      kv_key: 'navidur_store_true_final_station_reference',
      field: 'annual_flat_rows'
    }
  };
}

async function rollbackReferenceDur(body, actor) {
  if (!actor || !String(actor).trim()) {
    return { ok: false, error: 'admin_user_required' };
  }
  var stationId = String(body.station_id || '').trim();
  var auditId = String(body.audit_id || '').trim();
  if (!stationId) return { ok: false, error: 'station_id_required' };

  var audits = await auditStore.listAuditsForStation(stationId, 50);
  var target = null;
  if (auditId) {
    target = await auditStore.getAudit(auditId);
  } else {
    target = audits[0] || null;
  }
  if (!target || String(target.station_id) !== stationId) {
    return { ok: false, error: 'audit_not_found' };
  }
  if (!target.previous || !target.previous.annual_indices) {
    return { ok: false, error: 'audit_missing_rollback_payload' };
  }

  var doc = await loadTrueFinalDoc();
  await auditStore.saveBackupSnapshot(JSON.parse(JSON.stringify(doc)));

  var idxCur = target.previous.annual_indices.current;
  var idxNext = target.previous.annual_indices.next;
  if (target.previous.current_row) {
    doc.annual_flat_rows[idxCur] = JSON.parse(JSON.stringify(target.previous.current_row));
  }
  if (target.previous.next_row) {
    doc.annual_flat_rows[idxNext] = JSON.parse(JSON.stringify(target.previous.next_row));
  }

  var stations = await readJsonFile('stations', []);
  var station = stations.find(function (s) { return s && s.id === stationId; });
  if (station) {
    syncStationsSheetRow(doc, station, {
      current_dur_name_ar: target.previous.current_dur || '',
      current_dur_day_sheet: target.previous.dur_day,
      elapsed_days_sheet: target.previous.elapsed_days,
      remaining_days_sheet: target.previous.remaining_days,
      next_dur_name_ar: target.previous.next_dur || '',
      _reference_dur_health_rolled_back_at: nowIso()
    });
  }

  await writeJsonFile('true_final_station_reference', doc);
  var nameAr = target.station_name || (station && (station.name_ar || station.name)) || '';
  var asOfIso = utcTodayIso();
  var afterTf = tfLookup.getTrueFinalDurState(doc, { station_name_ar: nameAr, asOfIso: asOfIso });

  var rollbackAudit = await auditStore.appendAudit({
    id: createId('rda'),
    station_id: stationId,
    station_name: nameAr,
    previous: target.next,
    next: target.previous,
    reason: 'rollback:' + (body.reason || 'restore previous primary dur state'),
    changed_by: String(actor),
    changed_at: nowIso(),
    source: 'reference_dur_health_panel',
    applied_as_primary: true,
    rollback_of: target.id
  });

  return {
    ok: true,
    rolled_back_audit_id: target.id,
    audit: rollbackAudit,
    analysis_after_rollback: afterTf
  };
}

module.exports = {
  DUR_NAME_LIST: DUR_NAME_LIST,
  getReferenceDurHealthList: getReferenceDurHealthList,
  savePrimaryReferenceDur: savePrimaryReferenceDur,
  listAuditsForStation: auditStore.listAuditsForStation,
  rollbackReferenceDur: rollbackReferenceDur,
  isReferenceStation: isReferenceStation,
  canonicalDurName: canonicalDurName
};
