;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.NavidurSnapshotValidation = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SUPPORTED_VALIDATION_TRAITS = [
    'جو حار وجاف',
    'جو بارد',
    'اعتدال الجو',
    'بحر مضطرب',
    'نشاط الموج',
    'بحر هادئ',
    'تيار قوي',
    'نشاط التيارات',
    'تيار خفيف',
    'رياح قوية',
    'رياح متوسطة',
    'رياح خفيفة',
    'جو متقلب',
    'جو متقلب وغير مستقر',
    'عواصف قوية',
    'حمل',
    'فساد'
  ];

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function toNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

  function mapTideStateToArabic(state) {
    if (state === 'LOAD') return 'حمل';
    if (state === 'FASAD') return 'فساد';
    return 'غير معروف';
  }

  function deriveObservedTraitsFromDto(dto) {
    var environment = dto && dto.environment ? dto.environment : {};
    var tide = dto && dto.tide ? dto.tide : {};
    var traits = [];

    if (environment.wave_height_m != null) {
      if (environment.wave_height_m >= 1.5) traits.push('بحر مضطرب');
      else if (environment.wave_height_m >= 0.7) traits.push('نشاط الموج');
      else traits.push('بحر هادئ');
    }
    if (tide.current_speed_ms != null) {
      if (tide.current_speed_ms >= 0.8) traits.push('تيار قوي');
      else if (tide.current_speed_ms >= 0.45) traits.push('نشاط التيارات');
      else traits.push('تيار خفيف');
    }
    if (environment.wind_speed_kmh != null) {
      if (environment.wind_speed_kmh >= 30) traits.push('رياح قوية');
      else if (environment.wind_speed_kmh >= 18) traits.push('رياح متوسطة');
      else traits.push('رياح خفيفة');
    }
    if (environment.temp_c != null) {
      if (environment.temp_c >= 31) traits.push('جو حار وجاف');
      else if (environment.temp_c <= 18) traits.push('جو بارد');
      else traits.push('اعتدال الجو');
    }
    if (environment.wind_speed_kmh != null || environment.wave_height_m != null) {
      if ((environment.wind_speed_kmh != null && environment.wind_speed_kmh >= 36) ||
          (environment.wave_height_m != null && environment.wave_height_m >= 1.8)) {
        traits.push('عواصف قوية');
        traits.push('جو متقلب وغير مستقر');
      } else if ((environment.wind_speed_kmh != null && environment.wind_speed_kmh >= 24) ||
                 (environment.wave_height_m != null && environment.wave_height_m >= 1.1)) {
        traits.push('جو متقلب');
      }
    }
    if (tide && tide.state === 'LOAD') traits.push('حمل');
    else if (tide && tide.state === 'FASAD') traits.push('فساد');
    return uniqueStrings(traits);
  }

  function normalizeReferenceSummary(reference) {
    if (!reference) return null;
    return {
      id: normalizeString(reference.id),
      name_ar: normalizeString(reference.name_ar),
      season_ar: normalizeString(reference.season_ar),
      heritage_meaning_ar: normalizeString(reference.heritage_meaning_ar),
      description_ar: normalizeString(reference.description_ar),
      notes_ar: normalizeString(reference.notes_ar),
      general_traits: uniqueStrings(reference.general_traits || []),
      weather_traits: uniqueStrings(reference.weather_traits || []),
      marine_traits: uniqueStrings(reference.marine_traits || []),
      fish_traits: uniqueStrings(reference.fish_traits || []),
      related_event_ids: uniqueStrings(reference.related_event_ids || []),
      seasonal_event_names: uniqueStrings(reference.seasonal_event_names || [])
    };
  }

  function normalizePhaseSummary(reference) {
    if (!reference) return null;
    return {
      phase_id: normalizeString(reference.phase_id),
      title_ar: normalizeString(reference.title_ar) || null,
      start_day: toNumber(reference.start_day),
      end_day: toNumber(reference.end_day),
      notes_ar: normalizeString(reference.notes_ar),
      general_traits: uniqueStrings(reference.general_traits || []),
      weather_traits: uniqueStrings(reference.weather_traits || []),
      marine_traits: uniqueStrings(reference.marine_traits || []),
      fish_traits: uniqueStrings(reference.fish_traits || []),
      related_event_ids: uniqueStrings(reference.related_event_ids || []),
      seasonal_event_names: uniqueStrings(reference.seasonal_event_names || [])
    };
  }

  function collectExpectedTraits(dto) {
    var durReference = dto && dto.dur ? dto.dur.reference : null;
    var phaseReference = dto && dto.dur ? dto.dur.active_phase_reference : null;
    var allExpected = uniqueStrings([]
      .concat(durReference && durReference.general_traits || [])
      .concat(durReference && durReference.weather_traits || [])
      .concat(durReference && durReference.marine_traits || [])
      .concat(phaseReference && phaseReference.general_traits || [])
      .concat(phaseReference && phaseReference.weather_traits || [])
      .concat(phaseReference && phaseReference.marine_traits || [])
    );
    var comparable = allExpected.filter(function (trait) {
      return SUPPORTED_VALIDATION_TRAITS.indexOf(trait) >= 0;
    });
    var unsupported = allExpected.filter(function (trait) {
      return comparable.indexOf(trait) < 0;
    });
    return {
      comparable: comparable,
      unsupported: unsupported,
      all: allExpected
    };
  }

  function summarizeObservedWeather(dto) {
    var environment = dto && dto.environment ? dto.environment : {};
    return {
      temp_c: toNumber(environment.temp_c),
      wind_speed_kmh: toNumber(environment.wind_speed_kmh),
      wind_direction_deg: toNumber(environment.wind_direction_deg),
      derived_traits: uniqueStrings(deriveObservedTraitsFromDto({
        environment: {
          temp_c: environment.temp_c,
          wind_speed_kmh: environment.wind_speed_kmh,
          wind_direction_deg: environment.wind_direction_deg
        },
        tide: {}
      }).filter(function (trait) {
        return trait !== 'حمل' && trait !== 'فساد' &&
          ['بحر مضطرب', 'نشاط الموج', 'بحر هادئ', 'تيار قوي', 'نشاط التيارات', 'تيار خفيف'].indexOf(trait) < 0;
      }))
    };
  }

  function summarizeObservedMarine(dto) {
    var environment = dto && dto.environment ? dto.environment : {};
    var tide = dto && dto.tide ? dto.tide : {};
    return {
      wave_height_m: toNumber(environment.wave_height_m),
      current_speed_ms: toNumber(tide.current_speed_ms),
      derived_traits: uniqueStrings(deriveObservedTraitsFromDto({
        environment: {
          wave_height_m: environment.wave_height_m
        },
        tide: {
          current_speed_ms: tide.current_speed_ms
        }
      }).filter(function (trait) {
        return ['بحر مضطرب', 'نشاط الموج', 'بحر هادئ', 'تيار قوي', 'نشاط التيارات', 'تيار خفيف'].indexOf(trait) >= 0;
      }))
    };
  }

  function summarizeObservedTide(dto) {
    var tide = dto && dto.tide ? dto.tide : {};
    var stateAr = mapTideStateToArabic(tide.state);
    return {
      state: normalizeString(tide.state),
      state_ar: stateAr === 'غير معروف' ? '' : stateAr,
      current_speed_ms: toNumber(tide.current_speed_ms),
      derived_traits: stateAr === 'غير معروف' ? [] : [stateAr]
    };
  }

  function buildExpectedReferenceSummary(dto) {
    var durReference = dto && dto.dur ? dto.dur.reference : null;
    var phaseReference = dto && dto.dur ? dto.dur.active_phase_reference : null;
    var expectedTraits = collectExpectedTraits(dto);
    return {
      dur_reference: normalizeReferenceSummary(durReference),
      active_phase_reference: normalizePhaseSummary(phaseReference),
      expected_traits: expectedTraits.all,
      comparable_expected_traits: expectedTraits.comparable,
      unsupported_reference_traits: expectedTraits.unsupported
    };
  }

  function buildValidationResult(dto, fieldValidation, notes) {
    var expected = collectExpectedTraits(dto);
    var observed = deriveObservedTraitsFromDto(dto);
    var matched = expected.comparable.filter(function (trait) {
      return observed.indexOf(trait) >= 0;
    });
    var failed = expected.comparable.filter(function (trait) {
      return matched.indexOf(trait) < 0;
    });
    var extra = observed.filter(function (trait) {
      return expected.comparable.indexOf(trait) < 0;
    });
    var expectedCount = expected.comparable.length;
    var matchedCount = matched.length;
    var coverage = expectedCount ? (matchedCount / expectedCount) : 0;
    var penalty = extra.length ? (extra.length / Math.max(1, observed.length)) * 20 : 0;
    var score = expectedCount ? clamp(Math.round((coverage * 100) - penalty), 0, 100) : 0;
    var status = 'needs_review';
    if (!expectedCount) status = 'needs_review';
    else if (matchedCount === expectedCount && extra.length === 0) status = 'matched';
    else if (matchedCount === 0) status = 'failed';
    else status = 'partial';

    var noteParts = [];
    if (expected.unsupported.length) noteParts.push('unsupported_reference_traits: ' + expected.unsupported.join(', '));
    if (fieldValidation && Array.isArray(fieldValidation.observed_traits) && fieldValidation.observed_traits.length) {
      noteParts.push('field_observed_traits: ' + uniqueStrings(fieldValidation.observed_traits).join(', '));
    }
    if (normalizeString(notes)) noteParts.push(normalizeString(notes));

    return {
      expected_traits: expected.comparable,
      observed_traits: observed,
      matched_traits: matched,
      failed_traits: failed,
      extra_traits: extra,
      validation_score: score,
      validation_status: status,
      notes: noteParts.join(' | ') || null,
      field_observed_traits: fieldValidation && Array.isArray(fieldValidation.observed_traits)
        ? uniqueStrings(fieldValidation.observed_traits)
        : []
    };
  }

  function buildSnapshotRecord(input) {
    var dto = input && input.dto ? input.dto : {};
    var station = input && input.station ? input.station : {};
    var observedTraits = deriveObservedTraitsFromDto(dto);
    return {
      snapshot_id: normalizeString(input && input.snapshot_id),
      station_id: normalizeString(station.id || input && input.station_id),
      station_name: normalizeString(station.name || input && input.station_name),
      timestamp: normalizeString(input && input.timestamp),
      analysis_date: normalizeString(dto.analysis_timestamp || '').slice(0, 10),
      dur_id: normalizeString(dto && dto.dur && dto.dur.period_id),
      dur_name: normalizeString(dto && dto.dur && dto.dur.period_name),
      day_in_period: toNumber(dto && dto.dur && dto.dur.day_in_period),
      active_phase_id: normalizeString(dto && dto.dur && dto.dur.active_phase_id),
      expected_reference_summary: buildExpectedReferenceSummary(dto),
      observed_weather: summarizeObservedWeather(dto),
      observed_marine: summarizeObservedMarine(dto),
      observed_tide: summarizeObservedTide(dto),
      observed_traits: observedTraits,
      load_fasad_state: mapTideStateToArabic(dto && dto.tide && dto.tide.state),
      live_analysis_outputs: {
        tide_state: normalizeString(dto && dto.tide && dto.tide.state),
        advice_text: normalizeString(dto && dto.fishing && dto.fishing.advice_text),
        species_activity: uniqueStrings(dto && dto.fishing && dto.fishing.species_activity || []),
        is_recommended: !!(dto && dto.fishing && dto.fishing.is_recommended),
        confidence_score: toNumber(dto && dto.fishing && dto.fishing.confidence_score)
      },
      recommendation: {
        is_recommended: !!(dto && dto.fishing && dto.fishing.is_recommended),
        advice_text: normalizeString(dto && dto.fishing && dto.fishing.advice_text),
        species_activity: uniqueStrings(dto && dto.fishing && dto.fishing.species_activity || [])
      },
      confidence_score: toNumber(dto && dto.fishing && dto.fishing.confidence_score)
    };
  }

  function buildValidationLogRecord(input) {
    var dto = input && input.dto ? input.dto : {};
    var station = input && input.station ? input.station : {};
    var comparison = buildValidationResult(dto, input && input.field_validation, input && input.notes);
    return {
      validation_id: normalizeString(input && input.validation_id),
      station_id: normalizeString(station.id || input && input.station_id),
      timestamp: normalizeString(input && input.timestamp),
      dur_id: normalizeString(dto && dto.dur && dto.dur.period_id),
      dur_name: normalizeString(dto && dto.dur && dto.dur.period_name),
      active_phase_id: normalizeString(dto && dto.dur && dto.dur.active_phase_id),
      expected_traits: comparison.expected_traits,
      observed_traits: comparison.observed_traits,
      matched_traits: comparison.matched_traits,
      failed_traits: comparison.failed_traits,
      extra_traits: comparison.extra_traits,
      validation_score: comparison.validation_score,
      validation_status: comparison.validation_status,
      notes: comparison.notes,
      field_observed_traits: comparison.field_observed_traits
    };
  }

  return {
    deriveObservedTraitsFromDto: deriveObservedTraitsFromDto,
    buildExpectedReferenceSummary: buildExpectedReferenceSummary,
    buildValidationResult: buildValidationResult,
    buildSnapshotRecord: buildSnapshotRecord,
    buildValidationLogRecord: buildValidationLogRecord
  };
});
