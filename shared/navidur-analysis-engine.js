;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.NavidurAnalysisEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var getTrueFinalDurState;
  try {
    if (typeof require === 'function') {
      getTrueFinalDurState = require('./true-final-station-reference-lookup').getTrueFinalDurState;
    }
  } catch (_tfErr) {
    getTrueFinalDurState = null;
  }

  function toNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeString(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalizeStringArray(values) {
    return toArray(values).map(function (value) {
      return normalizeString(value);
    }).filter(Boolean);
  }

  function uniqueStrings(values) {
    var out = [];
    normalizeStringArray(values).forEach(function (value) {
      if (out.indexOf(value) < 0) out.push(value);
    });
    return out;
  }

  function addDays(date, days) {
    var next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + Number(days || 0));
    return next;
  }

  function startOfUtcDay(value) {
    var date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  function parseAnalysisDateTime(value) {
    if (!value) return new Date();
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return new Date();
    return date;
  }

  var DEFAULT_DURUR_LENGTH_DAYS = 13;

  function normalizeStationRecord(station) {
    var item = station || {};
    var referencePriority = toNumber(item.reference_priority);
    return {
      id: normalizeString(item.id) || null,
      name: normalizeString(item.name),
      lat: toNumber(item.lat),
      lon: toNumber(item.lon != null ? item.lon : item.lng),
      country: normalizeString(item.country),
      region: normalizeString(item.region),
      station_role_type: normalizeString(item.station_role_type),
      reference_station_id: normalizeString(item.reference_station_id),
      is_reference_station: !!item.is_reference_station,
      reference_priority: referencePriority != null ? referencePriority : null,
      latitude_band_key: normalizeString(item.latitude_band_key),
      manual_suhail_anchor_date: normalizeString(item.manual_suhail_anchor_date),
      manual_cycle_start_date: normalizeString(item.manual_cycle_start_date),
      is_verified: !!item.is_verified,
      calibration_notes: normalizeString(item.calibration_notes),
      workbook_city_key: normalizeString(item.workbook_city_key),
      workbook_city_name: normalizeString(item.workbook_city_name)
    };
  }

  function parseIsoDateOnly(value) {
    var raw = normalizeString(value);
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    var date = new Date(raw + 'T00:00:00.000Z');
    if (Number.isNaN(date.getTime())) return null;
    return startOfUtcDay(date);
  }

  function findStoredStation(referenceData, stationInput) {
    var stationId = normalizeString(stationInput && stationInput.id);
    if (!stationId) return null;
    return toArray(referenceData && referenceData.stations).find(function (station) {
      return normalizeString(station && station.id) === stationId;
    }) || null;
  }

  function sortDurRows(rows) {
    return toArray(rows).slice().sort(function (a, b) {
      var aOrder = Number(a && (a.order_index != null ? a.order_index : a.dur_number) || 0);
      var bOrder = Number(b && (b.order_index != null ? b.order_index : b.dur_number) || 0);
      return aOrder - bOrder;
    });
  }

  function sortDurPhases(phases) {
    return toArray(phases).slice().sort(function (a, b) {
      var aStart = Number(a && a.start_day || 0);
      var bStart = Number(b && b.start_day || 0);
      if (aStart !== bStart) return aStart - bStart;
      return Number(a && a.end_day || 0) - Number(b && b.end_day || 0);
    });
  }

  function normalizeDurPhase(phase, durRow, index, defaultDays) {
    var item = phase || {};
    var startDay = Math.max(1, toNumber(item.start_day) || 1);
    var endDay = Math.max(startDay, toNumber(item.end_day) || defaultDays || startDay);
    return {
      phase_id: normalizeString(item.phase_id) || (normalizeString(durRow && durRow.id) ? (normalizeString(durRow.id) + '_phase_' + String(index + 1).padStart(2, '0')) : ''),
      start_day: startDay,
      end_day: endDay,
      title_ar: normalizeString(item.title_ar),
      general_traits: normalizeStringArray(item.general_traits),
      weather_traits: normalizeStringArray(item.weather_traits),
      marine_traits: normalizeStringArray(item.marine_traits),
      fish_traits: normalizeStringArray(item.fish_traits),
      related_event_ids: uniqueStrings(item.related_event_ids || []),
      notes_ar: normalizeString(item.notes_ar),
      advice_text: normalizeString(item.advice_text)
    };
  }

  function buildDefaultDurPhase(durRow, defaultDays) {
    return normalizeDurPhase({
      phase_id: normalizeString(durRow && durRow.id) ? (normalizeString(durRow.id) + '_phase_01') : '',
      start_day: 1,
      end_day: defaultDays,
      title_ar: '',
      general_traits: durRow && durRow.general_traits || [],
      weather_traits: durRow && durRow.weather_traits || [],
      marine_traits: durRow && durRow.marine_traits || [],
      fish_traits: durRow && durRow.fish_traits || [],
      related_event_ids: durRow && durRow.related_event_ids || [],
      notes_ar: durRow && durRow.notes_ar || ''
    }, durRow, 0, defaultDays);
  }

  function normalizeDurPhases(values, durRow, defaultDays) {
    var phases = sortDurPhases(values).map(function (phase, index) {
      return normalizeDurPhase(phase, durRow, index, defaultDays);
    }).filter(function (phase) {
      return phase.start_day >= 1 && phase.end_day >= phase.start_day;
    });
    return phases.length ? phases : [buildDefaultDurPhase(durRow, defaultDays)];
  }

  function normalizeDurRow(row) {
    var item = row || {};
    var defaultDaysCount = toNumber(item.default_days_count != null ? item.default_days_count : item.days_count) || DEFAULT_DURUR_LENGTH_DAYS;
    var baseRow = {
      id: normalizeString(item.id),
      dur_number: toNumber(item.dur_number),
      order_index: toNumber(item.order_index != null ? item.order_index : item.dur_number),
      default_days_count: defaultDaysCount,
      season_ar: normalizeString(item.season_ar || item.season),
      season_en: normalizeString(item.season_en),
      astronomical_marker_ar: normalizeString(item.astronomical_marker_ar || item.zodiac_ar),
      astronomical_marker_en: normalizeString(item.astronomical_marker_en || item.zodiac_en),
      zodiac_ar: normalizeString(item.astronomical_marker_ar || item.zodiac_ar),
      zodiac_en: normalizeString(item.astronomical_marker_en || item.zodiac_en),
      name_ar: normalizeString(item.name_ar || item.name),
      name_en: normalizeString(item.name_en),
      heritage_meaning_ar: normalizeString(item.heritage_meaning_ar || item.heritage_meaning),
      heritage_meaning_en: normalizeString(item.heritage_meaning_en),
      description_ar: normalizeString(item.description_ar || item.description),
      description_en: normalizeString(item.description_en),
      notes_ar: normalizeString(item.notes_ar || item.notes),
      notes_en: normalizeString(item.notes_en),
      review_status: normalizeString(item.review_status || 'draft') || 'draft',
      advice_text: normalizeString(item.advice_text),
      general_traits: normalizeStringArray(item.general_traits),
      weather_traits: normalizeStringArray(item.weather_traits),
      marine_traits: normalizeStringArray(item.marine_traits),
      fish_traits: normalizeStringArray(item.fish_traits),
      related_event_ids: uniqueStrings([].concat(item.related_event_ids || [], item.related_events || [])),
      is_active: item.is_active !== false
    };
    baseRow.phases = normalizeDurPhases(item.phases, baseRow, defaultDaysCount);
    return baseRow;
  }

  function getSeasonKeyFromDate(date) {
    var month = date.getUTCMonth() + 1;
    if (month === 12 || month <= 2) return 'winter';
    if (month <= 5) return 'spring';
    if (month <= 8) return 'summer';
    return 'autumn';
  }

  function getSeasonAliases(seasonKey) {
    if (seasonKey === 'winter') return ['winter', 'شتاء', 'الشتاء'];
    if (seasonKey === 'spring') return ['spring', 'ربيع', 'الربيع'];
    if (seasonKey === 'summer') return ['summer', 'صيف', 'الصيف'];
    if (seasonKey === 'autumn') return ['autumn', 'fall', 'خريف', 'الخريف'];
    return [];
  }

  function normalizeForMatch(value) {
    return normalizeString(value).toLowerCase();
  }

  function matchAnyName(candidate, values) {
    var target = normalizeForMatch(candidate);
    if (!target) return false;
    return toArray(values).some(function (value) {
      return normalizeForMatch(value) === target;
    });
  }

  function resolveTraitLabel(value, referenceData) {
    var raw = normalizeString(value);
    if (!raw) return '';
    var traits = toArray(referenceData && referenceData.traits_reference);
    var match = traits.find(function (item) {
      if (!item) return false;
      return matchAnyName(raw, [item.id, item.name_ar, item.name_en, item.name]);
    });
    return normalizeString(match && (match.name_ar || match.name || match.name_en) || raw);
  }

  function resolveTraitLabels(values, referenceData) {
    return uniqueStrings(normalizeStringArray(values).map(function (value) {
      return resolveTraitLabel(value, referenceData);
    }));
  }

  function findDurReference(referenceData, durRow) {
    var targetDurNumber = toNumber(durRow && durRow.dur_number);
    var targetDurId = normalizeString(durRow && durRow.id);
    return toArray(referenceData && referenceData.durur_reference).find(function (item) {
      if (!item || item.is_active === false) return false;
      var itemDurNumber = toNumber(item.dur_number);
      var itemId = normalizeString(item.id);
      return (targetDurNumber != null && itemDurNumber === targetDurNumber) || (targetDurId && itemId === targetDurId);
    }) || null;
  }

  function findStationProfile(referenceData, station, durRow) {
    var stationId = normalizeString(station && station.id);
    if (!stationId) return null;
    var targetDurId = normalizeString(durRow && durRow.id);
    var targetDurNumber = toNumber(durRow && durRow.dur_number);
    var candidates = toArray(referenceData && referenceData.station_profiles).filter(function (item) {
      return item && item.is_active !== false && normalizeString(item.station_id) === stationId;
    });
    return candidates.find(function (item) {
      var durId = normalizeString(item.dur_id);
      var durNumber = toNumber(item.dur_number);
      if (targetDurId && durId) return durId === targetDurId;
      if (targetDurNumber != null && durNumber != null) return durNumber === targetDurNumber;
      return false;
    }) || candidates[0] || null;
  }

  function normalizeOverrideFields(fields) {
    var item = fields || {};
    var out = {};
    if (Object.prototype.hasOwnProperty.call(item, 'general_traits')) out.general_traits = normalizeStringArray(item.general_traits);
    if (Object.prototype.hasOwnProperty.call(item, 'weather_traits')) out.weather_traits = normalizeStringArray(item.weather_traits);
    if (Object.prototype.hasOwnProperty.call(item, 'marine_traits')) out.marine_traits = normalizeStringArray(item.marine_traits);
    if (Object.prototype.hasOwnProperty.call(item, 'fish_traits')) out.fish_traits = normalizeStringArray(item.fish_traits);
    if (Object.prototype.hasOwnProperty.call(item, 'advice_text')) out.advice_text = normalizeString(item.advice_text) || null;
    return out;
  }

  function normalizeReferenceOverrideRow(row) {
    var item = row || {};
    return {
      override_id: normalizeString(item.override_id || item.id),
      station_id: normalizeString(item.station_id),
      dur_id: normalizeString(item.dur_id),
      phase_id: normalizeString(item.phase_id),
      season_key: normalizeForMatch(item.season_key || item.season),
      fields: normalizeOverrideFields(item.fields),
      is_active: item.is_active !== false,
      created_at: normalizeString(item.created_at),
      updated_at: normalizeString(item.updated_at)
    };
  }

  function matchesSeasonKey(overrideSeason, activeSeasonKey) {
    if (!overrideSeason) return true;
    return getSeasonAliases(activeSeasonKey).map(normalizeForMatch).indexOf(overrideSeason) >= 0;
  }

  function sortReferenceOverrides(rows) {
    return toArray(rows).slice().sort(function (a, b) {
      var aPhase = a && a.phase_id ? 1 : 0;
      var bPhase = b && b.phase_id ? 1 : 0;
      if (aPhase !== bPhase) return aPhase - bPhase;
      var aStation = a && a.station_id ? 1 : 0;
      var bStation = b && b.station_id ? 1 : 0;
      return aStation - bStation;
    });
  }

  function resolveReferenceOverrideFields(referenceData, station, durRow, activePhase, seasonKey, includePhaseSpecific) {
    var stationId = normalizeString(station && station.id);
    var durId = normalizeString(durRow && durRow.id);
    var phaseId = normalizeString(activePhase && activePhase.phase_id);
    return sortReferenceOverrides(toArray(referenceData && referenceData.reference_overrides).map(normalizeReferenceOverrideRow).filter(function (item) {
      if (!item || item.is_active === false) return false;
      if (!durId || item.dur_id !== durId) return false;
      if (!matchesSeasonKey(item.season_key, seasonKey)) return false;
      if (includePhaseSpecific) {
        if (item.phase_id && item.phase_id !== phaseId) return false;
      } else if (item.phase_id) {
        return false;
      }
      if (item.station_id && item.station_id !== stationId) return false;
      return true;
    })).reduce(function (merged, item) {
      return Object.assign(merged, item.fields || {});
    }, {});
  }

  function cloneDurRowWithOverrides(durRow, overrideFields) {
    if (!durRow) return null;
    var next = Object.assign({}, durRow);
    var fields = overrideFields || {};
    if (Object.prototype.hasOwnProperty.call(fields, 'general_traits')) next.general_traits = normalizeStringArray(fields.general_traits);
    if (Object.prototype.hasOwnProperty.call(fields, 'weather_traits')) next.weather_traits = normalizeStringArray(fields.weather_traits);
    if (Object.prototype.hasOwnProperty.call(fields, 'marine_traits')) next.marine_traits = normalizeStringArray(fields.marine_traits);
    if (Object.prototype.hasOwnProperty.call(fields, 'fish_traits')) next.fish_traits = normalizeStringArray(fields.fish_traits);
    if (Object.prototype.hasOwnProperty.call(fields, 'advice_text')) next.advice_text = normalizeString(fields.advice_text) || '';
    return next;
  }

  function resolveActiveDurPhase(durRow, dayInPeriod) {
    var phases = sortDurPhases(durRow && durRow.phases);
    if (!phases.length) return null;
    var maxDay = Math.max(1, toNumber(durRow && durRow.default_days_count) || phases[phases.length - 1].end_day || 1);
    var day = clamp(toNumber(dayInPeriod) || 1, 1, maxDay);
    for (var i = 0; i < phases.length; i += 1) {
      if (day >= phases[i].start_day && day <= phases[i].end_day) return phases[i];
    }
    return phases.find(function (phase) {
      return day < phase.start_day;
    }) || phases[phases.length - 1];
  }

  function dateRangeContains(date, startMonth, startDay, endMonth, endDay) {
    if (!startMonth || !startDay || !endMonth || !endDay) return false;
    var year = date.getUTCFullYear();
    var start = new Date(Date.UTC(year, startMonth - 1, startDay, 0, 0, 0, 0));
    var end = new Date(Date.UTC(year, endMonth - 1, endDay, 23, 59, 59, 999));
    if (end < start) {
      if (date >= start) end.setUTCFullYear(year + 1);
      else start.setUTCFullYear(year - 1);
    }
    return date >= start && date <= end;
  }

  function resolveReferenceSeasonalEvents(referenceData, durRow, analysisDate, explicitEventIds, includeDurLinked) {
    var targetDurId = normalizeString(durRow && durRow.id);
    var resolvedEventIds = uniqueStrings([].concat(explicitEventIds || []));

    return toArray(referenceData && referenceData.seasonal_events).filter(function (item) {
      if (!item || item.is_active === false) return false;
      if (resolvedEventIds.length && resolvedEventIds.indexOf(normalizeString(item.id)) >= 0) return true;
      var related = normalizeStringArray(item.related_dur_ids);
      if (includeDurLinked && targetDurId && related.indexOf(targetDurId) >= 0) return true;
      return false;
    });
  }

  function resolveSeasonalEvents(referenceData, durRow, analysisDate, runtimeOverride, activePhase) {
    var directEvents = resolveReferenceSeasonalEvents(referenceData, durRow, analysisDate, uniqueStrings([].concat(
      toArray(durRow && durRow.related_event_ids),
      toArray(activePhase && activePhase.related_event_ids),
      toArray(runtimeOverride && runtimeOverride.season_event_ids),
      toArray(runtimeOverride && runtimeOverride.seasonal_event_ids)
    )), true);
    var directIds = uniqueStrings(directEvents.map(function (item) { return normalizeString(item && item.id); }));
    var dateMatchedEvents = toArray(referenceData && referenceData.seasonal_events).filter(function (item) {
      if (!item || item.is_active === false) return false;
      if (directIds.indexOf(normalizeString(item.id)) >= 0) return false;
      return dateRangeContains(
        analysisDate,
        toNumber(item.start_hint && item.start_hint.month),
        toNumber(item.start_hint && item.start_hint.day),
        toNumber(item.end_hint && item.end_hint.month),
        toNumber(item.end_hint && item.end_hint.day)
      );
    });
    return directEvents.concat(dateMatchedEvents);
  }

  function resolveLiveEnvironment(liveInputs) {
    var input = liveInputs || {};
    var weather = input.weather || {};
    var wind = input.wind || {};
    var marine = input.marine || {};
    var tide = input.tide || {};
    return {
      temp_c: toNumber(input.temp_c != null ? input.temp_c : (weather.temp_c != null ? weather.temp_c : marine.temp_c)),
      wind_speed_kmh: toNumber(input.wind_speed_kmh != null ? input.wind_speed_kmh : (wind.speed_kmh != null ? wind.speed_kmh : weather.wind_speed_kmh)),
      wind_direction_deg: toNumber(input.wind_direction_deg != null ? input.wind_direction_deg : (wind.direction_deg != null ? wind.direction_deg : weather.wind_direction_deg)),
      wave_height_m: toNumber(input.wave_height_m != null ? input.wave_height_m : (marine.wave_height_m != null ? marine.wave_height_m : weather.wave_height_m)),
      current_speed_ms: toNumber(input.current_speed_ms != null ? input.current_speed_ms : (marine.current_speed_ms != null ? marine.current_speed_ms : tide.current_speed_ms)),
      tide_previous: toNumber(input.tide_previous != null ? input.tide_previous : tide.previous),
      tide_current: toNumber(input.tide_current != null ? input.tide_current : tide.current),
      tide_next: toNumber(input.tide_next != null ? input.tide_next : tide.next),
      explicit_tide_state: normalizeString(input.tide_state != null ? input.tide_state : tide.state)
    };
  }

  function getTideStateFromSeries(prev, current, next) {
    if (prev == null || current == null || next == null) return 'UNKNOWN';
    var amplitudeCm = Math.abs(next - prev) * 100;
    var acceleration = (Math.abs(current - prev) + Math.abs(next - current)) * 100;
    var trend = next - prev;
    var trendBoost = trend > 0.04 ? 16 : trend < -0.04 ? 10 : 0;
    var coefficient = Math.round((amplitudeCm * 1.25) + (acceleration * 0.8) + trendBoost);
    return coefficient >= 55 ? 'LOAD' : 'FASAD';
  }

  function normalizeTideState(value) {
    var raw = normalizeForMatch(value);
    if (!raw) return '';
    if (raw === 'load' || raw === 'hamal' || raw === 'حمل') return 'LOAD';
    if (raw === 'fasad' || raw === 'فساد') return 'FASAD';
    if (raw === 'unknown' || raw === 'steady') return 'UNKNOWN';
    return '';
  }

  function resolveTideState(environment) {
    var explicit = normalizeTideState(environment.explicit_tide_state);
    if (explicit) return explicit;
    var seriesState = getTideStateFromSeries(environment.tide_previous, environment.tide_current, environment.tide_next);
    if (seriesState !== 'UNKNOWN') return seriesState;
    if (environment.current_speed_ms == null) return 'UNKNOWN';
    return environment.current_speed_ms >= 0.6 ? 'LOAD' : 'FASAD';
  }

  function collectReferenceTraits(referenceData, durRow, activePhase, stationProfile, seasonalEvents, runtimeOverride) {
    var weatherTraits = [];
    var marineTraits = [];
    var seasonalTraits = [];
    var fishTraits = [];
    var generalTraits = [];

    weatherTraits = weatherTraits.concat(durRow && durRow.weather_traits || []);
    weatherTraits = weatherTraits.concat(activePhase && activePhase.weather_traits || []);
    weatherTraits = weatherTraits.concat(stationProfile && stationProfile.traits_weather || []);
    weatherTraits = weatherTraits.concat(runtimeOverride && runtimeOverride.weather_traits || []);

    marineTraits = marineTraits.concat(durRow && durRow.marine_traits || []);
    marineTraits = marineTraits.concat(activePhase && activePhase.marine_traits || []);
    marineTraits = marineTraits.concat(stationProfile && stationProfile.traits_marine || []);
    marineTraits = marineTraits.concat(runtimeOverride && runtimeOverride.marine_traits || []);

    fishTraits = fishTraits.concat(durRow && durRow.fish_traits || []);
    fishTraits = fishTraits.concat(activePhase && activePhase.fish_traits || []);
    fishTraits = fishTraits.concat(stationProfile && stationProfile.traits_fish || []);
    fishTraits = fishTraits.concat(runtimeOverride && runtimeOverride.fish_traits || []);

    generalTraits = generalTraits.concat(durRow && durRow.general_traits || []);
    generalTraits = generalTraits.concat(activePhase && activePhase.general_traits || []);
    seasonalTraits = seasonalTraits.concat(stationProfile && stationProfile.traits_seasonal_transition_traits || []);
    seasonalTraits = seasonalTraits.concat(runtimeOverride && runtimeOverride.seasonal_traits || []);

    seasonalEvents.forEach(function (eventItem) {
      weatherTraits = weatherTraits.concat(eventItem.weather_traits || []);
      marineTraits = marineTraits.concat(eventItem.marine_traits || []);
      fishTraits = fishTraits.concat(eventItem.fish_traits || []);
      seasonalTraits.push(eventItem.name_ar || eventItem.name || eventItem.name_en || '');
    });

    return {
      general_traits: uniqueStrings(generalTraits),
      weather_traits: resolveTraitLabels(weatherTraits, referenceData),
      marine_traits: resolveTraitLabels(marineTraits, referenceData),
      seasonal_traits: uniqueStrings(seasonalTraits),
      fish_traits: uniqueStrings(fishTraits)
    };
  }

  function mapSeasonalEventMetadata(seasonalEvents) {
    return toArray(seasonalEvents).map(function (eventItem) {
      return {
        id: normalizeString(eventItem && eventItem.id),
        name_ar: normalizeString(eventItem && (eventItem.name_ar || eventItem.name)),
        name_en: normalizeString(eventItem && eventItem.name_en),
        description_ar: normalizeString(eventItem && (eventItem.description_ar || eventItem.description)),
        description_en: normalizeString(eventItem && eventItem.description_en)
      };
    });
  }

  function buildDurReferenceMetadata(durRow, nextDur, seasonalEvents) {
    if (!durRow) return null;
    var eventMetadata = mapSeasonalEventMetadata(seasonalEvents);
    return {
      id: normalizeString(durRow.id),
      dur_number: toNumber(durRow.dur_number),
      order_index: toNumber(durRow.order_index),
      name_ar: normalizeString(durRow.name_ar || durRow.name),
      name_en: normalizeString(durRow.name_en),
      season_ar: normalizeString(durRow.season_ar),
      season_en: normalizeString(durRow.season_en),
      astronomical_marker_ar: normalizeString(durRow.astronomical_marker_ar || durRow.zodiac_ar),
      astronomical_marker_en: normalizeString(durRow.astronomical_marker_en || durRow.zodiac_en),
      zodiac_ar: normalizeString(durRow.zodiac_ar),
      zodiac_en: normalizeString(durRow.zodiac_en),
      default_days_count: toNumber(durRow.default_days_count),
      heritage_meaning_ar: normalizeString(durRow.heritage_meaning_ar),
      heritage_meaning_en: normalizeString(durRow.heritage_meaning_en),
      description_ar: normalizeString(durRow.description_ar),
      description_en: normalizeString(durRow.description_en),
      notes_ar: normalizeString(durRow.notes_ar),
      notes_en: normalizeString(durRow.notes_en),
      review_status: normalizeString(durRow.review_status || 'draft') || 'draft',
      advice_text: normalizeString(durRow.advice_text),
      is_active: durRow.is_active !== false,
      general_traits: uniqueStrings(durRow.general_traits || []),
      weather_traits: uniqueStrings(durRow.weather_traits || []),
      marine_traits: uniqueStrings(durRow.marine_traits || []),
      fish_traits: uniqueStrings(durRow.fish_traits || []),
      related_event_ids: uniqueStrings(durRow.related_event_ids || []),
      phases: toArray(durRow.phases).map(function (phase) {
        return {
          phase_id: normalizeString(phase && phase.phase_id),
          start_day: toNumber(phase && phase.start_day),
          end_day: toNumber(phase && phase.end_day),
          title_ar: normalizeString(phase && phase.title_ar),
          general_traits: uniqueStrings(phase && phase.general_traits || []),
          weather_traits: uniqueStrings(phase && phase.weather_traits || []),
          marine_traits: uniqueStrings(phase && phase.marine_traits || []),
          fish_traits: uniqueStrings(phase && phase.fish_traits || []),
          related_event_ids: uniqueStrings(phase && phase.related_event_ids || []),
          notes_ar: normalizeString(phase && phase.notes_ar),
          advice_text: normalizeString(phase && phase.advice_text)
        };
      }),
      seasonal_event_names: uniqueStrings(eventMetadata.map(function (eventItem) {
        return normalizeString(eventItem && (eventItem.name_ar || eventItem.name || eventItem.name_en));
      })),
      seasonal_events: eventMetadata,
      next_period_id: normalizeString(nextDur && nextDur.durRow && nextDur.durRow.id),
      next_period_name: normalizeString(nextDur && nextDur.durRow && (nextDur.durRow.name_ar || nextDur.durRow.name || nextDur.durRow.name_en))
    };
  }

  function buildActivePhaseReferenceMetadata(activePhase, seasonalEvents) {
    if (!activePhase) return null;
    var eventMetadata = mapSeasonalEventMetadata(seasonalEvents);
    return {
      phase_id: normalizeString(activePhase.phase_id),
      start_day: toNumber(activePhase.start_day),
      end_day: toNumber(activePhase.end_day),
      title_ar: normalizeString(activePhase.title_ar),
      general_traits: uniqueStrings(activePhase.general_traits || []),
      weather_traits: uniqueStrings(activePhase.weather_traits || []),
      marine_traits: uniqueStrings(activePhase.marine_traits || []),
      fish_traits: uniqueStrings(activePhase.fish_traits || []),
      related_event_ids: uniqueStrings(activePhase.related_event_ids || []),
      notes_ar: normalizeString(activePhase.notes_ar),
      advice_text: normalizeString(activePhase.advice_text),
      seasonal_event_names: uniqueStrings(eventMetadata.map(function (eventItem) {
        return normalizeString(eventItem && (eventItem.name_ar || eventItem.name || eventItem.name_en));
      })),
      seasonal_events: eventMetadata
    };
  }

  function stationSupportsFish(station, fish) {
    if (!fish || fish.status === 'archived') return false;
    var stationRegion = normalizeForMatch(station && station.region);
    var stationCountry = normalizeForMatch(station && station.country);
    var fishRegions = normalizeStringArray(fish.regions).map(normalizeForMatch);
    if (!fishRegions.length) return true;
    if (stationRegion && fishRegions.indexOf(stationRegion) >= 0) return true;
    if (stationCountry && fishRegions.indexOf(stationCountry) >= 0) return true;
    return false;
  }

  function scoreFishSpecies(station, fish, traitBundle, tideState, environment, currentDur, seasonalEvents) {
    var score = 20;
    var fishName = normalizeString(fish && (fish.name || fish.name_ar || fish.id));
    if (!fishName) return 0;
    if (matchAnyName(fishName, traitBundle.fish_traits)) score += 38;
    if (seasonalEvents.some(function (eventItem) { return matchAnyName(fishName, eventItem && eventItem.fish_traits); })) score += 16;
    if (currentDur && currentDur.durRow && matchAnyName(fishName, currentDur.durRow.fish_traits)) score += 14;
    if (tideState === 'LOAD' && environment.current_speed_ms != null && environment.current_speed_ms >= 0.6) score += 6;
    if (tideState === 'FASAD' && environment.wave_height_m != null && environment.wave_height_m <= 1.2) score += 6;
    if (stationSupportsFish(station, fish)) score += 10;
    return score;
  }

  function pickSpeciesActivity(referenceData, station, traitBundle, tideState, environment, currentDur, seasonalEvents) {
    var fishRows = toArray(referenceData && referenceData.fish_reference).filter(function (fish) {
      return fish && fish.status !== 'archived' && stationSupportsFish(station, fish);
    });

    var ranked = fishRows.map(function (fish) {
      return {
        name: normalizeString(fish.name || fish.name_ar || fish.id),
        score: scoreFishSpecies(station, fish, traitBundle, tideState, environment, currentDur, seasonalEvents)
      };
    }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name, 'ar');
    });

    var selected = ranked.filter(function (item) { return item.score > 20; }).slice(0, 5);
    if (!selected.length) selected = ranked.slice(0, 3);
    return selected.map(function (item) { return item.name; }).filter(Boolean);
  }

  function scoreValidation(referenceTraits, fieldValidation) {
    if (!fieldValidation || !Array.isArray(fieldValidation.observed_traits)) return 0;
    var expected = uniqueStrings(
      referenceTraits.weather_traits
        .concat(referenceTraits.marine_traits)
        .concat(referenceTraits.seasonal_traits)
    );
    if (!expected.length) return 0;
    var observed = uniqueStrings(fieldValidation.observed_traits);
    var matches = observed.filter(function (item) { return expected.indexOf(item) >= 0; });
    var ratio = matches.length / expected.length;
    return Math.round((ratio - 0.35) * 25);
  }

  function buildAdviceText(referenceData, station, tideState, environment, currentDur, speciesActivity, confidenceScore, runtimeOverride) {
    if (runtimeOverride && normalizeString(runtimeOverride.advice_text)) {
      return normalizeString(runtimeOverride.advice_text);
    }

    var adviceRows = toArray(referenceData && referenceData.advice_templates);
    function pickAdvice(category, fallback) {
      var match = adviceRows.find(function (item) {
        return item && item.is_active !== false && normalizeForMatch(item.category) === normalizeForMatch(category);
      });
      return normalizeString(match && (match.description_ar || match.description || match.name_ar) || fallback);
    }

    var stateAr = tideState === 'LOAD' ? 'حمل' : tideState === 'FASAD' ? 'فساد' : 'غير معروف';
    var durName = normalizeString(currentDur && currentDur.durRow && (currentDur.durRow.name_ar || currentDur.durRow.name || currentDur.durRow.name_en)) || 'الدر الحالي';
    var topSpecies = speciesActivity.length ? speciesActivity.join('، ') : 'الأنواع المحلية النشطة';
    var parts = [];

    if (environment.wind_speed_kmh != null && environment.wind_speed_kmh >= 32) {
      parts.push(pickAdvice('high_wind_caution', 'الرياح الحالية قوية وتحتاج إلى حذر إضافي قبل النزول.'));
    }
    if (environment.wave_height_m != null && environment.wave_height_m >= 1.8) {
      parts.push(pickAdvice('rough_sea_caution', 'حالة البحر متعبة حالياً ويفضل تقليل المخاطرة.'));
    }
    if (!parts.length && tideState === 'UNKNOWN') {
      parts.push(pickAdvice('transition_notice', 'القراءة البحرية غير مكتملة حالياً، فتعامل معها كنافذة انتقالية بحذر.'));
    }
    if (!parts.length && confidenceScore >= 60) {
      parts.push(pickAdvice('calm_conditions', 'الظروف الحالية مستقرة نسبياً ومناسبة لاتخاذ قرار محسوب.'));
      parts.push(pickAdvice('seasonal_opportunity', 'الفترة الموسمية الحالية تدعم نشاط الصيد في هذه المحطة.'));
    }
    if (!parts.length) {
      parts.push(pickAdvice('unstable_weather', 'الظروف متوسطة وتحتاج متابعة مباشرة قبل التحرك.'));
    }

    parts.push('المحطة: ' + (normalizeString(station && station.name) || 'نقطة مؤقتة') + ' • الدر: ' + durName + ' • الحالة: ' + stateAr + '.');
    parts.push('الأنسب حالياً: ' + topSpecies + '.');
    return uniqueStrings(parts).join(' ');
  }

  function buildFishingDecision(referenceData, station, environment, tideState, currentDur, traitBundle, seasonalEvents, runtimeOverride, fieldValidation) {
    var speciesActivity = pickSpeciesActivity(referenceData, station, traitBundle, tideState, environment, currentDur, seasonalEvents);
    var score = 30;

    if (currentDur && currentDur.durRow) score += 18;
    if (environment.temp_c != null) score += environment.temp_c >= 20 && environment.temp_c <= 33 ? 10 : 4;
    if (environment.wind_speed_kmh != null) score += environment.wind_speed_kmh <= 28 ? 12 : environment.wind_speed_kmh <= 35 ? 4 : -12;
    if (environment.wave_height_m != null) score += environment.wave_height_m <= 1.2 ? 12 : environment.wave_height_m <= 1.8 ? 4 : -16;
    if (environment.current_speed_ms != null) score += environment.current_speed_ms >= 0.45 && environment.current_speed_ms <= 1.6 ? 10 : 2;
    if (tideState === 'LOAD') score += 8;
    else if (tideState === 'FASAD') score += 4;
    else score -= 8;
    if (speciesActivity.length) score += 8;
    score += scoreValidation(traitBundle, fieldValidation);

    if (fieldValidation && normalizeForMatch(fieldValidation.water_status) === 'confirmed_land') {
      score -= 40;
    }

    var confidenceScore = clamp(Math.round(score), 0, 100);
    var isRecommended = confidenceScore >= 55 &&
      tideState !== 'UNKNOWN' &&
      (environment.wave_height_m == null || environment.wave_height_m < 1.8) &&
      (environment.wind_speed_kmh == null || environment.wind_speed_kmh < 36);

    return {
      is_recommended: isRecommended,
      species_activity: speciesActivity,
      confidence_score: confidenceScore,
      advice_text: buildAdviceText(referenceData, station, tideState, environment, currentDur, speciesActivity, confidenceScore, runtimeOverride)
    };
  }

  function normalizeReferenceData(referenceData) {
    var source = referenceData || {};
    var dururReference = sortDurRows(source.durur_master || []).map(normalizeDurRow);
    var tfr0 = source.true_final_station_reference;
    var tfr = tfr0 && typeof tfr0 === 'object' ? tfr0 : { version: 0, stations: [] };

    return {
      stations: toArray(source.stations).map(normalizeStationRecord),
      durur_reference: dururReference,
      durur_order: dururReference.map(function (item) { return item.name_ar; }).filter(Boolean),
      traits_reference: toArray(source.traits_reference || source.trait_dictionaries),
      seasonal_events: toArray(source.seasonal_events || source.season_events),
      fish_reference: toArray(source.fish_reference || source.fish_species),
      advice_templates: toArray(source.advice_templates || source.advice_basis_tags),
      station_profiles: toArray(source.station_profiles || source.station_dur_profiles),
      overrides: toArray(source.overrides || source.station_dur_overrides),
      reference_overrides: toArray(source.durur_overrides || source.reference_overrides),
      rules_config: source.rules_config || null,
      true_final_station_reference: tfr
    };
  }

  function normalizeRuntimeOverride(overrides) {
    return Object.assign({}, overrides || {});
  }

  function analyzeLiveStation(params) {
    var options = params || {};
    var referenceData = normalizeReferenceData(options.reference_data);
    var stationInput = options.station || {};
    var storedStation = findStoredStation(referenceData, stationInput);
    var station = normalizeStationRecord(Object.assign({}, storedStation || {}, stationInput || {}));

    var analysisDateTime = parseAnalysisDateTime(options.datetime);
    var analysisDate = startOfUtcDay(analysisDateTime);
    var runtimeOverride = normalizeRuntimeOverride(options.overrides);
    var liveEnvironment = resolveLiveEnvironment(options.live_inputs);
    var tideState = resolveTideState(liveEnvironment);
    var asOfIso = analysisDate && analysisDate.toISOString ? analysisDate.toISOString().slice(0, 10) : '';
    var trueFinalDoc = referenceData.true_final_station_reference;
    var stationsArr = trueFinalDoc && Array.isArray(trueFinalDoc.stations) ? trueFinalDoc.stations : [];

    function failResponse(timingError) {
      return {
        station_id: station.id || null,
        analysis_timestamp: analysisDateTime.toISOString(),
        true_final_lookup_failed: true,
        operational_workbook_inactive: true,
        legacy_suhail_engine_inactive: true,
        dur: {
          timing_error: timingError,
          period_id: '',
          period_number: null,
          period_name: '',
          day_in_period: null,
          next_period_id: '',
          next_period_name: '',
          days_remaining: null,
          period_start_date: '',
          period_end_date: '',
          next_period_start_date: '',
          next_period_end_date: '',
          timing_resolution: 'true_final_error',
          timing_as_of: asOfIso,
          timing_from_resolved_local: false,
          timing_from_operational_workbook: false,
          suhail_anchor_date: '',
          base_suhail_anchor_date: '',
          cycle_start_date: '',
          timing_source: 'true_final_station_reference',
          timing_source_label_ar: '',
          calibration_reference_station_id: '',
          calibration_reference_station_name: '',
          calibration_latitude_band_key: '',
          calibration_selection_reason: '',
          calibration_delta_days: 0,
          reference: { periods: [] },
          active_phase_id: '',
          active_phase_reference: { events: [] },
          overrides_applied: false
        },
        environment: {
          temp_c: liveEnvironment.temp_c,
          wind_speed_kmh: liveEnvironment.wind_speed_kmh,
          wind_direction_deg: liveEnvironment.wind_direction_deg,
          wave_height_m: liveEnvironment.wave_height_m
        },
        tide: { state: tideState, current_speed_ms: liveEnvironment.current_speed_ms },
        fishing: { is_recommended: false, species_activity: [], confidence_score: 0, advice_text: '' }
      };
    }

    if (!getTrueFinalDurState) {
      return failResponse({ code: 'TRUE_FINAL_MODULE_MISSING', message: 'true_final_station_reference lookup not available' });
    }
    if (!trueFinalDoc || !stationsArr.length) {
      return failResponse({ code: 'TRUE_FINAL_DATA_REQUIRED', message: 'data/true_final_station_reference.json is missing, empty, or invalid' });
    }
    if (!asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) {
      return failResponse({ code: 'INVALID_ANALYSIS_DATE', message: 'analysis date must be a valid calendar day' });
    }
    if (!normalizeString(station.name)) {
      return failResponse({ code: 'STATION_NAME_REQUIRED', message: 'station name (Arabic) required to match true_final_station_reference' });
    }

    var tf;
    try {
      tf = getTrueFinalDurState(trueFinalDoc, { station_name_ar: station.name, asOfIso: asOfIso });
    } catch (tfEx) {
      tf = { ok: false, code: 'EXCEPTION', message: String((tfEx && tfEx.message) || tfEx) };
    }
    if (!tf || !tf.ok) {
      return failResponse(tf && !tf.ok ? { code: tf.code, message: tf.message, detail: tf } : { code: 'TRUE_FINAL_LOOKUP_FAILED', message: 'station not in true_final dataset or as_of outside window' });
    }

    var tfDurRow = {
      id: 'true_final:' + normalizeString(station.id),
      name_ar: tf.current_dur_name_ar,
      name: '',
      name_en: '',
      dur_number: null,
      order_index: null,
      default_days_count: null,
      phases: []
    };
    var tfNextRow = {
      id: '',
      name_ar: tf.next_dur_name_ar,
      name: '',
      name_en: '',
      dur_number: null,
      order_index: null,
      default_days_count: null,
      phases: []
    };
    var tfStart = tf._fishing_start;
    var tfEnd = tf._fishing_end;
    var minTfCurrent = { durRow: tfDurRow, start: tfStart, end: tfEnd };
    var minTfNext = { durRow: tfNextRow, start: null, end: null };
    var tfRefOnly = buildDurReferenceMetadata(tfDurRow, minTfNext, []);
    var fishingTf = buildFishingDecision(
      referenceData,
      station,
      liveEnvironment,
      tideState,
      minTfCurrent,
      {},
      [],
      runtimeOverride,
      options.field_validation || null
    );
    return {
      station_id: station.id || null,
      analysis_timestamp: analysisDateTime.toISOString(),
      true_final_reference_active: true,
      operational_workbook_inactive: true,
      legacy_suhail_engine_inactive: true,
      dur: {
        period_id: normalizeString(tfDurRow.id),
        period_number: null,
        period_name: normalizeString(tf.current_dur_name_ar),
        period_start: normalizeString(tf.period_start_mmdd),
        period_end: normalizeString(tf.period_end_mmdd),
        day_in_period: toNumber(tf.day_in_dur),
        next_period_id: '',
        next_period_name: normalizeString(tf.next_dur_name_ar),
        days_remaining: toNumber(tf.days_remaining_in_dur),
        timing_mode: 'month_day_only',
        source: 'true_final_station_reference',
        period_start_date: '',
        period_end_date: '',
        next_period_start_date: '',
        next_period_end_date: '',
        timing_resolution: 'navidur_seasonal_engine_v1',
        timing_as_of: asOfIso,
        timing_from_resolved_local: true,
        timing_from_operational_workbook: false,
        suhail_anchor_date: '',
        base_suhail_anchor_date: '',
        cycle_start_date: '',
        timing_source: 'true_final_station_reference',
        timing_source_label_ar: 'محرك المواسم NAVIDUR — مرجع محطة واحد (يوم/شهر)',
        calibration_reference_station_id: '',
        calibration_reference_station_name: '',
        calibration_latitude_band_key: '',
        calibration_selection_reason: 'true_final_seasonal_dataset_only',
        calibration_delta_days: 0,
        reference: tfRefOnly,
        active_phase_id: '',
        active_phase_reference: null,
        overrides_applied: false,
        true_final_station_workbook: 'navidur_true_final_station_reference',
        true_final_data_json: 'true_final_station_reference.json'
      },
      environment: {
        temp_c: liveEnvironment.temp_c,
        wind_speed_kmh: liveEnvironment.wind_speed_kmh,
        wind_direction_deg: liveEnvironment.wind_direction_deg,
        wave_height_m: liveEnvironment.wave_height_m
      },
      tide: { state: tideState, current_speed_ms: liveEnvironment.current_speed_ms },
      fishing: {
        is_recommended: fishingTf.is_recommended,
        species_activity: fishingTf.species_activity,
        confidence_score: fishingTf.confidence_score,
        advice_text: fishingTf.advice_text
      }
    };
  }

  return {
    analyzeLiveStation: analyzeLiveStation
  };
});
