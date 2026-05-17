'use strict';

var C = require('./constants');

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function scoreToLabel(score, reasons, prefix) {
  if (score == null || !Number.isFinite(score)) {
    reasons.push(prefix + '_score_missing');
    return 'unknown';
  }
  if (score >= 78) {
    reasons.push(prefix + '_excellent');
    return 'excellent';
  }
  if (score >= 62) {
    reasons.push(prefix + '_good');
    return 'good';
  }
  if (score >= 45) {
    reasons.push(prefix + '_medium');
    return 'medium';
  }
  if (score >= 28) {
    reasons.push(prefix + '_poor');
    return 'poor';
  }
  reasons.push(prefix + '_dangerous');
  return 'dangerous';
}

function activityFromScore(score, reasons, key) {
  if (score == null || !Number.isFinite(score)) {
    reasons.push(key + '_no_score');
    return { score: 0, label: 'unknown', reasons: reasons.slice() };
  }
  var label = 'low';
  if (score >= 70) {
    label = 'high';
    reasons.push(key + '_high');
  } else if (score >= 45) {
    label = 'medium';
    reasons.push(key + '_medium');
  } else {
    reasons.push(key + '_low');
  }
  return { score: Math.round(score), label: label, reasons: reasons.slice() };
}

function mapTideHamalFasad(tideState, reasons) {
  var s = String(tideState || '').toUpperCase();
  if (s === 'LOAD') {
    reasons.push('tide_load_hamal');
    return 'hamal';
  }
  if (s === 'FASAD') {
    reasons.push('tide_fasad');
    return 'fasad';
  }
  if (String(tideState || '').indexOf('حمل') >= 0) {
    reasons.push('tide_ar_hamal');
    return 'hamal';
  }
  if (String(tideState || '').indexOf('فساد') >= 0) {
    reasons.push('tide_ar_fasad');
    return 'fasad';
  }
  reasons.push('tide_state_unknown');
  return 'unknown';
}

function scoreMarineCondition(env, tide, reasons) {
  var wave = env && env.wave_height_m != null ? Number(env.wave_height_m) : null;
  var wind = env && env.wind_speed_kmh != null ? Number(env.wind_speed_kmh) : null;
  var current = tide && tide.current_speed_ms != null ? Number(tide.current_speed_ms) : null;

  if (wave == null && wind == null && current == null) {
    reasons.push('marine_metrics_all_missing');
    return { score: 0, label: 'unknown', reasons: reasons.slice() };
  }

  var score = 72;
  if (wave != null) {
    if (wave <= 0.4) {
      score += 12;
      reasons.push('wave_calm');
    } else if (wave <= 0.9) {
      score += 4;
      reasons.push('wave_moderate');
    } else if (wave <= 1.4) {
      score -= 10;
      reasons.push('wave_elevated');
    } else {
      score -= 22;
      reasons.push('wave_high');
    }
  } else {
    reasons.push('wave_missing');
    score -= 8;
  }

  if (wind != null) {
    if (wind <= 18) {
      score += 6;
      reasons.push('wind_light');
    } else if (wind <= 28) {
      reasons.push('wind_moderate');
    } else if (wind <= 38) {
      score -= 12;
      reasons.push('wind_strong');
    } else {
      score -= 22;
      reasons.push('wind_severe');
    }
  } else {
    reasons.push('wind_missing');
    score -= 6;
  }

  if (current != null) {
    if (current <= 0.35) {
      score += 4;
      reasons.push('current_light');
    } else if (current <= 0.75) {
      reasons.push('current_moderate');
    } else {
      score -= 14;
      reasons.push('current_strong');
    }
  } else {
    reasons.push('current_missing');
    score -= 4;
  }

  score = clamp(Math.round(score), 0, 100);
  return {
    score: score,
    label: scoreToLabel(score, reasons, 'marine'),
    reasons: reasons.slice()
  };
}

function scoreTraditionalLayer(dur, tide, reasons) {
  var durName = dur && (dur.period_name || dur.current_dur_name_ar) ? String(dur.period_name || dur.current_dur_name_ar) : '';
  var durDay = dur && dur.day_in_period != null ? Number(dur.day_in_period) : null;
  var hamalFasad = mapTideHamalFasad(tide && tide.state, reasons);

  var conf = 0;
  if (durName) {
    conf += 35;
    reasons.push('dur_name_present');
  } else {
    reasons.push('dur_name_missing');
  }
  if (Number.isFinite(durDay)) {
    conf += 15;
    reasons.push('dur_day_present');
  }
  if (hamalFasad !== 'unknown') {
    conf += 30;
  }
  if (dur && dur.timing_source) {
    conf += 10;
    reasons.push('dur_timing_source_' + String(dur.timing_source));
  }
  if (dur && dur.true_final_lookup_failed) {
    conf = Math.max(0, conf - 25);
    reasons.push('true_final_lookup_failed');
  }

  return {
    dur: durName,
    dur_day: Number.isFinite(durDay) ? durDay : null,
    hamal_fasad: hamalFasad,
    confidence: clamp(conf, 0, 100),
    reasons: reasons.slice()
  };
}

