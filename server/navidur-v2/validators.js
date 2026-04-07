'use strict';

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function assertNotNull(name, value, missing) {
  if (value == null || value === '') missing.push(name);
}

function assertRecentTimestamp(timestamp, maxAgeHours) {
  if (!timestamp) return false;
  const t = new Date(timestamp).getTime();
  if (!Number.isFinite(t)) return false;
  const ageMs = Date.now() - t;
  return ageMs >= 0 && ageMs <= (maxAgeHours * 60 * 60 * 1000);
}

function unitToCanonical(value, unit, canonicalUnit) {
  if (!isFiniteNumber(value)) return null;
  const u = String(unit || canonicalUnit || '').toLowerCase();
  const c = String(canonicalUnit || '').toLowerCase();

  if (!c || u === c) return value;

  if (c === 'm/s' && u === 'knots') return value * 0.514444;
  if (c === 'm/s' && u === 'km/h') return value / 3.6;
  if (c === 'm' && u === 'cm') return value / 100;
  if (c === 'celsius' && u === 'kelvin') return value - 273.15;

  return NaN;
}

function normalize01(value, min, max) {
  if (!isFiniteNumber(value) || !(max > min)) return null;
  const n = (value - min) / (max - min);
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

module.exports = {
  isFiniteNumber,
  assertNotNull,
  assertRecentTimestamp,
  unitToCanonical,
  normalize01
};
