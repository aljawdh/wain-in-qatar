'use strict';

const {
  readJsonFile, writeJsonFile, createId, nowIso,
  appendCatchLog, getCatchLogs, rateLimitKv, checkAndSetDedup, checkStorageHealth
} = require('./_lib/data-store');
const { isAllowedOrigin, parseBody, cleanString, toNumber, setNoCache, rateLimit } = require('./_lib/security');

// ─── Catch log handlers (routes: /api/log-catch, /api/catch-data, /api/system-storage-health) ───

async function handleLogCatch(req, res) {
  setNoCache(res);
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // ── Rate limiting: KV-backed (cross-instance), in-memory as last-resort fallback ──
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim() || 'unknown';
  const kvAllowed = await rateLimitKv('log_catch', ip, 20, 60);
  if (!kvAllowed || !rateLimit(req, 'log_catch', 40, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  try {
    const body = parseBody(req);

    // ── Source detection ──────────────────────────────────────────────────
    const sourceRaw = cleanString(body.source || 'public_ui', 20);
    const isFieldApp = sourceRaw === 'field_app';

    // ── Required field validation ──────────────────────────────────────────
    const stationId = cleanString(body.station_id || '', 100);
    if (!stationId) return res.status(400).json({ error: 'station_id_required' });

    // For field_app: analysis_timestamp may be absent — fall back to recorded_at_local
    const recordedAtLocalRaw = cleanString(body.recorded_at_local || '', 60) || null;
    const analysisTimestampRaw = cleanString(body.analysis_timestamp || body.recorded_at_local || '', 60);
    if (!analysisTimestampRaw) return res.status(400).json({ error: 'analysis_timestamp_required' });

    const catchSuccessRaw = body.catch_success;
    if (catchSuccessRaw === undefined || catchSuccessRaw === null) {
      return res.status(400).json({ error: 'catch_success_required' });
    }
    const catchSuccess = catchSuccessRaw === true || catchSuccessRaw === 'true';

    // ── Optional field validation ──────────────────────────────────────────
    const catchQuantityRaw = toNumber(body.catch_quantity);
    if (catchQuantityRaw !== null && catchQuantityRaw < 0) {
      return res.status(400).json({ error: 'catch_quantity_must_be_non_negative' });
    }

    const speciesPredicted = Array.isArray(body.species_predicted)
      ? body.species_predicted.map((s) => cleanString(String(s), 60)).filter(Boolean).slice(0, 20)
      : [];
    const actualSpecies = Array.isArray(body.actual_species)
      ? body.actual_species.map((s) => cleanString(String(s), 60)).filter(Boolean).slice(0, 20)
      : [];

    const fishingMethod = cleanString(body.fishing_method || '', 60) || null;

    // ── Field app extra fields ─────────────────────────────────────────────
    const operatorId       = isFieldApp ? (cleanString(body.operator_id || '', 80) || null) : null;
    const operatorUsername = isFieldApp ? (cleanString(body.operator_username || '', 60) || null) : null;
    const tripId           = isFieldApp ? (cleanString(body.trip_id || '', 80) || null) : null;
    const sessionId        = isFieldApp ? (cleanString(body.session_id || '', 80) || null) : null;
    const locationType     = isFieldApp ? (cleanString(body.location_type || '', 30) || null) : null;
    const waterObservation = isFieldApp ? (cleanString(body.water_observation || '', 30) || null) : null;
    const userNote         = isFieldApp ? (cleanString(body.user_note || '', 140) || null) : null;
    const syncedAt         = isFieldApp ? (cleanString(body.synced_at || '', 60) || null) : null;

    // ── Deduplication fingerprint (Task 6) ─────────────────────────────────
    // For field_app: include trip_id + session_id so field records can't falsely
    // collide with public records, and multiple field users won't cross-dedup.
    const snapshotIdForDedup = cleanString(body.prediction_snapshot_id || '', 80) || '';
    const dedupParts = isFieldApp
      ? [tripId || '', sessionId || '', stationId, analysisTimestampRaw.slice(0, 16), catchSuccess ? '1' : '0']
      : [snapshotIdForDedup, stationId, analysisTimestampRaw.slice(0, 16), catchSuccess ? '1' : '0', actualSpecies.slice().sort().join('|')];
    const dedupFingerprint = dedupParts.join(':');
    const isDuplicate = await checkAndSetDedup(dedupFingerprint, 120);
    if (isDuplicate) {
      return res.status(409).json({ error: 'duplicate_submission', message: 'تم تسجيل هذا الصيد مسبقاً' });
    }

    // ── Build record ───────────────────────────────────────────────────────
    const record = {
      id: createId('catch'),
      created_at: nowIso(),
      source: sourceRaw,
      // Identity
      station_id: stationId,
      lat: toNumber(body.lat),
      lng: toNumber(body.lng),
      // Timestamps
      analysis_timestamp: analysisTimestampRaw,
      prediction_snapshot_id: cleanString(body.prediction_snapshot_id || '', 80) || null,
      // Environment (frozen at analysis time)
      wind_speed: toNumber(body.wind_speed),
      wind_direction: toNumber(body.wind_direction),
      tide_current: toNumber(body.tide_current),
      tide_previous: toNumber(body.tide_previous),
      tide_next: toNumber(body.tide_next),
      temperature: toNumber(body.temperature),
      // Predictions (frozen at analysis time)
      water_state_predicted: cleanString(body.water_state_predicted || '', 40) || null,
      tidal_coefficient_predicted: toNumber(body.tidal_coefficient_predicted),
      activity_score_predicted: toNumber(body.activity_score_predicted),
      fishing_mode_predicted: cleanString(body.fishing_mode_predicted || '', 30) || null,
      species_predicted: speciesPredicted,
      compute_source: cleanString(body.compute_source || '', 20) || 'local',
      // Outcome
      catch_success: catchSuccess,
      actual_species: actualSpecies,
      catch_quantity: catchQuantityRaw,
      fishing_method: fishingMethod,
      // Field app extras (null for public_ui)
      operator_id: operatorId,
      operator_username: operatorUsername,
      trip_id: tripId,
      session_id: sessionId,
      location_type: locationType,
      water_observation: waterObservation,
      user_note: userNote,
      recorded_at_local: recordedAtLocalRaw,
      synced_at: syncedAt
    };

    // ── Append-safe write (Task 1) ─────────────────────────────────────────
    await appendCatchLog(record);

    return res.status(200).json({ ok: true, id: record.id });
  } catch (err) {
    return res.status(500).json({ error: 'log_catch_failed', detail: String(err.message || err) });
  }
}

async function handleCatchData(req, res) {
  setNoCache(res);
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim() || 'unknown';
  const kvAllowed = await rateLimitKv('catch_data', ip, 30, 60);
  if (!kvAllowed || !rateLimit(req, 'catch_data', 60, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  try {
    const stationId = req.query && req.query.station_id
      ? cleanString(req.query.station_id, 100)
      : null;

    const logs = await getCatchLogs(stationId, 100);
    return res.status(200).json({ ok: true, count: logs.length, logs });
  } catch (err) {
    return res.status(500).json({ error: 'catch_data_failed', detail: String(err.message || err) });
  }
}

async function handleStorageHealth(req, res) {
  setNoCache(res);
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const health = await checkStorageHealth();
    return res.status(health.ok ? 200 : 503).json(health);
  } catch (err) {
    return res.status(500).json({ ok: false, storage: 'upstash-kv', error: String(err.message || err) });
  }
}

// ─── Main handler ───

module.exports = async function handler(req, res) {
  // Route: /api/log-catch, /api/catch-data, /api/system-storage-health (rewrites via vercel.json)
  const route = req.query && req.query._navidur_route;
  if (route === 'log_catch') return handleLogCatch(req, res);
  if (route === 'catch_data') return handleCatchData(req, res);
  if (route === 'storage_health') return handleStorageHealth(req, res);

  setNoCache(res);
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!rateLimit(req, 'tracking', 120, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const body = parseBody(req);
  const records = Array.isArray(body.records) ? body.records : (body.record ? [body.record] : []);
  if (!records.length) return res.status(400).json({ error: 'tracking_records_required' });

  const rows = await readJsonFile('tracking', []);
  const ALLOWED_EVENT_TYPES = ['country_select', 'mode_select', 'station_select', 'analysis_complete'];
  records.slice(0, 200).forEach((r) => {
    const rawEvent = cleanString(r.event_type, 40).toLowerCase();
    rows.push({
      id: createId('trk'),
      event_type: ALLOWED_EVENT_TYPES.includes(rawEvent) ? rawEvent : 'station_select',
      country: cleanString(r.country, 80) || null,
      fishing_mode: cleanString(r.fishing_mode, 20).toLowerCase() || null,
      station_id: cleanString(r.station_id, 80) || null,
      station: cleanString(r.station, 100) || null,
      lat: toNumber(r.lat),
      lon: toNumber(r.lon),
      timestamp: cleanString(r.timestamp, 60) || nowIso(),
      session_id: cleanString(r.session_id, 80) || null
    });
  });

  await writeJsonFile('tracking', rows);
  return res.status(200).json({ ok: true, accepted: Math.min(records.length, 200) });
};
