/**
 * FIELD log analysis — pattern detection + decision strength (admin review only).
 * No automatic model updates; output feeds admin UI and optional manual adjustments file.
 */
'use strict';

function toArray(x) {
  return Array.isArray(x) ? x : [];
}

function normalizeString(v) {
  return String(v == null ? '' : v).trim();
}

function waterStateFromPredicted(s) {
  var t = normalizeString(s);
  if (t === 'حمل') return 'حمل';
  if (t === 'فساد') return 'فساد';
  return t || '—';
}

function tideStateFromTides(prev, cur, next) {
  if (cur == null || prev == null) return '';
  var d0 = Number(cur) - Number(prev);
  if (d0 > 0.005) return 'سقي';
  if (d0 < -0.005) return 'ثبر';
  if (next != null) {
    var d1 = Number(next) - Number(cur);
    if (d0 >= 0 && d1 >= 0) return 'سقي';
    if (d0 <= 0 && d1 <= 0) return 'ثبر';
  }
  return 'ثابت';
}

function parseIsoDate(iso) {
  var d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function daysAgo(d) {
  return (Date.now() - d.getTime()) / (86400000);
}

function recencyWeight(iso) {
  var d = parseIsoDate(iso);
  if (!d) return 0.3;
  var days = daysAgo(d);
  if (days <= 30) return 1;
  if (days <= 90) return 0.55;
  return 0.25;
}

/**
 * @param {object} log — catch record
 * @param {object} stationMap — id -> { name, ... }
 * @param {object} reviewMap — catch_id -> review row
 */
function enrichSessionFromLog(log, stationMap, reviewMap) {
  var st = stationMap[log.station_id] || {};
  var rid = log.id;
  var rev = (reviewMap && reviewMap[rid]) || {};
  return {
    catch_id: rid,
    session_id: log.session_id || null,
    trip_id: log.trip_id || null,
    source: log.source,
    station_id: log.station_id,
    station_name: normalizeString(st.name) || log.station_id,
    analysis_timestamp: log.analysis_timestamp,
    created_at: log.created_at,
    dur_name: log.dur_name || null,
    water_state: waterStateFromPredicted(log.water_state_predicted),
    tide_state: log.tide_state || tideStateFromTides(log.tide_previous, log.tide_current, log.tide_next),
    temperature: log.temperature,
    wind_speed: log.wind_speed,
    wind_direction: log.wind_direction,
    species_predicted: toArray(log.species_predicted),
    actual_species: toArray(log.actual_species),
    catch_success: !!log.catch_success,
    user_note: log.user_note || null,
    water_observation: log.water_observation || null,
    review_status: rev.review_status || 'pending',
    review_notes: rev.notes || null,
    photo_url: rev.photo_url || null,
    operator_id: log.operator_id
  };
}

/**
 * @param {object[]} fieldLogs — source === field_app
 * @param {object[]} stations
 * @param {object} reviewsDoc — { reviews: [] }
 */
function buildSessions(fieldLogs, stations, reviewsDoc) {
  var stationMap = {};
  toArray(stations).forEach(function (s) {
    if (s && s.id) stationMap[s.id] = s;
  });
  var reviewMap = {};
  toArray(reviewsDoc && reviewsDoc.reviews).forEach(function (r) {
    if (r && r.catch_id) reviewMap[r.catch_id] = r;
  });
  return toArray(fieldLogs)
    .filter(function (l) { return l && l.source === 'field_app'; })
    .map(function (l) { return enrichSessionFromLog(l, stationMap, reviewMap); });
}

/**
 * @param {object} session
 * @param {object} filter — optional query filters
 */
function sessionMatchesFilter(session, filter) {
  if (!filter) return true;
  if (filter.station_id && session.station_id !== filter.station_id) return false;
  if (filter.fish) {
    var f = normalizeString(filter.fish);
    var has = (session.species_predicted || []).concat(session.actual_species || [])
      .some(function (x) { return normalizeString(x).indexOf(f) >= 0 || f.indexOf(normalizeString(x)) >= 0; });
    if (!has) return false;
  }
  if (filter.water_state && session.water_state !== filter.water_state) return false;
  if (filter.tide_state && session.tide_state !== filter.tide_state) return false;
  if (filter.dur && session.dur_name && String(session.dur_name).indexOf(filter.dur) < 0) return false;
  if (filter.review_status && session.review_status !== filter.review_status) return false;
  if (filter.date_from) {
    var t = (session.analysis_timestamp || session.created_at || '');
    if (t < filter.date_from) return false;
  }
  if (filter.date_to) {
    var t2 = (session.analysis_timestamp || session.created_at || '');
    if (t2 > filter.date_to) return false;
  }
  if (filter.success === 'ok' && !session.catch_success) return false;
  if (filter.success === 'fail' && session.catch_success) return false;
  return true;
}

function buildSummary(sessions) {
  var list = toArray(sessions);
  var total = list.length;
  var ok = list.filter(function (s) { return s.catch_success; }).length;
  var fail = total - ok;
  var rate = total > 0 ? ok / total : 0;
  var fishCount = {};
  var stationCount = {};
  var durCount = {};
  var waterCount = {};
  list.forEach(function (s) {
    toArray(s.actual_species).forEach(function (f) {
      if (f) fishCount[f] = (fishCount[f] || 0) + 1;
    });
    if (s.station_id) stationCount[s.station_id] = (stationCount[s.station_id] || 0) + 1;
    if (s.dur_name) durCount[s.dur_name] = (durCount[s.dur_name] || 0) + 1;
    if (s.water_state) waterCount[s.water_state] = (waterCount[s.water_state] || 0) + 1;
  });
  function topN(obj, n) {
    return Object.keys(obj)
      .sort(function (a, b) { return (obj[b] || 0) - (obj[a] || 0); })
      .slice(0, n)
      .map(function (k) { return { key: k, count: obj[k] }; });
  }
  var recommendedAndCaught = 0, recommendedNot = 0, notRecommendedBut = 0;
  list.forEach(function (s) {
    var pred = toArray(s.species_predicted);
    var act = toArray(s.actual_species);
    var hit = act.some(function (a) { return pred.indexOf(a) >= 0; });
    if (hit) recommendedAndCaught += 1;
    else {
      if (pred.length) recommendedNot += 1;
    }
    var surprise = act.some(function (a) { return pred.indexOf(a) < 0; });
    if (surprise) notRecommendedBut += 1;
  });
  return {
    total_sessions: total,
    success_rate: total > 0 ? Math.round((rate) * 1000) / 10 : 0,
    failed_sessions: fail,
    top_caught_fish: topN(fishCount, 8),
    most_active_stations: topN(stationCount, 8),
    most_validated_dur: topN(durCount, 8),
    most_validated_water: topN(waterCount, 4),
    accuracy: {
      recommended_and_caught: recommendedAndCaught,
      recommended_not_caught: recommendedNot,
      not_recommended_but_caught: notRecommendedBut
    }
  };
}

function groupKey(fish, stationName, dur, water, tide) {
  return [normalizeString(fish), normalizeString(stationName), normalizeString(dur), normalizeString(water), normalizeString(tide)].join('||');
}

/**
 * Build patterns from field sessions (catch-level rows).
 * Each pattern: fish + context bucket.
 */
function buildPatterns(sessions) {
  var list = toArray(sessions);
  var groups = {};
  list.forEach(function (s) {
    var ctxDur = s.dur_name || '';
    toArray(s.actual_species).forEach(function (fish) {
      if (!fish) return;
      var key = groupKey(fish, s.station_name, ctxDur, s.water_state, s.tide_state);
      if (!groups[key]) {
        groups[key] = {
          fish: fish,
          station: s.station_name,
          station_id: s.station_id,
          dur: ctxDur,
          waterState: s.water_state,
          tideState: s.tide_state,
          events: []
        };
      }
      groups[key].events.push(s);
    });
  });
  var patterns = [];
  Object.keys(groups).forEach(function (key) {
    var g = groups[key];
    var ev = g.events;
    var n = ev.length;
    var success = ev.filter(function (e) { return e.catch_success; }).length;
    var fail = n - success;
    var succRate = n > 0 ? success / n : 0;
    var ds = computeDecisionStrength({
      evidence_count: n,
      success_rate: succRate,
      events: ev,
      station_spread: countUniqueStations(ev),
      weather_bundle: weatherConsistency(ev)
    });
    var suggested = Math.round((succRate - 0.5) * 20);
    suggested = Math.max(-12, Math.min(12, suggested));
    patterns.push({
      pattern_id: 'ptn_' + String(key).split('').reduce(function (h, c) { return (h * 31 + c.charCodeAt(0)) >>> 0; }, 7).toString(36) + '_' + n,
      fish: g.fish,
      station: g.station,
      station_id: g.station_id,
      dur: g.dur || '—',
      waterState: g.waterState,
      tideState: g.tideState,
      evidence_count: n,
      success_count: success,
      failure_count: fail,
      success_rate: Math.round(succRate * 1000) / 10,
      suggested_adjustment: suggested,
      confidence: ds.label,
      decision_strength: ds.score,
      decision_strength_label: ds.label,
      strength_reason: ds.reason
    });
  });
  patterns.sort(function (a, b) { return b.decision_strength - a.decision_strength; });
  return patterns;
}

function countUniqueStations(events) {
  var u = {};
  toArray(events).forEach(function (e) { if (e.station_id) u[e.station_id] = 1; });
  return Object.keys(u).length;
}

function weatherConsistency(events) {
  var temps = [];
  var winds = [];
  toArray(events).forEach(function (e) {
    if (e.temperature != null) temps.push(Number(e.temperature));
    if (e.wind_speed != null) winds.push(Number(e.wind_speed));
  });
  function variance(arr) {
    if (arr.length < 2) return 0;
    var m = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
    return arr.reduce(function (s, v) { return s + Math.pow(v - m, 2); }, 0) / arr.length;
  }
  return { temp_variance: variance(temps), wind_variance: variance(winds) };
}

/**
 * @returns {{ score: number, label: string, reason: string }}
 */
function computeDecisionStrength(opts) {
  var n = opts.evidence_count || 0;
  var sr = opts.success_rate != null ? opts.success_rate : 0;
  var spread = opts.station_spread || 1;
  var wx = opts.weather_bundle || { temp_variance: 0, wind_variance: 0 };

  var evBand = 0;
  if (n <= 2) evBand = 12;
  else if (n <= 5) evBand = 28;
  else if (n <= 10) evBand = 45;
  else evBand = 58;

  var srPts = Math.round(sr * 22);

  var recW = 0;
  toArray(opts.events).forEach(function (e) {
    recW += recencyWeight(e.analysis_timestamp || e.created_at);
  });
  var recencyPts = Math.min(20, Math.round((recW / Math.max(1, n)) * 20));

  var consistencyPts = n >= 3 ? 12 : n * 3;

  var spreadPts = spread <= 1 ? 4 : (spread === 2 ? 8 : 10);

  var wxPts = 5;
  if (wx.temp_variance < 2 && wx.wind_variance < 25) wxPts = 10;
  else if (wx.temp_variance < 8 && wx.wind_variance < 100) wxPts = 7;

  var raw = evBand * 0.45 + srPts * 0.2 + recencyPts * 0.15 + consistencyPts * 0.1 + spreadPts * 0.05 + wxPts * 0.05;
  var score = Math.round(Math.min(100, Math.max(0, raw)));

  var label = 'غير كافٍ';
  if (score >= 85) label = 'قوي جدًا';
  else if (score >= 70) label = 'قوي';
  else if (score >= 55) label = 'متوسط';
  else if (score >= 40) label = 'ضعيف';

  var reason = 'الأدلة: ' + n + ' ؛ نجاح: ' + Math.round(sr * 100) + '% ؛ تشتت محطات: ' + spread + ' ؛ اتساق طقس(تقريب): ' + (wxPts >= 8 ? 'جيد' : 'متوسط');

  return { score: score, label: label, reason: reason };
}

/**
 * Suggested adjustment after manual approval — derived from pattern (not auto-applied).
 */
function patternToSuggestedRecord(pattern, actor) {
  return {
    id: 'adj_' + createSimpleId(),
    fish: pattern.fish,
    conditions: {
      station: pattern.station,
      station_id: pattern.station_id,
      dur: pattern.dur,
      waterState: pattern.waterState,
      tideState: pattern.tideState
    },
    score_adjustment: clampAdj(pattern.suggested_adjustment),
    decision_strength: pattern.decision_strength,
    decision_strength_label: pattern.decision_strength_label,
    source: 'FIELD',
    approved_by: actor || 'admin',
    created_at: new Date().toISOString(),
    active: true,
    pattern_id: pattern.pattern_id
  };
}

function createSimpleId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function clampAdj(n) {
  return Math.max(-15, Math.min(15, Math.round(Number(n) || 0)));
}

module.exports = {
  buildSessions: buildSessions,
  buildSummary: buildSummary,
  buildPatterns: buildPatterns,
  buildSummaryFromData: function (fieldLogs, stations, reviewsDoc) {
    var s = buildSessions(fieldLogs, stations, reviewsDoc);
    return { sessions: s, summary: buildSummary(s) };
  },
  buildPatternsFromSessions: function (sessions) {
    return buildPatterns(sessions);
  },
  sessionMatchesFilter: sessionMatchesFilter,
  patternToSuggestedRecord: patternToSuggestedRecord,
  computeDecisionStrength: computeDecisionStrength,
  waterStateFromPredicted: waterStateFromPredicted,
  tideStateFromTides: tideStateFromTides
};
