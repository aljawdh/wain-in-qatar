const APP_TIMEZONE = 'Asia/Riyadh';
const { Redis } = require('@upstash/redis');

// Lazy KV REST client — reused across warm invocations in Vercel serverless.
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

function getDateKey(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(date);
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isAllowedOrigin(req) {
  const origin = String(req.headers.origin || '');
  const referer = String(req.headers.referer || '');
  const host = String(req.headers.host || '');
  const allowed = ['https://navidur.app', 'https://www.navidur.app'];
  const allowedHostSuffixes = ['.vercel.app'];

  // Allow same-host requests (admin.html and index.html on same deployment host)
  const sameHostFromOrigin = host && origin.startsWith('https://' + host);
  const sameHostFromReferer = host && referer.startsWith('https://' + host);

  // Allow Vercel preview domains for admin and app pages
  const previewOriginAllowed = allowedHostSuffixes.some((suffix) => origin.includes(suffix));
  const previewRefererAllowed = allowedHostSuffixes.some((suffix) => referer.includes(suffix));

  const okOrigin = allowed.some((d) => origin.startsWith(d));
  const okReferer = allowed.some((d) => referer.startsWith(d));
  const localhost = origin.startsWith('http://localhost') || referer.startsWith('http://localhost');

  // In strict referrer policies, origin/referer may be omitted for same-site calls.
  const missingHeadersButKnownHost = !origin && !referer && !!host;

  return okOrigin || okReferer || localhost || sameHostFromOrigin || sameHostFromReferer || previewOriginAllowed || previewRefererAllowed || missingHeadersButKnownHost;
}

function normalizeCity(input) {
  const city = String(input || '').trim();
  if (!city) return 'غير معروف';
  return city.slice(0, 60);
}

function normalizeFish(input) {
  const fish = String(input || '').trim();
  if (!fish) return null;
  return fish.slice(0, 60);
}

function normalizeFeature(input) {
  const val = String(input || '').trim().toLowerCase();
  if (val === 'tide' || val === 'tide_calculation') return 'tide_calculation';
  if (val === 'fish' || val === 'fish_info') return 'fish_info';
  return null;
}

function getClientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req.headers['x-real-ip'] || '').trim();
  return xff || real || '';
}

function isPublicIp(ip) {
  if (!ip || ip.includes(':')) return false;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.')) return false;
  const p = ip.split('.').map((n) => parseInt(n, 10));
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
  return true;
}

async function resolveCity(req, providedCity) {
  if (providedCity && String(providedCity).trim()) return normalizeCity(providedCity);

  const headerCity = req.headers['x-vercel-ip-city'] || req.headers['x-appengine-city'];
  if (headerCity) return normalizeCity(headerCity);

  const ip = getClientIp(req);
  if (!isPublicIp(ip)) return 'غير معروف';

  try {
    const r = await fetch('https://ipapi.co/' + encodeURIComponent(ip) + '/json/', {method: 'GET'});
    if (!r.ok) return 'غير معروف';
    const data = await r.json();
    return normalizeCity(data.city || data.region || data.country_name || 'غير معروف');
  } catch (e) {
    return 'غير معروف';
  }
}

function isKvConfigured() {
  return Boolean(getKvConfig());
}

function getKvEnvStatus() {
  const cfg = getKvConfig();
  return {
    KV_URL: Boolean(process.env.KV_URL),
    KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
    KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
    resolved: Boolean(cfg)
  };
}

function debugLog() {
  // Keep logs short and consistent for Vercel log search.
  const args = Array.from(arguments);
  console.log('[admin-analytics]', ...args);
}

function getMemoryStore() {
  if (!globalThis.__NAVIDUR_ANALYTICS__) {
    globalThis.__NAVIDUR_ANALYTICS__ = {
      totalVisits: 0,
      dailyVisits: {},
      fishClicks: {},
      featureClicks: {},
      cityVisits: {}
    };
  }
  return globalThis.__NAVIDUR_ANALYTICS__;
}

async function incrementVisit(dayKey, city) {
  if (isKvConfigured()) {
    const kv = getKv();
    await Promise.all([
      kv.incr('nd:analytics:visits:total'),
      kv.hincrby('nd:analytics:visits:daily', dayKey, 1),
      kv.hincrby('nd:analytics:cities', city, 1)
    ]);
    return;
  }

  const mem = getMemoryStore();
  mem.totalVisits += 1;
  mem.dailyVisits[dayKey] = (mem.dailyVisits[dayKey] || 0) + 1;
  mem.cityVisits[city] = (mem.cityVisits[city] || 0) + 1;
}

async function incrementFishClick(fishName) {
  if (!fishName) return;

  if (isKvConfigured()) {
    await getKv().hincrby('nd:analytics:fish', fishName, 1);
    return;
  }

  const mem = getMemoryStore();
  mem.fishClicks[fishName] = (mem.fishClicks[fishName] || 0) + 1;
}

async function incrementFeatureClick(featureName) {
  if (!featureName) return;

  if (isKvConfigured()) {
    await getKv().hincrby('nd:analytics:features', featureName, 1);
    return;
  }

  const mem = getMemoryStore();
  mem.featureClicks[featureName] = (mem.featureClicks[featureName] || 0) + 1;
}

