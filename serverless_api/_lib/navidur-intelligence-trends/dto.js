'use strict';

var INSUFFICIENT_SNAPSHOTS = 6;
var PRELIMINARY_SNAPSHOTS = 12;

function avg(values) {
  var nums = values.filter(function (v) { return v != null && Number.isFinite(Number(v)); });
  if (!nums.length) return null;
  return nums.reduce(function (a, b) { return a + Number(b); }, 0) / nums.length;
}

function buildSignature(snapshots, stationId, days) {
  var count = (snapshots || []).length;
  if (count < INSUFFICIENT_SNAPSHOTS) {
    return {
      station_id: stationId,
      days: days,
      evidence_count: count,
      confidence: 0,
      traits: [],
      summary_ar: 'لا توجد بيانات كافية لبناء بصمة بيئية موثوقة.',
      status: 'insufficient'
    };
  }

  var calculator = require('./calculator');
  var series = calculator.extractSeries(snapshots);
  var traits = [];

  var tempAvg = avg(series.map(function (p) { return p.sea_surface_temperature; }));
  var waveAvg = avg(series.map(function (p) { return p.wave_height; }));
  var currentAvg = avg(series.map(function (p) { return p.current_speed; }));
  var windAvg = avg(series.map(function (p) { return p.wind_speed; }));
  var scoreAvg = avg(series.map(function (p) { return p.marine_condition_score; }));

  if (tempAvg != null) {
    if (tempAvg >= 26 && tempAvg <= 32) traits.push('استقرار حراري جيد');
    else if (tempAvg > 32) traits.push('درجات حرارة مرتفعة نسبيًا');
    else traits.push('درجات حرارة منخفضة نسبيًا');
  }
  if (waveAvg != null) {
    if (waveAvg <= 0.8) traits.push('موج مستقر');
    else if (waveAvg >= 1.4) traits.push('موج مرتفع نسبيًا');
    else traits.push('موج معتدل');
  }
  if (currentAvg != null) {
    if (currentAvg < 0.35) traits.push('تيار خفيف');
    else if (currentAvg <= 0.8) traits.push('تيار خفيف إلى متوسط');
    else traits.push('تيار نشط');
  }
  if (windAvg != null) {
    if (windAvg <= 15) traits.push('رياح معتدلة');
    else if (windAvg >= 25) traits.push('رياح نشطة');
  }
  if (scoreAvg != null) {
    if (scoreAvg >= 70) traits.push('حالة بحرية جيدة بشكل عام');
    else if (scoreAvg < 50) traits.push('حالة بحرية متقلبة');
  }

  var confidence = Math.min(95, Math.round((count / (days * 24)) * 85) + 10);
  if (count < PRELIMINARY_SNAPSHOTS) confidence = Math.min(confidence, 55);

  var summary = 'تظهر المحطة سلوكًا بحريًا ';
  if (scoreAvg != null && scoreAvg >= 65) summary += 'مستقرًا';
  else if (scoreAvg != null && scoreAvg < 50) summary += 'متقلبًا';
  else summary += 'معتدلًا';
  summary += ' خلال الفترة المتاحة.';
  if (count < PRELIMINARY_SNAPSHOTS) {
    summary += ' النتائج أولية وتعتمد على عدد محدود من اللقطات.';
  }

  return {
    station_id: stationId,
    days: days,
    evidence_count: count,
    confidence: confidence,
    traits: traits.slice(0, 6),
    summary_ar: summary,
    status: count < PRELIMINARY_SNAPSHOTS ? 'preliminary' : 'ok'
  };
}

function emptyHistoryMessage() {
  return 'لا توجد بيانات تاريخية كافية بعد. اترك الذاكرة البحرية تعمل لفترة أطول.';
}

function wrapTrendsResponse(payload) {
  var snapshots = payload.snapshots || [];
  if (!snapshots.length) {
    return {
      ok: true,
      station_id: payload.station_id,
      days: payload.days,
      snapshot_count: 0,
      message_ar: emptyHistoryMessage(),
      trends: [],
      series: []
    };
  }
  return {
    ok: true,
    station_id: payload.station_id,
    days: payload.days,
    snapshot_count: snapshots.length,
    message_ar: snapshots.length < PRELIMINARY_SNAPSHOTS
      ? 'النتائج أولية وتعتمد على عدد محدود من اللقطات.'
      : '',
    trends: payload.trends || [],
    series: payload.series || []
  };
}

function wrapTimelineResponse(payload) {
  var snapshots = payload.snapshots || [];
  if (!snapshots.length) {
    return {
      ok: true,
      station_id: payload.station_id,
      days: payload.days,
      snapshot_count: 0,
      message_ar: emptyHistoryMessage(),
      events: []
    };
  }
  return {
    ok: true,
    station_id: payload.station_id,
    days: payload.days,
    snapshot_count: snapshots.length,
    message_ar: snapshots.length < PRELIMINARY_SNAPSHOTS
      ? 'النتائج أولية وتعتمد على عدد محدود من اللقطات.'
      : '',
    events: payload.events || []
  };
}

function wrapSignatureResponse(sig) {
  return Object.assign({ ok: true }, sig);
}

module.exports = {
  INSUFFICIENT_SNAPSHOTS: INSUFFICIENT_SNAPSHOTS,
  buildSignature: buildSignature,
  wrapTrendsResponse: wrapTrendsResponse,
  wrapTimelineResponse: wrapTimelineResponse,
  wrapSignatureResponse: wrapSignatureResponse,
  emptyHistoryMessage: emptyHistoryMessage
};
