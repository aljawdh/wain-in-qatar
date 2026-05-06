'use strict';

const handler = require('../../serverless_api/admin-system-integrity');

module.exports = async function systemIntegrityEndpoint(req, res) {
  return handler(req, res);
};
