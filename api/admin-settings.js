const { Redis } = require('@upstash/redis');
const { requireRole } = require('./_lib/auth');

const SETTINGS_KEY = 'navidur_settings';

let _kvClient = null;

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

function getMemoryStore() {
  if (!globalThis.__NAVIDUR_SETTINGS__) {
    globalThis.__NAVIDUR_SETTINGS__ = null;
  }
  return globalThis;
}

function defaultSettings() {
  return {
    site_mode: 'live',
    maintenance_message: '',
    allow_admin_bypass: true,
    station_list_mode: 'grouped',
    location_mode: 'ask',
    sort_stations_by_distance: false,
    headerText: '',
    headerColor: '#27b3ff',
    hijriOffset: -1,
    footerName: '',
    footerPhone: '',
    footerEmail: '',
    footerSponsor: '',
    footerSponsorLink: '',
    ads: {
      adBanner: {
        enabled: false,
        imageUrl: '',
        linkUrl: ''
      }
    },
    features: {
      featurePrediction: true
    },
    fishData: {
      featured: []
    },
    updatedAt: null
  };
}

function normalizeUrl(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://')) return value.slice(0, 500);
  return '';
}

function normalizeColor(input) {
  const value = String(input || '').trim();
  if (!value) return '#27b3ff';
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (/^#[0-9a-fA-F]{3}$/.test(value)) return value;
  return '#27b3ff';
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.toLowerCase().trim();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
  }
  return fallback;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeSiteMode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'maintenance' || v === 'private_beta' || v === 'live') return v;
  return 'live';
}

function normalizeStationListMode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'chips' || v === 'classic' || v === 'grouped') return v;
  return 'grouped';
}

function normalizeLocationMode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'off' || v === 'ask' || v === 'auto') return v;
  return 'ask';
}

function normalizeSettings(input) {
  const base = defaultSettings();
  const src = safeObject(input);
  const ads = safeObject(src.ads);
  const adBanner = safeObject(ads.adBanner || src.adBanner);
  const features = safeObject(src.features);
  const fishData = safeObject(src.fishData || src.fish);

  const featurePrediction = normalizeBoolean(
    features.featurePrediction !== undefined ? features.featurePrediction : src.featurePrediction,
    true
  );

  const rawHijriOffset = typeof src.hijriOffset === 'number' ? src.hijriOffset : parseInt(String(src.hijriOffset || '').trim(), 10);
  const hijriOffset = Number.isNaN(rawHijriOffset) ? -1 : Math.round(Math.max(-5, Math.min(5, rawHijriOffset)));

  return {
    site_mode: normalizeSiteMode(src.site_mode),
    maintenance_message: String(src.maintenance_message || '').trim().slice(0, 500),
    allow_admin_bypass: normalizeBoolean(src.allow_admin_bypass, true),
    station_list_mode: normalizeStationListMode(src.station_list_mode),
    location_mode: normalizeLocationMode(src.location_mode),
    sort_stations_by_distance: normalizeBoolean(src.sort_stations_by_distance, false),
    headerText: String(src.headerText || '').trim().slice(0, 120),
    headerColor: normalizeColor(src.headerColor),
    hijriOffset: hijriOffset,
    footerName: String(src.footerName || '').trim().slice(0, 120),
    footerPhone: String(src.footerPhone || '').trim().slice(0, 60),
    footerEmail: String(src.footerEmail || '').trim().slice(0, 120),
    footerSponsor: String(src.footerSponsor || '').trim().slice(0, 160),
    footerSponsorLink: normalizeUrl(src.footerSponsorLink),
    ads: {
      adBanner: {
        enabled: normalizeBoolean(adBanner.enabled, false),
        imageUrl: normalizeUrl(adBanner.imageUrl),
        linkUrl: normalizeUrl(adBanner.linkUrl)
      }
    },
    features: {
      featurePrediction: featurePrediction
    },
    fishData: {
      featured: Array.isArray(fishData.featured) ? fishData.featured.slice(0, 50) : []
    },
    updatedAt: new Date().toISOString(),
    previousUpdatedAt: src.updatedAt || base.updatedAt
  };
}

async function readSettings() {
  if (isKvConfigured()) {
    const raw = await getKv().get(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    try {
      return normalizeSettings(JSON.parse(raw));
    } catch (e) {
      return defaultSettings();
    }
  }

  const mem = getMemoryStore();
  if (!mem.__NAVIDUR_SETTINGS__) {
    mem.__NAVIDUR_SETTINGS__ = defaultSettings();
  }
  return normalizeSettings(mem.__NAVIDUR_SETTINGS__);
}

async function writeSettings(nextSettings) {
  const normalized = normalizeSettings(nextSettings);

  if (isKvConfigured()) {
    await getKv().set(SETTINGS_KEY, JSON.stringify(normalized));
    return normalized;
  }

  const mem = getMemoryStore();
  mem.__NAVIDUR_SETTINGS__ = normalized;
  return normalized;
}

module.exports = async function handler(req, res) {
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden domain' });
  }

  if (req.method === 'POST') {
    const actor = await requireRole('admin')(req, res);
    if (!actor) return;
  }

  if (req.method === 'GET') {
    try {
      const settings = await readSettings();
      return res.status(200).json({
        ok: true,
        key: SETTINGS_KEY,
        source: isKvConfigured() ? 'upstash-kv-rest' : 'memory-fallback',
        settings: settings
      });
    } catch (e) {
      return res.status(500).json({ error: 'Settings read failed' });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const incoming = body.settings && typeof body.settings === 'object' ? body.settings : body;
      const saved = await writeSettings(incoming);
      return res.status(200).json({
        ok: true,
        key: SETTINGS_KEY,
        source: isKvConfigured() ? 'upstash-kv-rest' : 'memory-fallback',
        settings: saved
      });
    } catch (e) {
      console.error('[admin-settings][POST] save failed', {
        message: e && e.message ? e.message : String(e),
        hasKvUrl: !!process.env.KV_URL || !!process.env.KV_REST_API_URL,
        hasKvToken: !!process.env.KV_REST_API_TOKEN,
        key: SETTINGS_KEY
      });
      return res.status(500).json({ error: 'Settings save failed' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};
