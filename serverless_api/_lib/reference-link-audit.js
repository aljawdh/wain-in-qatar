'use strict';

const { readJsonFile } = require('./data-store');
const { cleanString } = require('./security');
const { utcTodayIso } = require('./station-local-dur-resolver');
const { getTrueFinalDurState } = require('../../shared/true-final-station-reference-lookup');
const { resolveReferenceStationForDurInheritance } = require('../../shared/navidur-analysis-engine');

const TF_KEYS = [
  'current_dur_name_ar',
  'day_in_dur',
  'days_remaining_in_dur',
  'next_dur_name_ar',
  'period_start_mmdd',
  'period_end_mmdd'
];

function safeTfExtract(tf) {
  if (!tf || !tf.ok) return null;
  const o = {};
  var i;
  for (i = 0; i < TF_KEYS.length; i += 1) {
    o[TF_KEYS[i]] = tf[TF_KEYS[i]] != null ? tf[TF_KEYS[i]] : null;
  }
  return o;
}

function compareTrueFinalDur(a, b) {
  if (!a && !b) return { match: true, differences: [] };
  if (!a || !b) {
    return {
      match: false,
      differences: [{ field: '_entire', expected: a, actual: b }]
    };
  }
  const differences = [];
  var i;
  for (i = 0; i < TF_KEYS.length; i += 1) {
    const k = TF_KEYS[i];
    if (a[k] !== b[k]) {
      differences.push({ field: k, expected: a[k], actual: b[k] });
    }
  }
  return { match: differences.length === 0, differences: differences };
}

function findStationById(list, id) {
  if (!id) return null;
  const want = String(id).trim();
  var j;
  for (j = 0; j < list.length; j += 1) {
    if (list[j] && String(list[j].id) === want) {
      return list[j];
    }
  }
  return null;
}

function buildNoteAr(row) {
  if (row.station_type === 'reference') {
    return 'مطابق';
  }
  if (row.match_status === 'ok' && row.reference_resolution_source === 'manual' && row.dur_state_match) {
    return 'مطابق';
  }
  if (row.match_status === 'ok' && row.reference_resolution_source === 'auto') {
    return 'يستخدم ربط تلقائي';
  }
  if (row.match_status === 'mismatch' && (row.dur_state_match === false || row.dur_state_match == null)) {
    if (row.resolution_method === 'manual' && row.reference_resolution_source === 'manual') {
      if (row.true_final_dur_mismatch_fields && row.true_final_dur_mismatch_fields.length) {
        return 'اختلاف في بيانات الدور بين التحليل والملف الحقيقي';
      }
    }
    return 'اختلاف في المرجع المستخدم';
  }
  if (row.match_status === 'invalid_reference') {
    if (row.resolution_method === 'manual_invalid' && row.resolution_error === 'manual_reference_not_found') {
      return 'المحطة المرجعية غير موجودة';
    }
    if (row.resolution_method === 'manual_invalid' && row.resolution_error === 'manual_target_not_reference') {
      return 'المعرّف المرتبط ليس محطة مرجعية';
    }
    return 'بيانات مرجع غير صالحة';
  }
  if (row.match_status === 'missing_reference') {
    return 'لا يوجد ربط مرجعي';
  }
  if (row.match_status === 'ok' && row.reference_resolution_source === 'manual' && row.dur_state_match === false) {
    return 'اختلاف في بيانات الدور بين التحليل والملف الحقيقي';
  }
  if (row.match_status === 'ok' && row.reference_resolution_source === 'none' && !row.reference_station_id) {
    if (row.resolution_method === 'unresolved' || !row.resolved_reference_station_id) {
      return 'لا يوجد ربط مرجعي';
    }
  }
  if (row.match_status === 'ok') {
    return 'مطابق';
  }
  return '—';
}

/**
 * @returns {Promise<object>}
 */
