'use strict';

const path = require('path');
const fs = require('fs/promises');
const { readJsonFile, writeJsonFile, createId, nowIso, getStationSnapshots, getDurValidationLogs, getSnapshotRunLogs, getKv, kvStoreKey, getCatchLogs } = require('../_lib/data-store');
const fieldInsight = require('../../shared/navidur-learning-insight-engine.js');
const { resolveAutoReferenceInheritance } = require('../_lib/reference-station-inheritance');
const { requireRole, createUser, hashPassword } = require('../_lib/auth');
const { normalizeStationInput, hasDuplicateStation, normalizeStatus } = require('../_lib/stations');
const { isAllowedOrigin, parseBody, cleanString, setNoCache } = require('../_lib/security');
const { getDurIntelligenceSummary, getDurTraitReviewEvidence } = require('../_lib/dur-intelligence');
const traitCalibrationLib = require('../../shared/navidur-trait-calibration');
const traitLongTermLib = require('../_lib/navidur-trait-long-term');
const { utcTodayIso } = require('../_lib/station-local-dur-resolver');
const tfLookup = require('../../shared/true-final-station-reference-lookup');
const { analyzeLiveStation } = require('../../shared/navidur-analysis-engine');
const { normalizeRequestedStation, fetchWeatherAndMarineInputs, loadReferenceData } = require('../_lib/navidur-analysis-runtime');
const sgMonitoring = require('../_lib/stormglass-monitoring-provider');

/** Canonical 28 DUR names (admin manual edit + annual_flat_rows patch) — order fixed for UI. */
const TRUE_FINAL_MANUAL_DUR_NAME_LIST = [
  'المقدم', 'المؤخر', 'الرشاء', 'الشرطين', 'البطين', 'الثريا',
  'الدبران', 'الهقعة', 'الهنعة', 'الذراع', 'النثرة', 'الطرفة',
  'الجبهة', 'الزبرة', 'الصرفة', 'العواء', 'السماك', 'الغفر',
  'الزبانا', 'الإكليل', 'القلب', 'الشولة', 'النعايم', 'البلدة',
  'سعد الذابح', 'سعد بلع', 'سعد السعود', 'سعد الأخبية'
];

function buildManualDurNameAllowSet() {
  return new Set(TRUE_FINAL_MANUAL_DUR_NAME_LIST.map((n) => nfcStringAr(n)));
}

function canonicalManualDurName(input, allowSet) {
  const n = nfcStringAr(cleanString(input, 120));
  if (!n || !allowSet.has(n)) return null;
  for (let i = 0; i < TRUE_FINAL_MANUAL_DUR_NAME_LIST.length; i += 1) {
    const x = TRUE_FINAL_MANUAL_DUR_NAME_LIST[i];
    if (nfcStringAr(x) === n) return x;
  }
  return null;
}

function parseMonthDayFlexibleAdmin(s) {
  const p = tfLookup.parseDayMonthDdMm(s);
  if (p) return p;
  const t = String(s == null ? '' : s).trim();
  const m = t.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const mo = Number(m[1]);
  const day = Number(m[2]);
  if (!day || !mo || mo > 12 || day > 31) return null;
  return { d: day, m: mo };
}

function isAsOfInWindowKeysAdmin(sKey, eKey, aKey) {
  if (sKey == null || eKey == null || aKey == null) return false;
  if (sKey <= eKey) {
    return aKey >= sKey && aKey <= eKey;
  }
  return aKey >= sKey || aKey <= eKey;
}

function stationNameMatchesAnnualRow(rowName, wantName) {
  const wantExact = nfcStringAr(wantName);
  const wantNorm = tfLookup.normalizeArabicName(wantName);
  if (nfcStringAr(rowName) === wantExact) return true;
  if (wantNorm && tfLookup.normalizeArabicName(rowName) === wantNorm) return true;
  return false;
}

function findAnnualFlatCurrentNextGlobalIndices(doc, stationNameAr, asOfIso) {
  const annual = Array.isArray(doc.annual_flat_rows) ? doc.annual_flat_rows : [];
  const matched = [];
  for (let i = 0; i < annual.length; i += 1) {
    const row = annual[i];
    if (!row) continue;
    if (stationNameMatchesAnnualRow(row.station_name_ar, stationNameAr)) {
      matched.push({ globalIdx: i, row });
    }
  }
  if (!matched.length) {
    return { error: 'station_not_in_annual' };
  }
  const asDate = new Date(String(asOfIso).trim() + 'T12:00:00.000Z');
  if (Number.isNaN(asDate.getTime())) {
    return { error: 'bad_as_of' };
  }
  const asM = asDate.getUTCMonth() + 1;
  const asD = asDate.getUTCDate();
  const aKey = asM * 100 + asD;
  let localIdx = -1;
  for (let k = 0; k < matched.length; k += 1) {
    const row = matched[k].row;
    const pStart = parseMonthDayFlexibleAdmin(row.start_md);
    const pEnd = parseMonthDayFlexibleAdmin(row.end_md);
    if (!pStart || !pEnd) continue;
    const sKey = pStart.m * 100 + pStart.d;
    const eKey = pEnd.m * 100 + pEnd.d;
    if (isAsOfInWindowKeysAdmin(sKey, eKey, aKey)) {
      localIdx = k;
      break;
    }
  }
  if (localIdx < 0) {
    return { error: 'no_window_for_date', matched_len: matched.length };
  }
  const nextLocal = (localIdx + 1) % matched.length;
  return {
    currentGlobalIdx: matched[localIdx].globalIdx,
    nextGlobalIdx: matched[nextLocal].globalIdx,
    localIdx,
    nextLocalIdx: nextLocal
  };
}

async function writeAudit(action, actor, details) {
  const audit = await readJsonFile('audit', []);
  audit.push({
    id: createId('audit'),
    action,
    actor_user_id: actor ? actor.id : null,
    actor_username: actor ? actor.username : null,
    details: details || {},
    timestamp: nowIso()
  });
  await writeJsonFile('audit', audit);
}

function nfcStringAr(value) {
  if (value == null) return '';
  const t = String(value).trim();
  try {
    return t.normalize('NFC');
  } catch (_e) {
    return t;
  }
}

function isValidDdMmTrueFinal(s) {
  const m = String(s || '')
    .trim()
    .match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  return d >= 1 && d <= 31 && mo >= 1 && mo <= 12;
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active_status: user.active_status !== false,
    assigned_stations: Array.isArray(user.assigned_stations) ? user.assigned_stations : [],
    created_at: user.created_at || null,
    last_login: user.last_login || null,
    trust_score: user.trust_score != null ? user.trust_score : null
  };
}

function getPathSegments(req) {
  const p = req.query && req.query.path;
  if (Array.isArray(p)) return p;
  if (typeof p === 'string' && p) return [p];
  const rawUrl = String((req && req.url) || '');
  const noQuery = rawUrl.split('?')[0];
  const marker = '/api/admin/';
  const idx = noQuery.indexOf(marker);
  if (idx >= 0) {
    return noQuery.slice(idx + marker.length).split('/').map((x) => cleanString(x, 120)).filter(Boolean);
  }
  return [];
}

function getCollectionKey(root) {
  if (root === 'durur') return 'durur';
  if (root === 'durur-reference') return 'durur_reference_seed';
  if (root === 'season-events') return 'season_events';
  if (root === 'station-dur-profiles') return 'station_dur_profiles';
  if (root === 'station-dur-overrides') return 'station_dur_overrides';
  if (root === 'annual-comparisons') return 'annual_comparisons';
  if (root === 'durur-master') return 'durur_master';
  if (root === 'trait-dictionaries') return 'trait_dictionaries';
  if (root === 'fish-season-tags') return 'fish_season_tags';
  if (root === 'advice-basis-tags') return 'advice_basis_tags';
  return null;
}

function normalizeDururInput(input, existing) {
  const base = existing || {};
  return {
    id: cleanString(base.id || input.id || createId('dur'), 80),
    dur_number: Number.isFinite(Number(input.dur_number)) ? Number(input.dur_number) : Number(base.dur_number) || 0,
    name: cleanString(input.name != null ? input.name : base.name, 120),
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true),
    days_count: Number.isFinite(Number(input.days_count)) ? Number(input.days_count) : Number(base.days_count) || 0,
    gregorian_start_month: Number.isFinite(Number(input.gregorian_start_month)) ? Number(input.gregorian_start_month) : Number(base.gregorian_start_month) || 1,
    gregorian_start_day: Number.isFinite(Number(input.gregorian_start_day)) ? Number(input.gregorian_start_day) : Number(base.gregorian_start_day) || 1,
    gregorian_end_month: Number.isFinite(Number(input.gregorian_end_month)) ? Number(input.gregorian_end_month) : Number(base.gregorian_end_month) || 1,
    gregorian_end_day: Number.isFinite(Number(input.gregorian_end_day)) ? Number(input.gregorian_end_day) : Number(base.gregorian_end_day) || 1,
    description: cleanString(input.description != null ? input.description : base.description, 800),
    heritage_meaning: cleanString(input.heritage_meaning != null ? input.heritage_meaning : base.heritage_meaning, 800),
    weather_traits: Array.isArray(input.weather_traits) ? input.weather_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.weather_traits) ? base.weather_traits : []),
    marine_traits: Array.isArray(input.marine_traits) ? input.marine_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.marine_traits) ? base.marine_traits : []),
    fish_traits: Array.isArray(input.fish_traits) ? input.fish_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.fish_traits) ? base.fish_traits : []),
    notes: cleanString(input.notes != null ? input.notes : base.notes, 800),
    created_at: base.created_at || nowIso(),
    updated_at: nowIso()
  };
}

function normalizeSeasonEventInput(input, existing) {
  const base = existing || {};
  return {
    id: cleanString(base.id || input.id || createId('season_event'), 80),
    name_ar: cleanString(input.name_ar != null ? input.name_ar : base.name_ar, 120),
    name_en: cleanString(input.name_en != null ? input.name_en : base.name_en, 120),
    category: cleanString(input.category != null ? input.category : base.category, 120),
    description_ar: cleanString(input.description_ar != null ? input.description_ar : base.description_ar, 800),
    description_en: cleanString(input.description_en != null ? input.description_en : base.description_en, 800),
    start_hint: {
      month: Number.isFinite(Number(input.start_hint?.month)) ? Number(input.start_hint.month) : (base.start_hint?.month ?? null),
      day: Number.isFinite(Number(input.start_hint?.day)) ? Number(input.start_hint.day) : (base.start_hint?.day ?? null)
    },
    end_hint: {
      month: Number.isFinite(Number(input.end_hint?.month)) ? Number(input.end_hint.month) : (base.end_hint?.month ?? null),
      day: Number.isFinite(Number(input.end_hint?.day)) ? Number(input.end_hint.day) : (base.end_hint?.day ?? null)
    },
    days_count_hint: Number.isFinite(Number(input.days_count_hint)) ? Number(input.days_count_hint) : (Number(base.days_count_hint) || null),
    related_dur_ids: Array.isArray(input.related_dur_ids) ? input.related_dur_ids.map((v) => cleanString(v, 80)).filter(Boolean) : (Array.isArray(base.related_dur_ids) ? base.related_dur_ids : []),
    weather_traits: Array.isArray(input.weather_traits) ? input.weather_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.weather_traits) ? base.weather_traits : []),
    marine_traits: Array.isArray(input.marine_traits) ? input.marine_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.marine_traits) ? base.marine_traits : []),
    fish_traits: Array.isArray(input.fish_traits) ? input.fish_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.fish_traits) ? base.fish_traits : []),
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true),
    created_at: base.created_at || nowIso(),
    updated_at: nowIso()
  };
}

