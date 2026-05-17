'use strict';

var store = require('./genome-store');
var expected = require('./expected-traits');
var matcher = require('./matcher');
var dto = require('./dto');
var analysisContext = require('./analysis-context');

module.exports = {
  store: store,
  expected: expected,
  matcher: matcher,
  dto: dto,
  analysisContext: analysisContext,
  getGenome: store.getGenome,
  getExpectedTraitsForStation: expected.getExpectedTraitsForStation,
  buildMatchMatrix: matcher.buildMatchMatrix
};
