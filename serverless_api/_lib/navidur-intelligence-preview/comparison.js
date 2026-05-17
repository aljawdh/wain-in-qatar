'use strict';

var C = require('./constants');

function parseTs(value) {
  var t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : null;
}

function metricFromSnapshot(snap) {
  var marine = snap && snap.observed_marine ? snap.observed_marine : {};
  var live = snap && snap.live_analysis_outputs ? snap.live_analysis_outputs : {};
  return {
    confidence: live.confidence_score != null ? Number(live.confidence_score) : (snap.confidence_score != null ? Number(snap.confidence_score) : null),
    wave_height_m: marine.wave_height_m != null ? Number(marine.wave_height_m) : null,
    current_speed_ms: marine.current_speed_ms != null ? Number(marine.current_speed_ms) : null,
    tide_state: live.tide_state != null ? String(live.tide_state) : null
  };
}

function diffMetric(current, past, key) {
  var c = current[key];
  var p = past[key];
  if (c == null || p == null || !Number.isFinite(c) || !Number.isFinite(p)) {
    return { delta: null, direction: 'unknown' };
  }
  var delta = Number((c - p).toFixed(3));
  var direction = 'stable';
  if (delta > 0.05) direction = 'up';
  if (delta < -0.05) direction = 'down';
  return { delta: delta, direction: direction };
}

function pickSnapshotNear(snapshots, targetMs, windowMs) {
  var best = null;
  var bestDiff = Infinity;
  for (var i = 0; i < snapshots.length; i += 1) {
    var ts = parseTs(snapshots[i].timestamp);
    if (ts == null) continue;
    var diff = Math.abs(ts - targetMs);
    if (diff <= windowMs && diff < bestDiff) {
      bestDiff = diff;
      best = snapshots[i];
    }
  }
  return best;
}

/**
 * @param {object} currentMetrics
 * @param {Array} snapshots newest-first
 */
function buildComparison(currentMetrics, snapshots) {
  var reasons = [];
  if (!Array.isArray(snapshots) || !snapshots.length) {
    return {
      has_history: false,
      vs_previous: {},
      vs_24h: {},
      vs_7d: {},
      trend: 'unknown',
      reasons: ['no_snapshots']
    };
  }

  var now = Date.now();
  var prev = snapshots.length > 1 ? snapshots[1] : null;
  var snap24 = pickSnapshotNear(snapshots, now - 24 * 60 * 60 * 1000, 6 * 60 * 60 * 1000);
  var snap7d = pickSnapshotNear(snapshots, now - 7 * 24 * 60 * 60 * 1000, 36 * 60 * 60 * 1000);

  var vsPrevious = prev ? {
    confidence: diffMetric(currentMetrics, metricFromSnapshot(prev), 'confidence'),
    wave_height_m: diffMetric(currentMetrics, metricFromSnapshot(prev), 'wave_height_m'),
    snapshot_id: prev.snapshot_id || null,
    timestamp: prev.timestamp || null
  } : {};

  var vs24 = snap24 ? {
    confidence: diffMetric(currentMetrics, metricFromSnapshot(snap24), 'confidence'),
    wave_height_m: diffMetric(currentMetrics, metricFromSnapshot(snap24), 'wave_height_m'),
    snapshot_id: snap24.snapshot_id || null,
    timestamp: snap24.timestamp || null
  } : {};

  var vs7d = snap7d ? {
    confidence: diffMetric(currentMetrics, metricFromSnapshot(snap7d), 'confidence'),
    wave_height_m: diffMetric(currentMetrics, metricFromSnapshot(snap7d), 'wave_height_m'),
    snapshot_id: snap7d.snapshot_id || null,
    timestamp: snap7d.timestamp || null
  } : {};

  var trend = 'unknown';
  var confDelta = vs7d.confidence && vs7d.confidence.delta != null ? vs7d.confidence.delta : (vs24.confidence && vs24.confidence.delta);
  if (confDelta != null) {
    if (confDelta >= 5) {
      trend = 'improving';
      reasons.push('confidence_up_vs_history');
    } else if (confDelta <= -5) {
      trend = 'declining';
      reasons.push('confidence_down_vs_history');
    } else {
      trend = 'stable';
      reasons.push('confidence_stable_vs_history');
    }
  } else {
    reasons.push('confidence_history_unavailable');
  }

  return {
    has_history: true,
    vs_previous: vsPrevious,
    vs_24h: vs24,
    vs_7d: vs7d,
    trend: trend,
    reasons: reasons
  };
}

module.exports = {
  buildComparison: buildComparison,
  metricFromSnapshot: metricFromSnapshot
};
