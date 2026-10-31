'use strict';

const crypto = require('crypto');
/**
 * Seasonal / monitoring-only trait matching for admin Marine Monitoring Center.
 * Does not participate in public fishing recommendations or analyzeLiveStation outputs.
 */

const { deriveWaterTraits } = require('./navidur-analysis-runtime');
let deriveObservedTraitsFromDto;
try {
  deriveObservedTraitsFromDto = require('../../shared/navidur-snapshot-validation').deriveObservedTraitsFromDto;
} catch (_e) {
  deriveObservedTraitsFromDto = null;
}

function nfc(s) {
  const t = String(s == null ? '' : s).trim();
  try {
    return t.normalize('NFC');
  } catch (_e) {
    return t;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function traitFrameworkId(durId, traitName) {
  const slug = nfc(traitName).replace(/\s+/g, '_').slice(0, 80);
  return cleanIdPart(durId) + '::' + cleanIdPart(slug);
}

function cleanIdPart(s) {
  return String(s || '').replace(/[^\w\u0600-\u06FF-]/g, '_').slice(0, 80);
}

function openMeteoToEnvironment(open) {
  const o = open && typeof open === 'object' ? open : {};
  const air = o.airTemperature != null ? Number(o.airTemperature) : null;
  const water = o.waterTemperature != null ? Number(o.waterTemperature) : null;
  return {
    temp_c: water != null && Number.isFinite(water) ? water : air,
    wind_speed_kmh: o.windSpeed != null ? Number(o.windSpeed) : null,
    wave_height_m: o.waveHeight != null ? Number(o.waveHeight) : null,
    current_speed_ms: o.currentSpeed != null ? Number(o.currentSpeed) : null
  };
}

function buildMiniDtoForObservation(open, dto) {
  const env = openMeteoToEnvironment(open);
  const tide = dto && dto.tide && typeof dto.tide === 'object' ? dto.tide : {};
  return {
    environment: {
      wind_speed_kmh: env.wind_speed_kmh,
      wave_height_m: env.wave_height_m,
      temp_c: env.temp_c
    },
    tide: {
      current_speed_ms: tide.current_speed_ms != null ? tide.current_speed_ms : env.current_speed_ms,
      state: tide.state != null ? tide.state : null
    }
  };
}

function observedTraitStrings(open, dto) {
  const env = openMeteoToEnvironment(open);
  const fromNumeric = deriveWaterTraits({
    temp_c: env.temp_c,
    wind_speed_kmh: env.wind_speed_kmh,
    wave_height_m: env.wave_height_m,
    current_speed_ms: env.current_speed_ms
  });
  const mini = buildMiniDtoForObservation(open, dto);
  if (typeof deriveObservedTraitsFromDto === 'function') {
    try {
      const full = deriveObservedTraitsFromDto(mini);
      return Array.isArray(full) && full.length ? full : fromNumeric;
    } catch (_e) {
      return fromNumeric;
    }
  }
  return fromNumeric;
}

function hasNumericObservation(open) {
  const e = openMeteoToEnvironment(open);
  return (
    e.wind_speed_kmh != null ||
    e.wave_height_m != null ||
    e.current_speed_ms != null ||
    e.temp_c != null
  );
}

function rangeMatch(trait, open) {
  const er = trait && trait.expected_range && typeof trait.expected_range === 'object' ? trait.expected_range : null;
  if (!er) return null;
  const env = openMeteoToEnvironment(open);
  const checks = [
    ['wind_speed_kmh_min', 'wind_speed_kmh_max', env.wind_speed_kmh],
    ['wave_height_m_min', 'wave_height_m_max', env.wave_height_m],
    ['current_speed_ms_min', 'current_speed_ms_max', env.current_speed_ms],
    ['temp_c_min', 'temp_c_max', env.temp_c]
  ];
  let used = 0;
  let ok = 0;
  for (let i = 0; i < checks.length; i += 1) {
    const minK = checks[i][0];
    const maxK = checks[i][1];
    const val = checks[i][2];
    const lo = er[minK];
    const hi = er[maxK];
    if (lo == null && hi == null) continue;
    if (val == null || !Number.isFinite(val)) return null;
    used += 1;
    const passLo = lo == null || val >= Number(lo);
    const passHi = hi == null || val <= Number(hi);
    if (passLo && passHi) ok += 1;
  }
  if (!used) return null;
  return ok === used;
}

function sharedTokenOverlap(a, b) {
  const stop = new Set(['ال', 'في', 'من', 'إلى', 'مع', 'عند', 'أحياناً', 'نسبي', 'جيد']);
  const ta = nfc(a).split(/[\s،,]+/).filter((x) => x.length >= 2 && !stop.has(x));
  const tb = nfc(b).split(/[\s،,]+/).filter((x) => x.length >= 2 && !stop.has(x));
  if (!ta.length || !tb.length) return 0;
  let n = 0;
  for (let i = 0; i < ta.length; i += 1) {
    for (let j = 0; j < tb.length; j += 1) {
      if (ta[i] === tb[j]) n += 1;
    }
  }
  return n;
}

function classifyTraitVersusObserved(trait, observed, open) {
  const name = nfc(trait && trait.trait_name);
  if (!name) return 'unknown';
  const rm = rangeMatch(trait, open);
  if (rm === true) return 'matched';
  if (rm === false) return 'failed';
  const range = trait && trait.expected_range && typeof trait.expected_range === 'object'
    ? trait.expected_range
    : null;
  if (!range || !Object.keys(range).some(function (key) {
    return /_(?:min|max)$/.test(key);
  })) return 'unsupported';
  return 'insufficient_evidence';
}

/**
 * Independent seasonal trait matcher (monitoring / admin only).
 */
function matchDururTraitsWithMonitoringData(ctx) {
  const dto = ctx && ctx.dto ? ctx.dto : {};
  const open = ctx && ctx.openMeteoValues ? ctx.openMeteoValues : {};
  const traits = Array.isArray(ctx && ctx.frameworkTraits) ? ctx.frameworkTraits : [];
  const observed = observedTraitStrings(open, dto);

  const matched_traits = [];
  const partial_traits = [];
  const failed_traits = [];
  const unknown_traits = [];
  const unsupported_traits = [];
  const insufficient_traits = [];
  const conflicting_traits = [];
  const anomalies = [];
  const agreementPairs = ctx && ctx.sourceAgreement && Array.isArray(ctx.sourceAgreement.pairs)
    ? ctx.sourceAgreement.pairs
    : [];
  const rangeFieldToAgreementField = {
    wind_speed_kmh: 'windSpeed',
    wave_height_m: 'waveHeight',
    current_speed_ms: 'currentSpeed',
    temp_c: 'waterTemperature'
  };

  for (let i = 0; i < traits.length; i += 1) {
    const t = traits[i];
    const range = t && t.expected_range && typeof t.expected_range === 'object' ? t.expected_range : {};
    const conflict = Object.keys(range).some(function (key) {
      if (!/_(?:min|max)$/.test(key)) return false;
      const field = key.replace(/_(?:min|max)$/, '');
      const pairKey = rangeFieldToAgreementField[field];
      return !!pairKey && agreementPairs.some(function (pair) {
        return pair && pair.key === pairKey && pair.pass === false;
      });
    });
    const status = conflict
      ? 'conflicting_evidence'
      : (ctx && ctx.measurementKind !== 'observation' &&
        Object.keys(range).some(function (key) { return /_(?:min|max)$/.test(key); }))
        ? 'insufficient_evidence'
      : classifyTraitVersusObserved(t, observed, open);
    const row = {
      trait_id: t.id,
      trait_name: t.trait_name,
      trait_category: t.trait_category || '',
      status: status,
      expected_range: Object.keys(range).length ? range : null
    };
    if (status === 'matched') matched_traits.push(row);
    else if (status === 'partial') partial_traits.push(row);
    else if (status === 'failed') failed_traits.push(row);
    else {
      unknown_traits.push(row);
      if (status === 'unsupported') unsupported_traits.push(row);
      else if (status === 'conflicting_evidence') conflicting_traits.push(row);
      else insufficient_traits.push(row);
    }
  }

  const evaluable_trait_count = matched_traits.length + failed_traits.length;
  const trait_match_score = evaluable_trait_count
    ? Math.round((matched_traits.length / evaluable_trait_count) * 100)
    : null;

  if (insufficient_traits.length || (traits.length && !hasNumericObservation(open))) {
    anomalies.push({ type: 'incomplete_observation', message_ar: 'بيانات الرصد الرقمية غير كافية لمقارنة كاملة.' });
  }
  if (unsupported_traits.length) {
    anomalies.push({
      type: 'unsupported_trait_rules',
      message_ar: 'توجد سمات تراثية بلا قواعد تحقق كمية معتمدة؛ لم تدخل في النتيجة.'
    });
  }
  if (conflicting_traits.length) {
    anomalies.push({
      type: 'conflicting_evidence',
      message_ar: 'توجد قراءات متعارضة بين المصادر؛ لم تدخل السمات المتأثرة في النتيجة.'
    });
  }
  if (evaluable_trait_count && failed_traits.length > matched_traits.length && matched_traits.length === 0) {
    anomalies.push({
      type: 'trait_divergence',
      message_ar: 'معظم سمات الدر لا تطابق الرصد الحالي — راجع الفرضيات أو جودة الرصد.'
    });
  }

  const summary_ar =
    (trait_match_score == null ? 'لا يمكن حساب نسبة التحقق' : 'نسبة السمات القابلة للتقييم ' + trait_match_score + '%') +
    ': ' +
    matched_traits.length +
    ' مطابقة، ' +
    failed_traits.length +
    ' عدم تطابق مؤكد، ' +
    insufficient_traits.length +
    ' بأدلة غير كافية، ' +
    unsupported_traits.length +
    ' بلا قاعدة تحقق، ' +
    conflicting_traits.length +
    ' بأدلة متعارضة.';

  return {
    trait_match_score: trait_match_score,
    evaluable_trait_count: evaluable_trait_count,
    denominator: evaluable_trait_count,
    total_trait_count: traits.length,
    coverage: traits.length ? Number((evaluable_trait_count / traits.length).toFixed(4)) : 0,
    matched_traits: matched_traits,
    partial_traits: partial_traits,
    failed_traits: failed_traits,
    unknown_traits: unknown_traits,
    unsupported_traits: unsupported_traits,
    insufficient_traits: insufficient_traits,
    conflicting_traits: conflicting_traits,
    anomalies: anomalies,
    summary_ar: summary_ar,
    _observed_traits_debug: observed
  };
}

function computeSeasonalValidationConfidence(params) {
  const wm = params && params.weather_meta && typeof params.weather_meta === 'object' ? params.weather_meta : {};
  const rawMatchScore = params && params.trait_match_score;
  const matchScore = rawMatchScore == null ? NaN : Number(rawMatchScore);
  const rawAgreement = params && params.source_agreement_score;
  const agreement = rawAgreement == null ? NaN : Number(rawAgreement);
  const open = params && params.openMeteoValues ? params.openMeteoValues : {};

  let source_confidence = 55;
  if (wm.no_marine_data_for_date) source_confidence = 35;
  else if (wm.from_cache) source_confidence = 68;
  else if (wm.from_defaults) source_confidence = 30;
  else if (wm.forecast_source === 'open_meteo_hourly') source_confidence = 78;

  const dur = params && params.dto && params.dto.dur ? params.dto.dur : {};
  const dto0 = params && params.dto ? params.dto : {};
  const val = dto0.validation && typeof dto0.validation === 'object' ? dto0.validation : (dur.validation && typeof dur.validation === 'object' ? dur.validation : {});
  const matched = Array.isArray(val.matched_traits) ? val.matched_traits.length : 0;
  const failed = Array.isArray(val.failed_traits) ? val.failed_traits.length : 0;
  const tot = matched + failed;
  const dur_confidence = tot > 0 ? Math.round((matched / tot) * 100) : null;

  const trait_confidence = Number.isFinite(matchScore) ? Math.max(0, Math.min(100, matchScore)) : null;

  const env = openMeteoToEnvironment(open);
  let filled = 0;
  if (env.wind_speed_kmh != null) filled += 1;
  if (env.wave_height_m != null) filled += 1;
  if (env.current_speed_ms != null) filled += 1;
  if (env.temp_c != null) filled += 1;
  const environmental_confidence = Math.round((filled / 4) * 100);

  const validation_confidence = trait_confidence == null
    ? null
    : Math.round(
      Math.min(100, trait_confidence * 0.5 + (Number.isFinite(agreement) ? agreement * 0.5 : source_confidence * 0.5))
    );

  return {
    source_confidence: source_confidence,
    dur_confidence: dur_confidence,
    trait_confidence: trait_confidence,
    environmental_confidence: environmental_confidence,
    validation_confidence: validation_confidence
  };
}

function collectDurTraitNamesFromMasterRow(row) {
  const out = [];
  const pushArr = (arr, cat) => {
    (Array.isArray(arr) ? arr : []).forEach(function (x) {
      const s = nfc(x);
      if (!s) return;
      out.push({ name: s, category: cat });
    });
  };
  if (!row || typeof row !== 'object') return out;
  pushArr(row.general_traits, 'general');
  pushArr(row.weather_traits, 'weather');
  pushArr(row.marine_traits, 'marine');
  return out;
}

function buildFrameworkFromDururMaster(dururMasterRows) {
  const rows = Array.isArray(dururMasterRows) ? dururMasterRows : [];
  const traits = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || !row.id) continue;
    const durId = String(row.id);
    const durNameAr = String(row.name_ar || row.name || durId);
    const list = collectDurTraitNamesFromMasterRow(row);
    for (let j = 0; j < list.length; j += 1) {
      const name = list[j].name;
      const key = durId + '|' + name;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = traitFrameworkId(durId, name);
      const ts = nowIso();
      traits.push({
        id: id,
        dur_id: durId,
        dur_name_ar: durNameAr,
        trait_name: name,
        trait_category: list[j].category,
        description_ar: String(row.description_ar || row.heritage_meaning_ar || '').slice(0, 500),
        expected_behavior: 'hypothesis',
        expected_range: {},
        regional_variation: row.season_ar ? { default_season_ar: String(row.season_ar) } : {},
        seasonal_context: { season_ar: row.season_ar || null },
        source_type: 'heritage',
        status: 'unverified',
        validation_status: 'pending',
        confidence: 0,
        validation_years: 0,
        match_rate: 0,
        evidence_count: 0,
        evidence_history: [],
        regions_verified: [],
        regions_failed: [],
        seasonal_strength: 0,
        created_at: ts,
        updated_at: ts
      });
    }
  }
  return { version: 1, traits: traits, updated_at: nowIso() };
}

