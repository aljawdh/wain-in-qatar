'use strict';

/**
 * Trait validation / calibration buckets are keyed by reference station only.
 * Operational stations inherit calibration from their linked reference_station_id.
 */

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

/** KV / log bucket id for trait evidence (never an unlinked operational id). */
function resolveTraitEvidenceReferenceBucketId(station) {
  if (!station || typeof station !== 'object') return '';
  var ref = normalizeString(station.reference_station_id);
  if (ref) return ref;
  if (station.is_reference_station === true || station.is_reference_station === 'true') return normalizeString(station.id);
  if (station.is_operational_station === false) return normalizeString(station.id);
  return '';
}

function shouldAppendTraitValidationLog(station) {
  return !!resolveTraitEvidenceReferenceBucketId(station);
}

/** Display name for the reference bucket (Arabic when available). */
function resolveTraitEvidenceReferenceNameAr(station) {
  if (!station || typeof station !== 'object') return '';
  var ref = normalizeString(station.reference_station_id);
  if (ref) return normalizeString(station.reference_station_name_ar) || '';
  return normalizeString(station.name_ar || station.name);
}

module.exports = {
  resolveTraitEvidenceReferenceBucketId,
  shouldAppendTraitValidationLog,
  resolveTraitEvidenceReferenceNameAr,
  normalizeString
};
