'use strict';

var { getAuthUser, ROLE_ORDER } = require('./_lib/auth');
var { setNoCache, isAllowedOrigin, parseBody, rateLimit, cleanString } = require('./_lib/security');
var service = require('./_lib/trait-review-service');

function isAdminActor(user) {
  if (!user || !ROLE_ORDER[user.role]) return false;
  return ROLE_ORDER[user.role] >= ROLE_ORDER.admin;
}

async function assertAdminOnly(req, res) {
  var user = await getAuthUser(req);
  if (isAdminActor(user)) {
    return { user: user };
  }
  res.status(401).json({ ok: false, error: 'admin_auth_required' });
  return null;
}

module.exports = async function handler(req, res) {
  setNoCache(res);
  res.setHeader('Content-Type', 'application/json');

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'forbidden_domain' });
  }

  var route = String(req.query && req.query.route || '').toLowerCase();
  if (!rateLimit(req, 'trait_review_admin_' + route, 60, 60 * 1000)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  var auth = await assertAdminOnly(req, res);
  if (!auth) return;

  try {
    if (route === 'trait-review-list') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      var listOut = await service.listForScope(req.query || {});
      return res.status(200).json(listOut);
    }

    if (route === 'trait-review-save') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      var body = parseBody(req);
      var actor = (auth.user && (auth.user.username || auth.user.id)) || 'admin';
      var saved = await service.saveReview(body, actor);
      return res.status(200).json({ ok: true, review: saved });
    }

    if (route === 'trait-review-summary') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
      }
      var summary = await service.buildSummary(req.query || {});
      return res.status(200).json(summary);
    }

    return res.status(404).json({ ok: false, error: 'trait_review_route_not_found' });
  } catch (err) {
    var code = err && err.code === 400 ? 400 : 500;
    return res.status(code).json({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
};
