'use strict';

var RISK_NUM = { low: 1, medium: 2, high: 3, unknown: 0, excellent: 1, good: 1, poor: 3, dangerous: 4 };
var FISH_KEYS = ['coastal_fish', 'bottom_fish', 'pelagic_fish', 'reef_fish'];

var TREND_DEFS = [
  { key: 'sea_surface_temperature', label: 'حرارة سطح البحر', higherBetter: false, metric: 'delta' },
  { key: 'current_speed', label: 'سرعة التيار', higherBetter: false, metric: 'delta' },
  { key: 'wave_height', label: 'ارتفاع الموج', higherBetter: false, metric: 'delta' },
  { key: 'wave_period', label: 'فترة الموج', higherBetter: true, metric: 'delta' },
  { key: 'wind_speed', label: 'سرعة الرياح', higherBetter: false, metric: 'delta' },
  { key: 'tide_level', label: 'مستوى المد', higherBetter: false, metric: 'delta' },
  { key: 'marine_condition_score', label: 'حالة الذكاء البحري', higherBetter: true, metric: 'score' },
  { key: 'confidence', label: 'الثقة', higherBetter: true, metric: 'score' },
  { key: 'fish_activity_avg', label: 'متوسط نشاط الأسماك', higherBetter: true, metric: 'score' },
  { key: 'risk_level', label: 'مستوى المخاطر', higherBetter: false, metric: 'risk' }
];

function toNum(v) {
  var n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fishActivityAverage(groups) {
  if (!groups || typeof groups !== 'object') return null;
  var scores = [];
  FISH_KEYS.forEach(function (k) {
    var g = groups[k];
    if (g && g.score != null) {
      var n = toNum(g.score);
      if (n != null) scores.push(n);
    }
  });
  if (!scores.length) return null;
  return scores.reduce(function (a, b) { return a + b; }, 0) / scores.length;
}

function riskLevelNumeric(risk) {
  if (!risk || typeof risk !== 'object') return null;
  var vals = [risk.boating, risk.shore_activity, risk.diving].map(function (l) {
    return RISK_NUM[String(l || '').toLowerCase()] != null ? RISK_NUM[String(l).toLowerCase()] : 0;
  }).filter(function (v) { return v > 0; });
  if (!vals.length) return null;
  return Math.max.apply(null, vals);
}

function extractPoint(snap) {
  var intel = snap && snap.intelligence ? snap.intelligence : {};
  var mv = snap && snap.marine_variables ? snap.marine_variables : (intel.marine_variables || {});
  var scores = snap && snap.scores ? snap.scores : {};
  var marine = intel.marine_condition || {};
  return {
    timestamp: snap.timestamp || null,
    date: snap.date || null,
    hour: snap.hour != null ? String(snap.hour) : null,
    sea_surface_temperature: toNum(mv.sea_surface_temperature),
    current_speed: toNum(mv.current_speed),
    wave_height: toNum(mv.wave_height),
    wave_period: toNum(mv.wave_period),
    wind_speed: toNum(mv.wind_speed),
    tide_level: toNum(mv.tide_level),
    marine_condition_score: toNum(scores.marine_condition != null ? scores.marine_condition : marine.score),
    confidence: toNum(scores.confidence != null ? scores.confidence : intel.confidence),
    fish_activity_avg: fishActivityAverage(intel.fish_activity_groups),
    risk_level: riskLevelNumeric(intel.risk)
  };
}

function extractSeries(snapshots) {
  return (snapshots || []).map(extractPoint);
}

function stableThreshold(key, current, previous) {
  if (key === 'marine_condition_score' || key === 'confidence' || key === 'fish_activity_avg') return 2;
  if (key === 'risk_level') return 0.5;
  if (key === 'wave_period') return 0.25;
  if (key === 'tide_level') return 0.05;
  if (key === 'sea_surface_temperature') return 0.15;
  if (key === 'current_speed') return 0.08;
  if (key === 'wave_height') return 0.15;
  if (key === 'wind_speed') return 1.5;
  return 0.1;
}

function resolveDirection(def, delta) {
  var thresh = stableThreshold(def.key, 0, 0);
  if (Math.abs(delta) < thresh) return 'stable';
  if (def.metric === 'risk') {
    if (delta > 0) return 'declining';
    return 'improving';
  }
  if (def.metric === 'score') {
    if (delta > 0) return 'improving';
    if (delta < 0) return 'declining';
    return 'stable';
  }
  if (delta > 0) return 'increasing';
  return 'decreasing';
}

function summaryArForTrend(def, direction, delta, days) {
  var period = days === 1 ? 'آخر 24 ساعة' : ('آخر ' + days + ' أيام');
  if (direction === 'stable') return 'استقرار نسبي خلال ' + period;
  if (direction === 'improving') {
    if (def.key === 'marine_condition_score') return 'تحسن في الحالة البحرية خلال ' + period;
    if (def.key === 'confidence') return 'ارتفاع في الثقة خلال ' + period;
    if (def.key === 'fish_activity_avg') return 'تحسن في نشاط الأسماك خلال ' + period;
    if (def.key === 'risk_level') return 'انخفاض في المخاطر خلال ' + period;
    return 'تحسن خلال ' + period;
  }
  if (direction === 'declining') {
    if (def.key === 'marine_condition_score') return 'تراجع في الحالة البحرية خلال ' + period;
    if (def.key === 'risk_level') return 'زيادة في المخاطر خلال ' + period;
    return 'تراجع خلال ' + period;
  }
  if (direction === 'increasing') {
    if (def.key === 'wave_height') return 'ارتفاع في الموج خلال ' + period;
    if (def.key === 'wind_speed') return 'زيادة في الرياح خلال ' + period;
    if (def.key === 'current_speed') return 'زيادة في حركة التيار خلال ' + period;
    if (def.key === 'sea_surface_temperature') return 'ارتفاع طفيف خلال ' + period;
    return 'ارتفاع خلال ' + period;
  }
  if (direction === 'decreasing') {
    if (def.key === 'wave_height') return 'انخفاض في الموج خلال ' + period;
    if (def.key === 'wind_speed') return 'انخفاض في الرياح خلال ' + period;
    return 'انخفاض خلال ' + period;
  }
  return 'لا توجد بيانات كافية';
}

function buildTrendItem(def, series, days) {
  var values = series.map(function (p) { return p[def.key]; }).filter(function (v) { return v != null; });
  if (values.length < 2) {
    return {
      key: def.key,
      label: def.label,
      current: values.length ? values[values.length - 1] : null,
      previous: null,
      delta: null,
      direction: 'unknown',
      summary_ar: 'لا توجد بيانات كافية لهذا المتغير'
    };
  }
  var current = values[values.length - 1];
  var previous = values[0];
  var delta = Math.round((current - previous) * 100) / 100;
  var direction = resolveDirection(def, delta);
  return {
    key: def.key,
    label: def.label,
    current: current,
    previous: previous,
    delta: delta,
    direction: direction,
    summary_ar: summaryArForTrend(def, direction, delta, days)
  };
}

function buildTrends(snapshots, days) {
  var series = extractSeries(snapshots);
  var trends = TREND_DEFS.map(function (def) {
    return buildTrendItem(def, series, days);
  });
  return {
    trends: trends,
    series: series
  };
}

module.exports = {
  TREND_DEFS: TREND_DEFS,
  extractPoint: extractPoint,
  extractSeries: extractSeries,
  buildTrends: buildTrends
};
