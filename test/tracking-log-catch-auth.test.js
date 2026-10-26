'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isAllowedOrigin } = require('../serverless_api/_lib/security');

const trackingPath = require.resolve('../serverless_api/tracking');
const authPath = require.resolve('../serverless_api/_lib/auth');
const dataStorePath = require.resolve('../serverless_api/_lib/data-store');
const securityPath = require.resolve('../serverless_api/_lib/security');
const fieldHtmlPath = path.join(__dirname, '..', 'field', 'index.html');

function signSyntheticPayload(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + signature;
}

function installModule(id, exports) {
  const Module = require('node:module');
  const stub = new Module(id);
  stub.filename = id;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[id] = stub;
}

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

test('log-catch authenticates before writes and assigns server-verified attribution', async function () {
  const moduleIds = [trackingPath, authPath, dataStorePath, securityPath];
  const originalCache = new Map(moduleIds.map(function (id) {
    return [id, require.cache[id]];
  }));
  const originalJwtSecret = process.env.NAVIDUR_JWT_SECRET;
  const originalAuthSalt = process.env.NAVIDUR_AUTH_SALT;
  const secret = 'synthetic-log-catch-test-secret';
  const users = [];
  const persisted = [];
  const calls = { appendCatchLog: 0, dedup: 0, rateLimitKv: 0, rateLimit: 0 };

  process.env.NAVIDUR_JWT_SECRET = secret;
  process.env.NAVIDUR_AUTH_SALT = 'synthetic-log-catch-test-salt';
  installModule(dataStorePath, {
    readJsonFile: async function (key) { return key === 'users' ? users : []; },
    writeJsonFile: async function () {},
    createId: function (prefix) { return prefix + '_synthetic'; },
    nowIso: function () { return '2026-10-26T00:00:00.000Z'; },
    appendCatchLog: async function (record) {
      calls.appendCatchLog += 1;
      persisted.push(record);
    },
    getCatchLogs: async function () { return []; },
    rateLimitKv: async function () {
      calls.rateLimitKv += 1;
      return true;
    },
    checkAndSetDedup: async function () {
      calls.dedup += 1;
      return false;
    },
    checkStorageHealth: async function () { return { ok: true }; }
  });
  installModule(securityPath, {
    isAllowedOrigin: isAllowedOrigin,
    parseBody: function (req) { return req.body || {}; },
    cleanString: function (value, maxLength) {
      const result = String(value == null ? '' : value).trim();
      return typeof maxLength === 'number' ? result.slice(0, maxLength) : result;
    },
    toNumber: function (value) {
      if (value == null || value === '') return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    },
    setNoCache: function () {},
    rateLimit: function () {
      calls.rateLimit += 1;
      return true;
    }
  });

  try {
    delete require.cache[authPath];
    const auth = require(authPath);
    for (const [id, role] of [
      ['member-user', 'member'],
      ['admin-user', 'admin'],
      ['super-user', 'super_admin'],
      ['viewer-user', 'viewer']
    ]) {
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
    const expiredToken = signSyntheticPayload({
      user_id: 'member-user',
      role: 'member',
      username: 'member-user',
      exp: Date.now() - 1000
    }, secret);

    delete require.cache[trackingPath];
    const handler = require(trackingPath);

    async function submit(token, body, extraHeaders) {
      const req = {
        method: 'POST',
        headers: Object.assign({ host: 'navidur.app' }, token ? { authorization: 'Bearer ' + token } : {}, extraHeaders || {}),
        query: { _navidur_route: 'log_catch' },
        body: Object.assign({
          station_id: 'st_synthetic',
          analysis_timestamp: '2026-10-26T00:00:00.000Z',
          catch_success: true,
          source: 'public_ui',
          operator_id: 'spoofed-id',
          operator_username: 'spoofed-user'
        }, body || {})
      };
      const res = makeResponse();
      await handler(req, res);
      return res;
    }

    for (const token of [null, 'invalid.token', expiredToken, tokens.viewer]) {
      const res = await submit(token);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.body, { error: 'unauthorized' });
    }
    assert.equal(calls.appendCatchLog, 0);
    assert.equal(calls.dedup, 0);
    assert.equal(calls.rateLimitKv, 0);

    const cookieWithoutOrigin = await submit(null, null, { cookie: 'navidur_token=' + tokens.member });
    assert.equal(cookieWithoutOrigin.statusCode, 403);
    assert.equal(cookieWithoutOrigin.body.error, 'forbidden_domain');
    assert.equal(calls.appendCatchLog, 0);

    const untrustedCookieRequest = await submit(null, null, {
      cookie: 'navidur_token=' + tokens.member,
      origin: 'https://attacker.vercel.app',
      host: 'navidur.app'
    });
    assert.equal(untrustedCookieRequest.statusCode, 403);
    assert.equal(calls.appendCatchLog, 0);

    const productionCookieRequest = await submit(null, null, {
      cookie: 'navidur_token=' + tokens.member,
      origin: 'https://navidur.app',
      host: 'navidur.app'
    });
    assert.equal(productionCookieRequest.statusCode, 200);
    assert.equal(persisted[persisted.length - 1].operator_id, 'member-user');

    for (const role of ['member', 'admin', 'super_admin']) {
      const res = await submit(tokens[role]);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      const record = persisted[persisted.length - 1];
      assert.equal(record.source, 'field_app');
      assert.equal(record.operator_id, role === 'member' ? 'member-user' : role === 'admin' ? 'admin-user' : 'super-user');
      assert.equal(record.operator_username, record.operator_id);
      assert.equal(record.station_id, 'st_synthetic');
      assert.equal(record.catch_success, true);
    }

    assert.equal(calls.appendCatchLog, 4);
    assert.equal(calls.dedup, 4);
    assert.equal(calls.rateLimitKv, 4);
    assert.equal(calls.rateLimit, 4);
    assert.ok(persisted.every(function (record) { return record.source !== 'public_ui'; }));
    assert.ok(persisted.every(function (record) { return record.operator_id !== 'spoofed-id'; }));
  } finally {
    for (const [id, entry] of originalCache) {
      if (entry) require.cache[id] = entry;
      else delete require.cache[id];
    }
    if (originalJwtSecret === undefined) delete process.env.NAVIDUR_JWT_SECRET;
    else process.env.NAVIDUR_JWT_SECRET = originalJwtSecret;
    if (originalAuthSalt === undefined) delete process.env.NAVIDUR_AUTH_SALT;
    else process.env.NAVIDUR_AUTH_SALT = originalAuthSalt;
  }
});