var GROUP_DEPTH_HINTS = {
  coastal_fish: ['shallow', 'coastal'],
  bottom_fish: ['deep', 'bottom'],
  pelagic_fish: ['offshore', 'pelagic', 'open'],
  reef_fish: ['reef', 'rock']
};

function fishMatchesGroup(rec, groupKey) {
  var hints = GROUP_DEPTH_HINTS[groupKey] || [];
  var zone = String(rec.depth_zone || rec.zone || '').toLowerCase();
  var name = String(rec.name_ar || rec.name || '').toLowerCase();
  for (var i = 0; i < hints.length; i += 1) {
    if (zone.indexOf(hints[i]) >= 0) return true;
  }
  if (groupKey === 'reef_fish' && (name.indexOf('صقر') >= 0 || name.indexOf('نيزك') >= 0)) return true;
  return false;
}

function scoreFishActivityGroups(dto, zone, reasons) {
  var fish = dto && dto.fishing ? dto.fishing : {};
  var recs = Array.isArray(fish.fish_recommendations) ? fish.fish_recommendations : [];
  var baseConf = fish.confidence_score != null ? Number(fish.confidence_score) : null;
  var env = dto && dto.environment ? dto.environment : {};
  var tide = dto && dto.tide ? dto.tide : {};

  var out = {};
  C.FISH_GROUPS.forEach(function (groupKey) {
    var gr = [];
    var matched = recs.filter(function (r) {
      return fishMatchesGroup(r || {}, groupKey);
    });
    if (matched.length) {
      var avg =
        matched.reduce(function (sum, r) {
          return sum + (Number(r.score) || Number(r.confidence) || 0);
        }, 0) / matched.length;
      gr.push(groupKey + '_from_recommendations_n' + matched.length);
      out[groupKey] = activityFromScore(avg, gr, groupKey);
      return;
    }
    if (baseConf == null) {
      gr.push(groupKey + '_no_fish_data');
      out[groupKey] = { score: 0, label: 'unknown', reasons: gr };
      return;
    }
    var derived = baseConf;
    if (groupKey === 'pelagic_fish' && zone === 'open_water') derived += 8;
    if (groupKey === 'coastal_fish' && (zone === 'coast' || zone === 'shallow')) derived += 6;
    if (groupKey === 'reef_fish' && zone === 'reef_or_rock') derived += 10;
    if (groupKey === 'bottom_fish' && mapTideHamalFasad(tide.state, []) === 'fasad') derived += 5;
    var wave = env.wave_height_m != null ? Number(env.wave_height_m) : null;
    if (wave != null && wave > 1.5) derived -= 12;
    gr.push(groupKey + '_derived_from_marine_context');
    out[groupKey] = activityFromScore(derived, gr, groupKey);
  });
  return out;
}

function scoreRisk(env, tide, reasons) {
  var wave = env && env.wave_height_m != null ? Number(env.wave_height_m) : null;
  var wind = env && env.wind_speed_kmh != null ? Number(env.wind_speed_kmh) : null;
  var current = tide && tide.current_speed_ms != null ? Number(tide.current_speed_ms) : null;

  function riskLevel(metric, low, high, key, bucket) {
    if (metric == null) {
      bucket.push(key + '_metric_missing');
      return 'unknown';
    }
    if (metric >= high) {
      bucket.push(key + '_high');
      return 'high';
    }
    if (metric >= low) {
      bucket.push(key + '_medium');
      return 'medium';
    }
    bucket.push(key + '_low');
    return 'low';
  }

  var boatingR = [];
  var shoreR = [];
  var divingR = [];
  var boatingMetric = wave != null && wind != null ? Math.max(wave * 8, wind / 5) : (wave != null ? wave * 8 : wind != null ? wind / 5 : null);
  var divingMetric = current != null && wave != null ? current + wave * 0.5 : (current != null ? current : null);

  return {
    boating: riskLevel(boatingMetric, 3.5, 7, 'boating', boatingR),
    shore_activity: riskLevel(wind, 22, 35, 'shore', shoreR),
    diving: riskLevel(divingMetric, 0.85, 1.4, 'motion', divingR),
    reasons: reasons.concat(boatingR, shoreR, divingR)
  };
}

