'use strict';

var fs = require('fs');
var path = require('path');
var catalog = require('./trait-catalog');

var GENOME_PATH = path.join(__dirname, '..', '..', '..', 'data', 'marine_knowledge_genome.json');
var _cached = null;

function loadFromDisk() {
  try {
    var raw = fs.readFileSync(GENOME_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return catalog.buildGenomeDocument();
  }
}

function getGenome() {
  if (!_cached) {
    _cached = loadFromDisk();
  }
  return _cached;
}

function getTraitByKey(traitKey) {
  var doc = getGenome();
  var key = String(traitKey || '').trim();
  return (doc.traits || []).find(function (t) { return t.trait_key === key; }) || null;
}

function listTraits() {
  return (getGenome().traits || []).slice();
}

function listCategories() {
  return (getGenome().trait_categories || []).slice();
}

function reloadGenome() {
  _cached = null;
  return getGenome();
}

module.exports = {
  GENOME_PATH: GENOME_PATH,
  getGenome: getGenome,
  getTraitByKey: getTraitByKey,
  listTraits: listTraits,
  listCategories: listCategories,
  reloadGenome: reloadGenome
};
