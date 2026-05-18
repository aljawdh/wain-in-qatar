'use strict';

var store = require('./genome-store');

var PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
var HUMAN_SOURCES = { human_review: true, field_station: true };

function isImportanceHigh(importance) {
  return String(importance || '').toLowerCase() === 'high';
}

function confidenceOf(row) {
  var c = Number(row && row.confidence);
  return Number.isFinite(c) ? c : 0;
}

function isAutomaticSource(row) {
  var ms = String(row.match_status || '');
  if (ms === 'needs_human_review' || ms === 'needs_field_station') return false;
  var sources = Array.isArray(row.source_used) ? row.source_used : [];
  for (var i = 0; i < sources.length; i++) {
    if (HUMAN_SOURCES[sources[i]]) return false;
  }
  return true;
}

function isAutoApprovable(row) {
  return (
    row.match_status === 'matched' &&
    confidenceOf(row) >= 80 &&
    isAutomaticSource(row) &&
    !row.deferred_review
  );
}

function isSafetyRiskMismatch(row) {
  return String(row.category || '') === 'safety_risk' && String(row.match_status || '') === 'mismatch';
}

function isDataQualityCritical(row) {
  if (String(row.category || '') !== 'data_quality') return false;
  return String(row.trait_key || '').indexOf('critical') >= 0;
}

function computeDeferredReview(row) {
  var ms = String(row.match_status || '');
  if (ms === 'needs_human_review' || ms === 'needs_field_station') return true;
  if (ms === 'unavailable') return true;
  return false;
}

function computeUrgentNeedsReview(row) {
  if (computeDeferredReview(row)) return false;
  if (isAutoApprovable(row)) return false;

  var ms = String(row.match_status || '');
  var conf = confidenceOf(row);

  if (isSafetyRiskMismatch(row)) return true;
  if (isDataQualityCritical(row)) return true;

  if (ms === 'mismatch' && conf >= 50) return true;
  if (ms === 'partial') return true;
  if (ms === 'matched' && conf < 60) return true;

  return false;
}

function computeReviewPriority(row) {
  if (row.deferred_review) return 'medium';

  var ms = String(row.match_status || '');
  var conf = confidenceOf(row);
  var impHigh = isImportanceHigh(row.importance);

  if (isSafetyRiskMismatch(row) || isDataQualityCritical(row)) return 'critical';
  if (ms === 'mismatch' && impHigh) return 'critical';
  if (ms === 'mismatch' && conf < 60) return 'critical';
  if (ms === 'partial' && impHigh) return 'high';
  if (ms === 'matched' && conf >= 80) return 'low';
  if (ms === 'matched' && conf < 80) return 'medium';
  if (ms === 'partial') return 'medium';
  if (ms === 'mismatch') return 'high';
  return 'medium';
}

function computeSuggestedDecision(row) {
  var ms = String(row.match_status || '');
  var conf = confidenceOf(row);
  if (ms === 'matched' && conf >= 80) return 'correct';
  if (ms === 'matched' && conf < 80) return 'watch';
  if (ms === 'partial') return 'watch';
  if (ms === 'mismatch') return 'incorrect';
  if (ms === 'unavailable') return 'insufficient';
  if (ms === 'needs_human_review') return 'insufficient';
  if (ms === 'needs_field_station') return 'insufficient';
  return 'watch';
}

function buildReviewReasonAr(row) {
  var ms = String(row.match_status || '');
  var conf = confidenceOf(row);

  if (row.deferred_review) {
    if (ms === 'needs_human_review') {
      return 'مؤجلة: تحتاج رصدًا بشريًا أو تقريرًا ميدانيًا قبل الحكم.';
    }
    if (ms === 'needs_field_station') {
      return 'مؤجلة: تحتاج محطة ميدانية — لا يُستنتج من البيانات الآلية.';
    }
    if (ms === 'unavailable') {
      return 'مؤجلة: غير متوفرة من مصدر القياس الحالي — انتظر الرصد أو المحطة.';
    }
  }

  if (isSafetyRiskMismatch(row)) {
    return 'عدم مطابقة في سمة مخاطر — مراجعة عاجلة.';
  }
  if (isDataQualityCritical(row)) {
    return 'بيانات ناقصة حرجة — مراجعة عاجلة.';
  }
  if (ms === 'mismatch' && isImportanceHigh(row.importance)) {
    return 'عدم مطابقة في سمة عالية الأهمية — مراجعة عاجلة.';
  }
  if (ms === 'mismatch' && conf >= 50) {
    return 'عدم مطابقة بثقة كافية — تحقق من المصدر.';
  }
  if (ms === 'partial') {
    return 'مطابقة جزئية — يُفضّل التأكيد اليدوي.';
  }
  if (ms === 'matched' && conf < 60) {
    return 'مطابقة لكن الثقة أقل من 60% — مراجعة عاجلة موصى بها.';
  }
  if (ms === 'matched' && conf >= 80) {
    return 'مطابقة مستقرة بثقة عالية — يمكن الاعتماد السريع.';
  }
  if (ms === 'matched' && conf < 80) {
    return 'مطابقة بثقة متوسطة — مراقبة موصى بها.';
  }
  return 'لا تحتاج مراجعة عاجلة حالياً.';
}