function normalizeDururMasterInput(input, existing) {
  const base = existing || {};
  const phasesInput = Array.isArray(input.phases) ? input.phases : (Array.isArray(base.phases) ? base.phases : []);
  const fallbackDefaultDays = Number.isFinite(Number(input.default_days_count)) ? Number(input.default_days_count) : Number(base.default_days_count) || 13;
  const fallbackPhaseSource = phasesInput.length ? phasesInput : [{
    phase_id: ((base.id || input.id || 'dur') + '_phase_01'),
    start_day: 1,
    end_day: fallbackDefaultDays,
    title_ar: '',
    general_traits: Array.isArray(input.general_traits) ? input.general_traits : (Array.isArray(base.general_traits) ? base.general_traits : []),
    weather_traits: Array.isArray(input.weather_traits) ? input.weather_traits : (Array.isArray(base.weather_traits) ? base.weather_traits : []),
    marine_traits: Array.isArray(input.marine_traits) ? input.marine_traits : (Array.isArray(base.marine_traits) ? base.marine_traits : []),
    fish_traits: Array.isArray(input.fish_traits) ? input.fish_traits : (Array.isArray(base.fish_traits) ? base.fish_traits : []),
    related_event_ids: Array.isArray(input.related_event_ids) ? input.related_event_ids : (Array.isArray(base.related_event_ids) ? base.related_event_ids : []),
    notes_ar: input.notes_ar != null ? input.notes_ar : base.notes_ar
  }];
  return {
    id: cleanString(base.id || input.id || createId('dur'), 80),
    dur_number: Number.isFinite(Number(input.dur_number)) ? Number(input.dur_number) : Number(base.dur_number) || 0,
    name_ar: cleanString(input.name_ar != null ? input.name_ar : base.name_ar, 120),
    name_en: cleanString(input.name_en != null ? input.name_en : base.name_en, 120),
    order_index: Number.isFinite(Number(input.order_index)) ? Number(input.order_index) : Number(base.order_index) || 0,
    default_days_count: Number.isFinite(Number(input.default_days_count)) ? Number(input.default_days_count) : Number(base.default_days_count) || 13,
    gregorian_window_hint: {
      start_month: Number.isFinite(Number(input.gregorian_window_hint?.start_month)) ? Number(input.gregorian_window_hint.start_month) : (base.gregorian_window_hint?.start_month ?? null),
      start_day: Number.isFinite(Number(input.gregorian_window_hint?.start_day)) ? Number(input.gregorian_window_hint.start_day) : (base.gregorian_window_hint?.start_day ?? null),
      end_month: Number.isFinite(Number(input.gregorian_window_hint?.end_month)) ? Number(input.gregorian_window_hint.end_month) : (base.gregorian_window_hint?.end_month ?? null),
      end_day: Number.isFinite(Number(input.gregorian_window_hint?.end_day)) ? Number(input.gregorian_window_hint.end_day) : (base.gregorian_window_hint?.end_day ?? null)
    },
    season_ar: cleanString(input.season_ar != null ? input.season_ar : base.season_ar, 120),
    season_en: cleanString(input.season_en != null ? input.season_en : base.season_en, 120),
    astronomical_marker_ar: cleanString(input.astronomical_marker_ar != null ? input.astronomical_marker_ar : base.astronomical_marker_ar, 120),
    astronomical_marker_en: cleanString(input.astronomical_marker_en != null ? input.astronomical_marker_en : base.astronomical_marker_en, 120),
    heritage_meaning_ar: cleanString(input.heritage_meaning_ar != null ? input.heritage_meaning_ar : base.heritage_meaning_ar, 800),
    heritage_meaning_en: cleanString(input.heritage_meaning_en != null ? input.heritage_meaning_en : base.heritage_meaning_en, 800),
    description_ar: cleanString(input.description_ar != null ? input.description_ar : base.description_ar, 1200),
    description_en: cleanString(input.description_en != null ? input.description_en : base.description_en, 1200),
    general_traits: Array.isArray(input.general_traits) ? input.general_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.general_traits) ? base.general_traits : []),
    weather_traits: Array.isArray(input.weather_traits) ? input.weather_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.weather_traits) ? base.weather_traits : []),
    marine_traits: Array.isArray(input.marine_traits) ? input.marine_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.marine_traits) ? base.marine_traits : []),
    fish_traits: Array.isArray(input.fish_traits) ? input.fish_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.fish_traits) ? base.fish_traits : []),
    related_event_ids: Array.isArray(input.related_event_ids) ? input.related_event_ids.map((v) => cleanString(v, 80)).filter(Boolean) : (Array.isArray(base.related_event_ids) ? base.related_event_ids : []),
    notes_ar: cleanString(input.notes_ar != null ? input.notes_ar : base.notes_ar, 1200),
    notes_en: cleanString(input.notes_en != null ? input.notes_en : base.notes_en, 1200),
    review_status: ['draft', 'reviewed', 'approved', 'needs_revision'].includes(cleanString(input.review_status != null ? input.review_status : base.review_status || 'draft', 40))
      ? cleanString(input.review_status != null ? input.review_status : base.review_status || 'draft', 40)
      : 'draft',
    advice_text: input.advice_text === null ? null : cleanString(input.advice_text != null ? input.advice_text : base.advice_text, 1200) || null,
    phases: fallbackPhaseSource.map((phase, index) => ({
      phase_id: cleanString(phase && phase.phase_id ? phase.phase_id : ((base.id || input.id || 'dur') + '_phase_' + String(index + 1).padStart(2, '0')), 80),
      start_day: Number.isFinite(Number(phase && phase.start_day)) ? Number(phase.start_day) : 1,
      end_day: Number.isFinite(Number(phase && phase.end_day)) ? Number(phase.end_day) : fallbackDefaultDays,
      title_ar: cleanString(phase && phase.title_ar, 200),
      general_traits: Array.isArray(phase && phase.general_traits) ? phase.general_traits.map((v) => cleanString(v, 120)).filter(Boolean) : [],
      weather_traits: Array.isArray(phase && phase.weather_traits) ? phase.weather_traits.map((v) => cleanString(v, 120)).filter(Boolean) : [],
      marine_traits: Array.isArray(phase && phase.marine_traits) ? phase.marine_traits.map((v) => cleanString(v, 120)).filter(Boolean) : [],
      fish_traits: Array.isArray(phase && phase.fish_traits) ? phase.fish_traits.map((v) => cleanString(v, 120)).filter(Boolean) : [],
      related_event_ids: Array.isArray(phase && phase.related_event_ids) ? phase.related_event_ids.map((v) => cleanString(v, 80)).filter(Boolean) : [],
      notes_ar: cleanString(phase && phase.notes_ar, 1200)
    })),
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true),
    created_at: base.created_at || nowIso(),
    updated_at: nowIso()
  };
}

function normalizeStringArray(value, maxLength) {
  return Array.isArray(value) ? value.map((entry) => cleanString(entry, maxLength || 120)).filter(Boolean) : [];
}

function normalizeNullableString(value, maxLength) {
  if (value === null) return null;
  const cleaned = cleanString(value, maxLength || 1200);
  return cleaned || null;
}

function normalizeDururOverrideInput(input, existing) {
  const base = existing || {};
  const baseFields = base.fields || {};
  const nextFields = input.fields || {};
  return {
    override_id: cleanString(base.override_id || base.id || input.override_id || input.id || createId('durovr'), 80),
    station_id: cleanString(input.station_id != null ? input.station_id : base.station_id, 80) || null,
    dur_id: cleanString(input.dur_id != null ? input.dur_id : base.dur_id, 80),
    phase_id: cleanString(input.phase_id != null ? input.phase_id : base.phase_id, 80) || null,
    season_key: cleanString(input.season_key != null ? input.season_key : base.season_key, 60) || null,
    fields: {
      general_traits: Array.isArray(nextFields.general_traits) ? normalizeStringArray(nextFields.general_traits, 120) : (Array.isArray(baseFields.general_traits) ? baseFields.general_traits : []),
      weather_traits: Array.isArray(nextFields.weather_traits) ? normalizeStringArray(nextFields.weather_traits, 120) : (Array.isArray(baseFields.weather_traits) ? baseFields.weather_traits : []),
      marine_traits: Array.isArray(nextFields.marine_traits) ? normalizeStringArray(nextFields.marine_traits, 120) : (Array.isArray(baseFields.marine_traits) ? baseFields.marine_traits : []),
      fish_traits: Array.isArray(nextFields.fish_traits) ? normalizeStringArray(nextFields.fish_traits, 120) : (Array.isArray(baseFields.fish_traits) ? baseFields.fish_traits : []),
      advice_text: Object.prototype.hasOwnProperty.call(nextFields, 'advice_text')
        ? normalizeNullableString(nextFields.advice_text, 1200)
        : normalizeNullableString(baseFields.advice_text, 1200)
    },
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true),
    created_at: base.created_at || nowIso(),
    updated_at: nowIso()
  };
}

function applyPartialDurMasterUpdate(existing, fields) {
  const next = Object.assign({}, existing || {});
  Object.keys(fields || {}).forEach((key) => {
    if (key === 'id' || key === 'phases') return;
    next[key] = fields[key];
  });
  return normalizeDururMasterInput(next, existing);
}

function validateDurMasterRow(row) {
  if (!row || !row.id) throw new Error('dur_id_required');
  const reviewStatus = cleanString(row.review_status || 'draft', 40) || 'draft';
  if (!['draft', 'reviewed', 'approved', 'needs_revision'].includes(reviewStatus)) {
    throw new Error('invalid_review_status');
  }
  const phases = Array.isArray(row.phases) ? row.phases.slice() : [];
  const seenPhaseIds = new Set();
  phases.forEach((phase) => {
    if (!phase || !cleanString(phase.phase_id, 80)) throw new Error('phase_id_required');
    const phaseId = cleanString(phase.phase_id, 80);
    if (seenPhaseIds.has(phaseId)) throw new Error('duplicate_phase_id');
    seenPhaseIds.add(phaseId);
    const start = Number(phase.start_day);
    const end = Number(phase.end_day);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
      throw new Error('invalid_phase_range');
    }
  });
  phases.sort((a, b) => Number(a.start_day) - Number(b.start_day));
  for (let i = 1; i < phases.length; i += 1) {
    if (Number(phases[i].start_day) <= Number(phases[i - 1].end_day)) {
      throw new Error('overlapping_phase_ranges');
    }
  }
}

function validateDurMasterCollection(rows) {
  const seenDurIds = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    validateDurMasterRow(row);
    const durId = cleanString(row.id, 80);
    if (!durId) throw new Error('dur_id_required');
    if (seenDurIds.has(durId)) throw new Error('duplicate_dur_id');
    seenDurIds.add(durId);
  });
}

function mapDurMasterForAdmin(row) {
  const item = row || {};
  return Object.assign({}, item, {
    name: item.name_ar || item.name || '',
    days_count: item.default_days_count,
    description: item.description_ar || '',
    heritage_meaning: item.heritage_meaning_ar || '',
    notes: item.notes_ar || ''
  });
}

function mergeDurMasterAdminWithLegacy(row, legacyRows) {
  const item = mapDurMasterForAdmin(row);
  const legacy = (Array.isArray(legacyRows) ? legacyRows : []).find((entry) => {
    return cleanString(entry && entry.id, 80) === cleanString(item.id, 80)
      || (Number(entry && entry.dur_number) > 0 && Number(entry.dur_number) === Number(item.dur_number));
  }) || {};
  return Object.assign({}, item, {
    gregorian_start_month: legacy.gregorian_start_month != null ? legacy.gregorian_start_month : (item.gregorian_window_hint && item.gregorian_window_hint.start_month),
    gregorian_start_day: legacy.gregorian_start_day != null ? legacy.gregorian_start_day : (item.gregorian_window_hint && item.gregorian_window_hint.start_day),
    gregorian_end_month: legacy.gregorian_end_month != null ? legacy.gregorian_end_month : (item.gregorian_window_hint && item.gregorian_window_hint.end_month),
    gregorian_end_day: legacy.gregorian_end_day != null ? legacy.gregorian_end_day : (item.gregorian_window_hint && item.gregorian_window_hint.end_day)
  });
}

function normalizeTraitDictionaryInput(input, existing) {
  const base = existing || {};
  return {
    id: cleanString(base.id || input.id || createId('trait'), 80),
    category: cleanString(input.category != null ? input.category : base.category, 120),
    name_ar: cleanString(input.name_ar != null ? input.name_ar : base.name_ar, 120),
    name_en: cleanString(input.name_en != null ? input.name_en : base.name_en, 120),
    description_ar: cleanString(input.description_ar != null ? input.description_ar : base.description_ar, 800),
    description_en: cleanString(input.description_en != null ? input.description_en : base.description_en, 800),
    severity_hint: input.severity_hint != null ? cleanString(input.severity_hint, 60) : (base.severity_hint != null ? cleanString(base.severity_hint, 60) : null),
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true)
  };
}

function normalizeFishSeasonTagInput(input, existing) {
  const base = existing || {};
  return {
    id: cleanString(base.id || input.id || createId('fish_tag'), 80),
    name_ar: cleanString(input.name_ar != null ? input.name_ar : base.name_ar, 120),
    name_en: cleanString(input.name_en != null ? input.name_en : base.name_en, 120),
    category: cleanString(input.category != null ? input.category : base.category, 120),
    description_ar: cleanString(input.description_ar != null ? input.description_ar : base.description_ar, 800),
    description_en: cleanString(input.description_en != null ? input.description_en : base.description_en, 800),
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true)
  };
}

function normalizeAdviceBasisTagInput(input, existing) {
  const base = existing || {};
  return {
    id: cleanString(base.id || input.id || createId('advice_basis'), 80),
    category: cleanString(input.category != null ? input.category : base.category, 120),
    name_ar: cleanString(input.name_ar != null ? input.name_ar : base.name_ar, 120),
    name_en: cleanString(input.name_en != null ? input.name_en : base.name_en, 120),
    description_ar: cleanString(input.description_ar != null ? input.description_ar : base.description_ar, 800),
    description_en: cleanString(input.description_en != null ? input.description_en : base.description_en, 800),
    priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : Number(base.priority) || 1,
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true)
  };
}

function normalizeStationDurProfileInput(input, existing) {
  const base = existing || {};
  return {
    id: cleanString(base.id || input.id || createId('profile'), 80),
    station_id: cleanString(input.station_id != null ? input.station_id : base.station_id, 80),
    station_role_type: cleanString(input.station_role_type != null ? input.station_role_type : base.station_role_type, 120),
    reference_station_id: cleanString(input.reference_station_id != null ? input.reference_station_id : base.reference_station_id, 80),
    dur_id: cleanString(input.dur_id != null ? input.dur_id : base.dur_id, 80),
    dur_number: Number.isFinite(Number(input.dur_number)) ? Number(input.dur_number) : Number(base.dur_number) || 0,
    dur_start_month: Number.isFinite(Number(input.dur_start_month)) ? Number(input.dur_start_month) : Number(base.dur_start_month) || 1,
    dur_start_day: Number.isFinite(Number(input.dur_start_day)) ? Number(input.dur_start_day) : Number(base.dur_start_day) || 1,
    dur_days_count: Number.isFinite(Number(input.dur_days_count)) ? Number(input.dur_days_count) : Number(base.dur_days_count) || 0,
    traits_general: Array.isArray(input.traits_general) ? input.traits_general.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.traits_general) ? base.traits_general : []),
    traits_weather: Array.isArray(input.traits_weather) ? input.traits_weather.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.traits_weather) ? base.traits_weather : []),
    traits_marine: Array.isArray(input.traits_marine) ? input.traits_marine.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.traits_marine) ? base.traits_marine : []),
    traits_fish: Array.isArray(input.traits_fish) ? input.traits_fish.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.traits_fish) ? base.traits_fish : []),
    traits_fish_season: Array.isArray(input.traits_fish_season) ? input.traits_fish_season.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.traits_fish_season) ? base.traits_fish_season : []),
    traits_heritage: Array.isArray(input.traits_heritage) ? input.traits_heritage.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.traits_heritage) ? base.traits_heritage : []),
    traits_seasonal_transition_traits: Array.isArray(input.traits_seasonal_transition_traits) ? input.traits_seasonal_transition_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.traits_seasonal_transition_traits) ? base.traits_seasonal_transition_traits : []),
    advice_tags: Array.isArray(input.advice_tags) ? input.advice_tags.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.advice_tags) ? base.advice_tags : []),
    notes_local: cleanString(input.notes_local != null ? input.notes_local : base.notes_local, 1200),
    notes_expert: cleanString(input.notes_expert != null ? input.notes_expert : base.notes_expert, 1200),
    notes_interpretation: cleanString(input.notes_interpretation != null ? input.notes_interpretation : base.notes_interpretation, 1200),
    notes_correction: cleanString(input.notes_correction != null ? input.notes_correction : base.notes_correction, 1200),
    local_definition: cleanString(input.local_definition != null ? input.local_definition : base.local_definition, 1200),
    expert_summary: cleanString(input.expert_summary != null ? input.expert_summary : base.expert_summary, 1200),
    notes: cleanString(input.notes != null ? input.notes : base.notes, 1200),
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true),
    updated_at: nowIso(),
    updated_by: cleanString(input.updated_by != null ? input.updated_by : base.updated_by, 120)
  };
}

