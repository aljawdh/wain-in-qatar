'use strict';

var reader = require('./reader');
var calculator = require('./calculator');
var timeline = require('./timeline');
var dto = require('./dto');

async function loadHistory(stationId, days) {
  return reader.loadStationSnapshots(stationId, days);
}

async function buildIntelligenceTrends(stationId, days) {
  var pack = await loadHistory(stationId, days);
  var built = calculator.buildTrends(pack.snapshots, pack.days);
  return dto.wrapTrendsResponse({
    station_id: pack.station_id,
    days: pack.days,
    snapshots: pack.snapshots,
    trends: built.trends,
    series: built.series
  });
}

async function buildIntelligenceTimeline(stationId, days) {
  var pack = await loadHistory(stationId, days);
  var events = timeline.buildMarineTimeline(pack.snapshots);
  return dto.wrapTimelineResponse({
    station_id: pack.station_id,
    days: pack.days,
    snapshots: pack.snapshots,
    events: events
  });
}

async function buildIntelligenceSignature(stationId, days) {
  var pack = await loadHistory(stationId, days);
  if (!pack.snapshots.length) {
    return dto.wrapSignatureResponse({
      station_id: pack.station_id,
      days: pack.days,
      evidence_count: 0,
      confidence: 0,
      traits: [],
      summary_ar: dto.emptyHistoryMessage(),
      status: 'empty'
    });
  }
  var sig = dto.buildSignature(pack.snapshots, pack.station_id, pack.days);
  return dto.wrapSignatureResponse(sig);
}

module.exports = {
  buildIntelligenceTrends: buildIntelligenceTrends,
  buildIntelligenceTimeline: buildIntelligenceTimeline,
  buildIntelligenceSignature: buildIntelligenceSignature,
  loadHistory: loadHistory
};