function buildSuggestedNoteAr(row, suggestedDecision) {
  var label = row.label_ar || row.trait_key || 'السمة';
  var obs = row.observed_value != null && row.observed_value !== '' ? String(row.observed_value) : 'غير متوفر';
  var map = {
    correct: 'اعتماد سريع: ' + label + ' مطابقة بثقة ' + confidenceOf(row) + '% (مرصود: ' + obs + ').',
    incorrect: 'تصحيح: ' + label + ' غير مطابقة للمتوقع (مرصود: ' + obs + ').',
    watch: 'مراقبة: ' + label + ' — ' + (row.reason_ar || 'يحتاج متابعة.'),
    insufficient: 'غير كافٍ: ' + label + ' — ' + (row.reason_ar || 'بيانات غير كافية للحكم.')
  };
  return map[suggestedDecision] || map.watch;
}

function enrichMatrixRow(matchRow, traitMeta) {
  traitMeta = traitMeta || {};
  var row = Object.assign({}, matchRow, {
    importance: traitMeta.importance || 'medium',
    observable_now: traitMeta.observable_now !== false,
    category: matchRow.category || traitMeta.category || ''
  });
  var deferred = computeDeferredReview(row);
  row.deferred_review = deferred;
  var priority = computeReviewPriority(row);
  var suggested = computeSuggestedDecision(row);
  var urgent = computeUrgentNeedsReview(row);
  return Object.assign(row, {
    review_priority: priority,
    suggested_decision: suggested,
    suggested_note_ar: buildSuggestedNoteAr(row, suggested),
    needs_review: urgent,
    urgent_review: urgent,
    review_reason_ar: buildReviewReasonAr(row),
    auto_approvable: isAutoApprovable(row)
  });
}

function buildReviewSummary(matrix) {
  var rows = matrix || [];
  var total = rows.length;
  var matched = 0;
  var partial = 0;
  var mismatch = 0;
  var unavailable = 0;
  var human = 0;
  var field = 0;
  var critical = 0;
  var high = 0;
  var medium = 0;
  var low = 0;
  var urgentReview = 0;
  var deferredReview = 0;
  var autoApprovable = 0;

  rows.forEach(function (r) {
    var ms = String(r.match_status || '');
    if (ms === 'matched') matched += 1;
    else if (ms === 'partial') partial += 1;
    else if (ms === 'mismatch') mismatch += 1;
    else if (ms === 'unavailable') unavailable += 1;
    else if (ms === 'needs_human_review') human += 1;
    else if (ms === 'needs_field_station') field += 1;

    var p = String(r.review_priority || 'medium');
    if (p === 'critical') critical += 1;
    else if (p === 'high') high += 1;
    else if (p === 'low') low += 1;
    else medium += 1;

    if (r.urgent_review || r.needs_review) urgentReview += 1;
    if (r.deferred_review) deferredReview += 1;
    if (r.auto_approvable) autoApprovable += 1;
  });

  var genomeMatchPercent = total ? Math.round((matched / total) * 1000) / 10 : 0;
  var summaryAr =
    'إجمالي ' + total + ' سمة — مطابقة ' + matched +
    ' (' + genomeMatchPercent + '%) — مراجعة عاجلة ' + urgentReview +
    ' — مؤجلة ' + deferredReview +
    ' — اعتماد سريع ' + autoApprovable + '.';

  return {
    total_traits: total,
    matched_count: matched,
    partial_count: partial,
    mismatch_count: mismatch,
    unavailable_count: unavailable,
    human_review_count: human,
    field_station_count: field,
    critical_count: critical,
    high_count: high,
    medium_count: medium,
    low_count: low,
    needs_review_count: urgentReview,
    urgent_review_count: urgentReview,
    deferred_review_count: deferredReview,
    auto_approvable_count: autoApprovable,
    genome_match_percent: genomeMatchPercent,
    summary_ar: summaryAr,
    total: total,
    matched: matched,
    partial: partial,
    mismatch: mismatch,
    unavailable: unavailable,
    needs_human_review: human,
    needs_field_station: field
  };
}

function enrichMatchResult(result) {
  var traits = store.listTraits();
  var byKey = {};
  traits.forEach(function (t) {
    byKey[t.trait_key] = t;
  });
  var matrix = (result.matrix || []).map(function (row) {
    return enrichMatrixRow(row, byKey[row.trait_key]);
  });
  matrix.sort(function (a, b) {
    if (a.deferred_review !== b.deferred_review) {
      return a.deferred_review ? 1 : -1;
    }
    var pa = PRIORITY_ORDER[a.review_priority] != null ? PRIORITY_ORDER[a.review_priority] : 9;
    var pb = PRIORITY_ORDER[b.review_priority] != null ? PRIORITY_ORDER[b.review_priority] : 9;
    if (pa !== pb) return pa - pb;
    return String(a.label_ar || a.trait_key).localeCompare(String(b.label_ar || b.trait_key), 'ar');
  });
  var summary = buildReviewSummary(matrix);
  return Object.assign({}, result, { matrix: matrix, summary: summary });
}

module.exports = {
  enrichMatrixRow: enrichMatrixRow,
  enrichMatchResult: enrichMatchResult,
  buildReviewSummary: buildReviewSummary,
  computeReviewPriority: computeReviewPriority,
  computeSuggestedDecision: computeSuggestedDecision,
  computeDeferredReview: computeDeferredReview,
  computeUrgentNeedsReview: computeUrgentNeedsReview,
  isAutoApprovable: isAutoApprovable
};
