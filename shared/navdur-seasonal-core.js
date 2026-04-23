/**
 * Fixed annual durur framework: day-month only for seasonal mapping.
 * Hidden calibration: 15-08 = النثرة (day 7) — not exported to callers' UI; used only to anchor T0.
 * @see scripts/build-navidur-seasonal-reference.js
 */
'use strict';

/** 28 durs, order fixed by product spec */
var DUR_ORDER = [
  'المقدم', 'المؤخر', 'الرشاء', 'الشرطين', 'البطين', 'الثريا', 'الدبران', 'الهقعة', 'الهنعة', 'الذراع',
  'النثرة', 'الطرفة', 'الجبهة', 'الزبرة', 'الصرفة', 'العواء', 'السماك', 'الغفر', 'الزبانا', 'الإكليل',
  'القلب', 'الشولة', 'النعايم', 'البلدة', 'سعد الذابح', 'سعد بلع', 'سعد السعود', 'سعد الأخبية'
];

var JULY_AUG_15_08 = { m: 8, d: 15 };
var NITHRA_NAME = 'النثرة';
var NITHRA_DAY_ANCHOR = 7;
var TROPICAL_YEAR_DAYS = 365;

function parseDdMm(s) {
  var t = String(s == null ? '' : s).trim();
  var m = t.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  var day = Number(m[1]);
  var mo = Number(m[2]);
  if (!day || !mo || mo > 12 || day > 31) return null;
  return { d: day, m: mo };
}

function dayOfYearNonLeap2001(mm, dd) {
  var d = new Date(Date.UTC(2001, mm - 1, dd, 12, 0, 0, 0));
  if (Number.isNaN(d.getTime())) return -1;
  if (d.getUTCMonth() + 1 !== mm || d.getUTCDate() !== dd) return -1;
  var start = new Date(Date.UTC(2001, 0, 1, 12, 0, 0, 0));
  return Math.round((d - start) / 86400000) + 1;
}

/**
 * Cumulative day lengths; الجبهة = 14, else 13
 */
function durLengths() {
  return DUR_ORDER.map(function (name) {
    return name === 'الجبهة' ? 14 : 13;
  });
}

/**
 * From hidden rule 15-08 = النثرة day 7 → T0 = start of المقدم (day index 0 in cycle) as day-of-year 1..365
 */
function frameworkCycleT0Doy1Based() {
  var idxN = DUR_ORDER.indexOf(NITHRA_NAME);
  if (idxN < 0) throw new Error('framework_missing_nithra');
  var lens = durLengths();
  var daysBefore = 0;
  for (var i = 0; i < idxN; i += 1) {
    daysBefore += lens[i];
  }
  var nithraStart1Based = (NITHRA_DAY_ANCHOR - 1);
  var nithraStartDoy = dayOfYearNonLeap2001(JULY_AUG_15_08.m, JULY_AUG_15_08.d) - nithraStart1Based;
  if (nithraStartDoy < 1) nithraStartDoy += TROPICAL_YEAR_DAYS;
  var t0 = nithraStartDoy - daysBefore;
  while (t0 < 1) t0 += TROPICAL_YEAR_DAYS;
  while (t0 > TROPICAL_YEAR_DAYS) t0 -= TROPICAL_YEAR_DAYS;
  return t0;
}

/**
 * @returns {{ t0: number, lengths: number[], order: string[] }}
 */
function getFrameworkParams() {
  return {
    t0: frameworkCycleT0Doy1Based(),
    lengths: durLengths(),
    order: DUR_ORDER.slice()
  };
}

function signedOffsetDays(doyA, doyB) {
  var x = doyA - doyB;
  if (x > 182) x -= TROPICAL_YEAR_DAYS;
  if (x < -182) x += TROPICAL_YEAR_DAYS;
  return x;
}

function addDaysToDoy1Based(d0, add) {
  var u = d0 + add;
  while (u < 1) u += TROPICAL_YEAR_DAYS;
  while (u > TROPICAL_YEAR_DAYS) u -= TROPICAL_YEAR_DAYS;
  return u;
}

/**
 * Position in fixed framework for anchor frame (no station offset).
 * @param {number} doy1 — 1..365, non-leap calendar proxy
 * @returns {{ durIndex: number, dayInDur: number, name: string, rel: number }}
 */
