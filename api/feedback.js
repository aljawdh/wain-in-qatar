'use strict';

const { readJsonFile, writeJsonFile, createId, nowIso } = require('./_lib/data-store');
const { getAuthUser } = require('./_lib/auth');
const { isAllowedOrigin, parseBody, cleanString, toNumber, setNoCache, rateLimit } = require('./_lib/security');

function normalizeAnswer(answer) {
  const a = cleanString(answer, 10).toUpperCase();
  if (a === 'YES' || a === 'NO') return a;
  return null;
}

function normalizeZone(zone) {
  const z = cleanString(zone, 40).toUpperCase();
  if (!z) return null;
  return z;
}

function isDuplicate(rows, candidate) {
  const windowMs = 3 * 60 * 1000;
  const ts = new Date(candidate.timestamp).getTime();
  if (!Number.isFinite(ts)) return false;
  return rows.some((r) => {
    const t = new Date(r.timestamp).getTime();
    if (!Number.isFinite(t)) return false;
    const closeTime = Math.abs(t - ts) <= windowMs;
    if (!closeTime) return false;
    const sameLat = Number(r.lat).toFixed(4) === Number(candidate.lat).toFixed(4);
    const sameLon = Number(r.lon).toFixed(4) === Number(candidate.lon).toFixed(4);
    return sameLat && sameLon;
  });
}

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden domain' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!rateLimit(req, 'feedback', 40, 60 * 1000)) {
    return res.status(429).json({ status: 'FAILED', accepted: false, message: 'rate_limited' });
  }

  try {
    const body = parseBody(req);
    const user = await getAuthUser(req);
    if (!user || user.role !== 'member') {
      return res.status(401).json({ status: 'FAILED', accepted: false, message: 'member_login_required' });
    }
    const answer = normalizeAnswer(body.answer);
    const lat = toNumber(body.lat);
    const lon = toNumber(body.lon);
    const score = toNumber(body.score);

    if (!answer) throw new Error('answer_must_be_yes_or_no');
    if (lat == null || lon == null) throw new Error('lat_lon_required');
    if (lat < -90 || lat > 90) throw new Error('lat_out_of_range');
    if (lon < -180 || lon > 180) throw new Error('lon_out_of_range');
    if (score != null && (score < 0 || score > 100)) throw new Error('score_out_of_range');

    const record = {
      id: createId('fb'),
      user_id: user ? user.id : null,
      station: cleanString(body.station, 100) || null,
      lat,
      lon,
      score,
      zone: normalizeZone(body.zone),
      answer,
      timestamp: cleanString(body.timestamp, 60) || nowIso()
    };

    const rows = await readJsonFile('feedback', []);
    if (isDuplicate(rows, record)) {
      return res.status(409).json({ status: 'FAILED', accepted: false, message: 'duplicate_feedback_window' });
    }

    rows.push(record);
    await writeJsonFile('feedback', rows);

    return res.status(200).json({
      status: 'SUCCESS',
      accepted: true,
      feedback: record
    });
  } catch (err) {
    return res.status(400).json({
      status: 'FAILED',
      accepted: false,
      message: err && err.message ? err.message : 'invalid_payload'
    });
  }
};
