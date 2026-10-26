'use strict';

// TODO NAVIDUR_SECURITY_PHASE2: unify CORS handling through _lib/security.js before public scale (see api/index.js applyCorsHeaders, fishing-engine isAllowedOrigin).

const ORIGIN_ALLOWLIST = ['https://navidur.app', 'https://www.navidur.app'];

function parseHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      ? url
      : null;
  } catch (_err) {
    return null;
  }
}

function isAllowedOrigin(req) {
  const headers = req && req.headers ? req.headers : {};
  const origin = parseHttpUrl(String(headers.origin || ''));
  const referer = parseHttpUrl(String(headers.referer || ''));
  const host = String(headers.host || '').toLowerCase();
  const originHeader = String(headers.origin || '');
  const refererHeader = String(headers.referer || '');
  const hasOriginHeaders = !!(originHeader || refererHeader);
  const requestUrl = originHeader ? origin : referer;

  if (!hasOriginHeaders) return !!host;
  if (!requestUrl) return false;

  const trustedProductionOrigin = requestUrl.protocol === 'https:' && ORIGIN_ALLOWLIST.includes(requestUrl.origin);
  const trustedLocalOrigin = requestUrl.protocol === 'http:' && (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1');
  const sameHostOrigin = !!host && requestUrl.protocol === 'https:' && requestUrl.host.toLowerCase() === host;
  return trustedProductionOrigin || trustedLocalOrigin || sameHostOrigin;
}

function parseBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch (_err) {
      return {};
    }
  }
  if (typeof req.body === 'object') return req.body;
  return {};
}

function cleanString(value, maxLen) {
  const str = String(value == null ? '' : value).trim();
  const noControl = str.replace(/[\u0000-\u001f\u007f]/g, '');
  return typeof maxLen === 'number' ? noControl.slice(0, maxLen) : noControl;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function setNoCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
}

const _ipBuckets = new Map();

function rateLimit(req, keyPrefix, maxRequests, windowMs) {
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim() || 'unknown';
  const key = keyPrefix + ':' + ip;
  const now = Date.now();
  const bucket = _ipBuckets.get(key) || { count: 0, expiresAt: now + windowMs };
  if (now > bucket.expiresAt) {
    bucket.count = 0;
    bucket.expiresAt = now + windowMs;
  }
  bucket.count += 1;
  _ipBuckets.set(key, bucket);
  return bucket.count <= maxRequests;
}

module.exports = {
  isAllowedOrigin,
  parseBody,
  cleanString,
  toNumber,
  setNoCache,
  rateLimit
};
