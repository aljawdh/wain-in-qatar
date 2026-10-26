'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const trackingPath = require.resolve('../serverless_api/tracking');
const authPath = require.resolve('../serverless_api/_lib/auth');
const dataStorePath = require.resolve('../serverless_api/_lib/data-store');
const securityPath = require.resolve('../serverless_api/_lib/security');

test('catch-data requires admin authorization before returning records', async function () {
  const originalCacheEntries = new Map(
    [trackingPath, authPath, dataStorePath, securityPath].map(function (id) {
      return [id, require.cache[id]];
    })
  );
  const originalJwtSecret = process.env.NAVIDUR_JWT_SECRET;
  const originalAuthSalt = process.env.NAVIDUR_AUTH_SALT;
  const calls = {
    getCatchLogs: 0,
    rateLimitKv: 0,
    rateLimit: 0,
    noCache: 0
  };
  const users = [];

  function installStub(id, exports) {
    const stub = new Module(id);
    stub.filename = id;
    stub.loaded = true;
    stub.exports = exports;
    require.cache[id] = stub;
  }

  process.env.NAVIDUR_JWT_SECRET = 'synthetic-catch-data-test-secret';
  process.env.NAVIDUR_AUTH_SALT = 'synthetic-catch-data-test-salt';
  installStub(dataStorePath, {
    readJsonFile: async function (key) { return key === 'users' ? users : []; },
    writeJsonFile: async function () {},
    createId: function () { return 'synthetic-id'; },
    nowIso: function () { return '2026-01-01T00:00:00.000Z'; },
    appendCatchLog: async function () {},
    getCatchLogs: async function () {
      calls.getCatchLogs += 1;
      return [{ id: 'synthetic-catch' }];
    },
    rateLimitKv: async function () {
      calls.rateLimitKv += 1;
      return true;
    },
    checkAndSetDedup: async function () { return false; },
    checkStorageHealth: async function () { return { ok: true }; }
  });
  installStub(securityPath, {
    isAllowedOrigin: function () { return true; },
    parseBody: function () { return {}; },
    cleanString: function (value) { return String(value == null ? '' : value).trim(); },
    toNumber: function (value) { return Number.isFinite(Number(value)) ? Number(value) : null; },
    setNoCache: function () { calls.noCache += 1; },
    rateLimit: function () {
      calls.rateLimit += 1;
      return true;
    }
  });

  try {
    delete require.cache[authPath];
    const auth = require(authPath);
    for (const [id, role] of [['admin-user', 'admin'], ['super-user', 'super_admin'], ['viewer-user', 'viewer']]) {
      users.push({
        id: id,
        username: id,
        hashed_password: auth.hashPassword('synthetic-password'),
        role: role,
        active_status: true
      });
    }

    const tokens = {};
    for (const user of users) {
      const session = await auth.login(user.username, 'synthetic-password');
      assert.ok(session && session.token);
      tokens[user.role] = session.token;
    }

    delete require.cache[trackingPath];
    const handler = require(trackingPath);

    function makeResponse() {
      return {
        statusCode: null,
        body: null,
        headers: {},
        status: function (code) {
          this.statusCode = code;
          return this;
        },
        json: function (body) {
          this.body = body;
          return this;
        },
        setHeader: function (key, value) {
          this.headers[key] = value;
        }
      };
    }

    function makeRequest(token) {
      return {
        method: 'GET',
        headers: token ? { authorization: 'Bearer ' + token } : {},
        query: { _navidur_route: 'catch_data' }
      };
    }

    for (const token of [null, tokens.viewer]) {
      const denied = makeResponse();
      await handler(makeRequest(token), denied);
      assert.equal(denied.statusCode, 401);
      assert.deepEqual(denied.body, { error: 'unauthorized' });
      assert.equal(calls.getCatchLogs, 0);
    }

    for (const role of ['admin', 'super_admin']) {
      const allowed = makeResponse();
      await handler(makeRequest(tokens[role]), allowed);
      assert.equal(allowed.statusCode, 200);
      assert.deepEqual(allowed.body.logs, [{ id: 'synthetic-catch' }]);
    }

    assert.equal(calls.getCatchLogs, 2);
    assert.equal(calls.rateLimitKv, 4);
    assert.equal(calls.rateLimit, 4);
    assert.equal(calls.noCache, 4);
  } finally {
    for (const [id, entry] of originalCacheEntries) {
      if (entry) require.cache[id] = entry;
      else delete require.cache[id];
    }
    if (originalJwtSecret === undefined) delete process.env.NAVIDUR_JWT_SECRET;
    else process.env.NAVIDUR_JWT_SECRET = originalJwtSecret;
    if (originalAuthSalt === undefined) delete process.env.NAVIDUR_AUTH_SALT;
    else process.env.NAVIDUR_AUTH_SALT = originalAuthSalt;
  }
});
