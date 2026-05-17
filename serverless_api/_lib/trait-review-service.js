'use strict';

var { cleanString } = require('./security');
var store = require('./trait-review-store');

var DECISIONS = ['correct', 'incorrect', 'watch', 'insufficient'];
var MATCH_STATUSES = [
  'matched', 'partial', 'mismatch', 'unknown',
  'unavailable', 'needs_human_review', 'needs_field_station'
];
var MINIMUM_REVIEWS_FOR_ADOPTION = 10;

function slugTraitKey(label) {
  return String(label || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u0600-\u06FF-]+/g, '')
    .slice(0, 120) || 'trait_unknown';
}

function newReviewId() {
  return 'tr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function normalizeDecision(v) {
  var d = cleanString(v, 40).toLowerCase();
  return DECISIONS.indexOf(d) >= 0 ? d : 'insufficient';
}

function normalizeMatchStatus(v) {
  var m = cleanString(v, 40).toLowerCase();
  return MATCH_STATUSES.indexOf(m) >= 0 ? m : 'unknown';
}

function clampConfidence(n) {
  var x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function reliabilityLabel(percent, totalReviews) {
  var total = Number(totalReviews) || 0;
  var pct = Number(percent) || 0;
  if (total >= MINIMUM_REVIEWS_FOR_ADOPTION && pct >= 90) {
    return 'السمة مستقرة ومعتمدة';
  }
  if (pct >= 90 && total < MINIMUM_REVIEWS_FOR_ADOPTION) {
    return 'نتيجة أولية — تحتاج مراجعات إضافية';
  }
  if (pct >= 70) return 'السمة جيدة وتحتاج مراقبة';
  return 'السمة تحتاج إعادة ضبط';
}

function resolveDurAdoption(overallRel, totalReviews) {
  var total = Number(totalReviews) || 0;
  var pct = Number(overallRel) || 0;
  var reviewsNeeded = Math.max(0, MINIMUM_REVIEWS_FOR_ADOPTION - total);
  var out = {
    minimum_reviews_for_adoption: MINIMUM_REVIEWS_FOR_ADOPTION,
    reviews_needed_for_adoption: reviewsNeeded,
    dur_adoption_90_reached: false,
    adoption_status: 'pending',
    adoption_message_ar: null
  };
  if (pct >= 90 && total >= MINIMUM_REVIEWS_FOR_ADOPTION) {
    out.dur_adoption_90_reached = true;
    out.adoption_status = 'adopted';
  } else if (pct >= 90 && total > 0 && total < MINIMUM_REVIEWS_FOR_ADOPTION) {
    out.adoption_status = 'insufficient_reviews';
    out.adoption_message_ar = 'النسبة عالية لكنها غير كافية للاعتماد بسبب قلة المراجعات.';
  }
  return out;
}

function buildTraitStats(reviews) {
  var byTrait = {};
  (reviews || []).forEach(function (r) {
    var key = String(r.trait_key || slugTraitKey(r.trait_label_ar));
    if (!byTrait[key]) {
      byTrait[key] = {
        trait_key: key,
        trait_label_ar: r.trait_label_ar || key,
        total_reviews: 0,
        correct_count: 0,
        incorrect_count: 0,
        watch_count: 0,
        insufficient_count: 0,
        confidence_sum: 0,
        confidence_average: 0,
        reliability_percent: 0,
        reliability_label: 'السمة تحتاج إعادة ضبط',
        last_reviewed_at: null
      };
    }
    var row = byTrait[key];
    row.total_reviews += 1;
    var dec = String(r.reviewer_decision || '');
    if (dec === 'correct') row.correct_count += 1;
    else if (dec === 'incorrect') row.incorrect_count += 1;
    else if (dec === 'watch') row.watch_count += 1;
    else row.insufficient_count += 1;
    var conf = r.manual_confidence != null ? Number(r.manual_confidence) : Number(r.auto_confidence);
    if (Number.isFinite(conf)) row.confidence_sum += conf;
    var at = r.reviewed_at ? String(r.reviewed_at) : '';
    if (at && (!row.last_reviewed_at || at > row.last_reviewed_at)) {
      row.last_reviewed_at = at;
      row.trait_label_ar = r.trait_label_ar || row.trait_label_ar;
    }
  });
  return Object.keys(byTrait).map(function (key) {
    var row = byTrait[key];
    var total = row.total_reviews || 0;
    row.confidence_average = total ? Math.round((row.confidence_sum / total) * 10) / 10 : 0;
    row.reliability_percent = total ? Math.round((row.correct_count / total) * 1000) / 10 : 0;
    row.reliability_label = reliabilityLabel(row.reliability_percent, total);
    delete row.confidence_sum;
    delete row.insufficient_count;
    return row;
  });
}

function latestReviewsByTrait(reviews) {
  var map = {};
  (reviews || []).forEach(function (r) {
    var key = String(r.trait_key || slugTraitKey(r.trait_label_ar));
    var prev = map[key];
    if (!prev || String(r.reviewed_at || '') > String(prev.reviewed_at || '')) {
      map[key] = r;
    }
  });
  return map;
}

async function saveReview(body, actor) {
  var stationId = cleanString(body.station_id, 80);
  var durName = cleanString(body.dur_name, 120);
  if (!stationId || !durName) {
    throw Object.assign(new Error('station_id_and_dur_name_required'), { code: 400 });
  }
  var traitLabel = cleanString(body.trait_label_ar, 200) || cleanString(body.expected_value, 200) || cleanString(body.trait_key, 120);
  var traitKey = cleanString(body.trait_key, 120) || slugTraitKey(traitLabel);
  var now = new Date().toISOString();
  var record = {
    id: newReviewId(),
    station_id: stationId,
    reference_station_id: cleanString(body.reference_station_id, 80) || stationId,
    station_name: cleanString(body.station_name, 200),
    dur_name: durName,
    dur_day: body.dur_day != null && body.dur_day !== '' ? Number(body.dur_day) : null,
    trait_key: traitKey,
    trait_label_ar: traitLabel,
    expected_value: cleanString(body.expected_value, 300),
    observed_value: cleanString(body.observed_value, 300),
    match_status: normalizeMatchStatus(body.match_status),
    reviewer_decision: normalizeDecision(body.reviewer_decision),
    manual_confidence: clampConfidence(body.manual_confidence),
    auto_confidence: clampConfidence(body.auto_confidence),
    review_note: cleanString(body.review_note, 2000),
    approved_as_evidence: body.approved_as_evidence !== false && body.approved_as_evidence !== 0 && String(body.approved_as_evidence).toLowerCase() !== 'false',
    reviewed_by: cleanString(actor, 80) || 'admin',
    reviewed_at: now,
    source: cleanString(body.source, 80) || 'station_verification_panel',
    genome_version: cleanString(body.genome_version, 20) || null,
    category: cleanString(body.category, 80) || null,
    expected_status: cleanString(body.expected_status, 40) || null
  };
  await store.appendReview(record);
  return record;
}

async function listForScope(query) {
  var reviews = await store.listReviews({
    station_id: cleanString(query.station_id, 80),
    reference_station_id: cleanString(query.reference_station_id, 80),
    dur_name: cleanString(query.dur_name, 120),
    limit: typeof query.limit === 'number' ? query.limit : 2000
  });
  var latestMap = latestReviewsByTrait(reviews);
  var latestObj = {};
  Object.keys(latestMap).forEach(function (k) {
    latestObj[k] = latestMap[k];
  });
  var traitStats = buildTraitStats(reviews);
  return {
    ok: true,
    total: reviews.length,
    reviews: reviews,
    latest_by_trait: latestObj,
    trait_stats: traitStats
  };
}

async function buildSummary(query) {
  var durName = cleanString(query.dur_name, 120);
  if (!durName) {
    throw Object.assign(new Error('dur_name_required'), { code: 400 });
  }
  var reviews = await store.listReviews({
    station_id: cleanString(query.station_id, 80),
    reference_station_id: cleanString(query.reference_station_id, 80),
    dur_name: durName,
    limit: 10000
  });
  var total = reviews.length;
  var correct = 0;
  var incorrect = 0;
  var watch = 0;
  var confSum = 0;
  var lastAt = null;
  reviews.forEach(function (r) {
    var dec = String(r.reviewer_decision || '');
    if (dec === 'correct') correct += 1;
    else if (dec === 'incorrect') incorrect += 1;
    else if (dec === 'watch') watch += 1;
    var c = r.manual_confidence != null ? Number(r.manual_confidence) : Number(r.auto_confidence);
    if (Number.isFinite(c)) confSum += c;
    var at = r.reviewed_at ? String(r.reviewed_at) : '';
    if (at && (!lastAt || at > lastAt)) lastAt = at;
  });
  var traitStats = buildTraitStats(reviews);
  var stable = traitStats.filter(function (t) {
    return t.reliability_percent >= 90 && t.total_reviews >= MINIMUM_REVIEWS_FOR_ADOPTION;
  });
  var needsTune = traitStats.filter(function (t) { return t.reliability_percent < 70 && t.total_reviews > 0; });
  var overallRel = total ? Math.round((correct / total) * 1000) / 10 : 0;
  var avgConf = total ? Math.round((confSum / total) * 10) / 10 : 0;
  var adoption = resolveDurAdoption(overallRel, total);
  return {
    ok: true,
    dur_name: durName,
    station_id: cleanString(query.station_id, 80) || null,
    reference_station_id: cleanString(query.reference_station_id, 80) || null,
    total_reviews: total,
    correct_count: correct,
    incorrect_count: incorrect,
    watch_count: watch,
    correct_percent: total ? Math.round((correct / total) * 1000) / 10 : 0,
    incorrect_percent: total ? Math.round((incorrect / total) * 1000) / 10 : 0,
    watch_percent: total ? Math.round((watch / total) * 1000) / 10 : 0,
    confidence_average: avgConf,
    overall_reliability_percent: overallRel,
    dur_adoption_90_reached: adoption.dur_adoption_90_reached,
    adoption_status: adoption.adoption_status,
    adoption_message_ar: adoption.adoption_message_ar,
    minimum_reviews_for_adoption: adoption.minimum_reviews_for_adoption,
    reviews_needed_for_adoption: adoption.reviews_needed_for_adoption,
    traits_reviewed_count: traitStats.length,
    stable_traits: stable,
    traits_needing_tune: needsTune,
    trait_stats: traitStats,
    last_reviewed_at: lastAt
  };
}

module.exports = {
  MINIMUM_REVIEWS_FOR_ADOPTION: MINIMUM_REVIEWS_FOR_ADOPTION,
  slugTraitKey: slugTraitKey,
  saveReview: saveReview,
  listForScope: listForScope,
  buildSummary: buildSummary,
  reliabilityLabel: reliabilityLabel,
  resolveDurAdoption: resolveDurAdoption,
  latestReviewsByTrait: latestReviewsByTrait
};