async function ensureDururTraitFramework(readJsonFile, writeJsonFile, referenceData) {
  let doc = await readJsonFile('durur_trait_framework', { version: 1, traits: [] });
  const arr = Array.isArray(doc.traits) ? doc.traits : [];
  if (arr.length > 0) return doc;
  const master = referenceData && Array.isArray(referenceData.durur_master) ? referenceData.durur_master : [];
  doc = buildFrameworkFromDururMaster(master);
  await writeJsonFile('durur_trait_framework', doc);
  return doc;
}

function frameworkTraitsForDurId(doc, durId) {
  const id = String(durId || '');
  const traits = Array.isArray(doc.traits) ? doc.traits : [];
  return traits.filter(function (t) {
    return t && String(t.dur_id) === id;
  });
}

function updateFrameworkAfterRun(doc, matchResult, station, year, dateStr, regionLabel) {
  const traits = Array.isArray(doc.traits) ? doc.traits : [];
  const region = String(regionLabel || '').trim();
  const byId = {};
  for (let i = 0; i < traits.length; i += 1) {
    if (traits[i] && traits[i].id) byId[traits[i].id] = traits[i];
  }

  function bumpTrait(row, kind) {
    if (!row) return;
    const score = kind === 'matched' ? 100 : kind === 'partial' ? 55 : kind === 'unknown' ? null : 0;
    row.evidence_count = (Number(row.evidence_count) || 0) + 1;
    const hist = Array.isArray(row.evidence_history) ? row.evidence_history : [];
    hist.push({
      year: year,
      date: dateStr,
      station_id: station && station.id,
      kind: kind,
      score: score,
      at: nowIso()
    });
    row.evidence_history = hist.slice(-80);
    if (score != null) {
      const prev = Number(row.match_rate) || 0;
      const n = row.evidence_count;
      row.match_rate = Math.round((prev * (n - 1) + score) / n);
    }
    const yearsSet = new Set();
    row.evidence_history.forEach(function (h) {
      if (h && h.year != null) yearsSet.add(Number(h.year));
    });
    row.validation_years = yearsSet.size;
    if (region) {
      if (kind === 'matched') {
        if (row.regions_verified.indexOf(region) < 0) row.regions_verified.push(region);
      } else if (kind === 'failed') {
        if (row.regions_failed.indexOf(region) < 0) row.regions_failed.push(region);
      }
    }
    row.validation_status = kind === 'matched' ? 'supported' : kind === 'partial' ? 'mixed' : kind === 'unknown' ? 'pending' : 'challenged';
    row.updated_at = nowIso();
  }

  (matchResult.matched_traits || []).forEach(function (r) {
    bumpTrait(byId[r.trait_id], 'matched');
  });
  (matchResult.failed_traits || []).forEach(function (r) {
    bumpTrait(byId[r.trait_id], 'failed');
  });

  doc.traits = traits;
  doc.updated_at = nowIso();
  return doc;
}

