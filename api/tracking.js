'use strict';

const { readJsonFile, writeJsonFile, createId, nowIso } = require('./_lib/data-store');
const { isAllowedOrigin, parseBody, cleanString, toNumber, setNoCache, rateLimit } = require('./_lib/security');

module.exports = async function handler(req, res) {
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
