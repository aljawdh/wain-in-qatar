'use strict';

const { Redis } = require('@upstash/redis');
const { requireRole } = require('./_lib/auth');
const { cleanString } = require('./_lib/security');

const WATER_LAND_OVERRIDES_KEY = 'navidur:water_land_overrides';

let _kvClient = null;
/** In-memory fallback when KV is not configured (local dev only; not used on Vercel). */
let _memoryOverridesDoc = { points: {} };

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.KV_URL || '';
  const token = process.env.KV_REST_API_TOKEN || '';
  if (!url || !token) return null;
  return { url, token };
}

function getKv() {
  if (_kvClient) return _kvClient;
  const cfg = getKvConfig();
  if (!cfg) return null;
  _kvClient = new Redis({ url: cfg.url, token: cfg.token });
  return _kvClient;
}

function isKvConfigured() {
  return Boolean(getKvConfig());
}

function isAllowedOrigin(req) {
  const origin = String(req.headers.origin || '');
  const referer = String(req.headers.referer || '');
  const host = String(req.headers.host || '');
  const allowed = ['https://navidur.app', 'https://www.navidur.app'];
  const allowedHostSuffixes = ['.vercel.app'];
  const sameHostFromOrigin = host && origin.startsWith('https://' + host);
  const sameHostFromReferer = host && referer.startsWith('https://' + host);
  const previewOriginAllowed = allowedHostSuffixes.some(function (suffix) { return origin.includes(suffix); });
  const previewRefererAllowed = allowedHostSuffixes.some(function (suffix) { return referer.includes(suffix); });
  const okOrigin = allowed.some(function (d) { return origin.startsWith(d); });
  const okReferer = allowed.some(function (d) { return referer.startsWith(d); });
  const localhost = origin.startsWith('http://localhost') || referer.startsWith('http://localhost');
  const missingHeadersButKnownHost = !origin && !referer && !!host;
  return okOrigin || okReferer || localhost || sameHostFromOrigin || sameHostFromReferer || previewOriginAllowed || previewRefererAllowed || missingHeadersButKnownHost;
}

function normalizeDoc(raw) {
  if (raw == null) return { points: {} };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return { points: {} };
    if (parsed.points && typeof parsed.points === 'object' && !Array.isArray(parsed.points)) {
      return { points: parsed.points };
    }
    return { points: {} };
  } catch (_e) {
    return { points: {} };
  }
}

async function readOverridesFromKv() {
  const kv = getKv();
  if (!kv) {
    return normalizeDoc(_memoryOverridesDoc);
  }
  const raw = await kv.get(WATER_LAND_OVERRIDES_KEY);
  return normalizeDoc(raw);
}

async function writeOverridesToKv(doc) {
  const kv = getKv();
  if (!kv) {
    if (process.env.VERCEL) {
      throw new Error('kv_not_configured');
    }
    _memoryOverridesDoc = { points: Object.assign({}, doc.points || {}) };
    return _memoryOverridesDoc;
  }
  await kv.set(WATER_LAND_OVERRIDES_KEY, JSON.stringify(doc));
  return doc;
}

function toPointId(lat, lng) {
  return Number(lat).toFixed(6) + '_' + Number(lng).toFixed(6);
}

function normalizeStatus(s) {
  const v = String(s || '').trim().toLowerCase();
  if (v === 'confirmed_land' || v === 'confirmed_water' || v === 'unknown') return v;
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden domain' });
  }

  if (req.method === 'GET') {
    try {
      const doc = isKvConfigured() ? await readOverridesFromKv() : { points: {} };
      return res.status(200).json({
        ok: true,
        key: WATER_LAND_OVERRIDES_KEY,
        points: doc.points,
        storage: isKvConfigured() ? 'upstash_kv' : 'no_kv'
      });
    } catch (err) {
      console.error('[water-land-overrides][GET]', err);
      return res.status(500).json({ ok: false, error: 'read_failed' });
    }
  }

  if (req.method === 'POST') {
    const actor = await requireRole('admin')(req, res);
    if (!actor) return;

    if (!isKvConfigured() && process.env.VERCEL) {
      return res.status(503).json({ ok: false, error: 'kv_not_configured', message: 'Upstash KV not configured' });
    }

    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const action = String(body.action || '').trim().toLowerCase();
      const lat = Number(body.lat);
      const lng = Number(body.lng != null ? body.lng : body.lon);
      const pointId = body.point_id ? cleanString(body.point_id, 64) : null;
      const pid = pointId || (isFinite(lat) && isFinite(lng) ? toPointId(lat, lng) : null);

      if (!pid) {
        return res.status(400).json({ ok: false, error: 'invalid_coordinates' });
      }

      let doc = isKvConfigured() ? await readOverridesFromKv() : { points: {} };
      if (!doc.points || typeof doc.points !== 'object') doc.points = {};

      if (action === 'delete') {
        delete doc.points[pid];
        await writeOverridesToKv(doc);
        return res.status(200).json({
          ok: true,
          key: WATER_LAND_OVERRIDES_KEY,
          action: 'delete',
          point_id: pid,
          storage: isKvConfigured() ? 'upstash_kv' : 'memory_fallback_dev'
        });
      }

      if (action !== 'upsert') {
        return res.status(400).json({ ok: false, error: 'invalid_action' });
      }

      const status = normalizeStatus(body.status);
      if (!status) {
        return res.status(400).json({ ok: false, error: 'invalid_status' });
      }

      const latN = isFinite(lat) ? lat : (doc.points[pid] && doc.points[pid].lat != null ? Number(doc.points[pid].lat) : NaN);
      const lngN = isFinite(lng) ? lng : (doc.points[pid] && doc.points[pid].lng != null ? Number(doc.points[pid].lng) : NaN);
      if (!isFinite(latN) || !isFinite(lngN)) {
        return res.status(400).json({ ok: false, error: 'invalid_coordinates' });
      }

      const prev = doc.points[pid] || null;
      const created = prev && prev.created_at ? prev.created_at : nowIso();
      const entry = {
        id: pid,
        lat: Number(latN.toFixed(6)),
        lng: Number(lngN.toFixed(6)),
        status: status,
        source: 'admin_manual',
        station_id: cleanString(body.station_id || (prev && prev.station_id), 80) || '',
        station_name: cleanString(body.station_name || (prev && prev.station_name), 120) || '',
        created_at: created,
        updated_at: nowIso()
      };
      doc.points[pid] = entry;
      await writeOverridesToKv(doc);

      return res.status(200).json({
        ok: true,
        key: WATER_LAND_OVERRIDES_KEY,
        action: 'upsert',
        point: entry,
        storage: isKvConfigured() ? 'upstash_kv' : 'memory_fallback_dev'
      });
    } catch (err) {
      console.error('[water-land-overrides][POST]', err);
      const msg = err && err.message === 'kv_not_configured' ? 'kv_not_configured' : 'save_failed';
      return res.status(500).json({ ok: false, error: msg });
    }
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
};
