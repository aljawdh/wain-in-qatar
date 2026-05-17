'use strict';

function genomeDictionaryResponse(doc) {
  return {
    ok: true,
    version: doc.version,
    created_at: doc.created_at,
    scope: doc.scope,
    description_ar: doc.description_ar,
    trait_categories: doc.trait_categories || [],
    traits: doc.traits || [],
    trait_count: (doc.traits || []).length
  };
}

function reviewPayloadFromGenome(body, actor) {
  return {
    station_id: body.station_id,
    reference_station_id: body.reference_station_id,
    station_name: body.station_name,
    dur_name: body.dur_name,
    dur_day: body.dur_day,
    trait_key: body.trait_key,
    trait_label_ar: body.trait_label_ar || body.label_ar,
    expected_value: body.expected_value || body.expected_status,
    observed_value: body.observed_value,
    match_status: body.match_status,
    reviewer_decision: body.reviewer_decision,
    manual_confidence: body.manual_confidence,
    auto_confidence: body.auto_confidence,
    review_note: body.review_note,
    approved_as_evidence: body.approved_as_evidence,
    source: 'marine_knowledge_genome',
    genome_version: body.genome_version || 'v1',
    category: body.category,
    expected_status: body.expected_status
  };
}

module.exports = {
  genomeDictionaryResponse: genomeDictionaryResponse,
  reviewPayloadFromGenome: reviewPayloadFromGenome
};
