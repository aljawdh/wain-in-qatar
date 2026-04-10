'use strict';

const { readJsonFile, writeJsonFile, createId, nowIso } = require('./_lib/data-store');
const { isAllowedOrigin, parseBody, cleanString, toNumber, setNoCache, rateLimit } = require('./_lib/security');

// ─── Catch log handlers (routes: /api/log-catch, /api/catch-data) ───

async function handleLogCatch(req, res) {
  setNoCache(res);
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!rateLimit(req, 'log_catch', 30, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  try {
    const body = parseBody(req);
    const stationId = cleanString(body.station_id || '', 100);
    const timestamp = cleanString(body.timestamp || '', 60) || nowIso();

    if (!stationId) return res.status(400).json({ error: 'station_id_required' });
    if (!timestamp) return res.status(400).json({ error: 'timestamp_required' });

    const speciesPredicted = Array.isArray(body.species_predicted)
      ? body.species_predicted.map((s) => cleanString(String(s), 60)).filter(Boolean)
      : [];
    const actualSpecies = Array.isArray(body.actual_species)
      ? body.actual_species.map((s) => cleanString(String(s), 60)).filter(Boolean)
      : [];

    const record = {
      id: createId('catch'),
      created_at: nowIso(),
      station_id: stationId,
      lat: toNumber(body.lat),
      lng: toNumber(body.lng),
      timestamp,
      wind_speed: toNumber(body.wind_speed),
      wind_direction: toNumber(body.wind_direction),
      tide_current: toNumber(body.tide_current),
      tide_previous: toNumber(body.tide_previous),
      tide_next: toNumber(body.tide_next),
      temperature: toNumber(body.temperature),
      water_state_predicted: cleanString(body.water_state_predicted || '', 40) || null,
      activity_score_predicted: toNumber(body.activity_score_predicted),
      fishing_mode_predicted: cleanString(body.fishing_mode_predicted || '', 30) || null,
      species_predicted: speciesPredicted,
      catch_success: body.catch_success === true || body.catch_success === 'true',
      actual_species: actualSpecies,
      catch_quantity: toNumber(body.catch_quantity),
      fishing_method: cleanString(body.fishing_method || '', 60) || null
    };

    const rows = await readJsonFile('catch_logs', []);
    rows.push(record);
    await writeJsonFile('catch_logs', rows);

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
  if (!rateLimit(req, 'catch_data', 60, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  try {
    const stationId = req.query && req.query.station_id
      ? cleanString(req.query.station_id, 100)
      : null;

    const rows = await readJsonFile('catch_logs', []);
    const filtered = stationId
      ? rows.filter((r) => r.station_id === stationId)
      : rows;

    const latest = filtered.slice(-100);
    return res.status(200).json({ ok: true, count: latest.length, logs: latest });
  } catch (err) {
    return res.status(500).json({ error: 'catch_data_failed', detail: String(err.message || err) });
  }
}

// ─── Main handler ───

module.exports = async function handler(req, res) {
  // Route: /api/log-catch and /api/catch-data (rewrites via vercel.json)
  const route = req.query && req.query._navidur_route;
  if (route === 'log_catch') return handleLogCatch(req, res);
  if (route === 'catch_data') return handleCatchData(req, res);

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
