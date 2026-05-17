'use strict';

var store = require('./genome-store');
var { cleanString } = require('../security');

function normalizeDurName(name) {
  return cleanString(name, 120);
}

function traitAppliesToDur(trait, durName) {
  if (trait.dur_applicability !== 'specific') return true;
  var names = Array.isArray(trait.dur_names) ? trait.dur_names : [];
  if (!names.length) return true;
  if (!durName) return false;
  return names.some(function (n) {
    return String(n).trim() === durName;
  });
}

function resolveExpectedStatus(trait, ctx) {
  if (!trait || trait.status !== 'active') return 'not_expected';
  var durName = normalizeDurName(ctx && ctx.dur_name);
  if (!traitAppliesToDur(trait, durName)) {
    return durName ? 'conditional' : 'unknown';
  }
  if (trait.category === 'field_observation' && trait.trait_key === 'field_station_required') {
    return 'conditional';
  }
  return 'expected';
}

function buildExpectedTraitRow(trait, ctx) {
  var expectedStatus = resolveExpectedStatus(trait, ctx);
  return {
    trait_key: trait.trait_key,
    label_ar: trait.label_ar,
    category: trait.category,
    subcategory: trait.subcategory,
    description_ar: trait.description_ar,
    expected_status: expectedStatus,
    expected_value_type: trait.expected_value_type,
    observable_now: trait.observable_now,
    observable_sources: trait.observable_sources || [],
    primary_source: trait.primary_source,
    validation_rule: trait.validation_rule,
    match_logic: trait.match_logic,
    confidence_weight: trait.confidence_weight,
    importance: trait.importance,
    requires_human_review: trait.requires_human_review,
    requires_field_station: trait.requires_field_station,
    fish_group_relations: trait.fish_group_relations || [],
    risk_relations: trait.risk_relations || [],
    future_use: trait.future_use
  };
}

function getExpectedTraitsForStation(ctx) {
  var genome = store.getGenome();
  var traits = store.listTraits();
  var rows = traits.map(function (trait) {
    return buildExpectedTraitRow(trait, ctx);
  });
  return {
    ok: true,
    version: genome.version,
    scope: genome.scope,
    station_id: cleanString(ctx && ctx.station_id, 80) || null,
    reference_station_id: cleanString(ctx && ctx.reference_station_id, 80) || null,
    dur_name: normalizeDurName(ctx && ctx.dur_name) || null,
    dur_day: ctx && ctx.dur_day != null ? Number(ctx.dur_day) : null,
    total_traits: rows.length,
    traits: rows
  };
}

module.exports = {
  resolveExpectedStatus: resolveExpectedStatus,
  getExpectedTraitsForStation: getExpectedTraitsForStation,
  buildExpectedTraitRow: buildExpectedTraitRow
};
