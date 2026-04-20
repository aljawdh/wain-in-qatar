'use strict';

const loginHandler = require('../serverless_api/login');
const logoutHandler = require('../serverless_api/logout');
const feedbackHandler = require('../serverless_api/feedback');
const trackingHandler = require('../serverless_api/tracking');
const stationsHandler = require('../serverless_api/stations');
const fishingEngineHandler = require('../serverless_api/fishing-engine');
const analysisHandler = require('../serverless_api/navidur-analysis');
const snapshotHandler = require('../serverless_api/navidur-snapshot');
const adminSettingsHandler = require('../serverless_api/admin-settings');
const adminAnalyticsHandler = require('../serverless_api/admin-analytics');
const adminSummaryHandler = require('../serverless_api/admin/summary');
const adminHandler = require('../serverless_api/admin/[...path]');
const vercelAnalyticsHandler = require('../serverless_api/vercel-analytics');
const runtimeStoreHandler = require('../serverless_api/runtime-store');
const storeHandler = require('../serverless_api/_store');

function normalizeRoute(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAdminPath(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '')
    .split('/')
    .map(function (part) { return String(part || '').trim(); })
    .filter(Boolean);
}

function applyCorsHeaders(res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

module.exports = async function handler(req, res) {
  applyCorsHeaders(res);
  req.query = req.query || {};

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  const route = normalizeRoute(req.query.route || req.query.resource || req.query._route);

  if (route === 'login') return loginHandler(req, res);
  if (route === 'logout') return logoutHandler(req, res);
  if (route === 'feedback') return feedbackHandler(req, res);
  if (route === 'tracking') return trackingHandler(req, res);
  if (route === 'stations') return stationsHandler(req, res);
  if (route === 'fish-species') {
    req.query._navidur_route = 'fish_species';
    return stationsHandler(req, res);
  }
  if (route === 'fishing-engine') return fishingEngineHandler(req, res);
  if (route === 'compute-decision') {
    req.query._navidur_route = 'compute_decision';
    return fishingEngineHandler(req, res);
  }
  if (route === 'analysis') return analysisHandler(req, res);
  if (route === 'capture-snapshot' || route === 'snapshot-capture') return snapshotHandler(req, res);
  if (route === 'admin-settings') return adminSettingsHandler(req, res);
  if (route === 'admin-analytics') return adminAnalyticsHandler(req, res);
  if (route === 'admin-summary') return adminSummaryHandler(req, res);
  if (route === 'log-catch') {
    req.query._navidur_route = 'log_catch';
    return trackingHandler(req, res);
  }
  if (route === 'catch-data') {
    req.query._navidur_route = 'catch_data';
    return trackingHandler(req, res);
  }
  if (route === 'storage-health' || route === 'system-storage-health') {
    req.query._navidur_route = 'storage_health';
    return trackingHandler(req, res);
  }
  if (route === 'vercel-analytics') return vercelAnalyticsHandler(req, res);
  if (route === 'runtime-store') return runtimeStoreHandler(req, res);
  if (route === 'store') return storeHandler(req, res);
  if (route === 'overrides') {
    req.query.path = ['station-dur-overrides'];
    return adminHandler(req, res);
  }
  if (route === 'admin') {
    req.query.path = normalizeAdminPath(req.query.path);
    if (req.query.path[0] === 'summary') {
      return adminSummaryHandler(req, res);
    }
    return adminHandler(req, res);
  }

  return res.status(404).json({ error: 'api_route_not_found' });
};