test('field pending reports survive 401/403 and retry after reauthentication', async function () {
  const source = fs.readFileSync(fieldHtmlPath, 'utf8');
  const start = source.indexOf('async function syncPending() {');
  const nextSection = source.indexOf('// RENDER HELPERS', start);
  const end = source.lastIndexOf('\n}', nextSection);
  assert.notEqual(start, -1, 'syncPending function exists');
  assert.notEqual(nextSection, -1, 'render helpers section exists');
  assert.notEqual(end, -1, 'syncPending function boundary exists');
  const functionSource = source.slice(start, end + 2);

  async function runScenario(responses) {
    const record = { local_id: 'local-synthetic', owner_id: 'member-user', synced_at: null, station_id: 'st_synthetic' };
    const requests = [];
    const authError = { textContent: '' };
    const state = {
      _syncInFlight: false,
      appState: { isOnline: true, pendingCount: 1 },
      Auth: {
        token: 'expired-token',
        user: { id: 'member-user' },
        clear: function () { this.token = null; this.user = null; }
      },
      FieldDB: {
        getPending: async function () { return record.synced_at ? [] : [record]; },
        markSynced: async function (_localId, syncedAt) { record.synced_at = syncedAt; }
      },
      fetch: async function (_url, options) {
        requests.push(options);
        const response = responses.shift();
        return {
          status: response.status,
          ok: response.status >= 200 && response.status < 300,
          json: async function () { return response.body; }
        };
      },
      nowIso: function () { return '2026-10-26T00:01:00.000Z'; },
      showAuthScreen: function () { state.authScreenShown = true; },
      showToast: function (message) { state.toastMessage = message; },
      renderStatusBar: function () {},
      document: {
        getElementById: function () { return authError; }
      },
      authError: authError
    };
    const syncPending = vm.runInNewContext(functionSource + '\nsyncPending;', state);
    await syncPending();
    return { state: state, record: record, requests: requests, syncPending: syncPending };
  }

  for (const status of [401, 403]) {
    const scenario = await runScenario([{ status: status, body: { ok: false } }]);
    assert.equal(scenario.record.synced_at, null);
    assert.equal(scenario.state.appState.pendingCount, 1);
  }

  const scenario = await runScenario([
    { status: 401, body: { ok: false } },
    { status: 200, body: { ok: true, id: 'catch-synthetic' } }
  ]);
  assert.equal(scenario.record.synced_at, null);
  assert.equal(scenario.state.Auth.token, null);
  assert.equal(scenario.state.authScreenShown, true);
  assert.match(scenario.state.authError.textContent, /سجّل الدخول مجدداً/);
  assert.equal(scenario.requests.length, 1);

  scenario.state.Auth.token = 'reauthenticated-token';
  scenario.state.Auth.user = { id: 'member-user' };
  await scenario.syncPending();
  assert.equal(scenario.record.synced_at, '2026-10-26T00:01:00.000Z');
  assert.equal(scenario.state.appState.pendingCount, 0);
  assert.equal(scenario.requests.length, 2);
  assert.equal(scenario.requests[1].headers.Authorization, 'Bearer reauthenticated-token');
});