async function appendSeasonalHistory(readJsonFile, writeJsonFile, record, historyStore) {
  const doc = await readJsonFile('navidur_seasonal_validation_history', { version: 1, entries: [] });
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  const next = Object.assign({}, record || {});
  const key = [next.station_id, next.dur_id, next.date, next.verification_rule_version || 'legacy'].join('|');
  const evidence = {
    observation_evidence: next.observation_evidence ? {
      values: next.observation_evidence.values || {},
      provider: next.observation_evidence.provider || 'unknown',
      measurement_kind: next.observation_evidence.measurement_kind || 'unknown',
      observation_time: next.observation_evidence.observation_time || null,
      cached: next.observation_evidence.cached === true,
      defaulted: next.observation_evidence.defaulted === true
    } : null,
    expected_traits: next.expected_traits || [],
    matched_traits: next.matched_traits || [],
    partial_traits: next.partial_traits || [],
    failed_traits: next.failed_traits || [],
    unsupported_traits: next.unsupported_traits || [],
    insufficient_traits: next.insufficient_traits || [],
    conflicting_traits: next.conflicting_traits || []
  };
  const signature = crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  let latestPrior = null;
  let maxRevision = 0;
  let duplicateRecord = null;
  function inspectPrior(entry) {
    if (!entry || [entry.station_id, entry.dur_id, entry.date, entry.verification_rule_version || 'legacy'].join('|') !== key) return;
    const revision = Number(entry.revision_number) || 1;
    if (revision > maxRevision) {
      maxRevision = revision;
      latestPrior = entry;
    }
    if (entry.evidence_signature === signature) duplicateRecord = entry;
  }
  entries.forEach(inspectPrior);
  if (historyStore && typeof historyStore.getSeasonalValidationHistoryPage === 'function') {
    await historyStore.getSeasonalValidationHistoryPage({
      stationId: next.station_id,
      durId: next.dur_id,
      date: next.date,
      ruleVersion: next.verification_rule_version || 'legacy',
      includeLegacy: false,
      onRecord: inspectPrior,
      limit: 1
    });
  }
  if (duplicateRecord) return { doc: doc, duplicate: true, record: duplicateRecord };

  next.validation_id = next.validation_id || 'seasonal_' + crypto.randomBytes(12).toString('hex');
  next.evidence_signature = signature;
  next.revision_number = maxRevision + 1;
  if (latestPrior) {
    next.supersedes_validation_id = latestPrior.validation_id || null;
  }
  if (historyStore && typeof historyStore.appendSeasonalValidationRecord === 'function') {
    await historyStore.appendSeasonalValidationRecord(next);
    return { doc: doc, duplicate: false, record: next };
  }
  entries.unshift(next);
  doc.entries = entries.slice(0, 2500);
  doc.version = 1;
  await writeJsonFile('navidur_seasonal_validation_history', doc);
  return { doc: doc, duplicate: false, record: next };
}

