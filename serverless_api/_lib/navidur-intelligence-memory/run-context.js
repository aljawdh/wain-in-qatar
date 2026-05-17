'use strict';

var crypto = require('crypto');

var ENGINE_VERSION = 'v1';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function resolveMemoryDateCtx(options) {
  var now = new Date();
  if (options && options.analysis_date && /^\d{4}-\d{2}-\d{2}$/.test(options.analysis_date)) {
    var hour = options.hour && /^\d{1,2}$/.test(String(options.hour))
      ? pad2(Number(options.hour))
      : pad2(now.getUTCHours());
    var iso = options.analysis_date + 'T' + hour + ':00:00.000Z';
    return {
      analysis_date: options.analysis_date,
      hour: hour,
      as_of_iso: iso,
      datetime: iso
    };
  }
  return {
    analysis_date: now.toISOString().slice(0, 10),
    hour: pad2(now.getUTCHours()),
    as_of_iso: now.toISOString(),
    datetime: now.toISOString()
  };
}

function createRunId() {
  var ts = Date.now().toString(36);
  var rnd = crypto.randomBytes(4).toString('hex');
  return 'intel_run_' + ts + '_' + rnd;
}

function buildSnapshotRecord(previewPayload, dateCtx) {
  var st = previewPayload.station || {};
  var intel = previewPayload.intelligence || {};
  var marine = intel.marine_condition || {};
  var trad = intel.traditional_layer || {};
  var dq = previewPayload.data_quality || {};
  var stationId = String(st.id || '');
  var date = dateCtx.analysis_date;
  var hour = dateCtx.hour;

  return {
    id: stationId + '-' + date + '-' + hour,
    station_id: stationId,
    station_name: String(st.name || stationId),
    timestamp: dateCtx.as_of_iso,
    date: date,
    hour: hour,
    source: 'navidur_intelligence_preview',
    mode: 'hourly_memory',
    station: st,
    intelligence: intel,
    data_quality: dq,
    summary_ar: String(intel.summary_ar || ''),
    scores: {
      marine_condition: marine.score != null ? Number(marine.score) : 0,
      confidence: intel.confidence != null ? Number(intel.confidence) : 0,
      data_quality: dq.score != null ? Number(dq.score) : 0
    },
    labels: {
      marine_condition: marine.label != null ? String(marine.label) : 'unknown',
      trend: intel.comparison && intel.comparison.trend ? String(intel.comparison.trend) : 'unknown',
      hamal_fasad: trad.hamal_fasad != null ? String(trad.hamal_fasad) : 'unknown'
    },
    anomalies: Array.isArray(intel.anomalies) ? intel.anomalies.slice() : [],
    meta: {
      engine_version: ENGINE_VERSION,
      read_only_analysis: false,
      created_by: 'hourly_memory_engine'
    }
  };
}

module.exports = {
  ENGINE_VERSION: ENGINE_VERSION,
  resolveMemoryDateCtx: resolveMemoryDateCtx,
  createRunId: createRunId,
  buildSnapshotRecord: buildSnapshotRecord
};