function normalizeDururReferenceInput(input, existing) {
  const base = existing || {};
  return {
    id: cleanString(base.id || input.id || createId('durref'), 80),
    dur_number: Number.isFinite(Number(input.dur_number)) ? Number(input.dur_number) : Number(base.dur_number) || 0,
    name_ar: cleanString(input.name_ar != null ? input.name_ar : base.name_ar, 120),
    season_ar: cleanString(input.season_ar != null ? input.season_ar : base.season_ar, 120),
    zodiac_ar: cleanString(input.zodiac_ar != null ? input.zodiac_ar : base.zodiac_ar, 120),
    description: cleanString(input.description != null ? input.description : base.description, 800),
    heritage_meaning: cleanString(input.heritage_meaning != null ? input.heritage_meaning : base.heritage_meaning, 800),
    weather_traits: Array.isArray(input.weather_traits) ? input.weather_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.weather_traits) ? base.weather_traits : []),
    marine_traits: Array.isArray(input.marine_traits) ? input.marine_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.marine_traits) ? base.marine_traits : []),
    fish_traits: Array.isArray(input.fish_traits) ? input.fish_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.fish_traits) ? base.fish_traits : []),
    general_traits: Array.isArray(input.general_traits) ? input.general_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.general_traits) ? base.general_traits : []),
    related_events: Array.isArray(input.related_events) ? input.related_events.map((v) => cleanString(v, 80)).filter(Boolean) : (Array.isArray(base.related_events) ? base.related_events : []),
    review_status: cleanString(input.review_status != null ? input.review_status : base.review_status || 'draft', 60),
    notes: cleanString(input.notes != null ? input.notes : base.notes, 800),
    needs_expert_review: input.needs_expert_review != null ? !!input.needs_expert_review : !!base.needs_expert_review,
    local_override_ready: input.local_override_ready != null ? !!input.local_override_ready : !!base.local_override_ready,
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true),
    created_at: base.created_at || nowIso(),
    updated_at: nowIso(),
    reviewed_at: input.reviewed_at != null ? cleanString(input.reviewed_at, 40) : base.reviewed_at || null,
    approved_at: input.approved_at != null ? cleanString(input.approved_at, 40) : base.approved_at || null
  };
}

function normalizeStationDurOverrideInput(input, existing) {
  const base = existing || {};
  return {
    id: cleanString(base.id || input.id || createId('override'), 80),
    station_id: cleanString(input.station_id != null ? input.station_id : base.station_id, 80),
    dur_id: cleanString(input.dur_id != null ? input.dur_id : base.dur_id, 80),
    dur_number: Number.isFinite(Number(input.dur_number)) ? Number(input.dur_number) : Number(base.dur_number) || 0,
    season_key: cleanString(input.season_key != null ? input.season_key : base.season_key, 60),
    start_offset_days: Number.isFinite(Number(input.start_offset_days)) ? Number(input.start_offset_days) : Number(base.start_offset_days) || 0,
    end_offset_days: Number.isFinite(Number(input.end_offset_days)) ? Number(input.end_offset_days) : Number(base.end_offset_days) || 0,
    weather_traits: Array.isArray(input.weather_traits) ? input.weather_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.weather_traits) ? base.weather_traits : []),
    marine_traits: Array.isArray(input.marine_traits) ? input.marine_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.marine_traits) ? base.marine_traits : []),
    seasonal_traits: Array.isArray(input.seasonal_traits) ? input.seasonal_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.seasonal_traits) ? base.seasonal_traits : []),
    season_event_ids: Array.isArray(input.season_event_ids) ? input.season_event_ids.map((v) => cleanString(v, 80)).filter(Boolean) : (Array.isArray(base.season_event_ids) ? base.season_event_ids : []),
    fish_traits: Array.isArray(input.fish_traits) ? input.fish_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.fish_traits) ? base.fish_traits : []),
    advice_text: cleanString(input.advice_text != null ? input.advice_text : base.advice_text, 1200),
    advice_tags: Array.isArray(input.advice_tags) ? input.advice_tags.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.advice_tags) ? base.advice_tags : []),
    local_notes: cleanString(input.local_notes != null ? input.local_notes : base.local_notes, 800),
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true),
    updated_at: nowIso(),
    updated_by: cleanString(input.updated_by != null ? input.updated_by : base.updated_by, 120)
  };
}

function normalizeAnnualComparisonInput(input, existing) {
  const base = existing || {};
  return {
    id: cleanString(base.id || input.id || createId('comparison'), 80),
    year: Number.isFinite(Number(input.year)) ? Number(input.year) : Number(base.year) || new Date().getFullYear(),
    station_id: cleanString(input.station_id != null ? input.station_id : base.station_id, 80),
    dur_id: cleanString(input.dur_id != null ? input.dur_id : base.dur_id, 80),
    expected_traits: Array.isArray(input.expected_traits) ? input.expected_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.expected_traits) ? base.expected_traits : []),
    observed_traits: Array.isArray(input.observed_traits) ? input.observed_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.observed_traits) ? base.observed_traits : []),
    match_score: Number.isFinite(Number(input.match_score)) ? Number(input.match_score) : Number(base.match_score) || 0,
    summary: cleanString(input.summary != null ? input.summary : base.summary, 800),
    notes: cleanString(input.notes != null ? input.notes : base.notes, 800),
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true),
    created_at: base.created_at || nowIso(),
    updated_at: nowIso()
  };
}

function sanitizeCollectionItem(root, item, existing) {
  if (root === 'durur') return normalizeDururInput(item, existing);
  if (root === 'durur-reference') return normalizeDururReferenceInput(item, existing);
  if (root === 'season-events') return normalizeSeasonEventInput(item, existing);
  if (root === 'station-dur-profiles') return normalizeStationDurProfileInput(item, existing);
  if (root === 'station-dur-overrides') return normalizeStationDurOverrideInput(item, existing);
  if (root === 'annual-comparisons') return normalizeAnnualComparisonInput(item, existing);
  if (root === 'durur-master') return normalizeDururMasterInput(item, existing);
  if (root === 'trait-dictionaries') return normalizeTraitDictionaryInput(item, existing);
  if (root === 'fish-season-tags') return normalizeFishSeasonTagInput(item, existing);
  if (root === 'advice-basis-tags') return normalizeAdviceBasisTagInput(item, existing);
  return item;
}

async function readCollection(root) {
  const key = getCollectionKey(root);
  if (!key) return null;
  const data = await readJsonFile(key, []);
  if (key === 'durur_reference_seed') {
    if (data && Array.isArray(data.durur_master)) return data.durur_master;
    return [];
  }
  return data;
}

async function writeCollection(root, rows) {
  const key = getCollectionKey(root);
  if (!key) return null;
  if (key === 'durur_reference_seed') {
    const existing = await readJsonFile(key, { metadata: {}, zodiac_seasons: {}, season_events: [], general_traits: [], durur_order: [], durur_master: [] });
    const next = Object.assign({}, existing, { durur_master: rows });
    await writeJsonFile(key, next);
    return;
  }
  await writeJsonFile(key, rows);
}

async function readDurMasterRows() {
  const rows = await readJsonFile('durur_master', []);
  const out = Array.isArray(rows) ? rows : [];
  validateDurMasterCollection(out);
  return out;
}

function removeTraitCalibrationEntryByName(arr, traitName) {
  return (Array.isArray(arr) ? arr : []).filter(function (e) {
    return cleanString(e && e.trait_name, 120) !== traitName;
  });
}

async function applyTraitCalibrationAction(actor, body) {
  const action = cleanString(body.action, 20);
  const traitName = cleanString(body.trait_name, 120);
  if (!traitName) {
    const err = new Error('trait_name_required');
    err.code = 400;
    throw err;
  }
  const evidence = Number(body.evidence_count) || 0;
  const durNameAr = cleanString(body.dur_name_ar, 120);
  const phaseId = cleanString(body.phase_id, 120);
  const depthMode = cleanString(body.depth_mode, 20) || 'coastal';
  const refId = cleanString(body.reference_station_id, 80);
  if (!refId || !durNameAr) {
    const err = new Error('reference_station_and_dur_required');
    err.code = 400;
    throw err;
  }
  const opId = cleanString(body.operational_station_id, 80);
  if (action === 'confirm' && evidence < 3) {
    const err = new Error('confirm_requires_evidence_3');
    err.code = 400;
    throw err;
  }
  const refNameAr = cleanString(body.reference_station_name_ar, 200);
  const key = traitCalibrationLib.buildTraitCalibrationScopeKey({
    reference_station_id: refId,
    dur_name_ar: durNameAr,
    phase_id: phaseId,
    depth_mode: depthMode
  });
  const doc = await readJsonFile('trait_calibration', { version: 1, scopes: {} });
  doc.version = 1;
  doc.scopes = doc.scopes && typeof doc.scopes === 'object' ? doc.scopes : {};
  const nowIso = new Date().toISOString();
  var entry = doc.scopes[key];
  if (!entry) {
    entry = {
      reference_station_id: refId,
      reference_station_name_ar: refNameAr,
      dur_name_ar: durNameAr,
      phase_id: phaseId,
      depth_mode: depthMode,
      confirmed_traits: [],
      excluded_traits: [],
      review_traits: [],
      updated_at: nowIso
    };
    doc.scopes[key] = entry;
  }
  entry.reference_station_id = refId;
  entry.reference_station_name_ar = refNameAr || entry.reference_station_name_ar;
  entry.dur_name_ar = durNameAr;
  entry.phase_id = phaseId;
  entry.depth_mode = depthMode;
  entry.confirmed_traits = removeTraitCalibrationEntryByName(entry.confirmed_traits, traitName);
  entry.excluded_traits = removeTraitCalibrationEntryByName(entry.excluded_traits, traitName);
  entry.review_traits = removeTraitCalibrationEntryByName(entry.review_traits, traitName);
  const srcHint = cleanString(body.source, 40);
  const bodyFirst = cleanString(body.first_seen_at, 50);
  const bodyLast = cleanString(body.last_seen_at, 50);
  const firstSeen = bodyFirst || nowIso;
  const lastSeen = bodyLast || bodyFirst || nowIso;
  if (action === 'confirm') {
    entry.confirmed_traits.push({
      trait_name: traitName,
      source: 'observed_extra',
      evidence_count: evidence,
      first_seen_at: firstSeen,
      last_seen_at: lastSeen,
      status: 'confirmed'
    });
  } else if (action === 'exclude') {
    entry.excluded_traits.push({
      trait_name: traitName,
      source: 'predicted_failed',
      evidence_count: evidence,
      first_seen_at: firstSeen,
      last_seen_at: lastSeen,
      status: 'excluded'
    });
  } else if (action === 'review') {
    entry.review_traits.push({
      trait_name: traitName,
      source: srcHint === 'extra' ? 'extra' : 'failed',
      evidence_count: Math.max(1, evidence),
      first_seen_at: firstSeen,
      last_seen_at: lastSeen,
      status: 'review'
    });
  } else {
    const err = new Error('invalid_action');
    err.code = 400;
    throw err;
  }
  entry.updated_at = nowIso;
  await writeJsonFile('trait_calibration', doc);
  await writeAudit('trait_calibration_' + action, actor, {
    scope_key: key,
    trait_name: traitName,
    evidence_count: evidence,
    operational_station_id: opId || null
  });
  try {
    if (typeof console !== 'undefined' && console && typeof console.debug === 'function') {
      console.debug('NAVIDUR_TRAIT_REVIEW_ACTION', {
        action: action,
        reference_station_id: entry.reference_station_id,
        reference_station_name_ar: entry.reference_station_name_ar,
        operational_station_id: cleanString(body.operational_station_id, 80) || undefined,
        dur_name_ar: entry.dur_name_ar,
        phase_id: entry.phase_id,
        depth_mode: entry.depth_mode,
        trait_name: traitName,
        evidence_count: evidence
      });
      console.debug('NAVIDUR_TRAIT_CALIBRATION_APPLIED', {
        reference_station_id: entry.reference_station_id,
        reference_station_name_ar: entry.reference_station_name_ar,
        dur_name_ar: entry.dur_name_ar,
        phase_id: entry.phase_id,
        depth_mode: entry.depth_mode,
        confirmed_traits: entry.confirmed_traits,
        excluded_traits: entry.excluded_traits,
        review_traits: entry.review_traits
      });
    }
  } catch (_logE) { /* ignore */ }
  return { ok: true, scope_key: key, entry: entry };
}

