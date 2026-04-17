'use strict';

const { readJsonFile, writeJsonFile, createId, nowIso } = require('../_lib/data-store');
const { requireRole, createUser, hashPassword } = require('../_lib/auth');
const { normalizeStationInput, hasDuplicateStation, normalizeStatus } = require('../_lib/stations');
const { isAllowedOrigin, parseBody, cleanString, setNoCache } = require('../_lib/security');

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
    general_traits: Array.isArray(input.general_traits) ? input.general_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.general_traits) ? base.general_traits : []),
    weather_traits: Array.isArray(input.weather_traits) ? input.weather_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.weather_traits) ? base.weather_traits : []),
    marine_traits: Array.isArray(input.marine_traits) ? input.marine_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.marine_traits) ? base.marine_traits : []),
    fish_traits: Array.isArray(input.fish_traits) ? input.fish_traits.map((v) => cleanString(v, 120)).filter(Boolean) : (Array.isArray(base.fish_traits) ? base.fish_traits : []),
    related_event_ids: Array.isArray(input.related_event_ids) ? input.related_event_ids.map((v) => cleanString(v, 80)).filter(Boolean) : (Array.isArray(base.related_event_ids) ? base.related_event_ids : []),
    notes_ar: cleanString(input.notes_ar != null ? input.notes_ar : base.notes_ar, 1200),
    notes_en: cleanString(input.notes_en != null ? input.notes_en : base.notes_en, 1200),
    is_active: input.is_active != null ? !!input.is_active : (base.is_active != null ? !!base.is_active : true),
    created_at: base.created_at || nowIso(),
    updated_at: nowIso()
  };
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
    dur_number: Number.isFinite(Number(input.dur_number)) ? Number(input.dur_number) : Number(base.dur_number) || 0,
    start_offset_days: Number.isFinite(Number(input.start_offset_days)) ? Number(input.start_offset_days) : Number(base.start_offset_days) || 0,
    end_offset_days: Number.isFinite(Number(input.end_offset_days)) ? Number(input.end_offset_days) : Number(base.end_offset_days) || 0,
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

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });

  const actor = await requireRole('admin')(req, res);
  if (!actor) return;

  const segments = getPathSegments(req);
  const [root, id, action] = segments;

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

          const station = normalizeStationInput({
            ...body,
            id: requestedId || createId('st'),
            sort_order: body.sort_order != null ? body.sort_order : (rows.length + 1),
            status: body.status || 'active'
          });
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
            await writeCollection(rootName, rows);
            await writeAudit(rootName + '_updated', actor, { item_id: item.id });
            return res.status(200).json({ ok: true, item });
          }
          rows.push(item);
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

  const collectionRoots = ['durur', 'durur-reference', 'season-events', 'station-dur-profiles', 'station-dur-overrides', 'annual-comparisons', 'durur-master', 'trait-dictionaries', 'fish-season-tags', 'advice-basis-tags'];
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

  return res.status(404).json({ error: 'admin_route_not_found' });
};

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