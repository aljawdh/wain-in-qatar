/**
 * Real apparent-altitude test for Suhail (body = Canopus) vs Sun.
 * star_alt >= 2°, sun_alt <= -10° (astronomical / post-sunset); evaluation in local civil context via UTC search.
 * Node (build script) only — uses astronomy-engine.
 */
'use strict';

var Astronomy = require('astronomy-engine');

var STAR_ALT_BASE = 2;
var SUN_ALT_MAX = -10;
var Body = Astronomy.Body;

// Canopus: ICRS J2000.0 — SIMBAD ~ 6h 23m 57s, −52° 41′ 45″
var CANOPUS_RA_H = 6.399199;
var CANOPUS_DEC_DEG = -52.695278;

function ensureCanopus() {
  Astronomy.DefineStar(Body.Star1, CANOPUS_RA_H, CANOPUS_DEC_DEG, 310);
}

/**
 * Approximate best-case elevation of Canopus (any hour) in `year` at the observer, for floor logic.
 * @param {Astronomy.Observer} observer
 * @param {number} year
 */
function approximateMaxCanopusAltDeg(observer, year) {
  ensureCanopus();
  var best = -90;
  for (var mo = 5; mo <= 11; mo += 1) {
    for (var d = 1; d <= 28; d += 3) {
      for (var h = 0; h < 24; h += 2) {
        var t = new Date(Date.UTC(year, mo, d, h, 0, 0, 0));
        if (t.getUTCFullYear() !== year) continue;
        var at = Astronomy.MakeTime(t);
        var stEq = Astronomy.Equator(Body.Star1, at, observer, true, true);
        var stH = Astronomy.Horizon(at, observer, stEq.ra, stEq.dec, 'normal');
        if (stH.altitude > best) best = stH.altitude;
      }
    }
  }
  return best;
}

/**
 * @param {Astronomy.Observer} observer
 * @param {Astronomy.AstroTime} at
 */
function altitudes(at, observer) {
  var sunEq = Astronomy.Equator(Body.Sun, at, observer, true, true);
  var stEq = Astronomy.Equator(Body.Star1, at, observer, true, true);
  var sunH = Astronomy.Horizon(at, observer, sunEq.ra, sunEq.dec, 'normal');
  var stH = Astronomy.Horizon(at, observer, stEq.ra, stEq.dec, 'normal');
  return { sun: sunH.altitude, star: stH.altitude };
}

/**
 * First local-evening (UTC 14:00–23:00 band) date Jul–early Nov when Canopus ≥2° and Sun ≤-10°.
 * @param {number} lat
 * @param {number} lon
 * @param {number} year
 * @param {{ minStar: number, relaxed: boolean } | undefined} cap
 * @returns {{m:number,d:number,relaxed?: boolean}|null}
 */
function findSuhailEntryYmdInYear(lat, lon, year, cap) {
  ensureCanopus();
  var observer = new Astronomy.Observer(lat, lon, 0);
  var starMin = (cap && cap.minStar) != null ? cap.minStar : STAR_ALT_BASE;
  if (cap && cap.relaxed) {
    // kept for call-site; physical floor already in minStar
  }
  var cur = new Date(Date.UTC(year, 5, 1, 0, 0, 0, 0));
  var end = new Date(Date.UTC(year, 11, 20, 0, 0, 0, 0));
  while (cur < end) {
    var y = cur.getUTCFullYear();
    var mo = cur.getUTCMonth();
    var day = cur.getUTCDate();
    for (var h = 0; h < 24; h += 1) {
      for (var min = 0; min < 60; min += 5) {
        var t = new Date(Date.UTC(y, mo, day, h, min, 0, 0));
        if (t.getUTCMonth() !== mo || t.getUTCDate() !== day) break;
        var at = Astronomy.MakeTime(t);
        var a = altitudes(at, observer);
        if (a.star >= starMin && a.sun <= SUN_ALT_MAX) {
          return { m: t.getUTCMonth() + 1, d: t.getUTCDate() };
        }
      }
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return null;
}

/**
 * @returns {{ modeDdMm: string, byYear: object, yearSamples: { year, ddMm }[] }}
 */
function modeAstronomicalSuhailEntry(lat, lon, year0, year1, forceStrictStarAlt) {
  var observer = new Astronomy.Observer(lat, lon, 0);
  var max0 = approximateMaxCanopusAltDeg(observer, year0);
  var floor = STAR_ALT_BASE;
  if (!forceStrictStarAlt && max0 < STAR_ALT_BASE - 0.25) {
    floor = Math.max(0.25, max0 - 0.1);
  }
  var usedCap = !forceStrictStarAlt && floor < STAR_ALT_BASE ? { minStar: floor, relaxed: true } : undefined;
  var counts = new Map();
  var samples = [];
  for (var y = year0; y <= year1; y += 1) {
    var ymd = findSuhailEntryYmdInYear(lat, lon, y, usedCap);
    if (!ymd) {
      samples.push({ year: y, ddMm: null });
      continue;
    }
    var key = String(ymd.d).padStart(2, '0') + '-' + String(ymd.m).padStart(2, '0');
    counts.set(key, (counts.get(key) || 0) + 1);
    samples.push({ year: y, ddMm: key });
  }
  var best = null;
  var bestC = -1;
  counts.forEach(function (c, k) {
    if (c > bestC) {
      bestC = c;
      best = k;
    }
  });
  if (!best) {
    return {
      modeDdMm: '',
      byYear: Object.fromEntries(counts),
      yearSamples: samples,
      warning: 'no_suhail_any_year',
      star_alt_floor: floor
    };
  }
  return {
    modeDdMm: best,
    byYear: Object.fromEntries(counts),
    yearSamples: samples,
    warning: null,
    star_alt_floor: floor
  };
}

/**
 * @param {string} anchorHeritageDdMm "15-08" internal only — not exposed
 * @param {number} doyAstroStation
 * @param {number} doyAstroInternal
 * @param {import('./navdur-seasonal-core')} core
 */
function heritageDdMm(anchorHeritageDdMm, doyAstroStation, doyAstroInternal, core) {
  var off = core.signedOffsetDays(doyAstroStation, doyAstroInternal);
  var p0 = core.parseDdMm(anchorHeritageDdMm);
  if (!p0) return '';
  var d0 = core.dayOfYearNonLeap2001(p0.m, p0.d);
  var t = d0 + off;
  var u = t;
  while (u < 1) u += 365;
  while (u > 365) u -= 365;
  return core.doy1ToDdMm(u);
}

module.exports = {
  findSuhailEntryYmdInYear: findSuhailEntryYmdInYear,
  modeAstronomicalSuhailEntry: modeAstronomicalSuhailEntry,
  heritageDdMm: heritageDdMm
};