function positionInFrameworkAtDoy(doy1, t0) {
  var rel = (doy1 - t0 + TROPICAL_YEAR_DAYS) % TROPICAL_YEAR_DAYS;
  if (rel < 0) rel += TROPICAL_YEAR_DAYS;
  var lens = durLengths();
  var c = 0;
  for (var i = 0; i < lens.length; i += 1) {
    if (rel < c + lens[i]) {
      return {
        durIndex: i,
        dayInDur: rel - c + 1,
        name: DUR_ORDER[i],
        rel: rel
      };
    }
    c += lens[i];
  }
  return { durIndex: 0, dayInDur: 1, name: DUR_ORDER[0], rel: 0 };
}

/**
 * @param {number} astroDoyS — day-of-year of mode astronomical Suhail (1..365)
 * @param {number} astroDoyA — same for internal anchor
 * @param {number} doy1 — day-of-year of "as of" date
 */
function effectiveDoyForStation(astroDoyS, astroDoyA, doy1) {
  var off = signedOffsetDays(astroDoyS, astroDoyA);
  return addDaysToDoy1Based(doy1, -off);
}

/**
 * @param {string} refDdMm e.g. 23-04
 */
function doyFromDdMm(refDdMm) {
  var p = parseDdMm(refDdMm);
  if (!p) return -1;
  return dayOfYearNonLeap2001(p.m, p.d);
}

/**
 * @param {number} doy1
 * @returns {string} DD-MM
 */
function doy1ToDdMm(doy1) {
  for (var m = 1; m <= 12; m += 1) {
    for (var d = 1; d <= 31; d += 1) {
      if (dayOfYearNonLeap2001(m, d) === doy1) {
        return String(d).padStart(2, '0') + '-' + String(m).padStart(2, '0');
      }
    }
  }
  return '';
}

/**
 * Start/end doy1 for dur segment containing relStart..relEnd within one cycle
 */
function durStartEndDoyInCycle(durIndex, t0) {
  var lens = durLengths();
  var c = 0;
  for (var i = 0; i < durIndex; i += 1) c += lens[i];
  var sRel = c;
  var eRel = c + lens[durIndex] - 1;
  var sD = addDaysToDoy1Based(t0, sRel);
  var eD = addDaysToDoy1Based(t0, eRel);
  return { startDoy: sD, endDoy: eD };
}

/**
 * @param {number} effectiveDoy
 * @param {number} t0
 * @returns {{ startDdMm: string, endDdMm: string, nextName: string }}
 */
function currentDurWindowAndNext(effectiveDoy, t0) {
  var pos = positionInFrameworkAtDoy(effectiveDoy, t0);
  var w = durStartEndDoyInCycle(pos.durIndex, t0);
  var nextI = (pos.durIndex + 1) % DUR_ORDER.length;
  return {
    startDdMm: doy1ToDdMm(w.startDoy),
    endDdMm: doy1ToDdMm(w.endDoy),
    nextName: DUR_ORDER[nextI],
    currentName: pos.name,
    dayInDur: pos.dayInDur,
    durIndex: pos.durIndex
  };
}

/**
 * @param {number} durLen
 * @param {number} dayInDur
 * @returns {{ elapsed: number, remaining: number }}
 */
function elapsedRemaining(durLen, dayInDur) {
  return {
    elapsed: dayInDur,
    remaining: durLen - dayInDur
  };
}

module.exports = {
  DUR_ORDER: DUR_ORDER,
  getFrameworkParams: getFrameworkParams,
  dayOfYearNonLeap2001: dayOfYearNonLeap2001,
  signedOffsetDays: signedOffsetDays,
  addDaysToDoy1Based: addDaysToDoy1Based,
  effectiveDoyForStation: effectiveDoyForStation,
  positionInFrameworkAtDoy: positionInFrameworkAtDoy,
  doyFromDdMm: doyFromDdMm,
  doy1ToDdMm: doy1ToDdMm,
  currentDurWindowAndNext: currentDurWindowAndNext,
  elapsedRemaining: elapsedRemaining,
  parseDdMm: parseDdMm
};