async function buildReferenceLinkAudit() {
  const list = await readJsonFile('stations', []);
  const stations = Array.isArray(list) ? list : [];
  const tfrDoc = await readJsonFile('true_final_station_reference', { version: 0, stations: [] });
  const asOfIso = utcTodayIso() || new Date().toISOString().slice(0, 10);

  const rows = [];
  var i;
  for (i = 0; i < stations.length; i += 1) {
    const s = stations[i];
    if (!s) continue;
    const stationId = s.id != null ? cleanString(String(s.id), 80) || String(s.id) : '';
    const stationName = s.name != null ? cleanString(String(s.name), 120) : '';
    const isRef = !!s.is_reference_station;
    const stationType = isRef ? 'reference' : 'operational';

    const res = resolveReferenceStationForDurInheritance(s, stations);
    const refIdRaw = !isRef ? cleanString(s.reference_station_id, 80) : '';
    const storedRef = refIdRaw && String(refIdRaw).trim() ? String(refIdRaw).trim() : null;

    const actual = res.source
      ? {
        id: res.source.id != null ? String(res.source.id) : null,
        name: res.source.name != null ? String(res.source.name) : null
      }
      : { id: null, name: null };

    let sourceTag = 'none';
    if (isRef) {
      sourceTag = 'none';
    } else if (storedRef) {
      sourceTag = 'manual';
    } else if (res.source && (res.method === 'same_band' || res.method === 'nearest')) {
      sourceTag = 'auto';
    } else {
      sourceTag = 'none';
    }

    var tfFromLinkedReferenceRow = null;
    var tfActual = null;

    if (!isRef && tfrDoc && asOfIso) {
      if (res.source) {
        const aSt = res.source;
        const nameForAnalysis = aSt && aSt.name != null ? String(aSt.name) : '';
        if (nameForAnalysis) {
          const ta = getTrueFinalDurState(tfrDoc, { station_name_ar: nameForAnalysis, asOfIso: asOfIso });
          if (ta && ta.ok) {
            tfActual = safeTfExtract(ta);
          }
        }
      }
      if (storedRef) {
        const mRef = findStationById(stations, storedRef);
        if (mRef && mRef.is_reference_station && mRef.name) {
          const te = getTrueFinalDurState(tfrDoc, { station_name_ar: mRef.name, asOfIso: asOfIso });
          if (te && te.ok) {
            tfFromLinkedReferenceRow = safeTfExtract(te);
          }
        }
      }
    }

    var matchStatus = 'ok';
    if (isRef) {
      matchStatus = 'ok';
    } else if (storedRef) {
      if (res.method === 'manual' && res.source && String(res.source.id) === storedRef) {
        matchStatus = 'ok';
      } else if (res.method === 'manual_invalid') {
        matchStatus = 'invalid_reference';
      } else {
        matchStatus = 'mismatch';
      }
    } else {
      if (!res.source) {
        matchStatus = 'missing_reference';
      } else {
        matchStatus = 'ok';
      }
    }

    var durStateMatch = null;
    if (!isRef && storedRef && res.method === 'manual' && res.source && String(res.source.id) === storedRef) {
      if (tfFromLinkedReferenceRow == null && tfActual == null) {
        durStateMatch = null;
      } else if (tfFromLinkedReferenceRow == null || tfActual == null) {
        durStateMatch = false;
        matchStatus = 'mismatch';
      } else {
        const durCmp = compareTrueFinalDur(tfFromLinkedReferenceRow, tfActual);
        durStateMatch = durCmp.match;
        if (!durCmp.match) {
          matchStatus = 'mismatch';
        }
      }
    } else if (!isRef) {
      durStateMatch = null;
    }

    const durDiff =
      !isRef && storedRef && res.method === 'manual' && tfFromLinkedReferenceRow && tfActual
        ? compareTrueFinalDur(tfFromLinkedReferenceRow, tfActual).differences
        : [];

    const row = {
      station_id: stationId,
      station_name: stationName,
      station_type: stationType,
      reference_station_id: storedRef,
      resolved_reference_station_id: actual.id,
      resolved_reference_station_name: actual.name,
      reference_resolution_source: sourceTag,
      expected_reference_from_manual_link: storedRef,
      actual_reference_used_by_analysis: actual.id,
      actual_reference_name_used: actual.name,
      resolution_method: res.method,
      resolution_error: res.error || null,
      match_status: matchStatus,
      as_of: asOfIso,
      true_final_dur_for_expected_manual: tfFromLinkedReferenceRow,
      true_final_dur_for_analysis_reference: tfActual,
      true_final_dur_mismatch_fields: durDiff,
      dur_state_match: durStateMatch,
      weather_uses_operational_local: !isRef
    };
    row.note_ar = buildNoteAr(row);
    rows.push(row);
  }

  return {
    generated_at: new Date().toISOString(),
    as_of: asOfIso,
    weather_policy:
      'الطقس من إحداثيات المحطة التشغيلية؛ يورث التحليل توقيت الدور (DUR) فقط من المحطة المرجعية عبر data/true_final_station_reference.json',
    summary: {
      stations_audited: rows.length,
      mismatch_count: rows.filter((r) => r.match_status === 'mismatch').length,
      invalid_reference_count: rows.filter((r) => r.match_status === 'invalid_reference').length,
      missing_reference_count: rows.filter((r) => r.match_status === 'missing_reference').length,
      resolver_enforcement: 'reference_station_id يمنع الانتقال التلقائي لأقرب/نفس النطاق عند غياب أو خطأ الربط'
    },
    audits: rows,
    mismatches_fixed_in_resolver: 'تم منع override التلقائي عند reference_station_id غير موجود أو ليس مرجعية (shared/navidur-analysis-engine.js)'
  };
}

module.exports = {
  buildReferenceLinkAudit
};
