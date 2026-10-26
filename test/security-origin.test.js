'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedOrigin } = require('../serverless_api/_lib/security');

test('origin checks accept production NAVIDUR and reject untrusted Vercel origins', function () {
  function request(origin, host) {
    return { headers: { origin: origin, host: host || 'navidur.app' } };
  }

  assert.equal(isAllowedOrigin(request('https://navidur.app')), true);
  assert.equal(isAllowedOrigin(request('https://www.navidur.app')), true);
  assert.equal(isAllowedOrigin(request('null')), false);
  assert.equal(isAllowedOrigin(request('   ')), false);
  assert.equal(isAllowedOrigin(request('https://attacker.vercel.app')), false);
  assert.equal(isAllowedOrigin(request('https://navidur.app.attacker.test')), false);
  assert.equal(isAllowedOrigin(request('http://localhost:3000', 'localhost:3000')), true);
});