async function applyTraitLearningSupervisor(actor, body) {
  const action = cleanString(body.action, 20);
  const traitName = cleanString(body.trait_name, 120);
  const refId = cleanString(body.reference_station_id, 80);
  const durNameAr = cleanString(body.dur_name_ar, 120);
  const phaseId = cleanString(body.phase_id, 120);
  const depthMode = cleanString(body.depth_mode, 20) || 'coastal';
  if (!traitName || !refId || !durNameAr) {
    const err = new Error('trait_learning_scope_required');
    err.code = 400;
    throw err;
  }
  const key = traitCalibrationLib.buildTraitCalibrationScopeKey({
    reference_station_id: refId,
    dur_name_ar: durNameAr,
    phase_id: phaseId,
    depth_mode: depthMode
  });
  const cyclesDoc = await readJsonFile('trait_cycles', { version: 1, scopes: {} });
  cyclesDoc.scopes = cyclesDoc.scopes && typeof cyclesDoc.scopes === 'object' ? cyclesDoc.scopes : {};
  const scope = cyclesDoc.scopes[key];
  const row = scope && scope.traits ? scope.traits[traitName] : null;
  if (!row) {
    const err = new Error('trait_cycle_not_found');
    err.code = 400;
    throw err;
  }
  const refNameAr = cleanString(body.reference_station_name_ar, 200);
  const seasonalCycles = traitLongTermLib.yearCycleCountForSupervisor(row);
  if ((action === 'confirm' || action === 'exclude') && seasonalCycles < 3) {
    const err = new Error('لا يمكن اتخاذ قرار قبل 3 دورات موسمية');
    err.code = 400;
    throw err;
  }
  if (action === 'confirm') {
    if (String(row.status) === 'stage_3_confirmed_candidate') {
      row.supervisor_hold = false;
      await applyTraitCalibrationAction(actor, {
        action: 'confirm',
        reference_station_id: refId,
        reference_station_name_ar: refNameAr,
        dur_name_ar: durNameAr,
        phase_id: phaseId,
        depth_mode: depthMode,
        trait_name: traitName,
        evidence_count: 3,
        source: 'extra',
        first_seen_at: row.last_event_at,
        last_seen_at: row.last_event_at
      });
      row.status = 'confirmed';
    } else if (String(row.status) === 'exclusion_candidate') {
      row.supervisor_hold = false;
      await applyTraitCalibrationAction(actor, {
        action: 'exclude',
        reference_station_id: refId,
        reference_station_name_ar: refNameAr,
        dur_name_ar: durNameAr,
        phase_id: phaseId,
        depth_mode: depthMode,
        trait_name: traitName,
        evidence_count: Math.max(3, Number(row.failed_events) || 3),
        source: 'failed',
        first_seen_at: row.last_event_at,
        last_seen_at: row.last_event_at
      });
      row.status = 'excluded';
    } else {
      const err = new Error('trait_not_ready_for_supervisor_confirm');
      err.code = 400;
      throw err;
    }
  } else if (action === 'exclude') {
    row.supervisor_hold = false;
    await applyTraitCalibrationAction(actor, {
      action: 'exclude',
      reference_station_id: refId,
      reference_station_name_ar: refNameAr,
      dur_name_ar: durNameAr,
      phase_id: phaseId,
      depth_mode: depthMode,
      trait_name: traitName,
      evidence_count: Math.max(1, Number(row.failed_events) || 1),
      source: 'failed'
    });
    row.status = 'excluded';
  } else if (action === 'review') {
    row.supervisor_hold = true;
    if (String(row.status) !== 'confirmed' && String(row.status) !== 'excluded') {
      row.status = 'stage_1_review';
    }
  } else {
    const err = new Error('invalid_action');
    err.code = 400;
    throw err;
  }
  scope.traits[traitName] = row;
  scope.updated_at = new Date().toISOString();
  cyclesDoc.scopes[key] = scope;
  await writeJsonFile('trait_cycles', cyclesDoc);
  await writeAudit('trait_learning_supervisor_' + action, actor, { scope_key: key, trait_name: traitName });
  return { ok: true, scope_key: key, trait_name: traitName, status: row.status };
}

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });

  const actor = await requireRole('admin')(req, res);
  if (!actor) return;

  const segments = getPathSegments(req);
  const [root, id, action] = segments;

  /** Read-only: full station list as stored (KV when configured, else data/stations.json). */
  if (root === 'export-stations-kv') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    if (id) {
      return res.status(404).json({ error: 'admin_route_not_found' });
    }
    const rows = await readJsonFile('stations', []);
    const list = Array.isArray(rows) ? rows : [];
    const dataSource = getKv() ? 'upstash_kv' : 'local_data_file';
    var mapped = 0;
    var si;
    for (si = 0; si < list.length; si += 1) {
      const s = list[si];
      if (s && (String(s.workbook_city_name || '').trim() || String(s.workbook_city_key || '').trim())) {
        mapped += 1;
      }
    }
    const stations = list.map(function (s) {
      if (!s) return null;
      return {
        id: s.id,
        name: s.name,
        lat: s.lat != null ? s.lat : null,
        lon: s.lon != null ? s.lon : s.lng != null ? s.lng : null,
        is_operational: s.is_operational_station == null ? null : !!s.is_operational_station,
        is_reference_station: !!s.is_reference_station,
        workbook_city_name: s.workbook_city_name != null && String(s.workbook_city_name).trim() !== '' ? s.workbook_city_name : null,
        workbook_city_key: s.workbook_city_key != null && String(s.workbook_city_key).trim() !== '' ? s.workbook_city_key : null,
        workbook_match_mode: s.workbook_match_mode != null ? s.workbook_match_mode : null,
        workbook_assignment_status: s.workbook_assignment_status != null ? s.workbook_assignment_status : null,
        manual_suhail_anchor_date: s.manual_suhail_anchor_date != null ? s.manual_suhail_anchor_date : null,
        suhail_anchor_resolution: s.suhail_anchor_resolution != null ? s.suhail_anchor_resolution : null
      };
    }).filter(Boolean);
    await writeAudit('export_stations_kv_read', actor, {
      total: list.length,
      mapped,
      unmapped: list.length - mapped,
      data_source: dataSource
    });
    return res.status(200).json({
      ok: true,
      path: 'export-stations-kv',
      data_source: dataSource,
      total_stations: list.length,
      mapped_stations: mapped,
      unmapped_stations: list.length - mapped,
      stations: stations
    });
  }

  /** Read-only: station health (Open-Meteo probe) + reference linkage; no station or cache writes. */
  if (root === 'station-health-report') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    if (id) {
      return res.status(404).json({ error: 'admin_route_not_found' });
    }
    const { buildStationHealthReport } = require('../_lib/station-health-report');
    const report = await buildStationHealthReport();
    return res.status(200).json(
      Object.assign({ ok: true, path: 'station-health-report' }, report)
    );
  }

  if (root === 'reference-link-audit') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    if (id) {
      return res.status(404).json({ error: 'admin_route_not_found' });
    }
    const { buildReferenceLinkAudit } = require('../_lib/reference-link-audit');
    const report = await buildReferenceLinkAudit();
    return res.status(200).json(Object.assign({ ok: true, path: 'reference-link-audit' }, report));
  }

  if (root === 'weather-fetch-audit') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    if (id) {
      return res.status(404).json({ error: 'admin_route_not_found' });
    }
    const { buildWeatherFetchAudit } = require('../_lib/weather-fetch-audit');
    const report = await buildWeatherFetchAudit();
    return res.status(200).json(Object.assign({ ok: true, path: 'weather-fetch-audit' }, report));
  }

  /**
   * Read-only: single-station DUR reference resolution (store → public shape → merge → resolver).
   * GET /api?route=admin&path=debug-reference-resolution&station_id=...
   */
  if (root === 'debug-reference-resolution') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    if (id) {
      return res.status(404).json({ error: 'admin_route_not_found' });
    }
    const stationId = cleanString(req.query && req.query.station_id, 80);
    if (!stationId) {
      return res.status(400).json({ error: 'station_id_required' });
    }
    const { normalizeRequestedStation, loadReferenceData } = require('../_lib/navidur-analysis-runtime');
    const { resolveReferenceStationForDurInheritance } = require('../../shared/navidur-analysis-engine');
    const refData = await loadReferenceData();
    const list = Array.isArray(refData.stations) ? refData.stations : [];
    const stationFromStore = list.find((s) => s && String(s.id).trim() === stationId) || null;

    function isPublicOperationalStation(s) {
      if (!s) return false;
      if (s.status === 'archived' || s.status === 'disabled') return false;
      if (s.is_reference_station) return false;
      if (s.is_operational_station === false) return false;
      if (s.operational_visibility === false) return false;
      return true;
    }

    const publicRow = stationFromStore && isPublicOperationalStation(stationFromStore) ? stationFromStore : null;
    const stationFromPublicShape = publicRow
      ? (function mapPublicShape(st) {
          const o = {
            id: st.id,
            name: st.name,
            country: st.country,
            lat: Number(st.lat),
            lng: st.lon != null ? Number(st.lon) : (st.lng != null ? Number(st.lng) : null),
            is_reference_station: st.is_reference_station === true
          };
          if (st.reference_station_id != null && String(st.reference_station_id).trim() !== '') {
            o.reference_station_id = String(st.reference_station_id);
          }
          return o;
        })(publicRow)
      : null;

    const preFixLegacyClient = publicRow
      ? {
          id: publicRow.id,
          reference_station_id: publicRow.reference_station_id != null ? String(publicRow.reference_station_id) : ''
        }
      : null;

    const body = { station: stationFromPublicShape || { id: stationId }, station_id: stationId };
    const mergedAnalysisStation = normalizeRequestedStation(body, list);
    const durNameSet = tfLookup.buildTrueFinalStationNameNormSet(refData.true_final_station_reference || { stations: [] });
    const durResolution = resolveReferenceStationForDurInheritance(mergedAnalysisStation, list, durNameSet);
    const durSource = durResolution && durResolution.source;
    const method = durResolution && durResolution.method;
    const refSourceTag = (function mapMethod(m) {
      if (m === 'manual') return 'manual';
      if (m === 'self') return 'self';
      if (m === 'same_band') return 'latitude_band';
      if (m === 'nearest') return 'nearest';
      return m ? String(m) : 'unknown';
    })(method);

    return res.status(200).json({
      ok: true,
      path: 'debug-reference-resolution',
      station_id: stationId,
      station_from_store: stationFromStore,
      station_from_public_shape: stationFromPublicShape,
      legacy_client_reference_station_id_empty_string: preFixLegacyClient,
      merged_analysis_station: mergedAnalysisStation,
      resolver_result: {
        reference_resolution_source: refSourceTag,
        dur_source_station_id: durSource ? String(durSource.id) : null,
        dur_source_station_name: durSource ? String(durSource.name) : null,
        resolution_method: method || null,
        error: durResolution && durResolution.error ? String(durResolution.error) : null
      },
      final_dur_source: durSource ? { id: durSource.id, name: durSource.name, is_reference_station: !!durSource.is_reference_station } : null,
      fallback_attempted: method === 'nearest' || method === 'same_band',
      weather_coordinates_used: {
        lat: mergedAnalysisStation.lat,
        lon: mergedAnalysisStation.lon
      }
    });
  }

  if (root === 'station-reference-link') {
    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'PATCH');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    if (id) {
      return res.status(404).json({ error: 'admin_route_not_found' });
    }
    const body = parseBody(req);
    const opId = cleanString(body && body.station_id, 80);
    const refId = cleanString(body && body.reference_station_id, 80);
    if (!opId || !refId) {
      return res.status(400).json({ error: 'station_id_and_reference_station_id_required' });
    }
    const rows = await readJsonFile('stations', []);
    const list = Array.isArray(rows) ? rows : [];
    const opIdx = list.findIndex((s) => s && String(s.id) === opId);
    if (opIdx < 0) return res.status(404).json({ error: 'station_not_found' });
    const op = list[opIdx];
    if (op.is_reference_station) {
      return res.status(400).json({ error: 'station_must_be_operational' });
    }
    const refIdx = list.findIndex((s) => s && String(s.id) === refId);
    if (refIdx < 0) return res.status(404).json({ error: 'reference_station_not_found' });
    const refSt = list[refIdx];
    if (!refSt.is_reference_station) {
      return res.status(400).json({ error: 'target_must_be_reference_station' });
    }
    const refNameAr = cleanString(refSt.name_ar || refSt.name, 120);
    const next = normalizeStationInput(
      Object.assign({}, op, {
        reference_station_id: refId,
        reference_station_name_ar: refNameAr,
        dur_reference_station: refId,
        id: op.id
      }),
      op
    );
    list[opIdx] = next;
    await writeJsonFile('stations', list);
    await writeAudit('station_reference_link_set', actor, {
      station_id: opId,
      reference_station_id: refId
    });
    return res.status(200).json({
      ok: true,
      station_id: opId,
      reference_station_id: refId,
      reference_station_name: refSt.name,
      reference_station_name_ar: refNameAr,
      dur_reference_station: refId
    });
  }

  if (root === 'sync-dur-windows-kv') {
    return res.status(410).json({ ok: false, error: 'dur_windows_sync_removed', message: 'NAVIDUR uses data/true_final_station_reference.json only' });
  }

  if (root === 'feedback') {
    if (req.method === 'GET') {
      const station = cleanString(req.query && req.query.station, 100);
      const userId = cleanString(req.query && req.query.user_id, 80);
      const date = cleanString(req.query && req.query.date, 20);
      const rows = await readJsonFile('feedback', []);
      const filtered = rows.filter((r) => {
        if (r.archived) return false;
        if (station && String(r.station || '') !== station) return false;
        if (userId && String(r.user_id || '') !== userId) return false;
        if (date && String(r.timestamp || '').slice(0, 10) !== date) return false;
        return true;
      });
      return res.status(200).json({ ok: true, total: filtered.length, feedback: filtered });
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const feedbackId = cleanString(body.id, 80);
      if (!feedbackId) return res.status(400).json({ error: 'feedback_id_required' });
      const rows = await readJsonFile('feedback', []);
      const idx = rows.findIndex((x) => x.id === feedbackId);
      if (idx < 0) return res.status(404).json({ error: 'feedback_not_found' });
      if (body.action === 'archive') {
        rows[idx].archived = true;
        rows[idx].updated_at = nowIso();
        await writeJsonFile('feedback', rows);
        await writeAudit('feedback_archived', actor, { feedback_id: feedbackId });
        return res.status(200).json({ ok: true, feedback: rows[idx] });
      }
      return res.status(400).json({ error: 'invalid_action' });
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (root === 'true-final-reference') {
    if (id) {
      return res.status(404).json({ error: 'admin_route_not_found' });
    }
    const defaultDoc = { version: 0, reference_mode: '', stations: [] };
    if (req.method === 'GET') {
      const doc = await readJsonFile('true_final_station_reference', defaultDoc);
      return res.status(200).json({ ok: true, document: doc });
    }
    if (req.method === 'PATCH') {
      if (!getKv()) {
        return res.status(503).json({
          ok: false,
          error: 'kv_required_for_annual_flat_manual_patch',
          message:
            'Updating annual_flat_rows requires KV (navidur_store_true_final_station_reference). Configure KV_REST_API_URL and KV_REST_API_TOKEN.'
        });
      }
      const body = parseBody(req);
      const stationNameAr = cleanString(body.station_name_ar, 200);
      let asOfIso = cleanString(body.as_of_iso, 20);
      const rawCur = body.current_dur_name_ar;
      const rawNext = body.next_dur_name_ar;
      if (!stationNameAr) {
        return res.status(400).json({ error: 'station_name_ar_required' });
      }
      if (!asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) {
        asOfIso = utcTodayIso();
      }
      const allow = buildManualDurNameAllowSet();
      const canonCur = canonicalManualDurName(rawCur, allow);
      const canonNext = canonicalManualDurName(rawNext, allow);
      if (!canonCur) {
        return res.status(400).json({ error: 'invalid_current_dur_name_ar' });
      }
      if (!canonNext) {
        return res.status(400).json({ error: 'invalid_next_dur_name_ar' });
      }
      const doc = await readJsonFile('true_final_station_reference', defaultDoc);
      const annual = Array.isArray(doc.annual_flat_rows) ? doc.annual_flat_rows : [];
      if (!annual.length) {
        return res.status(400).json({ error: 'annual_flat_rows_missing' });
      }
      const loc = findAnnualFlatCurrentNextGlobalIndices(doc, stationNameAr, asOfIso);
      if (loc.error) {
        const code =
          loc.error === 'station_not_in_annual'
            ? 404
            : loc.error === 'no_window_for_date'
              ? 400
              : 400;
        return res.status(code).json({ ok: false, error: loc.error, detail: loc });
      }
      const curG = loc.currentGlobalIdx;
      const nextG = loc.nextGlobalIdx;
      if (curG === nextG && nfcStringAr(canonCur) !== nfcStringAr(canonNext)) {
        return res.status(400).json({
          ok: false,
          error: 'current_next_same_annual_row',
          message: 'النافذة الحالية والتالية تشيران لنفس الصف في annual_flat_rows — يجب أن يتطابق اسم الدر في الحقلين.'
        });
      }
      const curRow = doc.annual_flat_rows[curG];
      const nextRow = doc.annual_flat_rows[nextG];
      if (!curRow || !nextRow) {
        return res.status(500).json({ error: 'annual_flat_index_corrupt' });
      }
      const beforeCurrent = String(curRow.dur_name_ar != null ? curRow.dur_name_ar : '').trim();
      const beforeNext = String(nextRow.dur_name_ar != null ? nextRow.dur_name_ar : '').trim();
      let changed = false;
      if (nfcStringAr(beforeCurrent) !== nfcStringAr(canonCur)) {
        doc.annual_flat_rows[curG] = { ...curRow, dur_name_ar: canonCur };
        changed = true;
      }
      if (nfcStringAr(beforeNext) !== nfcStringAr(canonNext)) {
        doc.annual_flat_rows[nextG] = { ...nextRow, dur_name_ar: canonNext };
        changed = true;
      }
      if (!changed) {
        return res.status(200).json({
          ok: true,
          unchanged: true,
          station_name_ar: stationNameAr,
          current_dur_before: beforeCurrent,
          current_dur_after: beforeCurrent,
          next_dur_before: beforeNext,
          next_dur_after: beforeNext,
          indices: { current: curG, next: nextG }
        });
      }
      doc._manual_annual_flat_edited_at = nowIso();
      await writeJsonFile('true_final_station_reference', doc);
      await writeAudit('true_final_annual_flat_dur_patched', actor, {
        station_name_ar: stationNameAr,
        current_global_index: curG,
        next_global_index: nextG,
        current_dur_before: beforeCurrent,
        current_dur_after: canonCur,
        next_dur_before: beforeNext,
        next_dur_after: canonNext,
        kv_key: kvStoreKey('true_final_station_reference')
      });
      return res.status(200).json({
        ok: true,
        station_name_ar: stationNameAr,
        current_dur_before: beforeCurrent,
        current_dur_after: String(doc.annual_flat_rows[curG].dur_name_ar != null ? doc.annual_flat_rows[curG].dur_name_ar : ''),
        next_dur_before: beforeNext,
        next_dur_after: String(doc.annual_flat_rows[nextG].dur_name_ar != null ? doc.annual_flat_rows[nextG].dur_name_ar : ''),
        indices: { current: curG, next: nextG }
      });
    }
    if (req.method === 'PUT') {
      const body = parseBody(req);
      const stationId = cleanString(body.station_id, 80);
      const stationNameAr = cleanString(body.station_name_ar, 200);
      if (!stationId && !stationNameAr) {
        return res.status(400).json({ error: 'station_id_or_name_required' });
      }
      const doc = await readJsonFile('true_final_station_reference', defaultDoc);
      const list = Array.isArray(doc.stations) ? doc.stations : [];
      let idx = -1;
      if (stationId) {
        idx = list.findIndex((r) => r && String(r.station_id || '') === String(stationId));
      }
      if (idx < 0 && stationNameAr) {
        const w = nfcStringAr(stationNameAr);
        idx = list.findIndex((r) => r && nfcStringAr(r.station_name_ar) === w);
      }
      if (idx < 0) {
        return res.status(404).json({ error: 'true_final_station_not_found' });
      }
      const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
      const currentDur = cleanString(patch.current_dur_name_ar, 120);
      const nextDur = cleanString(patch.next_dur_name_ar, 120);
      const startMd = cleanString(patch.current_dur_start_md, 20);
      const endMd = cleanString(patch.current_dur_end_md, 20);
      const dayN = Number(patch.current_dur_day_sheet);
      if (!currentDur) return res.status(400).json({ error: 'current_dur_name_ar_required' });
      if (!nextDur) return res.status(400).json({ error: 'next_dur_name_ar_required' });
      if (!isValidDdMmTrueFinal(startMd)) return res.status(400).json({ error: 'invalid_current_dur_start_md' });
      if (!isValidDdMmTrueFinal(endMd)) return res.status(400).json({ error: 'invalid_current_dur_end_md' });
      if (!Number.isFinite(dayN) || dayN < 1) return res.status(400).json({ error: 'invalid_current_dur_day_sheet' });
      const next = { ...list[idx] };
      next.current_dur_name_ar = currentDur;
      next.next_dur_name_ar = nextDur;
      next.current_dur_start_md = startMd;
      next.current_dur_end_md = endMd;
      next.current_dur_day_sheet = Math.round(dayN);
      if (stationId) {
        next.station_id = stationId;
      }
      next._manual_edited_at = nowIso();
      list[idx] = next;
      doc.stations = list;
      await writeJsonFile('true_final_station_reference', doc);
      await writeAudit('true_final_reference_station_patched', actor, {
        station_id: stationId || null,
        station_name_ar: next.station_name_ar || null
      });
      return res.status(200).json({ ok: true, row: list[idx], document: doc });
    }
    res.setHeader('Allow', 'GET, PUT, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (root === 'manual-anchor') {
    if (id) {
      return res.status(404).json({ error: 'admin_route_not_found' });
    }
    const defaultMan = { version: 1, overrides: {} };
    if (req.method === 'GET') {
      const doc = await readJsonFile('manual_anchor', defaultMan);
      return res.status(200).json({ ok: true, document: doc });
    }
    if (!getKv()) {
      return res.status(503).json({
        ok: false,
        error: 'kv_required',
        message: 'manual_anchor requires KV (navidur_store_manual_anchor). Set KV_REST_API_URL and KV_REST_API_TOKEN.'
      });
    }
    if (req.method === 'PUT') {
      const body = parseBody(req);
      const stationId = cleanString(body.station_id, 80);
      const stationNameAr = cleanString(body.station_name_ar, 200);
      const cur = cleanString(body.current_dur_name_ar, 120);
      const nx = cleanString(body.next_dur_name_ar, 120);
      const startMd = cleanString(body.start_md, 20);
      const endMd = cleanString(body.end_md, 20);
      if (!stationId) {
        return res.status(400).json({ error: 'station_id_required' });
      }
      if (!cur) {
        return res.status(400).json({ error: 'current_dur_name_ar_required' });
      }
      if (!isValidDdMmTrueFinal(startMd) || !isValidDdMmTrueFinal(endMd)) {
        return res.status(400).json({ error: 'invalid_dd_mm' });
      }
      const allow = buildManualDurNameAllowSet();
      const canonCur = canonicalManualDurName(cur, allow);
      if (!canonCur) {
        return res.status(400).json({ error: 'invalid_current_dur_name_ar' });
      }
      const canonNext = nx ? canonicalManualDurName(nx, allow) : canonCur;
      if (nx && !canonNext) {
        return res.status(400).json({ error: 'invalid_next_dur_name_ar' });
      }
      let dayIdx = null;
      if (body.day_index != null && String(body.day_index).trim() !== '') {
        const d0 = Number(body.day_index);
        if (!Number.isFinite(d0) || d0 < 1) {
          return res.status(400).json({ error: 'invalid_day_index' });
        }
        dayIdx = Math.round(d0);
      }
      const doc = await readJsonFile('manual_anchor', defaultMan);
      const o = doc.overrides && typeof doc.overrides === 'object' ? { ...doc.overrides } : {};
      o[stationId] = {
        station_id: stationId,
        station_name_ar: stationNameAr || stationId,
        manual_override: true,
        current_dur_name_ar: canonCur,
        next_dur_name_ar: canonNext || canonCur,
        start_md: startMd,
        end_md: endMd,
        day_index: dayIdx,
        updated_at: nowIso()
      };
      doc.version = 1;
      doc.overrides = o;
      await writeJsonFile('manual_anchor', doc);
      await writeAudit('manual_anchor_upserted', actor, { station_id: stationId, kv_key: kvStoreKey('manual_anchor') });
      return res.status(200).json({ ok: true, record: o[stationId], document: doc });
    }
    if (req.method === 'DELETE') {
      if (!getKv()) {
        return res.status(503).json({
          ok: false,
          error: 'kv_required',
          message: 'manual_anchor requires KV (navidur_store_manual_anchor). Set KV_REST_API_URL and KV_REST_API_TOKEN.'
        });
      }
      const q = req.query || {};
      const stationId = cleanString(q.station_id, 80);
      if (!stationId) {
        return res.status(400).json({ error: 'station_id_required' });
      }
      const doc = await readJsonFile('manual_anchor', defaultMan);
      const o = doc.overrides && typeof doc.overrides === 'object' ? { ...doc.overrides } : {};
      if (!o[stationId]) {
        return res.status(404).json({ error: 'manual_anchor_not_found' });
      }
      delete o[stationId];
      doc.overrides = o;
      await writeJsonFile('manual_anchor', doc);
      await writeAudit('manual_anchor_deleted', actor, { station_id: stationId, kv_key: kvStoreKey('manual_anchor') });
      return res.status(200).json({ ok: true, document: doc });
    }
    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (root === 'stations') {
    if (!id) {
      if (req.method === 'GET') {
        const rows = await readJsonFile('stations', []);
        const out = rows.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
        return res.status(200).json({ ok: true, total: out.length, stations: out });
      }
      if (req.method === 'POST') {
        try {
          const body = parseBody(req);
          const rows = await readJsonFile('stations', []);
          const requestedId = cleanString(body.id, 80);
          const existingIdx = requestedId ? rows.findIndex((s) => s.id === requestedId) : -1;

          // Upsert by id on the root endpoint to avoid route mismatch issues on some deployments.
          if (existingIdx >= 0) {
            const station = normalizeStationInput({ ...rows[existingIdx], ...body, id: requestedId }, rows[existingIdx]);
            if (hasDuplicateStation(rows, station, requestedId)) {
              return res.status(409).json({ error: 'duplicate_station_name_coordinates' });
            }
            rows[existingIdx] = station;
            await writeJsonFile('stations', rows);
            await writeAudit('station_updated', actor, { station_id: station.id, station_name: station.name });
            return res.status(200).json({ ok: true, station });
          }

          let station = normalizeStationInput({
            ...body,
            id: requestedId || createId('st'),
            sort_order: body.sort_order != null ? body.sort_order : (rows.length + 1),
            status: body.status || 'active'
          });
          if (!station.is_reference_station) {
            if (!cleanString(station.reference_station_id, 80)) {
              const resolved = resolveAutoReferenceInheritance(station, rows);
              if (resolved) {
                station = normalizeStationInput(
                  {
                    ...station,
                    reference_station_id: resolved.id,
                    reference_inheritance: { method: resolved.method, decided_at: nowIso() }
                  },
                  station
                );
              }
            }
          }
          if (hasDuplicateStation(rows, station)) {
            return res.status(409).json({ error: 'duplicate_station_name_coordinates' });
          }
          rows.push(station);
          await writeJsonFile('stations', rows);
          await writeAudit('station_created', actor, { station_id: station.id, station_name: station.name });
          return res.status(201).json({ ok: true, station });
        } catch (err) {
          return res.status(400).json({ error: err && err.message ? err.message : 'station_create_failed' });
        }
      }
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    if (action === 'status') {
      if (req.method !== 'PATCH') {
        res.setHeader('Allow', 'PATCH');
        return res.status(405).json({ error: 'method_not_allowed' });
      }
      const body = parseBody(req);
      const nextStatus = normalizeStatus(body.status);
      const rows = await readJsonFile('stations', []);
      const idx = rows.findIndex((s) => s.id === id);
      if (idx < 0) return res.status(404).json({ error: 'station_not_found' });
      rows[idx] = { ...rows[idx], status: nextStatus, updated_at: nowIso() };
      await writeJsonFile('stations', rows);
      await writeAudit('station_status_changed', actor, { station_id: rows[idx].id, status: nextStatus });
      return res.status(200).json({ ok: true, station: rows[idx] });
    }

    const rows = await readJsonFile('stations', []);
    const idx = rows.findIndex((s) => s.id === id);
    if (idx < 0) return res.status(404).json({ error: 'station_not_found' });

    if (req.method === 'PUT') {
      try {
        const body = parseBody(req);
        const next = normalizeStationInput({ ...rows[idx], ...body, id }, rows[idx]);
        if (hasDuplicateStation(rows, next, id)) {
          return res.status(409).json({ error: 'duplicate_station_name_coordinates' });
        }
        rows[idx] = next;
        await writeJsonFile('stations', rows);
        await writeAudit('station_updated', actor, { station_id: next.id, station_name: next.name });
        return res.status(200).json({ ok: true, station: next });
      } catch (err) {
        return res.status(400).json({ error: err && err.message ? err.message : 'station_update_failed' });
      }
    }

    if (req.method === 'DELETE') {
      const deleted = rows[idx];
      rows.splice(idx, 1);
      await writeJsonFile('stations', rows);
      await writeAudit('station_deleted', actor, { station_id: deleted.id, station_name: deleted.name });
      return res.status(200).json({ ok: true, deleted: true, station_id: deleted.id });
    }

    res.setHeader('Allow', 'PUT, DELETE, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  async function handleCollection(rootName) {
    if (!rootName) return false;
    const rows = await readCollection(rootName);
    if (rows == null) return false;
    if (!id) {
      if (req.method === 'GET') {
        const filtered = rows.filter(function (item) {
          const stationId = cleanString(req.query && req.query.station_id, 80);
          const year = cleanString(req.query && req.query.year, 20);
          const durId = cleanString(req.query && req.query.dur_id, 80);
          if (stationId && String(item.station_id || item.stationId || '') !== stationId) return false;
          if (year && String(item.year || '') !== year) return false;
          if (durId && String(item.dur_id || item.durId || '') !== durId) return false;
          return true;
        });
        return res.status(200).json({ ok: true, total: filtered.length, items: filtered });
      }
      if (req.method === 'POST') {
        try {
          const body = parseBody(req);
          const requestedId = cleanString(body.id, 80);
          const existingIdx = requestedId ? rows.findIndex((item) => String(item.id) === requestedId) : -1;
          const item = sanitizeCollectionItem(rootName, body, existingIdx >= 0 ? rows[existingIdx] : null);
          if (existingIdx >= 0) {
            rows[existingIdx] = item;
            if (rootName === 'durur-master') validateDurMasterCollection(rows);
            await writeCollection(rootName, rows);
            await writeAudit(rootName + '_updated', actor, { item_id: item.id });
            return res.status(200).json({ ok: true, item });
          }
          rows.push(item);
          if (rootName === 'durur-master') validateDurMasterCollection(rows);
          await writeCollection(rootName, rows);
          await writeAudit(rootName + '_created', actor, { item_id: item.id });
          return res.status(201).json({ ok: true, item });
        } catch (err) {
          return res.status(400).json({ error: err && err.message ? err.message : 'create_failed' });
        }
      }
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    const idx = rows.findIndex(function (item) { return String(item.id) === String(id); });
    if (idx < 0) return res.status(404).json({ error: 'item_not_found' });

    if (req.method === 'PUT') {
      try {
        const body = parseBody(req);
        const updated = sanitizeCollectionItem(rootName, body, rows[idx]);
        rows[idx] = updated;
        if (rootName === 'durur-master') validateDurMasterCollection(rows);
        await writeCollection(rootName, rows);
        await writeAudit(rootName + '_updated', actor, { item_id: updated.id });
        return res.status(200).json({ ok: true, item: updated });
      } catch (err) {
        return res.status(400).json({ error: err && err.message ? err.message : 'update_failed' });
      }
    }

    if (req.method === 'DELETE') {
      const deleted = rows.splice(idx, 1)[0];
      await writeCollection(rootName, rows);
      await writeAudit(rootName + '_deleted', actor, { item_id: deleted.id });
      return res.status(200).json({ ok: true, deleted: true, item_id: deleted.id });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (root === 'durur') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const rows = await readDurMasterRows();
    const legacyRows = await readJsonFile('durur', []);
    if (req.method === 'GET') {
      const durId = cleanString(req.query && req.query.dur_id, 80);
      if (durId) {
        const item = rows.find((row) => row.id === durId);
        if (!item) return res.status(404).json({ error: 'dur_not_found' });
        return res.status(200).json({ ok: true, item: mergeDurMasterAdminWithLegacy(item, legacyRows) });
      }
      const items = rows.slice().sort((a, b) => Number(a.order_index || a.dur_number || 0) - Number(b.order_index || b.dur_number || 0)).map((item) => mergeDurMasterAdminWithLegacy(item, legacyRows));
      return res.status(200).json({ ok: true, total: items.length, items });
    }
    try {
      const body = parseBody(req) || {};
      const requestedId = cleanString(body.dur_id || body.id, 80);
      if (!requestedId) return res.status(400).json({ error: 'dur_id_required' });
      const idx = rows.findIndex((row) => row.id === requestedId);
      if (idx < 0) return res.status(404).json({ error: 'dur_not_found' });
      const partialFields = Object.assign({}, body.fields || body || {}, body.id ? { id: requestedId } : {});
      const updated = applyPartialDurMasterUpdate(rows[idx], partialFields);
      rows[idx] = updated;
      validateDurMasterCollection(rows);
      await writeJsonFile('durur_master', rows);
      await writeAudit('durur_master_updated', actor, { dur_id: updated.id, via: 'durur_root_post' });
      return res.status(200).json({ ok: true, item: mapDurMasterForAdmin(updated) });
    } catch (err) {
      return res.status(400).json({ error: err && err.message ? err.message : 'durur_update_failed' });
    }
  }

  if (root === 'durur-update') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    try {
      const body = parseBody(req) || {};
      const durId = cleanString(body.dur_id, 80);
      if (!durId) return res.status(400).json({ error: 'dur_id_required' });
      const rows = await readDurMasterRows();
      const idx = rows.findIndex((row) => row.id === durId);
      if (idx < 0) return res.status(404).json({ error: 'dur_not_found' });
      const updated = applyPartialDurMasterUpdate(rows[idx], body.fields || {});
      rows[idx] = updated;
      validateDurMasterCollection(rows);
      await writeJsonFile('durur_master', rows);
      await writeAudit('durur_master_updated', actor, { dur_id: updated.id });
      return res.status(200).json({ ok: true, item: mapDurMasterForAdmin(updated) });
    } catch (err) {
      return res.status(400).json({ error: err && err.message ? err.message : 'durur_update_failed' });
    }
  }

  if (root === 'durur-phase-update') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    try {
      const body = parseBody(req) || {};
      const durId = cleanString(body.dur_id, 80);
      const phaseId = cleanString(body.phase_id, 80);
      if (!durId || !phaseId) return res.status(400).json({ error: 'dur_id_phase_id_required' });
      const rows = await readDurMasterRows();
      const idx = rows.findIndex((row) => row.id === durId);
      if (idx < 0) return res.status(404).json({ error: 'dur_not_found' });
      const current = rows[idx];
      const phaseIdx = (Array.isArray(current.phases) ? current.phases : []).findIndex((phase) => cleanString(phase.phase_id, 80) === phaseId);
      if (phaseIdx < 0) return res.status(404).json({ error: 'phase_not_found' });
      const phases = current.phases.slice();
      phases[phaseIdx] = Object.assign({}, phases[phaseIdx], body.fields || {}, { phase_id: phaseId });
      const updated = normalizeDururMasterInput(Object.assign({}, current, { phases: phases }), current);
      rows[idx] = updated;
      validateDurMasterCollection(rows);
      await writeJsonFile('durur_master', rows);
      await writeAudit('durur_phase_updated', actor, { dur_id: durId, phase_id: phaseId });
      return res.status(200).json({ ok: true, item: mapDurMasterForAdmin(updated) });
    } catch (err) {
      return res.status(400).json({ error: err && err.message ? err.message : 'durur_phase_update_failed' });
    }
  }

  if (root === 'durur-overrides') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const rows = await readJsonFile('durur_overrides', []);
    return res.status(200).json({ ok: true, total: Array.isArray(rows) ? rows.length : 0, items: Array.isArray(rows) ? rows : [] });
  }

  if (root === 'durur-override-create' || root === 'durur-override-update') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    try {
      const body = parseBody(req) || {};
      const rows = await readJsonFile('durur_overrides', []);
      const overrideId = cleanString(body.override_id || body.id, 80);
      const existingIdx = overrideId ? rows.findIndex((item) => cleanString(item.override_id || item.id, 80) === overrideId) : -1;
      if (root === 'durur-override-update' && existingIdx < 0) {
        return res.status(404).json({ error: 'override_not_found' });
      }
      const item = normalizeDururOverrideInput(body, existingIdx >= 0 ? rows[existingIdx] : null);
      if (!item.dur_id) return res.status(400).json({ error: 'dur_id_required' });
      if (existingIdx >= 0) rows[existingIdx] = item;
      else rows.push(item);
      await writeJsonFile('durur_overrides', rows);
      await writeAudit(existingIdx >= 0 ? 'durur_override_updated' : 'durur_override_created', actor, {
        override_id: item.override_id,
        dur_id: item.dur_id,
        station_id: item.station_id
      });
      return res.status(existingIdx >= 0 ? 200 : 201).json({ ok: true, item });
    } catch (err) {
      return res.status(400).json({ error: err && err.message ? err.message : 'durur_override_save_failed' });
    }
  }

  if (root === 'station-dur-windows') {
    return res.status(410).json({ ok: false, error: 'station_dur_windows_api_removed', message: 'Use data/true_final_station_reference.json; timing is in navidur analysis API only' });
  }

  const collectionRoots = ['durur-reference', 'season-events', 'station-dur-profiles', 'station-dur-overrides', 'annual-comparisons', 'durur-master', 'trait-dictionaries', 'fish-season-tags', 'advice-basis-tags'];
  if (collectionRoots.includes(root)) {
    return handleCollection(root);
  }

  if (root === 'users') {
    if (!id) {
      if (req.method === 'GET') {
        const users = await readJsonFile('users', []);
        return res.status(200).json({ ok: true, total: users.length, users: users.map(safeUser) });
      }
      if (req.method === 'POST') {
        try {
          const body = parseBody(req);
          const user = await createUser(body, actor);
          await writeAudit('user_created', actor, { user_id: user.id, username: user.username, role: user.role });
          return res.status(201).json({ ok: true, user: safeUser(user) });
        } catch (err) {
          return res.status(400).json({ error: err && err.message ? err.message : 'user_create_failed' });
        }
      }
      if (req.method === 'PATCH') {
        const body = parseBody(req);
        const userId = cleanString(body.id, 80);
        if (!userId) return res.status(400).json({ error: 'user_id_required' });
        const users = await readJsonFile('users', []);
        const userIdx = users.findIndex((u) => u.id === userId);
        if (userIdx < 0) return res.status(404).json({ error: 'user_not_found' });
        if (typeof body.active_status === 'boolean') users[userIdx].active_status = body.active_status;
        if (Array.isArray(body.assigned_stations)) {
          users[userIdx].assigned_stations = body.assigned_stations.map((x) => cleanString(x, 80)).filter(Boolean).slice(0, 300);
        }
        await writeJsonFile('users', users);
        await writeAudit('user_updated', actor, { user_id: userId, active_status: users[userIdx].active_status });
        return res.status(200).json({ ok: true, user: safeUser(users[userIdx]) });
      }
      res.setHeader('Allow', 'GET, POST, PATCH');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    if (action === 'password') {
      if (req.method !== 'PATCH') {
        res.setHeader('Allow', 'PATCH');
        return res.status(405).json({ error: 'method_not_allowed' });
      }
      const body = parseBody(req);
      const nextPassword = cleanString(body.password, 200);
      if (!nextPassword) return res.status(400).json({ error: 'user_id_password_required' });
      const users = await readJsonFile('users', []);
      const userIdx = users.findIndex((u) => u.id === id);
      if (userIdx < 0) return res.status(404).json({ error: 'user_not_found' });
      users[userIdx].hashed_password = hashPassword(nextPassword);
      await writeJsonFile('users', users);
      await writeAudit('password_changed', actor, { user_id: id });
      return res.status(200).json({ ok: true });
    }
  }

  if (root === 'analytics-summary') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const tracking = await readJsonFile('tracking', []);
    return res.status(200).json(buildAnalyticsSummary(tracking));
  }

  if (root === 'station-snapshots') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const stationId = cleanString(req.query && req.query.station_id, 80);
    const durId = cleanString(req.query && req.query.dur_id, 80);
    const limit = id
      ? 500
      : (Number(req.query && req.query.limit) > 0 ? Math.min(Number(req.query.limit), 500) : 100);
    const items = await getStationSnapshots({ stationId: stationId, durId: durId, limit: limit });
    if (id) {
      const item = items.find(function (entry) { return String(entry.snapshot_id || entry.id || '') === String(id); });
      if (!item) return res.status(404).json({ error: 'snapshot_not_found' });
      return res.status(200).json({ ok: true, item: item });
    }
    return res.status(200).json({ ok: true, total: items.length, items: items });
  }

  if (root === 'dur-validation-logs') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const stationId = cleanString(req.query && req.query.station_id, 80);
    const durId = cleanString(req.query && req.query.dur_id, 80);
    const status = cleanString(req.query && req.query.status, 40);
    const limit = id
      ? 500
      : (Number(req.query && req.query.limit) > 0 ? Math.min(Number(req.query.limit), 500) : 100);
    const items = await getDurValidationLogs({ stationId: stationId, durId: durId, status: status, limit: limit });
    if (id) {
      const item = items.find(function (entry) { return String(entry.validation_id || entry.id || '') === String(id); });
      if (!item) return res.status(404).json({ error: 'validation_not_found' });
      return res.status(200).json({ ok: true, item: item });
    }
    return res.status(200).json({ ok: true, total: items.length, items: items });
  }

  if (root === 'snapshot-run-logs') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const limit = id
      ? 500
      : (Number(req.query && req.query.limit) > 0 ? Math.min(Number(req.query.limit), 500) : 100);
    const items = await getSnapshotRunLogs({ limit: limit });
    if (id) {
      const item = items.find(function (entry) { return String(entry.run_id || entry.id || '') === String(id); });
      if (!item) return res.status(404).json({ error: 'snapshot_run_not_found' });
      return res.status(200).json({ ok: true, item: item });
    }
    return res.status(200).json({ ok: true, total: items.length, items: items });
  }

  if (root === 'durur-intelligence') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const durId = cleanString(req.query && req.query.dur_id, 80);
    const stationId =
      cleanString(req.query && req.query.reference_station_id, 80) || cleanString(req.query && req.query.station_id, 80);
    const result = await getDurIntelligenceSummary({ durId: durId, stationId: stationId });
    return res.status(200).json({
      ok: true,
      total: Array.isArray(result.items) ? result.items.length : 0,
      items: Array.isArray(result.items) ? result.items : [],
      grouped: Array.isArray(result.grouped) ? result.grouped : []
    });
  }

  if (root === 'durur-trait-review-evidence') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const q = req.query || {};
    const refStationId = cleanString(q.reference_station_id, 80) || cleanString(q.station_id, 80);
    const evidence = await getDurTraitReviewEvidence({
      referenceStationId: refStationId,
      durId: cleanString(q.dur_id, 80),
      phaseId: cleanString(q.phase_id, 120),
      limit: 20000
    });
    return res.status(200).json(evidence);
  }

  if (root === 'trait-calibration') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const doc = await readJsonFile('trait_calibration', { version: 1, scopes: {} });
    const q = req.query || {};
    const durName = cleanString(q.dur_name_ar, 120);
    const phaseId = cleanString(q.phase_id, 120);
    const depthMode = cleanString(q.depth_mode, 20) || 'coastal';
    const refId = cleanString(q.reference_station_id, 80) || cleanString(q.station_id, 80);
    if (refId && durName) {
      const sk = traitCalibrationLib.buildTraitCalibrationScopeKey({
        reference_station_id: refId,
        dur_name_ar: durName,
        phase_id: phaseId,
        depth_mode: depthMode
      });
      var entryOut = (doc.scopes && doc.scopes[sk]) || null;
      if (!entryOut && cleanString(q.legacy_operational_station_id, 80)) {
        const leg = traitCalibrationLib.buildLegacyTraitCalibrationScopeKey({
          station_id: cleanString(q.legacy_operational_station_id, 80),
          reference_station_id: refId,
          dur_name_ar: durName,
          phase_id: phaseId,
          depth_mode: depthMode
        });
        entryOut = (doc.scopes && doc.scopes[leg]) || null;
      }
      return res.status(200).json({
        ok: true,
        scope_key: sk,
        entry: entryOut
      });
    }
    return res.status(200).json({ ok: true, version: doc.version, scopes: doc.scopes || {} });
  }

  if (root === 'trait-calibration-action') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    try {
      const body = parseBody(req);
      const out = await applyTraitCalibrationAction(actor, body);
      return res.status(200).json(out);
    } catch (err) {
      const code = err && err.code === 400 ? 400 : 500;
      return res.status(code).json({ ok: false, error: String(err.message || err) });
    }
  }

  if (root === 'trait-long-term-state') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const doc = await readJsonFile('trait_cycles', { version: 1, scopes: {} });
    const q = req.query || {};
    const refId = cleanString(q.reference_station_id, 80) || cleanString(q.station_id, 80);
    const durName = cleanString(q.dur_name_ar, 120);
    const phaseId = cleanString(q.phase_id, 120);
    const depthMode = cleanString(q.depth_mode, 20) || 'coastal';
    if (refId && durName) {
      const sk = traitCalibrationLib.buildTraitCalibrationScopeKey({
        reference_station_id: refId,
        dur_name_ar: durName,
        phase_id: phaseId,
        depth_mode: depthMode
      });
      const scope = doc.scopes && doc.scopes[sk] ? doc.scopes[sk] : null;
      const traits = scope && scope.traits ? scope.traits : {};
      const query = {
        compare_year: cleanString(q.compare_year, 8),
        compare_previous_year: cleanString(q.compare_previous_year, 8),
        comparison_filter: cleanString(q.comparison_filter, 40)
      };
      const rows = traitLongTermLib.buildTraitLongTermStateRows({ scope: Object.assign({}, scope, { traits: traits }), query: query });
      return res.status(200).json({ ok: true, scope_key: sk, rows: rows, comparison_query: query });
    }
    return res.status(200).json({ ok: true, version: doc.version, scopes: doc.scopes || {} });
  }

  if (root === 'trait-learning-supervisor') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    try {
      const body = parseBody(req);
      const out = await applyTraitLearningSupervisor(actor, body);
      return res.status(200).json(out);
    } catch (err) {
      const code = err && err.code === 400 ? 400 : 500;
      return res.status(code).json({ ok: false, error: String(err.message || err) });
    }
  }

  /** FIELD review + learning (admin-only; catch logs from KV only) */
  if (root === 'field-review-summary') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    try {
      const logs = await getCatchLogs(null, 5000);
      const fieldLogs = (Array.isArray(logs) ? logs : []).filter(function (l) { return l && l.source === 'field_app'; });
      const stations = await readJsonFile('stations', []);
      const reviews = await readJsonFile('field_session_reviews', { version: 1, reviews: [] });
      const built = fieldInsight.buildSummaryFromData(fieldLogs, stations, reviews);
      const all = built.sessions || [];
      const excludedN = all.filter(function (s) { return s && s.excluded_from_accuracy; }).length;
      return res.status(200).json({
        ok: true,
        summary: built.summary,
        session_count: all.length,
        excluded_from_accuracy_count: excludedN,
        accuracy_session_count: all.length - excludedN
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'field_review_summary_failed', detail: String(err.message || err) });
    }
  }

  if (root === 'field-review-sessions') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    try {
      const logs = await getCatchLogs(null, 5000);
      const fieldLogs = (Array.isArray(logs) ? logs : []).filter(function (l) { return l && l.source === 'field_app'; });
      const stations = await readJsonFile('stations', []);
      const reviews = await readJsonFile('field_session_reviews', { version: 1, reviews: [] });
      const built = fieldInsight.buildSummaryFromData(fieldLogs, stations, reviews);
      const q = req.query || {};
      const filter = {
        station_id: cleanString(q.station_id, 80) || null,
        fish: cleanString(q.fish, 80) || null,
        water_state: cleanString(q.water_state, 20) || null,
        tide_state: cleanString(q.tide_state, 20) || null,
        dur: cleanString(q.dur, 80) || null,
        review_status: cleanString(q.review_status, 20) || null,
        date_from: cleanString(q.date_from, 30) || null,
        date_to: cleanString(q.date_to, 30) || null,
        success: cleanString(q.success, 10) || null
      };
      const sessions = built.sessions.filter(function (s) { return fieldInsight.sessionMatchesFilter(s, filter); });
      return res.status(200).json({ ok: true, total: sessions.length, sessions: sessions });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'field_review_sessions_failed', detail: String(err.message || err) });
    }
  }

  if (root === 'field-review-patterns') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    try {
      const logs = await getCatchLogs(null, 5000);
      const fieldLogs = (Array.isArray(logs) ? logs : []).filter(function (l) { return l && l.source === 'field_app'; });
      const stations = await readJsonFile('stations', []);
      const reviews = await readJsonFile('field_session_reviews', { version: 1, reviews: [] });
      const built = fieldInsight.buildSummaryFromData(fieldLogs, stations, reviews);
      const patterns = fieldInsight.buildPatternsFromSessions(built.sessions);
      return res.status(200).json({ ok: true, patterns: patterns });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'field_review_patterns_failed', detail: String(err.message || err) });
    }
  }

  if (root === 'field-review-learning-settings') {
    if (req.method === 'GET') {
      const s = await readJsonFile('navidur_learning_settings', { version: 1, learning_layer_enabled: false });
      return res.status(200).json({ ok: true, settings: s });
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = parseBody(req);
      const next = Object.assign({}, await readJsonFile('navidur_learning_settings', { version: 1, learning_layer_enabled: false }), {
        learning_layer_enabled: !!body.learning_layer_enabled,
        updated_at: nowIso()
      });
      await writeJsonFile('navidur_learning_settings', next);
      await writeAudit('learning_settings_update', actor, { enabled: next.learning_layer_enabled });
      return res.status(200).json({ ok: true, settings: next });
    }
    res.setHeader('Allow', 'GET, POST, PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (root === 'apply-learning-adjustment') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const body = parseBody(req);
    const strength = Number(body.decision_strength);
    if (!Number.isFinite(strength) || strength < 55) {
      return res.status(400).json({ ok: false, error: 'insufficient_decision_strength' });
    }
    const doc = await readJsonFile('navidur_learning_adjustments', { version: 1, adjustments: [] });
    const adj = {
      id: cleanString(body.id, 80) || createId('adj'),
      fish: cleanString(body.fish, 120),
      conditions: body.conditions && typeof body.conditions === 'object' ? body.conditions : {},
      score_adjustment: Math.max(-15, Math.min(15, Number(body.score_adjustment) || 0)),
      decision_strength: strength,
      decision_strength_label: cleanString(body.decision_strength_label, 40) || '',
      source: cleanString(body.source, 20) || 'FIELD',
      approved_by: cleanString(body.approved_by || actor.username, 80) || 'admin',
      created_at: nowIso(),
      active: body.active !== false,
      pattern_id: cleanString(body.pattern_id, 80) || null
    };
    if (!adj.fish) return res.status(400).json({ error: 'fish_required' });
    doc.adjustments = Array.isArray(doc.adjustments) ? doc.adjustments : [];
    doc.adjustments.push(adj);
    await writeJsonFile('navidur_learning_adjustments', doc);
    await writeAudit('learning_adjustment_applied', actor, { adjustment_id: adj.id, fish: adj.fish });
    return res.status(200).json({ ok: true, adjustment: adj });
  }

  if (root === 'toggle-learning-adjustment') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const body = parseBody(req);
    const aid = cleanString(body.id, 80);
    if (!aid) return res.status(400).json({ error: 'id_required' });
    const doc = await readJsonFile('navidur_learning_adjustments', { version: 1, adjustments: [] });
    const list = Array.isArray(doc.adjustments) ? doc.adjustments : [];
    const idx = list.findIndex(function (a) { return a && String(a.id) === aid; });
    if (idx < 0) return res.status(404).json({ error: 'adjustment_not_found' });
    list[idx].active = body.active === true;
    list[idx].updated_at = nowIso();
    doc.adjustments = list;
    await writeJsonFile('navidur_learning_adjustments', doc);
    await writeAudit('learning_adjustment_toggle', actor, { adjustment_id: aid, active: list[idx].active });
    return res.status(200).json({ ok: true, adjustment: list[idx] });
  }

  if (root === 'field-session-review') {
    if (req.method !== 'POST' && req.method !== 'PUT') {
      res.setHeader('Allow', 'POST, PUT');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const body = parseBody(req);
    const catchId = cleanString(body.catch_id, 80);
    if (!catchId) return res.status(400).json({ error: 'catch_id_required' });
    const doc = await readJsonFile('field_session_reviews', { version: 1, reviews: [] });
    const reviews = Array.isArray(doc.reviews) ? doc.reviews : [];
    const ix = reviews.findIndex(function (r) { return r && r.catch_id === catchId; });
    const existing = (ix >= 0 && reviews[ix]) ? reviews[ix] : {};
    const hasOwn = Object.prototype.hasOwnProperty.bind(body);
    const entry = Object.assign({ catch_id: catchId, review_status: 'pending' }, existing);
    entry.catch_id = catchId;
    if (hasOwn('review_status')) {
      const status = cleanString(body.review_status, 20) || 'pending';
      entry.review_status = ['pending', 'approved', 'rejected'].indexOf(status) >= 0 ? status : 'pending';
    } else if (!entry.review_status) {
      entry.review_status = 'pending';
    }
    if (hasOwn('notes')) entry.notes = cleanString(body.notes, 2000) || null;
    if (hasOwn('photo_url')) entry.photo_url = cleanString(body.photo_url, 500) || null;
    if (hasOwn('excluded_from_accuracy')) {
      entry.excluded_from_accuracy = body.excluded_from_accuracy === true;
    }
    entry.updated_at = nowIso();
    entry.reviewer = cleanString(actor.username, 80) || 'admin';
    if (ix >= 0) reviews[ix] = entry;
    else reviews.push(entry);
    doc.reviews = reviews;
    await writeJsonFile('field_session_reviews', doc);
    await writeAudit('field_session_review', actor, { catch_id: catchId, review_status: entry.review_status, excluded_from_accuracy: !!entry.excluded_from_accuracy });
    return res.status(200).json({ ok: true, review: entry });
  }

  if (root === 'delete-learning-adjustment') {
    if (req.method !== 'POST' && req.method !== 'DELETE') {
      res.setHeader('Allow', 'POST, DELETE');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const body = parseBody(req);
    const aid = cleanString(body.id, 80);
    if (!aid) return res.status(400).json({ error: 'id_required' });
    const doc = await readJsonFile('navidur_learning_adjustments', { version: 1, adjustments: [] });
    const before = Array.isArray(doc.adjustments) ? doc.adjustments.length : 0;
    doc.adjustments = (Array.isArray(doc.adjustments) ? doc.adjustments : []).filter(function (a) { return a && String(a.id) !== aid; });
    if (doc.adjustments.length === before) return res.status(404).json({ error: 'adjustment_not_found' });
    await writeJsonFile('navidur_learning_adjustments', doc);
    await writeAudit('learning_adjustment_delete', actor, { adjustment_id: aid });
    return res.status(200).json({ ok: true, deleted: aid });
  }

  if (root === 'list-learning-adjustments') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const doc = await readJsonFile('navidur_learning_adjustments', { version: 1, adjustments: [] });
    return res.status(200).json({ ok: true, adjustments: Array.isArray(doc.adjustments) ? doc.adjustments : [] });
  }

  if (root === 'monitoring-snapshot') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    try {
      const q = req.query || {};
      const date = cleanString(q.date, 20) || new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'date_invalid' });
      }
      const stationId = cleanString(q.station_id, 80);
      if (!stationId) return res.status(400).json({ error: 'station_id_required' });
      const source = cleanString(q.source, 20).toLowerCase();

      const referenceData = await loadReferenceData();
      const station = normalizeRequestedStation({ station_id: stationId }, referenceData.stations || []);
      if (!station || !station.id) return res.status(404).json({ error: 'station_not_found' });
      if (station.lat == null || station.lon == null) return res.status(400).json({ error: 'station_coordinates_required' });

      const body = { analysis_date: date, datetime: date + 'T12:00:00Z', as_of_iso: date + 'T12:00:00Z', source: source === 'sg' ? 'sg' : '' };
      const weatherPack = await fetchWeatherAndMarineInputs(station, body);
      const liveInputs = weatherPack.live_inputs || {};
      const dto = analyzeLiveStation({
        station: station,
        datetime: body.datetime,
        reference_data: referenceData,
        overrides: null,
        live_inputs: liveInputs,
        weather_meta: weatherPack.weather_meta || {},
        tide_debug: weatherPack.tide_debug || null,
        debug_log: false,
        field_validation: null,
        trait_calibration: await readJsonFile('trait_calibration', { version: 1, scopes: {} }),
        request_depth_mode: 'coastal'
      });

      const start = date + 'T00:00:00Z';
      const end = date + 'T23:59:59Z';
      const sgWeather = await sgMonitoring.getStormglassWeatherPoint(station.lat, station.lon, start, end);
      const sgMarine = await sgMonitoring.getStormglassMarinePoint(station.lat, station.lon, start, end);
      const sgTideExtremes = await sgMonitoring.getStormglassTideExtremes(station.lat, station.lon, start, end);
      const sgSeaLevel = await sgMonitoring.getStormglassTideSeaLevel(station.lat, station.lon, start, end);

      const sgHoursMerged = mergeStormglassHours(sgWeather.hours || [], sgMarine.hours || []);
      const sgCurrent = pickClosestHour(sgHoursMerged, body.datetime);
      const sgSea = pickClosestHour(sgSeaLevel.seaLevel || [], body.datetime);
      const sgValues = {
        windSpeed: n(sgCurrent && sgCurrent.windSpeed),
        windDirection: n(sgCurrent && sgCurrent.windDirection),
        airTemperature: n(sgCurrent && sgCurrent.airTemperature),
        waveHeight: n(sgCurrent && sgCurrent.waveHeight),
        swellHeight: n(sgCurrent && sgCurrent.swellHeight),
        swellDirection: n(sgCurrent && sgCurrent.swellDirection),
        currentSpeed: n(sgCurrent && sgCurrent.currentSpeed),
        currentDirection: n(sgCurrent && sgCurrent.currentDirection),
        waterTemperature: n(sgCurrent && sgCurrent.waterTemperature),
        seaLevel: n((sgCurrent && sgCurrent.seaLevel) != null ? sgCurrent.seaLevel : (sgSea && sgSea.seaLevel)),
        tideExtremes: Array.isArray(sgTideExtremes.extremes) ? sgTideExtremes.extremes.slice(0, 10) : []
      };

      const validationStatus = (sgWeather.ok && sgMarine.ok && sgTideExtremes.ok && sgSeaLevel.ok)
        ? 'stormglass_available'
        : 'stormglass_unavailable';
      if (validationStatus === 'stormglass_unavailable') {
        console.warn('NAVIDUR_STORMGLASS_MONITORING_FAILED', {
          station_id: station.id,
          date: date,
          weather_ok: !!sgWeather.ok,
          marine_ok: !!sgMarine.ok,
          tide_extremes_ok: !!sgTideExtremes.ok,
          sea_level_ok: !!sgSeaLevel.ok
        });
      }

      const openMeteoValues = {
        windSpeed: n(liveInputs.wind_speed_kmh),
        windDirection: n(liveInputs.wind_direction_deg),
        airTemperature: n(liveInputs.temp_c),
        waveHeight: n(liveInputs.wave_height_m),
        currentSpeed: n(liveInputs.current_speed_ms),
        waterTemperature: n(liveInputs.temp_c),
        tideState: dto && dto.tide ? dto.tide.state || null : null
      };
      const agreement = computeAgreement(openMeteoValues, sgValues);
      console.info('NAVIDUR_SOURCE_AGREEMENT_COMPUTED', {
        station_id: station.id,
        date: date,
        score: agreement.score
      });

      const traitMatch = computeTraitMatchScore(dto);
      const anomalies = buildAnomalies(openMeteoValues, sgValues, validationStatus, agreement.pairs);

      const snapshot = {
        station_id: String(station.id),
        station_name_ar: cleanString(station.name_ar || station.name, 120),
        date: date,
        dur_name_ar: cleanString(dto && dto.dur && dto.dur.period_name, 120),
        open_meteo_values: openMeteoValues,
        stormglass_values: sgValues,
        navidur_decision: {
          advice_text: cleanString(dto && dto.fishing && dto.fishing.recommendation_text, 400),
          confidence_score: n(dto && dto.fishing && dto.fishing.confidence_score),
          tide_state: cleanString(dto && dto.tide && dto.tide.state, 40)
        },
        source_agreement_score: agreement.score,
        dur_trait_match_score: traitMatch,
        anomalies: anomalies,
        validation_status: validationStatus,
        created_at: nowIso()
      };

      const doc = await readJsonFile('navidur_monitoring_snapshots', { version: 1, snapshots: [] });
      const rows = Array.isArray(doc.snapshots) ? doc.snapshots : [];
      rows.unshift(snapshot);
      doc.version = 1;
      doc.snapshots = rows.slice(0, 300);
      await writeJsonFile('navidur_monitoring_snapshots', doc);

      console.info('NAVIDUR_MONITORING_SNAPSHOT_CREATED', {
        station_id: station.id,
        date: date,
        validation_status: validationStatus
      });

      return res.status(200).json({
        station: {
          id: String(station.id),
          name_ar: cleanString(station.name_ar || station.name, 120),
          lat: n(station.lat),
          lon: n(station.lon != null ? station.lon : station.lng)
        },
        date: date,
        dur: dto && dto.dur ? dto.dur : null,
        navidur_decision: snapshot.navidur_decision,
        open_meteo_values: openMeteoValues,
        stormglass_values: sgValues,
        tide_values: {
          navidur_tide: dto && dto.tide ? dto.tide : null,
          stormglass_sea_level: Array.isArray(sgSeaLevel.seaLevel) ? sgSeaLevel.seaLevel.slice(0, 24) : [],
          stormglass_tide_extremes: Array.isArray(sgTideExtremes.extremes) ? sgTideExtremes.extremes : []
        },
        source_agreement_score: agreement.score,
        dur_trait_match_score: traitMatch,
        anomalies: anomalies,
        validation_status: validationStatus,
        selected_source: source === 'sg' ? 'sg' : 'default',
        generated_at: nowIso()
      });
    } catch (err) {
      return res.status(500).json({ error: 'monitoring_snapshot_failed', detail: String(err && err.message ? err.message : err) });
    }
  }

  return res.status(404).json({ error: 'admin_route_not_found' });
};