test('field pending sync preserves offline records and isolates records by owner', async function () {
  const source = fs.readFileSync(fieldHtmlPath, 'utf8');
  const saveStart = source.indexOf('async function saveCatch() {');
  const syncStart = source.indexOf('async function syncPending() {');
  const renderStart = source.indexOf('// RENDER HELPERS', syncStart);
  const syncEnd = source.lastIndexOf('\n}', renderStart);
  assert.match(source.slice(saveStart, syncStart), /owner_id:\s*user\.id/);
  assert.match(source.slice(saveStart, syncStart), /await FieldDB\.addPending\(payload\)/);
  const syncSource = source.slice(syncStart, syncEnd + 2);

  const records = [
    { local_id: 'a-pending', owner_id: 'account-a', operator_id: 'account-a', synced_at: null },
    { local_id: 'b-pending', owner_id: 'account-b', operator_id: 'account-b', synced_at: null },
    { local_id: 'legacy-pending', operator_id: 'account-a', synced_at: null }
  ];
  const requests = [];
  const state = {
    _syncInFlight: false,
    appState: { isOnline: false, pendingCount: records.length },
    Auth: {
      token: 'account-a-token',
      user: { id: 'account-a' },
      clear: function () { this.token = null; this.user = null; }
    },
    FieldDB: {
      getPending: async function () { return records.filter(function (record) { return !record.synced_at; }); },
      markSynced: async function (localId, syncedAt) {
        const record = records.find(function (item) { return item.local_id === localId; });
        if (record) record.synced_at = syncedAt;
      }
    },
    fetch: async function (_url, options) {
      requests.push(options);
      return { status: 200, json: async function () { return { ok: true, id: 'catch-id' }; } };
    },
    nowIso: function () { return '2026-10-26T00:01:00.000Z'; },
    showAuthScreen: function () {},
    showToast: function () {},
    renderStatusBar: function () {},
    document: { getElementById: function () { return { textContent: '' }; } }
  };
  const syncPending = vm.runInNewContext(syncSource + '\nsyncPending;', state);

  await syncPending();
  assert.equal(requests.length, 0, 'offline recording does not trigger a network request');

  state.appState.isOnline = true;
  await syncPending();
  assert.deepEqual(requests.map(function (request) {
    return JSON.parse(request.body).operator_id;
  }), ['account-a']);
  assert.equal(records[0].synced_at, '2026-10-26T00:01:00.000Z');
  assert.equal(records[1].synced_at, null);
  assert.equal(records[2].synced_at, null, 'legacy records with unknown owner remain queued');
  assert.equal(Object.hasOwn(JSON.parse(requests[0].body), 'owner_id'), false);

  records.push({ local_id: 'a-pending-after-switch', owner_id: 'account-a', operator_id: 'account-a', synced_at: null });
  state.Auth.user = { id: 'account-b' };
  state.Auth.token = 'account-b-token';
  await syncPending();
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[1].body).operator_id, 'account-b');
  assert.equal(records[1].synced_at, '2026-10-26T00:01:00.000Z');
  assert.equal(records[3].synced_at, null, 'account switching leaves another account’s record queued');
  assert.equal(records[2].synced_at, null);

  state.Auth.clear();
  await syncPending();
  assert.equal(requests.length, 2, 'logout leaves pending records untouched');
  assert.equal(records[3].synced_at, null);
  assert.equal(records[2].synced_at, null);

  state.Auth.token = 'account-a-token';
  state.Auth.user = { id: 'account-a' };
  await syncPending();
  assert.equal(requests.length, 3, 'the original account can sync its retained record');
  assert.equal(JSON.parse(requests[2].body).operator_id, 'account-a');
  assert.equal(records[3].synced_at, '2026-10-26T00:01:00.000Z');
});

