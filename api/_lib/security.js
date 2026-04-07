'use strict';

const ORIGIN_ALLOWLIST = ['https://navidur.app', 'https://www.navidur.app'];
const PREVIEW_SUFFIXES = ['.vercel.app'];

function isAllowedOrigin(req) {
  const origin = String(req.headers.origin || '');
  const referer = String(req.headers.referer || '');
  const host = String(req.headers.host || '');

  const sameHostFromOrigin = host && origin.startsWith('https://' + host);
  const sameHostFromReferer = host && referer.startsWith('https://' + host);
  const previewOriginAllowed = PREVIEW_SUFFIXES.some((suffix) => origin.includes(suffix));
  const previewRefererAllowed = PREVIEW_SUFFIXES.some((suffix) => referer.includes(suffix));
  const okOrigin = ORIGIN_ALLOWLIST.some((d) => origin.startsWith(d));
  const okReferer = ORIGIN_ALLOWLIST.some((d) => referer.startsWith(d));
  const localhost = origin.startsWith('http://localhost') || referer.startsWith('http://localhost');
  const missingHeadersButKnownHost = !origin && !referer && !!host;

  return okOrigin || okReferer || localhost || sameHostFromOrigin || sameHostFromReferer || previewOriginAllowed || previewRefererAllowed || missingHeadersButKnownHost;
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