function n(v) {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function pickClosestHour(rows, isoTime) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return null;
  const target = Date.parse(String(isoTime || ''));
  if (Number.isNaN(target)) return arr[0];
  let best = null;
  let diff = Infinity;
  for (let i = 0; i < arr.length; i += 1) {
    const row = arr[i];
    const ts = Date.parse(String(row && row.time || ''));
    if (Number.isNaN(ts)) continue;
    const d = Math.abs(ts - target);
    if (d < diff) {
      diff = d;
      best = row;
    }
  }
  return best || arr[0];
}

function mergeStormglassHours(a, b) {
  const map = Object.create(null);
  (Array.isArray(a) ? a : []).forEach(function (row) {
    const t = String(row && row.time || '');
    if (!t) return;
    map[t] = Object.assign({}, row);
  });
  (Array.isArray(b) ? b : []).forEach(function (row) {
    const t = String(row && row.time || '');
    if (!t) return;
    map[t] = Object.assign({}, map[t] || {}, row);
  });
  return Object.keys(map).sort().map(function (k) { return map[k]; });
}

function computeAgreement(openVals, sgVals) {
  const checks = [
    ['windSpeed', 4],
    ['airTemperature', 2.5],
    ['waveHeight', 0.4],
    ['currentSpeed', 0.25],
    ['waterTemperature', 2.5],
    ['seaLevel', 0.25]
  ];
  let used = 0;
  let ok = 0;
  const pairs = [];
  checks.forEach(function (pair) {
    const key = pair[0];
    const tol = pair[1];
    const a = n(openVals[key]);
    const b = n(sgVals[key]);
    if (a == null || b == null) return;
    used += 1;
    const pass = Math.abs(a - b) <= tol;
    if (pass) ok += 1;
    pairs.push({ key: key, open: a, stormglass: b, delta: n(Math.abs(a - b).toFixed(3)), pass: pass });
  });
  if (!used) return { score: 0, pairs: [] };
  return { score: Math.round((ok / used) * 100), pairs: pairs };
}

