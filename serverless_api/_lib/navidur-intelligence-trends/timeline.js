'use strict';

var calculator = require('./calculator');

function formatEventTime(point) {
  if (point && point.hour != null) {
    var h = String(point.hour).padStart(2, '0');
    return h + ':00';
  }
  if (point && point.timestamp) {
    var d = new Date(point.timestamp);
    if (!Number.isNaN(d.getTime())) {
      return String(d.getUTCHours()).padStart(2, '0') + ':00';
    }
  }
  return '—';
}

function levelFromDelta(positive, negative) {
  if (positive) return 'good';
  if (negative) return 'medium';
  return 'stable';
}

function buildMarineTimeline(snapshots) {
  var series = calculator.extractSeries(snapshots);
  var events = [];

  if (series.length < 2) {
    return events;
  }

  for (var i = 1; i < series.length; i += 1) {
    var prev = series[i - 1];
    var curr = series[i];
    var time = formatEventTime(curr);

    if (curr.marine_condition_score != null && prev.marine_condition_score != null) {
      var scoreDelta = curr.marine_condition_score - prev.marine_condition_score;
      if (scoreDelta >= 5) {
        events.push({
          time: time,
          type: 'marine_condition',
          level: 'good',
          message_ar: 'تحسن في الحالة البحرية'
        });
      } else if (scoreDelta <= -5) {
        events.push({
          time: time,
          type: 'marine_condition',
          level: 'poor',
          message_ar: 'تراجع في الحالة البحرية'
        });
      } else if (Math.abs(scoreDelta) < 2) {
        events.push({
          time: time,
          type: 'marine_condition',
          level: 'good',
          message_ar: 'استقرار بحري جيد'
        });
      }
    }

    if (curr.wave_height != null && prev.wave_height != null) {
      var waveDelta = curr.wave_height - prev.wave_height;
      if (waveDelta >= 0.3) {
        events.push({
          time: time,
          type: 'wave',
          level: 'medium',
          message_ar: 'ارتفاع في الموج'
        });
      } else if (waveDelta <= -0.3) {
        events.push({
          time: time,
          type: 'wave',
          level: 'low',
          message_ar: 'انخفاض في الموج'
        });
      }
    }

    if (curr.wind_speed != null && prev.wind_speed != null) {
      var windDelta = curr.wind_speed - prev.wind_speed;
      if (windDelta >= 3) {
        events.push({
          time: time,
          type: 'wind',
          level: 'medium',
          message_ar: 'زيادة في الرياح'
        });
      } else if (windDelta <= -3) {
        events.push({
          time: time,
          type: 'wind',
          level: 'low',
          message_ar: 'انخفاض في الرياح'
        });
      }
    }

    if (curr.current_speed != null && prev.current_speed != null) {
      var curDelta = curr.current_speed - prev.current_speed;
      if (curDelta >= 0.15) {
        events.push({
          time: time,
          type: 'current',
          level: 'medium',
          message_ar: 'زيادة في حركة التيار'
        });
      } else if (Math.abs(curDelta) < 0.05) {
        events.push({
          time: time,
          type: 'current',
          level: 'low',
          message_ar: 'تيار مستقر'
        });
      }
    }

    if (curr.risk_level != null && prev.risk_level != null) {
      var riskDelta = curr.risk_level - prev.risk_level;
      if (riskDelta >= 1) {
        events.push({
          time: time,
          type: 'risk',
          level: 'high',
          message_ar: 'زيادة في المخاطر البحرية'
        });
      } else if (riskDelta <= -1) {
        events.push({
          time: time,
          type: 'risk',
          level: 'good',
          message_ar: 'انخفاض في المخاطر البحرية'
        });
      }
    }
  }

  return events.slice(-40);
}

module.exports = {
  buildMarineTimeline: buildMarineTimeline
};