function buildAnomalies(dto, marine, traditional, dataQuality) {
  var list = [];
  if (dataQuality.score < 50) {
    list.push({ type: 'data_quality_low', message_ar: 'جودة البيانات منخفضة للمعاينة.' });
  }
  if (marine.label === 'dangerous') {
    list.push({ type: 'marine_dangerous', message_ar: 'ظروف بحرية قاسية وفق المؤشرات الحية.' });
  }
  if (traditional.hamal_fasad === 'fasad' && marine.score >= 60) {
    list.push({ type: 'fasad_favorable_marine', message_ar: 'فساد مد مع ظروف بحرية نسبيًا ملائمة — سياق تقليدي مهم.' });
  }
  var env = dto && dto.environment ? dto.environment : {};
  if (env.no_marine_data_for_date) {
    list.push({ type: 'no_marine_data_for_date', message_ar: 'لا توجد بيانات بحرية كاملة لهذا التاريخ.' });
  }
  return list;
}

function buildSummaryAr(station, marine, traditional, fishGroups, risk, comparison, confidence) {
  var parts = [];
  var name = station.name_ar || station.name || station.id || 'المحطة';
  parts.push('معاينة ذكاء بحرية لـ «' + name + '» (قراءة فقط).');
  if (marine.label !== 'unknown') {
    parts.push('الحالة البحرية: ' + marine.label + ' (' + marine.score + '/100).');
  }
  if (traditional.dur) {
    parts.push('الدر: ' + traditional.dur + (traditional.dur_day != null ? ' — اليوم ' + traditional.dur_day : '') + '.');
  }
  if (traditional.hamal_fasad !== 'unknown') {
    parts.push('المد: ' + (traditional.hamal_fasad === 'hamal' ? 'حمل' : 'فساد') + '.');
  }
  if (comparison.has_history && comparison.trend !== 'unknown') {
    parts.push('الاتجاه مقارنة بالسجل: ' + comparison.trend + '.');
  }
  if (confidence < 45) {
    parts.push('الثقة إجمالًا منخفضة — لا تُعتمد كتوصية قطعية.');
  }
  var highRisk = risk.boating === 'high' || risk.diving === 'high';
  if (highRisk) {
    parts.push('تحذير: مخاطر بحرية مرتفعة لنشاطات محددة.');
  }
  return parts.join(' ');
}

function assessDataQuality(dto, station, snapshots) {
  var missing = [];
  var warnings = [];
  var score = 100;
  var env = dto && dto.environment ? dto.environment : {};
  var dur = dto && dto.dur ? dto.dur : {};

  if (!station || !station.id) {
    missing.push('station');
    score -= 40;
  }
  if (env.wave_height_m == null) {
    missing.push('wave_height_m');
    score -= 12;
  }
  if (env.wind_speed_kmh == null) {
    missing.push('wind_speed_kmh');
    score -= 10;
  }
  if (!dto || !dto.tide || dto.tide.state == null) {
    missing.push('tide_state');
    score -= 12;
  }
  if (!dur.period_name && !dur.current_dur_name_ar) {
    missing.push('dur_name');
    score -= 18;
  }
  if (env.no_marine_data_for_date) {
    warnings.push('no_marine_data_for_date');
    score -= 15;
  }
  if (!snapshots || !snapshots.length) {
    warnings.push('no_station_snapshots');
    score -= 10;
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    missing: missing,
    warnings: warnings
  };
}

function computeOverallConfidence(marine, traditional, dataQuality) {
  var parts = [];
  if (marine.score > 0) parts.push(marine.score * 0.35);
  if (traditional.confidence > 0) parts.push(traditional.confidence * 0.35);
  parts.push(dataQuality.score * 0.3);
  if (!parts.length) return 0;
  return clamp(Math.round(parts.reduce(function (a, b) {
    return a + b;
  }, 0)), 0, 100);
}

module.exports = {
  scoreMarineCondition: scoreMarineCondition,
  scoreTraditionalLayer: scoreTraditionalLayer,
  scoreFishActivityGroups: scoreFishActivityGroups,
  scoreRisk: scoreRisk,
  buildAnomalies: buildAnomalies,
  buildSummaryAr: buildSummaryAr,
  assessDataQuality: assessDataQuality,
  computeOverallConfidence: computeOverallConfidence
};
