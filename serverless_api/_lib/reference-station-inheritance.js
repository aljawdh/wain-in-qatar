'use strict';

const { cleanString, toNumber } = require('./security');

/** Max great-circle distance (km) for P3: closest reference within same country+region. */
const P3_MAX_KM = 450;

function normKey(s) {
  return String(s == null ? '' : s)
    .trim()
    .toLowerCase();
}

function greatCircleDistanceKm(lat1, lon1, lat2, lon2) {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    return Infinity;
  }
  const p = Math.PI / 180;
  const a =
    0.5 - Math.cos((lat2 - lat1) * p) / 2
    + Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p)) / 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
}

function isUsableReferenceStation(s) {
  if (!s || !s.is_reference_station) return false;
  const st = String(s.status || 'active').toLowerCase();
  if (st === 'archived' || st === 'disabled') return false;
  if (!Number.isFinite(toNumber(s.lat)) || !Number.isFinite(toNumber(s.lon))) return false;
  if (!cleanString(s.id, 80)) return false;
  return true;
}

/**
 * @param {Array} allRows
 * @returns {Array<object>}
 */
function listUsableReferenceStations(allRows) {
  return (Array.isArray(allRows) ? allRows : []).filter(isUsableReferenceStation);
}

/**
 * @param {object} ref
 * @returns {number} lower sorts first
 */
function referenceRankForTiebreak(ref) {
  const primary = ref.primary_reference ? 0 : 1;
  const pr = ref.reference_priority;
  const p = Number.isFinite(Number(pr)) ? Number(pr) : 999;
  return primary * 1000 + p;
}

/**
 * @param {object} anchor
 * @param {Array<object>} candidates
 * @returns {object|null}
 */
function pickBestReference(anchor, candidates) {
  if (!candidates || !candidates.length) return null;
  const alat = toNumber(anchor.lat);
  const alon = toNumber(anchor.lon);
  const withGeo = Number.isFinite(alat) && Number.isFinite(alon);
  return candidates
    .slice()
    .sort((a, b) => {
      const ra = referenceRankForTiebreak(a) - referenceRankForTiebreak(b);
      if (ra !== 0) return ra;
      if (withGeo) {
        return (
          greatCircleDistanceKm(alat, alon, toNumber(a.lat), toNumber(a.lon))
          - greatCircleDistanceKm(alat, alon, toNumber(b.lat), toNumber(b.lon))
        );
      }
      return String(a.id || '').localeCompare(String(b.id || ''));
    })[0];
}

/**
 * Auto-resolve reference station id for a new operational station (DUR / timing inheritance only).
 * Does not read or copy any weather or environmental data.
 *
 * Priority 1: same country, region, and local_area (all non-empty, exact normalized match)
 * Priority 2: same latitude_band_key (and same country when country is set on the new station)
 * Priority 3: closest reference among same country+region, within P3_MAX_KM
 *
 * @param {object} partialStation — normalized station row (not yet saved)
 * @param {Array<object>} allRows — existing station rows (may include the new id if re-entrant; filtered)
 * @returns {{ id: string, method: string }|null}
 */
function resolveAutoReferenceInheritance(partialStation, allRows) {
  const n = partialStation;
  if (!n || n.is_reference_station) return null;
  const selfId = cleanString(n.id, 80);
  const refs = listUsableReferenceStations(allRows).filter((s) => !selfId || s.id !== selfId);
  if (!refs.length) return null;

  const c = normKey(n.country);
  const r = normKey(n.region);
  const l = normKey(n.local_area);
  if (c && r && l) {
    const p1c = refs.filter(
      (s) => normKey(s.country) === c && normKey(s.region) === r && normKey(s.local_area) === l
    );
    if (p1c.length) {
      const best = pickBestReference(n, p1c);
      if (best && best.id !== selfId) {
        return { id: String(best.id), method: 'exact_area_match' };
      }
    }
  }

  const band = cleanString(n.latitude_band_key, 80);
  if (band) {
    const byBand = refs.filter(
      (s) => cleanString(s.latitude_band_key, 80) === band
    );
    if (byBand.length) {
      let pool = byBand;
      if (c) {
        const sameCo = byBand.filter((s) => normKey(s.country) === c);
        if (sameCo.length) pool = sameCo;
      }
      const best = pickBestReference(n, pool);
      if (best && best.id !== selfId) {
        return { id: String(best.id), method: 'latitude_band_match' };
      }
    }
  }

  if (c && r) {
    const p3c = refs.filter(
      (s) => normKey(s.country) === c && normKey(s.region) === r
    );
    const alat = toNumber(n.lat);
    const alon = toNumber(n.lon);
    if (p3c.length && Number.isFinite(alat) && Number.isFinite(alon)) {
      const scored = p3c.map((cand) => ({
        ref: cand,
        d: greatCircleDistanceKm(alat, alon, toNumber(cand.lat), toNumber(cand.lon))
      })).filter((x) => x.d <= P3_MAX_KM);
      if (scored.length) {
        scored.sort((a, b) => a.d - b.d);
        const best = scored[0].ref;
        if (best && best.id !== selfId) {
          return { id: String(best.id), method: 'country_region_closest' };
        }
      }
    }
  }

  return null;
}

/**
 * For optional future admin backfill — same policy as at-create, without persisting.
 * @param {object} station
 * @param {Array<object>} allRows
 * @returns {{ id: string, method: string }|null}
 */
function suggestReferenceInheritanceForBackfill(station, allRows) {
  return resolveAutoReferenceInheritance(station, allRows);
}

module.exports = {
  P3_MAX_KM,
  resolveAutoReferenceInheritance,
  listUsableReferenceStations,
  suggestReferenceInheritanceForBackfill
};
