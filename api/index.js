'use strict';

const loginHandler = require('../serverless_api/login');
const logoutHandler = require('../serverless_api/logout');
const feedbackHandler = require('../serverless_api/feedback');
const trackingHandler = require('../serverless_api/tracking');
const stationsHandler = require('../serverless_api/stations');
const fishingEngineHandler = require('../serverless_api/fishing-engine');
const analysisHandler = require('../serverless_api/navidur-analysis');
const snapshotHandler = require('../serverless_api/navidur-snapshot');
const runSnapshotsHandler = require('../serverless_api/run-snapshots');
const adminSettingsHandler = require('../serverless_api/admin-settings');
const adminAnalyticsHandler = require('../serverless_api/admin-analytics');
const adminSummaryHandler = require('../serverless_api/admin/summary');
const adminSystemIntegrityHandler = require('../serverless_api/admin-system-integrity');
const adminHandler = require('../serverless_api/admin/[...path]');
const waterLandOverridesHandler = require('../serverless_api/water-land-overrides');
const vercelAnalyticsHandler = require('../serverless_api/vercel-analytics');
const runtimeStoreHandler = require('../serverless_api/runtime-store');
const storeHandler = require('../serverless_api/_store');
const astroDurApiHandler = require('../serverless_api/astro-dur-api');
const intelligencePreviewHandler = require('../serverless_api/navidur-intelligence-preview');
const runIntelligenceMemoryHandler = require('../serverless_api/run-intelligence-memory');
const intelligenceCronAdminHandler = require('../serverless_api/intelligence-cron-admin');
const intelligenceTrendsHandler = require('../serverless_api/navidur-intelligence-trends');
const traitReviewAdminHandler = require('../serverless_api/trait-review-admin');
const marineGenomeAdminHandler = require('../serverless_api/marine-genome-admin');
const referenceDurHealthAdminHandler = require('../serverless_api/reference-dur-health-admin');

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
  if (route === 'intelligence-preview') return intelligencePreviewHandler(req, res);
  if (route === 'run-intelligence-memory') return runIntelligenceMemoryHandler(req, res);
  if (route === 'intelligence-cron-config' || route === 'intelligence-cron-stations' || route === 'intelligence-cron-test-run') {
    return intelligenceCronAdminHandler(req, res);
  }
  if (route === 'intelligence-memory-latest') {
    req.query._memory_route = 'intelligence-memory-latest';
    return runIntelligenceMemoryHandler(req, res);
  }
  if (route === 'intelligence-memory-runs') {
    req.query._memory_route = 'intelligence-memory-runs';
    return runIntelligenceMemoryHandler(req, res);
  }
  if (route === 'intelligence-trends' || route === 'intelligence-timeline' || route === 'intelligence-signature') {
    return intelligenceTrendsHandler(req, res);
  }
  if (route === 'trait-review-list' || route === 'trait-review-save' || route === 'trait-review-summary') {
    return traitReviewAdminHandler(req, res);
  }
  if (
    route === 'marine-genome' ||
    route === 'marine-genome-expected' ||
    route === 'marine-genome-match' ||
    route === 'marine-genome-trait-review'
  ) {
    return marineGenomeAdminHandler(req, res);
  }
  if (
    route === 'reference-dur-health' ||
    route === 'reference-dur-primary-save' ||
    route === 'reference-dur-audit-list' ||
    route === 'reference-dur-rollback'
  ) {
    return referenceDurHealthAdminHandler(req, res);
  }
  if (route === 'capture-snapshot' || route === 'snapshot-capture') return snapshotHandler(req, res);
  if (route === 'run-snapshots') return runSnapshotsHandler(req, res);
  if (route === 'admin-settings') return adminSettingsHandler(req, res);
  if (route === 'water-land-overrides') return waterLandOverridesHandler(req, res);
  if (route === 'astro-dur') return astroDurApiHandler(req, res);
  if (route === 'admin-analytics') return adminAnalyticsHandler(req, res);
  if (route === 'admin-summary') return adminSummaryHandler(req, res);
  if (route === 'admin-system-integrity' || route === 'system-integrity') return adminSystemIntegrityHandler(req, res);
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
