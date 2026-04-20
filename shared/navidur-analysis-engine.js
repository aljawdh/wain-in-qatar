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

  function calculateSuhailStart(lat, year) {
    var safeLat = toNumber(lat);
    var base = new Date(Date.UTC(Number(year || new Date().getUTCFullYear()), 7, 15));
    if (safeLat == null) return base;
    var offsetDays = Math.floor((25 - safeLat) * 2);
    base.setUTCDate(base.getUTCDate() + offsetDays);
    return base;
  }

  function sortDurRows(rows) {
    return toArray(rows).slice().sort(function (a, b) {
      return Number(a && a.dur_number || 0) - Number(b && b.dur_number || 0);
    });
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

  function buildDurTimeline(referenceData, station, analysisDate, runtimeOverride) {
    var durRows = sortDurRows(referenceData && referenceData.durur_reference);
    if (!durRows.length) return { current: null, next: null };

    var year = analysisDate.getUTCFullYear();
    var suhailStart = calculateSuhailStart(station && station.lat, year);
    var seasonKey = getSeasonKeyFromDate(analysisDate);

    var timeline = durRows.map(function (durRow, index) {
      var start = addDays(suhailStart, index * 13);
      var end = addDays(start, Math.max(0, Number(durRow.days_count || durRow.default_days_count || 13) - 1));
      var storedOverride = findStoredOverride(referenceData, station, durRow, seasonKey) || {};
      var mergedOverride = Object.assign({}, storedOverride, runtimeOverride || {});
      start = addDays(start, toNumber(mergedOverride.start_offset_days) || 0);
      end = addDays(end, toNumber(mergedOverride.end_offset_days) || 0);
      return {
        durRow: durRow,
        start: start,
        end: end
      };
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
    return { current: current, next: next };
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

  function resolveSeasonalEvents(referenceData, durRow, analysisDate, runtimeOverride) {
    var targetDurId = normalizeString(durRow && durRow.id);
    var overrideEventIds = uniqueStrings([].concat(
      toArray(runtimeOverride && runtimeOverride.season_event_ids),
      toArray(runtimeOverride && runtimeOverride.seasonal_event_ids)
    ));

    return toArray(referenceData && referenceData.seasonal_events).filter(function (item) {
      if (!item || item.is_active === false) return false;
      if (overrideEventIds.length && overrideEventIds.indexOf(normalizeString(item.id)) >= 0) return true;
      var related = normalizeStringArray(item.related_dur_ids);
      if (targetDurId && related.indexOf(targetDurId) >= 0) return true;
      return dateRangeContains(
        analysisDate,
        toNumber(item.start_hint && item.start_hint.month),
        toNumber(item.start_hint && item.start_hint.day),
        toNumber(item.end_hint && item.end_hint.month),
        toNumber(item.end_hint && item.end_hint.day)
      );
    });
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

  function collectReferenceTraits(referenceData, durRow, durReference, stationProfile, seasonalEvents, runtimeOverride) {
    var weatherTraits = [];
    var marineTraits = [];
    var seasonalTraits = [];
    var fishTraits = [];

    weatherTraits = weatherTraits.concat(durRow && durRow.weather_traits || []);
    weatherTraits = weatherTraits.concat(durReference && durReference.weather_traits || []);
    weatherTraits = weatherTraits.concat(stationProfile && stationProfile.traits_weather || []);
    weatherTraits = weatherTraits.concat(runtimeOverride && runtimeOverride.weather_traits || []);

    marineTraits = marineTraits.concat(durRow && durRow.marine_traits || []);
    marineTraits = marineTraits.concat(durReference && durReference.marine_traits || []);
    marineTraits = marineTraits.concat(stationProfile && stationProfile.traits_marine || []);
    marineTraits = marineTraits.concat(runtimeOverride && runtimeOverride.marine_traits || []);

    fishTraits = fishTraits.concat(durRow && durRow.fish_traits || []);
    fishTraits = fishTraits.concat(durReference && durReference.fish_traits || []);
    fishTraits = fishTraits.concat(stationProfile && stationProfile.traits_fish || []);
    fishTraits = fishTraits.concat(runtimeOverride && runtimeOverride.fish_traits || []);

    seasonalTraits = seasonalTraits.concat(stationProfile && stationProfile.traits_seasonal_transition_traits || []);
    seasonalTraits = seasonalTraits.concat(runtimeOverride && runtimeOverride.seasonal_traits || []);

    seasonalEvents.forEach(function (eventItem) {
      weatherTraits = weatherTraits.concat(eventItem.weather_traits || []);
      marineTraits = marineTraits.concat(eventItem.marine_traits || []);
      fishTraits = fishTraits.concat(eventItem.fish_traits || []);
      seasonalTraits.push(eventItem.name_ar || eventItem.name || eventItem.name_en || '');
    });

    return {
      weather_traits: resolveTraitLabels(weatherTraits, referenceData),
      marine_traits: resolveTraitLabels(marineTraits, referenceData),
      seasonal_traits: uniqueStrings(seasonalTraits),
      fish_traits: uniqueStrings(fishTraits)
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
    var dururReference = sortDurRows(
      source.durur_reference ||
      source.durur ||
      (source.durur_reference_seed && source.durur_reference_seed.durur_master) ||
      []
    );

    return {
      durur_reference: dururReference,
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
    var durReference = findDurReference(referenceData, currentDur && currentDur.durRow);
    var stationProfile = findStationProfile(referenceData, station, currentDur && currentDur.durRow);
    var seasonalEvents = resolveSeasonalEvents(referenceData, currentDur && currentDur.durRow, analysisDate, runtimeOverride);
    var traitBundle = collectReferenceTraits(
      referenceData,
      currentDur && currentDur.durRow,
      durReference,
      stationProfile,
      seasonalEvents,
      runtimeOverride
    );

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
        period_number: currentDur && currentDur.durRow ? toNumber(currentDur.durRow.dur_number) : null,
        period_name: currentDur && currentDur.durRow ? normalizeString(currentDur.durRow.name_ar || currentDur.durRow.name || currentDur.durRow.name_en) : '',
        next_period_name: nextDur && nextDur.durRow ? normalizeString(nextDur.durRow.name_ar || nextDur.durRow.name || nextDur.durRow.name_en) : '',
        days_remaining: currentDur && currentDur.end ? Math.max(0, Math.ceil((currentDur.end.getTime() - analysisDate.getTime()) / 86400000)) : null
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
