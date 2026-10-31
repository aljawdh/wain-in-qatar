'use strict';

const {
  buildHistoricalEvidenceBundle,
  isValidDateInput,
  isValidStationIdInput
} = require('./_lib/navidur-evidence-service');

const ROLE_ORDER = { viewer: 0, member: 1, admin: 2, super_admin: 3 };
const SAFE_RESULT_REASONS = [
  'search_limit_reached',
  'pagination_consistency_unverified',
  'index_changed_during_scan',
  'malformed_index_data',
  'malformed_storage_response',
  'malformed_snapshot_record',
  'dangling_index_entry',
  'duplicate_records_conflict',
  'snapshot_request_mismatch',
  'snapshot_timestamp_date_conflict'
];

function safeReason(reason, fallback) {
  return SAFE_RESULT_REASONS.indexOf(reason) >= 0 ? reason : fallback;
}

function createEvidenceHandler(dependencies) {
  const deps = dependencies || {};
  if (typeof deps.authorize !== 'function' || typeof deps.getSnapshot !== 'function') {
    throw new TypeError('evidence_handler_dependencies_required');
  }
  const allowedRoles = Array.isArray(deps.allowedRoles)
    ? deps.allowedRoles
    : ['admin', 'super_admin'];

  return async function handleEvidenceRequest(req, res) {
    if (!req || req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    let actor;
    try {
      actor = await deps.authorize(req);
    } catch (_error) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    if (
      !actor ||
      !Object.prototype.hasOwnProperty.call(ROLE_ORDER, actor.role) ||
      allowedRoles.indexOf(actor.role) < 0 ||
      ROLE_ORDER[actor.role] < ROLE_ORDER.admin
    ) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const query = req.query || {};
    const stationId = typeof query.station_id === 'string' ? query.station_id.trim() : '';
    const date = typeof query.date === 'string' ? query.date.trim() : '';
    if (!isValidStationIdInput(stationId)) {
      return res.status(400).json({ ok: false, error: 'station_id_invalid' });
    }
    if (!isValidDateInput(date)) {
      return res.status(400).json({ ok: false, error: 'date_invalid' });
    }

    try {
      const result = await deps.getSnapshot({ stationId: stationId, date: date });
      if (result && result.status === 'conflict') {
        return res.status(409).json({
          ok: false,
          status: 'conflict',
          reason: safeReason(result.reason, 'record_conflict')
        });
      }
      if (result && result.status === 'incomplete') {
        return res.status(503).json({
          ok: false,
          status: 'incomplete',
          reason: safeReason(result.reason, 'search_incomplete')
        });
      }
      if (!result || result.found !== true) {
        return res.status(200).json({
          ok: true,
          evidence: { found: false, reason: 'not_found' }
        });
      }
      if (
        !result.record ||
        String(result.record.station_id || '') !== stationId ||
        String(result.record.analysis_date || '') !== date
      ) {
        return res.status(409).json({ ok: false, status: 'conflict', reason: 'snapshot_request_mismatch' });
      }
      const bundle = buildHistoricalEvidenceBundle({
        snapshot: result.record,
        stationId: stationId,
        requestedDate: date,
        retrievedAt: typeof deps.now === 'function' ? deps.now() : new Date().toISOString(),
        engineVersion: deps.engineVersion
      });
      return res.status(200).json({ ok: true, evidence: { found: true, bundle: bundle } });
    } catch (error) {
      if (error && error.message === 'snapshot_timestamp_date_conflict') {
        return res.status(409).json({ ok: false, status: 'conflict', reason: error.message });
      }
      return res.status(500).json({
        ok: false,
        error: 'evidence_retrieval_failed'
      });
    }
  };
}

module.exports = { createEvidenceHandler: createEvidenceHandler };
