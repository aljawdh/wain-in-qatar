'use strict';

var C = require('./constants');

function buildStationBlock(station, classification) {
  return {
    id: station.id != null ? String(station.id) : '',
    name: String(station.name_ar || station.name || station.id || ''),
    lat: Number.isFinite(Number(station.lat)) ? Number(station.lat) : null,
    lon: Number.isFinite(Number(station.lon != null ? station.lon : station.lng)) ? Number(station.lon != null ? station.lon : station.lng) : null,
    reference_station_id: station.reference_station_id ? String(station.reference_station_id) : null,
    classification: {
      zone: classification.zone,
      confidence: classification.confidence,
      reasons: classification.reasons.slice()
    }
  };
}

function buildReportPayload(station, classification, intelligence, dataQuality) {
  return {
    ok: true,
    mode: C.PREVIEW_MODE,
    station: buildStationBlock(station, classification),
    intelligence: intelligence,
    data_quality: dataQuality
  };
}

function buildAllResponse(items, meta) {
  var m = meta || {};
  return {
    ok: true,
    mode: C.PREVIEW_MODE,
    all: true,
    total: items.length,
    eligible_total: m.eligible_total != null ? m.eligible_total : items.length,
    limited: true,
    requested_limit: m.requested_limit != null ? m.requested_limit : C.DEFAULT_ALL_LIMIT,
    applied_limit: m.applied_limit != null ? m.applied_limit : items.length,
    note: C.ALL_BATCH_NOTE,
    items: items
  };
}

module.exports = {
  buildReportPayload: buildReportPayload,
  buildAllResponse: buildAllResponse
};