function filterHistoryForComparison(entries, durId, stationId, region, dateStr) {
  const did = String(durId || '');
  const sid = String(stationId || '');
  const reg = String(region || '').trim();
  const md = dateStr && String(dateStr).length >= 10 ? String(dateStr).slice(5, 10) : null;
  return entries.filter(function (e) {
    if (!e) return false;
    if (String(e.dur_id) !== did) return false;
    if (String(e.station_id) !== sid) return false;
    if (reg && e.region && String(e.region) !== reg) return false;
    if (md && e.date && String(e.date).length >= 10 && String(e.date).slice(5, 10) !== md) return false;
    return true;
  });
}

function getYearComparisonCompleteness(historyPage) {
  const complete = !(historyPage && (
    historyPage.has_more ||
    historyPage.is_partial ||
    historyPage.offset > 0
  ));
  return {
    year_comparison_complete: complete,
    year_comparison_status: complete ? 'complete' : 'partial'
  };
}

module.exports = {
  matchDururTraitsWithMonitoringData: matchDururTraitsWithMonitoringData,
  computeSeasonalValidationConfidence: computeSeasonalValidationConfidence,
  buildFrameworkFromDururMaster: buildFrameworkFromDururMaster,
  ensureDururTraitFramework: ensureDururTraitFramework,
  frameworkTraitsForDurId: frameworkTraitsForDurId,
  updateFrameworkAfterRun: updateFrameworkAfterRun,
  appendSeasonalHistory: appendSeasonalHistory,
  filterHistoryForComparison: filterHistoryForComparison,
  getYearComparisonCompleteness: getYearComparisonCompleteness,
  observedTraitStrings: observedTraitStrings
};
