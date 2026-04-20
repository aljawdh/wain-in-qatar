;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.NavidurAnalysisEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

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

  var SOHAIL_STATION_ANCHORS = {
    'جازان': { month: 8, day: 16 },
    'فرسان': { month: 8, day: 16 },
    'صلالة': { month: 8, day: 16 },
    'الدقم': { month: 8, day: 19 },
    'القنفذة': { month: 8, day: 19 },
    'جدة': { month: 8, day: 20 },
    'الليث': { month: 8, day: 20 },
    'رابغ': { month: 8, day: 22 },
    'ينبع': { month: 8, day: 23 },
    'أبوظبي': { month: 8, day: 23 },
    'مسقط': { month: 8, day: 23 },
    'أملج': { month: 8, day: 23 },
    'صحار': { month: 8, day: 23 },
    'مسندم (خصب)': { month: 8, day: 23 },
    'الفجيرة': { month: 8, day: 23 },
    'بوشهر': { month: 8, day: 23 },
    'الدوحة': { month: 8, day: 24 },
    'دبي': { month: 8, day: 24 },
    'العقير': { month: 8, day: 24 },
    'الخور': { month: 8, day: 24 },
    'الرويس': { month: 8, day: 24 },
    'المنامة': { month: 8, day: 25 },
    'الخبر': { month: 8, day: 25 },
    'الدمام': { month: 8, day: 25 },
    'الجبيل': { month: 8, day: 26 },
    'خفجي': { month: 8, day: 27 },
    'ضبا': { month: 8, day: 27 },
    'الوجه': { month: 8, day: 27 },
    'حقل': { month: 8, day: 27 },
    'نيوم': { month: 8, day: 27 },
    'الكويت': { month: 8, day: 28 },
    'الجهراء': { month: 8, day: 28 }
  };

  var DURUR_CYCLE_ALIGNMENT_OFFSET_DAYS = 106;
  var DEFAULT_DURUR_LENGTH_DAYS = 13;

  function normalizeStationName(value) {
    return normalizeString(value);
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getFallbackSuhailAnchorDay(station) {
    var lat = toNumber(station && station.lat);
    if (lat == null) return 24;
    return clampNumber(Math.round(24 + ((lat - 25.3) * 0.75)), 16, 28);
  }

  function getStationSuhailAnchorConfig(station) {
    var byName = SOHAIL_STATION_ANCHORS[normalizeStationName(station && station.name)];
    if (byName) return { month: byName.month, day: byName.day, source: 'station_lookup' };
    return { month: 8, day: getFallbackSuhailAnchorDay(station), source: 'latitude_fallback' };
  }

  function createUtcDate(year, month, day) {
    return new Date(Date.UTC(Number(year || new Date().getUTCFullYear()), Number(month || 1) - 1, Number(day || 1), 0, 0, 0, 0));
  }

  function getStationSuhailAnchorDate(station, year) {
    var cfg = getStationSuhailAnchorConfig(station);
    return createUtcDate(year, cfg.month, cfg.day);
  }

  function getRelevantSuhailAnchor(station, analysisDate) {
    var year = analysisDate.getUTCFullYear();
    var currentAnchor = getStationSuhailAnchorDate(station, year);
    var currentCycleStart = addDays(currentAnchor, -DURUR_CYCLE_ALIGNMENT_OFFSET_DAYS);
    if (analysisDate >= currentCycleStart) return currentAnchor;
    return getStationSuhailAnchorDate(station, year - 1);
  }

  function getDaysBetween(start, end) {
    return Math.floor((end.getTime() - start.getTime()) / 86400000);
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
      notes_ar: normalizeString(item.notes_ar)
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

  function findStoredOverride(referenceData, station, durRow, seasonKey) {
    var stationId = normalizeString(station && station.id);
    if (!stationId) return null;
    var targetDurNumber = toNumber(durRow && durRow.dur_number);
    var targetDurId = normalizeString(durRow && durRow.id);
    var allowedSeasons = getSeasonAliases(seasonKey).map(normalizeForMatch);
    return toArray(referenceData && referenceData.overrides).find(function (item) {
      if (!item || item.is_active === false) return false;
      if (normalizeString(item.station_id) !== stationId) return false;
      var itemDurNumber = toNumber(item.dur_number);
      var itemDurId = normalizeString(item.dur_id);
      if (targetDurId && itemDurId && itemDurId !== targetDurId) return false;
      if (targetDurNumber != null && itemDurNumber != null && itemDurNumber !== targetDurNumber) return false;
      var seasonValue = normalizeForMatch(item.season_key || item.season || '');
      if (seasonValue && allowedSeasons.length && allowedSeasons.indexOf(seasonValue) < 0) return false;
      return true;
    }) || null;
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

  function buildDurTimeline(referenceData, station, analysisDate, runtimeOverride) {
    var durRows = sortDurRows(referenceData && referenceData.durur_reference);
    if (!durRows.length) return { current: null, next: null };

    var suhailStart = getRelevantSuhailAnchor(station, analysisDate);
    var seasonKey = getSeasonKeyFromDate(analysisDate);
    var cycleStart = addDays(suhailStart, -DURUR_CYCLE_ALIGNMENT_OFFSET_DAYS);
    var cursor = cycleStart;

    var timeline = durRows.map(function (durRow, index) {
      var daysCount = Math.max(1, Number(durRow && durRow.default_days_count || DEFAULT_DURUR_LENGTH_DAYS));
      var storedOverride = findStoredOverride(referenceData, station, durRow, seasonKey) || {};
      var mergedOverride = Object.assign({}, storedOverride, runtimeOverride || {});
      var start = addDays(cursor, toNumber(mergedOverride.start_offset_days) || 0);
      var end = addDays(start, daysCount - 1);
      end = addDays(end, toNumber(mergedOverride.end_offset_days) || 0);
      var item = {
        durRow: durRow,
        start: start,
        end: end
      };
      cursor = addDays(end, 1);
      return item;
    });

    var current = null;
    for (var i = 0; i < timeline.length; i += 1) {
      if (analysisDate >= timeline[i].start && analysisDate <= timeline[i].end) {
        current = timeline[i];
        break;
      }
    }
    if (!current) {
      current = timeline.find(function (item) {
        return analysisDate < item.start;
      }) || timeline[timeline.length - 1];
    }

    var currentIndex = timeline.indexOf(current);
    var next = timeline[(currentIndex + 1) % timeline.length];
    return {
      current: current,
      next: next,
      timeline: timeline,
      suhail_anchor: suhailStart,
      cycle_start: timeline[0] ? timeline[0].start : cycleStart
    };
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
          notes_ar: normalizeString(phase && phase.notes_ar)
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

    return {
      durur_reference: dururReference,
      durur_order: dururReference.map(function (item) { return item.name_ar; }).filter(Boolean),
      traits_reference: toArray(source.traits_reference || source.trait_dictionaries),
      seasonal_events: toArray(source.seasonal_events || source.season_events),
      fish_reference: toArray(source.fish_reference || source.fish_species),
      advice_templates: toArray(source.advice_templates || source.advice_basis_tags),
      station_profiles: toArray(source.station_profiles || source.station_dur_profiles),
      overrides: toArray(source.overrides || source.station_dur_overrides),
      rules_config: source.rules_config || null
    };
  }

  function normalizeRuntimeOverride(overrides) {
    return Object.assign({}, overrides || {});
  }

  function analyzeLiveStation(params) {
    var options = params || {};
    var referenceData = normalizeReferenceData(options.reference_data);
    var stationInput = options.station || {};
    var station = {
      id: normalizeString(stationInput.id) || null,
      name: normalizeString(stationInput.name),
      lat: toNumber(stationInput.lat),
      lon: toNumber(stationInput.lon != null ? stationInput.lon : stationInput.lng),
      country: normalizeString(stationInput.country),
      region: normalizeString(stationInput.region)
    };

    var analysisDateTime = parseAnalysisDateTime(options.datetime);
    var analysisDate = startOfUtcDay(analysisDateTime);
    var runtimeOverride = normalizeRuntimeOverride(options.overrides);
    var liveEnvironment = resolveLiveEnvironment(options.live_inputs);
    var tideState = resolveTideState(liveEnvironment);
    var durInfo = buildDurTimeline(referenceData, station, analysisDate, runtimeOverride);
    var currentDur = durInfo.current;
    var nextDur = durInfo.next;
    var stationProfile = findStationProfile(referenceData, station, currentDur && currentDur.durRow);
    var dayInPeriod = currentDur ? (getDaysBetween(currentDur.start, analysisDate) + 1) : null;
    var activePhase = resolveActiveDurPhase(currentDur && currentDur.durRow, dayInPeriod);
    var baseReferenceEvents = resolveReferenceSeasonalEvents(
      referenceData,
      currentDur && currentDur.durRow,
      analysisDate,
      currentDur && currentDur.durRow && currentDur.durRow.related_event_ids,
      true
    );
    var activePhaseEvents = resolveReferenceSeasonalEvents(
      referenceData,
      currentDur && currentDur.durRow,
      analysisDate,
      activePhase && activePhase.related_event_ids,
      false
    );
    var seasonalEvents = resolveSeasonalEvents(referenceData, currentDur && currentDur.durRow, analysisDate, runtimeOverride, activePhase);
    var traitBundle = collectReferenceTraits(
      referenceData,
      currentDur && currentDur.durRow,
      activePhase,
      stationProfile,
      seasonalEvents,
      runtimeOverride
    );
    var durReferenceMetadata = buildDurReferenceMetadata(
      currentDur && currentDur.durRow,
      nextDur,
      baseReferenceEvents
    );
    var activePhaseReferenceMetadata = buildActivePhaseReferenceMetadata(activePhase, activePhaseEvents);

    var fishing = buildFishingDecision(
      referenceData,
      station,
      liveEnvironment,
      tideState,
      currentDur,
      traitBundle,
      seasonalEvents,
      runtimeOverride,
      options.field_validation || null
    );

    return {
      station_id: station.id || null,
      analysis_timestamp: analysisDateTime.toISOString(),
      dur: {
        period_id: currentDur && currentDur.durRow ? normalizeString(currentDur.durRow.id) : '',
        period_number: currentDur && currentDur.durRow ? toNumber(currentDur.durRow.dur_number) : null,
        period_name: currentDur && currentDur.durRow ? normalizeString(currentDur.durRow.name_ar || currentDur.durRow.name || currentDur.durRow.name_en) : '',
        day_in_period: dayInPeriod,
        next_period_id: nextDur && nextDur.durRow ? normalizeString(nextDur.durRow.id) : '',
        next_period_name: nextDur && nextDur.durRow ? normalizeString(nextDur.durRow.name_ar || nextDur.durRow.name || nextDur.durRow.name_en) : '',
        days_remaining: currentDur && currentDur.end ? Math.max(0, getDaysBetween(analysisDate, currentDur.end)) : null,
        suhail_anchor_date: durInfo && durInfo.suhail_anchor ? durInfo.suhail_anchor.toISOString().slice(0, 10) : '',
        reference: durReferenceMetadata,
        active_phase_id: normalizeString(activePhase && activePhase.phase_id),
        active_phase_reference: activePhaseReferenceMetadata
      },
      environment: {
        temp_c: liveEnvironment.temp_c,
        wind_speed_kmh: liveEnvironment.wind_speed_kmh,
        wind_direction_deg: liveEnvironment.wind_direction_deg,
        wave_height_m: liveEnvironment.wave_height_m
      },
      tide: {
        state: tideState,
        current_speed_ms: liveEnvironment.current_speed_ms
      },
      fishing: {
        is_recommended: fishing.is_recommended,
        species_activity: fishing.species_activity,
        confidence_score: fishing.confidence_score,
        advice_text: fishing.advice_text
      }
    };
  }

  return {
    analyzeLiveStation: analyzeLiveStation
  };
});