test('field sync stops on account changes and retains in-flight records for the original account', async function () {
  const source = fs.readFileSync(fieldHtmlPath, 'utf8');
  const start = source.indexOf('async function syncPending() {');
  const nextSection = source.indexOf('// RENDER HELPERS', start);
  const end = source.lastIndexOf('\n}', nextSection);
  const functionSource = source.slice(start, end + 2);
  const records = [
    { local_id: 'a-first', owner_id: 'account-a', synced_at: null },
    { local_id: 'a-second', owner_id: 'account-a', synced_at: null }
  ];
  const requests = [];
  let resolveFirstResponse;
  let signalFirstRequest;
  const firstRequestStarted = new Promise(function (resolve) {
    signalFirstRequest = resolve;
  });
  const accountAToken = {};
  const accountBToken = {};
  const state = {
    _syncInFlight: false,
    appState: { isOnline: true, pendingCount: records.length },
    Auth: {
      token: accountAToken,
      user: { id: 'account-a' },
      clear: function () { this.token = null; this.user = null; }
    },
    FieldDB: {
      getPending: async function () { return records.filter(function (record) { return !record.synced_at; }); },
      markSynced: async function (localId, syncedAt) {
        const record = records.find(function (item) { return item.local_id === localId; });
        if (record) record.synced_at = syncedAt;
      }
    },
    fetch: function (_url, options) {
      requests.push(options);
      if (requests.length === 1) {
        signalFirstRequest();
        return new Promise(function (resolve) { resolveFirstResponse = resolve; });
      }
      return Promise.resolve({
        status: 200,
        json: async function () { return { ok: true, id: 'catch-id' }; }
      });
    },
    nowIso: function () { return '2026-10-26T00:01:00.000Z'; },
    showAuthScreen: function () {},
    showToast: function () {},
    renderStatusBar: function () {},
    document: { getElementById: function () { return { textContent: '' }; } }
  };
  const syncPending = vm.runInNewContext(functionSource + '\nsyncPending;', state);

  const firstSync = syncPending();
  await firstRequestStarted;
  assert.equal(requests.length, 1, 'account A sends only the first pending catch initially');

  state.Auth.user = { id: 'account-b' };
  state.Auth.token = accountBToken;
  resolveFirstResponse({
    status: 200,
    json: async function () { return { ok: true, id: 'catch-id' }; }
  });
  await firstSync;

  assert.equal(records[0].synced_at, null, 'a response from the previous session does not mark the catch synced');
  assert.equal(records[1].synced_at, null);
  assert.equal(requests.length, 1, 'the old sync stops before sending the next catch');

  await syncPending();
  assert.equal(requests.length, 1, 'account B cannot submit account A pending catches');
  assert.equal(records[0].synced_at, null);
  assert.equal(records[1].synced_at, null);

  state.Auth.user = { id: 'account-a' };
  state.Auth.token = accountAToken;
  await syncPending();
  assert.equal(requests.length, 3, 'the original account can retry both retained catches');
  assert.equal(records[0].synced_at, '2026-10-26T00:01:00.000Z');
  assert.equal(records[1].synced_at, '2026-10-26T00:01:00.000Z');
});

test('field pending records survive network, permission, and server failures', async function () {
  const source = fs.readFileSync(fieldHtmlPath, 'utf8');
  const start = source.indexOf('async function syncPending() {');
  const nextSection = source.indexOf('// RENDER HELPERS', start);
  const end = source.lastIndexOf('\n}', nextSection);
  const functionSource = source.slice(start, end + 2);

  for (const failure of [
    { status: 403 },
    { status: 500 },
    { status: 429 },
    { throws: true }
  ]) {
    const record = { local_id: 'pending', owner_id: 'account-a', synced_at: null };
    const state = {
      _syncInFlight: false,
      appState: { isOnline: true, pendingCount: 1 },
      Auth: { token: 'account-a-token', user: { id: 'account-a' }, clear: function () {} },
      FieldDB: {
        getPending: async function () { return record.synced_at ? [] : [record]; },
        markSynced: async function (_id, timestamp) { record.synced_at = timestamp; }
      },
      fetch: async function () {
        if (failure.throws) throw new TypeError('network unavailable');
        return { status: failure.status, json: async function () { return { ok: false }; } };
      },
      nowIso: function () { return '2026-10-26T00:01:00.000Z'; },
      showAuthScreen: function () {},
      showToast: function () {},
      renderStatusBar: function () {},
      document: { getElementById: function () { return { textContent: '' }; } }
    };
    const syncPending = vm.runInNewContext(functionSource + '\nsyncPending;', state);
    await syncPending();
    assert.equal(record.synced_at, null, 'failed sync retains the queued catch');
  }
});

test('reconnection event automatically retries queued field catches', function () {
  const source = fs.readFileSync(fieldHtmlPath, 'utf8');
  const start = source.indexOf("window.addEventListener('online',");
  const end = source.indexOf("window.addEventListener('offline',", start);
  assert.notEqual(start, -1, 'online event handler exists');
  assert.notEqual(end, -1, 'offline event handler boundary exists');
  let onlineHandler;
  let syncCalls = 0;
  const state = {
    appState: { isOnline: false },
    window: {
      addEventListener: function (name, handler) {
        if (name === 'online') onlineHandler = handler;
      }
    },
    renderStatusBar: function () {},
    renderAddStationPermissionState: function () {},
    renderFishManageControls: function () {},
    showToast: function () {},
    syncPending: function () { syncCalls += 1; }
  };

  vm.runInNewContext(source.slice(start, end), state);
  assert.equal(typeof onlineHandler, 'function');
  onlineHandler();
  assert.equal(state.appState.isOnline, true);
  assert.equal(syncCalls, 1);
});