function computeTraitMatchScore(dto) {
  const v = dto && dto.validation && typeof dto.validation === 'object' ? dto.validation : {};
  const matched = Array.isArray(v.matched_traits) ? v.matched_traits.length : 0;
  const failed = Array.isArray(v.failed_traits) ? v.failed_traits.length : 0;
  const total = matched + failed;
  if (!total) return null;
  return Math.round((matched / total) * 100);
}

function buildAnomalies(openVals, sgVals, validationStatus, pairs) {
  const out = [];
  if (validationStatus !== 'stormglass_available') {
    out.push({ type: 'stormglass_unavailable', message: 'Stormglass غير متاح' });
    return out;
  }
  (Array.isArray(pairs) ? pairs : []).forEach(function (p) {
    if (!p.pass) {
      out.push({
        type: 'source_mismatch',
        metric: p.key,
        open_meteo: p.open,
        stormglass: p.stormglass,
        delta: p.delta
      });
    }
  });
  if (out.length === 0) {
    out.push({ type: 'none', message: 'لا توجد فروقات جوهرية' });
  }
  return out;
}

// ---- Analytics snapshot builder ----
const ANALYTICS_THRESHOLDS = { sessions_per_day: 20, analyses_per_day: 10, conversion_pct: 60 };

function buildAnalyticsSummary(tracking) {
  function todayCutoff() {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).getTime();
  }
  function dayKey(ts) {
    const d = new Date(ts || '');
    if (Number.isNaN(d.getTime())) return null;
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  const sessions = new Set(), stationMap = {}, countryMap = {}, modeMap = {};
  let totalAnalyses = 0, totalStationSelects = 0;
  const dailySessions = {}, dailyAnalyses = {}, dailyStationSelect = {};
  tracking.forEach(function (r) {
    if (r.session_id) sessions.add(r.session_id);
    if (r.event_type === 'analysis_complete') {
      totalAnalyses++;
      const name = String(r.station || '').trim() || String(r.station_id || '').trim() || null;
      if (name) stationMap[name] = (stationMap[name] || 0) + 1;
    }
    if (r.event_type === 'station_select') totalStationSelects++;
    if (r.country) countryMap[r.country] = (countryMap[r.country] || 0) + 1;
    if (r.fishing_mode === 'coastal' || r.fishing_mode === 'deep') modeMap[r.fishing_mode] = (modeMap[r.fishing_mode] || 0) + 1;
    const k = dayKey(r.timestamp);
    if (!k) return;
    if (r.session_id) { if (!dailySessions[k]) dailySessions[k] = new Set(); dailySessions[k].add(r.session_id); }
    if (r.event_type === 'analysis_complete') dailyAnalyses[k] = (dailyAnalyses[k] || 0) + 1;
    if (r.event_type === 'station_select') dailyStationSelect[k] = (dailyStationSelect[k] || 0) + 1;
  });
  const todayMs = todayCutoff();
  const dailyLog = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(todayMs - i * 86400000);
    const k = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    const daySess = dailySessions[k] ? dailySessions[k].size : 0;
    const dayAn = dailyAnalyses[k] || 0;
    const daySS = dailyStationSelect[k] || 0;
    const conv = daySS > 0 ? Number(((dayAn / (daySS + dayAn)) * 100).toFixed(1)) : (dayAn > 0 ? 100 : null);
    dailyLog.push({ date: k, sessions: daySess, analysis_complete: dayAn, conversion_pct: conv, meets_sessions_target: daySess >= ANALYTICS_THRESHOLDS.sessions_per_day, meets_analyses_target: dayAn >= ANALYTICS_THRESHOLDS.analyses_per_day, meets_conversion_target: conv !== null ? conv >= ANALYTICS_THRESHOLDS.conversion_pct : null });
  }
  const cTotal = Object.values(countryMap).reduce((a, b) => a + b, 0);
  const mTotal = Object.values(modeMap).reduce((a, b) => a + b, 0);
  const overallConv = (totalStationSelects + totalAnalyses) > 0 ? Number(((totalAnalyses / (totalStationSelects + totalAnalyses)) * 100).toFixed(1)) : null;
  return {
    ok: true, generated_at: new Date().toISOString(),
    totals: { sessions: sessions.size, analysis_complete: totalAnalyses, conversion_pct: overallConv },
    success_thresholds: ANALYTICS_THRESHOLDS,
    top_5_stations: Object.entries(stationMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(p => ({ station: p[0], count: p[1], share_pct: totalAnalyses > 0 ? Number(((p[1] / totalAnalyses) * 100).toFixed(1)) : 0 })),
    country_distribution: Object.entries(countryMap).sort((a, b) => b[1] - a[1]).map(p => ({ country: p[0], count: p[1], share_pct: cTotal > 0 ? Number(((p[1] / cTotal) * 100).toFixed(1)) : 0 })),
    fishing_mode_split: Object.entries(modeMap).sort((a, b) => b[1] - a[1]).map(p => ({ mode: p[0], count: p[1], share_pct: mTotal > 0 ? Number(((p[1] / mTotal) * 100).toFixed(1)) : 0 })),
    daily_log: dailyLog
  };
}