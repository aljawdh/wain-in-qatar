/**
 * Manual learning layer: match approved adjustments to live context; additive score delta only.
 * Caps total adjustment per fish recommendation to [-15, +15].
 */
'use strict';

var fishRec = null;
try {
  fishRec = require('./navidur-fish-recommendation-engine');
} catch (_e) {
  fishRec = null;
}

function toArray(x) {
  return Array.isArray(x) ? x : [];
}

function normalizeString(v) {
  return String(v == null ? '' : v).trim();
}

function resolveTidePhase(env) {
  if (fishRec && typeof fishRec.resolveTidePhaseArabic === 'function') {
    return fishRec.resolveTidePhaseArabic(env || {});
  }
  var e = env || {};
  var prev = e.tide_previous, cur = e.tide_current, next = e.tide_next;
  if (cur == null || prev == null) return '';
  var d0 = Number(cur) - Number(prev);
  if (d0 > 0.005) return 'سقي';
  if (d0 < -0.005) return 'ثبر';
  if (next != null) {
    var d1 = Number(next) - Number(cur);
    if (d0 >= 0 && d1 >= 0) return 'سقي';
    if (d0 <= 0 && d1 <= 0) return 'ثبر';
  }
  return '';
}

function waterStateAr(tideState) {
  if (tideState === 'LOAD') return 'حمل';
  if (tideState === 'FASAD') return 'فساد';
  return '';
}

/**
 * @param {string} fishNameAr
 * @param {object} station
 * @param {string} tideState
 * @param {object} liveEnvironment
 * @param {object} currentDur
 * @param {object} settings — { learning_layer_enabled: boolean }
 * @param {object} doc — { adjustments: [] }
 * @returns {number} delta in [-15, 15]
 */
function getLearningScoreDelta(fishNameAr, station, tideState, liveEnvironment, currentDur, settings, doc) {
  if (!settings || !settings.learning_layer_enabled) return 0;
  var adjs = toArray(doc && doc.adjustments).filter(function (a) { return a && a.active; });
  if (!adjs.length) return 0;
  var name = normalizeString(fishNameAr);
  var durName = '';
  try {
    durName = normalizeString(currentDur && currentDur.durRow && (currentDur.durRow.name_ar || currentDur.durRow.name));
  } catch (_e) { /* ignore */ }
  var ws = waterStateAr(tideState);
  var tidePhase = resolveTidePhase(liveEnvironment);
  var stName = normalizeString(station && (station.name_ar || station.name));
  var stId = normalizeString(station && station.id);

  var total = 0;
  for (var i = 0; i < adjs.length; i += 1) {
    var a = adjs[i];
    if (normalizeString(a.fish) !== name) continue;
    var c = a.conditions || {};
    if (normalizeString(c.station) && normalizeString(c.station) !== stName) continue;
    if (normalizeString(c.station_id) && normalizeString(c.station_id) !== stId) continue;
    if (normalizeString(c.dur) && durName && String(durName).indexOf(normalizeString(c.dur)) < 0) continue;
    if (normalizeString(c.waterState) && normalizeString(c.waterState) !== ws) continue;
    if (normalizeString(c.tideState) && normalizeString(c.tideState) !== tidePhase) continue;
    var d = Number(a.score_adjustment);
    if (!isFinite(d)) d = 0;
    total += d;
  }
  return Math.max(-15, Math.min(15, Math.round(total)));
}

module.exports = {
  getLearningScoreDelta: getLearningScoreDelta,
  resolveTidePhaseForMatch: resolveTidePhase
};