function sortEntriesDesc(obj) {
  return Object.entries(obj || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
}

function toTopArray(entries, n) {
  return entries.slice(0, n).map((row) => [row[0], Number(row[1] || 0)]);
}

async function getStats() {
  const todayKey = getDateKey(new Date());
  const dayKeys = [];
  for (let i = 13; i >= 0; i--) dayKeys.push(getDateKey(addDays(new Date(), -i)));
  const weekKeys = [];
  for (let i = 6; i >= 0; i--) weekKeys.push(getDateKey(addDays(new Date(), -i)));

  if (isKvConfigured()) {
    const kv = getKv();
    const [totalRaw, dailyRaw, fishRaw, featureRaw, citiesRaw] = await Promise.all([
      kv.get('nd:analytics:visits:total'),
      kv.hgetall('nd:analytics:visits:daily'),
      kv.hgetall('nd:analytics:fish'),
      kv.hgetall('nd:analytics:features'),
      kv.hgetall('nd:analytics:cities')
    ]);

    const total = Number(totalRaw || 0);
    const daily = dailyRaw || {};
    const today = Number(daily[todayKey] || 0);
    const week = weekKeys.reduce((sum, key) => sum + Number(daily[key] || 0), 0);

    const history = dayKeys.map((k) => ({date: k, count: Number(daily[k] || 0)}));

    const payload = {
      visits: {today, week, total, history},
      fishClicks: toTopArray(sortEntriesDesc(fishRaw || {}), 10),
      topFeatures: toTopArray(sortEntriesDesc(featureRaw || {}), 10),
      cities: toTopArray(sortEntriesDesc(citiesRaw || {}), 20),
      source: 'upstash-kv-rest'
    };
    const noData = payload.visits.total === 0 && payload.fishClicks.length === 0 && payload.topFeatures.length === 0 && payload.cities.length === 0;
    if (noData) payload.message = 'No data yet';
    payload.noData = noData;
    return payload;
  }

  const mem = getMemoryStore();
  const today = Number(mem.dailyVisits[todayKey] || 0);
  const week = weekKeys.reduce((sum, key) => sum + Number(mem.dailyVisits[key] || 0), 0);
  const history = dayKeys.map((k) => ({date: k, count: Number(mem.dailyVisits[k] || 0)}));

  const payload = {
    visits: {today, week, total: Number(mem.totalVisits || 0), history},
    fishClicks: toTopArray(sortEntriesDesc(mem.fishClicks), 10),
    topFeatures: toTopArray(sortEntriesDesc(mem.featureClicks), 10),
    cities: toTopArray(sortEntriesDesc(mem.cityVisits), 20),
    source: 'memory-fallback' // KV_URL/KV_REST_API_TOKEN not set — using in-process store (resets on cold start)
  };
  const noData = payload.visits.total === 0 && payload.fishClicks.length === 0 && payload.topFeatures.length === 0 && payload.cities.length === 0;
  if (noData) payload.message = 'No data yet';
  payload.noData = noData;
  return payload;
}

module.exports = async function handler(req, res) {
  debugLog('request', {
    method: req.method,
    path: req.url,
    host: req.headers.host || '',
    hasOrigin: Boolean(req.headers.origin),
    hasReferer: Boolean(req.headers.referer),
    kvConfigured: isKvConfigured(),
    kvEnvVars: getKvEnvStatus()
  });

  if (!isAllowedOrigin(req)) {
    debugLog('blocked_by_origin_policy', {
      origin: String(req.headers.origin || ''),
      referer: String(req.headers.referer || ''),
      host: String(req.headers.host || '')
    });
    return res.status(403).json({error: 'Forbidden domain'});
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      console.log('DATA RECEIVED:', JSON.stringify(body));
      const action = String(body.action || '').trim();
      const dayKey = getDateKey(new Date());
      debugLog('post_action_received', {
        action,
        fishName: body.fishName || null,
        featureName: body.featureName || null,
        city: body.city || null,
        dayKey
      });

      if (action === 'visit') {
        const city = await resolveCity(req, body.city);
        await incrementVisit(dayKey, city);
        debugLog('visit_saved', {city, store: isKvConfigured() ? 'redis-url' : 'memory-fallback'});
      } else if (action === 'fish_click') {
        const fishName = normalizeFish(body.fishName);
        await incrementFishClick(fishName);
        debugLog('fish_click_saved', {fishName, store: isKvConfigured() ? 'redis-url' : 'memory-fallback'});
      } else if (action === 'feature_click') {
        const featureName = normalizeFeature(body.featureName);
        await incrementFeatureClick(featureName);
        debugLog('feature_click_saved', {featureName, store: isKvConfigured() ? 'redis-url' : 'memory-fallback'});
      }

      return res.status(200).json({ok: true, store: isKvConfigured() ? 'redis-url' : 'memory-fallback'});
    } catch (err) {
      debugLog('post_error', {message: err && err.message ? err.message : 'unknown'});
      return res.status(500).json({error: 'Analytics write failed'});
    }
  }

  if (req.method === 'GET') {
    try {
      const stats = await getStats();
      debugLog('stats_read', {
        source: stats.source,
        total: stats.visits.total,
        today: stats.visits.today,
        week: stats.visits.week,
        noData: stats.noData
      });
      return res.status(200).json(stats);
    } catch (err) {
      debugLog('get_error', {message: err && err.message ? err.message : 'unknown'});
      return res.status(500).json({error: 'Analytics read failed'});
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({error: 'Method not allowed'});
};
