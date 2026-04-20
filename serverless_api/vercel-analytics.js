const APP_TIMEZONE = 'Asia/Riyadh';

function getDateParts(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(date);
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  return {year: Number(map.year), month: Number(map.month), day: Number(map.day)};
}

function toIsoStartOfDay(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0)).toISOString();
}

function toIsoEndOfDay(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 23, 59, 59)).toISOString();
}

function isAllowedOrigin(req) {
  const origin = String(req.headers.origin || '');
  const referer = String(req.headers.referer || '');
  const allowed = ['https://navidur.app', 'https://www.navidur.app'];
  const okOrigin = allowed.some((d) => origin.startsWith(d));
  const okReferer = allowed.some((d) => referer.startsWith(d));
  const localhost = origin.startsWith('http://localhost') || referer.startsWith('http://localhost');
  return okOrigin || okReferer || localhost;
}

function numberFromUnknown(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickVisitorsFromData(data) {
  if (!data) return 0;

  if (typeof data.visitors === 'number') return data.visitors;
  if (typeof data.totalVisitors === 'number') return data.totalVisitors;

  if (Array.isArray(data.data)) {
    return data.data.reduce((sum, row) => {
      const direct = numberFromUnknown(row && row.visitors);
      if (direct) return sum + direct;
      return sum + numberFromUnknown(row && row.value);
    }, 0);
  }

  if (Array.isArray(data.timeSeries)) {
    return data.timeSeries.reduce((sum, row) => {
      return sum + numberFromUnknown(row && (row.visitors || row.value || row.count));
    }, 0);
  }

  if (Array.isArray(data.results)) {
    return data.results.reduce((sum, row) => {
      return sum + numberFromUnknown(row && (row.visitors || row.value || row.count));
    }, 0);
  }

  return 0;
}

async function callVercelApi(url, token) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error('Vercel API error: ' + res.status + ' ' + txt.slice(0, 160));
  }

  return res.json();
}

async function getVisitorsToday() {
  const token = process.env.VERCEL_API_TOKEN || process.env.VERCEL_TOKEN || process.env.VERCEL_OIDC_TOKEN || '';
  const projectId = process.env.VERCEL_PROJECT_ID || process.env.NAVIDUR_VERCEL_PROJECT_ID || '';

  if (!token || !projectId) {
    return {visitorsToday: 0, source: 'missing_env'};
  }

  const parts = getDateParts(new Date());
  const from = encodeURIComponent(toIsoStartOfDay(parts));
  const to = encodeURIComponent(toIsoEndOfDay(parts));

  const urls = [
    'https://api.vercel.com/v1/web/analytics/timeseries?projectId=' + encodeURIComponent(projectId) + '&from=' + from + '&to=' + to + '&metric=visitors&interval=1d',
    'https://api.vercel.com/v1/analytics/timeseries?projectId=' + encodeURIComponent(projectId) + '&from=' + from + '&to=' + to + '&metric=visitors&interval=1d',
    'https://api.vercel.com/v2/web/analytics/timeseries?projectId=' + encodeURIComponent(projectId) + '&from=' + from + '&to=' + to + '&metric=visitors&interval=1d'
  ];

  let lastError = null;
  for (const url of urls) {
    try {
      const data = await callVercelApi(url, token);
      const visitors = pickVisitorsFromData(data);
      return {visitorsToday: visitors, source: 'vercel_api'};
    } catch (e) {
      lastError = e;
    }
  }

  return {visitorsToday: 0, source: 'failed', error: lastError ? String(lastError.message || lastError) : 'unknown'};
}

module.exports = async function handler(req, res) {
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({error: 'Forbidden domain'});
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error: 'Method not allowed'});
  }

  try {
    const out = await getVisitorsToday();
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({error: 'Failed to read Vercel analytics'});
  }
};
