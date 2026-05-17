'use strict';

var TRAIT_CATEGORIES = [
  { id: 'marine_core', label_ar: 'السمات البحرية الأساسية', description_ar: 'موج، تيار، حرارة سطح البحر، حالة البحر' },
  { id: 'weather_surface', label_ar: 'الرياح والطقس السطحي', description_ar: 'رياح، ضغط، رطوبة، غبار' },
  { id: 'tide_lunar', label_ar: 'المد والجزر والقمر', description_ar: 'حمل، فساد، مستوى المد، تأثير قمري' },
  { id: 'heritage_seasonal', label_ar: 'التراث والموسم', description_ar: 'انتقالات الدر والنوافذ الموسمية' },
  { id: 'fish_behavior', label_ar: 'سلوك مجموعات الأسماك', description_ar: 'نشاط ساحلي، قاعي، لاحم، صيد' },
  { id: 'habitat_environment', label_ar: 'البيئة والموائل', description_ar: 'عمق، قاع، خور، فشت، عكام' },
  { id: 'field_observation', label_ar: 'الرصد الميداني والبشري', description_ar: 'تقارير صيادين، غواصين، مراجعة بشرية' },
  { id: 'safety_risk', label_ar: 'السلامة والمخاطر', description_ar: 'مخاطر قوارب، غوص، شاطئ' },
  { id: 'anomaly_intelligence', label_ar: 'الشذوذ والذكاء', description_ar: 'انحرافات غير اعتيادية' },
  { id: 'station_signature', label_ar: 'بصمة المحطة', description_ar: 'أنماط ثابتة للمحطة المرجعية' },
  { id: 'data_quality', label_ar: 'جودة البيانات', description_ar: 'اكتمال المصدر والثقة' }
];

function t(key, labelAr, category, opts) {
  opts = opts || {};
  return {
    trait_key: key,
    label_ar: labelAr,
    category: category,
    subcategory: opts.subcategory || category,
    description_ar: opts.description_ar || ('سمة من الجين البحري: ' + labelAr),
    expected_value_type: opts.expected_value_type || 'boolean',
    observable_now: opts.observable_now !== false,
    observable_sources: opts.observable_sources || ['open_meteo_marine', 'navidur_memory', 'human_review'],
    primary_source: opts.primary_source || (opts.observable_now === false ? 'human_review' : 'open_meteo_marine'),
    validation_rule: opts.validation_rule || null,
    match_logic: opts.match_logic || (opts.validation_rule ? 'rule_based' : 'manual'),
    confidence_weight: opts.confidence_weight != null ? opts.confidence_weight : 0.7,
    importance: opts.importance || 'medium',
    applies_to: ['all_reference_stations'],
    dur_applicability: opts.dur_applicability || 'all',
    dur_names: opts.dur_names || [],
    fish_group_relations: opts.fish_group_relations || [],
    risk_relations: opts.risk_relations || [],
    requires_human_review: !!opts.requires_human_review,
    requires_field_station: !!opts.requires_field_station,
    status: 'active',
    future_use: opts.future_use || 'trend'
  };
}

function rule(variable, operator, value, unit) {
  return { variable: variable, operator: operator, value: value, unit: unit || '' };
}

var TRAIT_ENTRIES = [
  // A marine_core
  t('sea_surface_temperature', 'حرارة سطح البحر', 'marine_core', { subcategory: 'temperature', expected_value_type: 'range', validation_rule: rule('marine_variables.sea_surface_temperature', 'between', [18, 34], 'c'), confidence_weight: 0.85 }),
  t('temperature_rising', 'ارتفاع حرارة الماء', 'marine_core', { subcategory: 'temperature', validation_rule: rule('marine_variables.sea_surface_temperature', '>=', 28, 'c') }),
  t('temperature_dropping', 'انخفاض حرارة الماء', 'marine_core', { subcategory: 'temperature', validation_rule: rule('marine_variables.sea_surface_temperature', '<=', 22, 'c') }),
  t('temperature_stable', 'استقرار حرارة الماء', 'marine_core', { subcategory: 'temperature', match_logic: 'manual', importance: 'low' }),
  t('wave_height_low', 'انخفاض ارتفاع الموج', 'marine_core', { subcategory: 'waves', validation_rule: rule('marine_variables.wave_height', '<=', 0.5, 'm'), confidence_weight: 0.9 }),
  t('wave_height_medium', 'موج متوسط', 'marine_core', { subcategory: 'waves', validation_rule: rule('marine_variables.wave_height', 'between', [0.5, 1.5], 'm') }),
  t('wave_height_high', 'ارتفاع موج مرتفع', 'marine_core', { subcategory: 'waves', validation_rule: rule('marine_variables.wave_height', '>=', 1.5, 'm'), importance: 'high' }),
  t('wave_period_short', 'دورة موج قصيرة', 'marine_core', { subcategory: 'waves', validation_rule: rule('marine_variables.wave_period', '<=', 5, 's') }),
  t('wave_period_medium', 'دورة موج متوسطة', 'marine_core', { subcategory: 'waves', validation_rule: rule('marine_variables.wave_period', 'between', [5, 9], 's') }),
  t('wave_period_long', 'دورة موج طويلة', 'marine_core', { subcategory: 'waves', validation_rule: rule('marine_variables.wave_period', '>=', 9, 's') }),
  t('wave_direction_expected', 'اتجاه موج متوقع', 'marine_core', { subcategory: 'waves', validation_rule: rule('marine_variables.wave_direction', 'exists', true) }),
  t('wave_direction_shift', 'انزياح اتجاه الموج', 'marine_core', { subcategory: 'waves', match_logic: 'manual' }),
  t('current_speed_light', 'تيار خفيف', 'marine_core', { subcategory: 'current', validation_rule: rule('marine_variables.current_speed', '<=', 0.45, 'm/s') }),
  t('current_speed_medium', 'تيار متوسط', 'marine_core', { subcategory: 'current', validation_rule: rule('marine_variables.current_speed', 'between', [0.45, 0.8], 'm/s') }),
  t('current_speed_strong', 'تيار قوي', 'marine_core', { subcategory: 'current', validation_rule: rule('marine_variables.current_speed', '>=', 0.8, 'm/s'), importance: 'high' }),
  t('current_direction_expected', 'اتجاه تيار متوقع', 'marine_core', { subcategory: 'current', validation_rule: rule('marine_variables.current_direction', 'exists', true) }),
  t('current_direction_shift', 'انزياح اتجاه التيار', 'marine_core', { subcategory: 'current', match_logic: 'manual' }),
  t('sea_state_calm', 'بحر هادئ', 'marine_core', { subcategory: 'sea_state', validation_rule: rule('marine_variables.wave_height', '<=', 0.7, 'm') }),
  t('sea_state_moderate', 'بحر معتدل', 'marine_core', { subcategory: 'sea_state', validation_rule: rule('marine_variables.wave_height', 'between', [0.7, 1.5], 'm') }),
  t('sea_state_rough', 'بحر مضطرب', 'marine_core', { subcategory: 'sea_state', validation_rule: rule('marine_variables.wave_height', '>=', 1.5, 'm') }),
  t('water_clarity_good', 'وضوح ماء جيد', 'marine_core', { observable_now: false, requires_human_review: true, primary_source: 'human_review' }),
  t('water_clarity_poor', 'عكامة/وضوح ضعيف', 'marine_core', { observable_now: false, requires_human_review: true }),
  t('surface_disturbance_low', 'اضطراب سطحي منخفض', 'marine_core', { validation_rule: rule('marine_variables.wave_height', '<=', 0.6, 'm') }),
  t('surface_disturbance_high', 'اضطراب سطحي مرتفع', 'marine_core', { validation_rule: rule('marine_variables.wave_height', '>=', 1.2, 'm') }),

  // B weather_surface
  t('wind_speed_light', 'رياح خفيفة', 'weather_surface', { validation_rule: rule('marine_variables.wind_speed', '<=', 18, 'km/h') }),
  t('wind_speed_medium', 'رياح متوسطة', 'weather_surface', { validation_rule: rule('marine_variables.wind_speed', 'between', [18, 30], 'km/h') }),
  t('wind_speed_strong', 'رياح قوية', 'weather_surface', { validation_rule: rule('marine_variables.wind_speed', '>=', 30, 'km/h'), importance: 'high' }),
  t('wind_direction_expected', 'اتجاه رياح متوقع', 'weather_surface', { validation_rule: rule('marine_variables.wind_direction', 'exists', true) }),
  t('wind_direction_shift', 'انزياح اتجاه الرياح', 'weather_surface', { match_logic: 'manual' }),
  t('northwest_wind_presence', 'رياح شمال غربية', 'weather_surface', { match_logic: 'manual' }),
  t('humidity_high', 'رطوبة عالية', 'weather_surface', { observable_now: false, requires_human_review: true }),
  t('pressure_stable', 'ضغط جوي مستقر', 'weather_surface', { observable_now: false }),
  t('pressure_drop', 'انخفاض ضغط جوي', 'weather_surface', { observable_now: false }),
  t('dust_or_haze_presence', 'غبار أو ضبابية', 'weather_surface', { observable_now: false, requires_human_review: true }),

  // C tide_lunar
  t('hamal_expected', 'حمل متوقع', 'tide_lunar', { validation_rule: rule('marine_variables.tide_state', 'eq', 'hamal') }),
  t('fasad_expected', 'فساد متوقع', 'tide_lunar', { validation_rule: rule('marine_variables.tide_state', 'eq', 'fasad') }),
  t('tide_level_high', 'مد مرتفع', 'tide_lunar', { validation_rule: rule('marine_variables.tide_level', '>=', 2, 'm') }),
  t('tide_level_low', 'مد منخفض', 'tide_lunar', { validation_rule: rule('marine_variables.tide_level', '<=', 0.5, 'm') }),
  t('tide_transition_active', 'مرحلة انتقال مد', 'tide_lunar', { match_logic: 'manual' }),
  t('lunar_phase_effect', 'تأثير طور قمري', 'tide_lunar', { observable_now: false }),
  t('spring_tide_window', 'نافذة مد جزرية كبيرة', 'tide_lunar', { observable_now: false }),
  t('neap_tide_window', 'نافذة مد جزرية صغرى', 'tide_lunar', { observable_now: false }),

  // D heritage_seasonal
  t('dur_transition_early', 'بداية الدر', 'heritage_seasonal', { match_logic: 'manual', primary_source: 'navidur_memory' }),
  t('dur_transition_middle', 'منتصف الدر', 'heritage_seasonal', { match_logic: 'manual' }),
  t('dur_transition_late', 'نهاية الدر', 'heritage_seasonal', { match_logic: 'manual' }),
  t('expected_seasonal_calm', 'هدوء موسمي متوقع', 'heritage_seasonal', { match_logic: 'manual' }),
  t('expected_seasonal_wind', 'رياح موسمية متوقعة', 'heritage_seasonal', { match_logic: 'manual' }),
  t('expected_temperature_shift', 'تحول حراري موسمي', 'heritage_seasonal', { match_logic: 'manual' }),
  t('expected_water_color_change', 'تغير لون الماء المتوقع', 'heritage_seasonal', { observable_now: false, requires_human_review: true }),
  t('expected_visibility_shift', 'تغير وضوح متوقع', 'heritage_seasonal', { observable_now: false, requires_human_review: true }),
  t('expected_fishing_window', 'نافذة صيد متوقعة', 'heritage_seasonal', { fish_group_relations: ['coastal_fish'], future_use: 'prediction' }),
  t('expected_diving_window', 'نافذة غوص متوقعة', 'heritage_seasonal', { risk_relations: ['diving'] }),
  t('heritage_match_score', 'درجة مطابقة تراثية', 'heritage_seasonal', { expected_value_type: 'score', match_logic: 'manual' }),
  t('heritage_mismatch_score', 'درجة عدم مطابقة تراثية', 'heritage_seasonal', { expected_value_type: 'score', match_logic: 'manual' }),

  // E fish_behavior
  t('coastal_fish_activity_high', 'نشاط أسماك ساحلية مرتفع', 'fish_behavior', { fish_group_relations: ['coastal_fish'], observable_now: false, requires_human_review: true }),
  t('coastal_fish_activity_low', 'نشاط أسماك ساحلية منخفض', 'fish_behavior', { fish_group_relations: ['coastal_fish'], observable_now: false }),
  t('bottom_fish_activity_high', 'نشاط أسماك قاعية مرتفع', 'fish_behavior', { fish_group_relations: ['bottom_fish'], observable_now: false }),
  t('bottom_fish_activity_low', 'نشاط أسماك قاعية منخفض', 'fish_behavior', { fish_group_relations: ['bottom_fish'], observable_now: false }),
  t('pelagic_fish_activity_high', 'نشاط أسماك لاحمية مرتفع', 'fish_behavior', { fish_group_relations: ['pelagic_fish'], observable_now: false }),
  t('pelagic_fish_activity_low', 'نشاط أسماك لاحمية منخفض', 'fish_behavior', { fish_group_relations: ['pelagic_fish'], observable_now: false }),
  t('reef_fish_activity_high', 'نشاط أسماك الشعاب مرتفع', 'fish_behavior', { fish_group_relations: ['reef_fish'], observable_now: false }),
  t('reef_fish_activity_low', 'نشاط أسماك الشعاب منخفض', 'fish_behavior', { fish_group_relations: ['reef_fish'], observable_now: false }),
  t('fish_nearshore_movement', 'تحرك سمك نحو الساحل', 'fish_behavior', { observable_now: false }),
  t('fish_offshore_movement', 'تحرك سمك نحو العمق', 'fish_behavior', { observable_now: false }),
  t('fish_surface_activity', 'نشاط سطحي للأسماك', 'fish_behavior', { observable_now: false }),
  t('fish_bottom_activity', 'نشاط قاعي للأسماك', 'fish_behavior', { observable_now: false }),
  t('feeding_window_active', 'نافذة تغذية نشطة', 'fish_behavior', { future_use: 'prediction' }),
  t('feeding_window_weak', 'نافذة تغذية ضعيفة', 'fish_behavior', { future_use: 'prediction' }),
  t('night_activity_possible', 'نشاط ليلي محتمل', 'fish_behavior', { observable_now: false }),
  t('dawn_activity_possible', 'نشاط الفجر محتمل', 'fish_behavior', { observable_now: false }),
  t('migration_signal_possible', 'إشارة هجرة محتملة', 'fish_behavior', { observable_now: false, future_use: 'alert' }),
  t('schooling_behavior_possible', 'سلوك تجمّع محتمل', 'fish_behavior', { observable_now: false }),

  // F habitat_environment
  t('shallow_habitat_influence', 'تأثير موطئ ضحل', 'habitat_environment', { observable_now: false }),
  t('reef_or_rock_habitat_influence', 'تأثير شعاب/صخور', 'habitat_environment', { observable_now: false }),
  t('sandy_bottom_influence', 'تأثير قاع رملي', 'habitat_environment', { observable_now: false }),
  t('muddy_bottom_influence', 'تأثير قاع طيني', 'habitat_environment', { observable_now: false }),
  t('seagrass_presence', 'وجود عشب بحري', 'habitat_environment', { observable_now: false, requires_field_station: true }),
  t('khor_influence', 'تأثير خور', 'habitat_environment', { observable_now: false }),
  t('fasht_influence', 'تأثير فشت', 'habitat_environment', { observable_now: false }),
  t('island_coast_influence', 'تأثير ساحل جزيرة', 'habitat_environment', { observable_now: false }),
  t('open_water_influence', 'تأثير مياه مفتوحة', 'habitat_environment', { observable_now: false }),
  t('depth_transition_zone', 'منطقة انتقال عمق', 'habitat_environment', { observable_now: false }),
  t('thermal_layer_possible', 'طبقة حرارية محتملة', 'habitat_environment', { observable_now: false }),
  t('chlorophyll_signal_possible', 'إشارة كلوروفيل', 'habitat_environment', { observable_now: false, future_use: 'trend' }),
  t('turbidity_possible', 'عكامة محتملة', 'habitat_environment', { observable_now: false, requires_human_review: true }),
  t('salinity_shift_possible', 'تحول ملوحة محتمل', 'habitat_environment', { observable_now: false }),
  t('oxygen_stress_possible', 'إجهاد أكسجين محتمل', 'habitat_environment', { observable_now: false }),

  // G field_observation
  t('fisherman_report_available', 'تقرير صياد متوفر', 'field_observation', { observable_now: false, requires_human_review: true, primary_source: 'human_review' }),
  t('diver_report_available', 'تقرير غواص متوفر', 'field_observation', { observable_now: false, requires_human_review: true }),
  t('boat_report_available', 'تقرير قارب متوفر', 'field_observation', { observable_now: false, requires_human_review: true }),
  t('catch_success_reported', 'صيد ناجح مُبلّغ', 'field_observation', { observable_now: false, requires_human_review: true }),
  t('catch_failure_reported', 'فشل صيد مُبلّغ', 'field_observation', { observable_now: false, requires_human_review: true }),
  t('visibility_reported', 'وضوح مُبلّغ', 'field_observation', { observable_now: false, requires_human_review: true }),
  t('water_color_reported', 'لون ماء مُبلّغ', 'field_observation', { observable_now: false, requires_human_review: true }),
  t('unusual_behavior_reported', 'سلوك غير اعتيادي مُبلّغ', 'field_observation', { observable_now: false, requires_human_review: true }),
  t('human_review_required', 'مراجعة بشرية مطلوبة', 'field_observation', { observable_now: false, requires_human_review: true, importance: 'high' }),
  t('field_station_required', 'محطة ميدانية مطلوبة', 'field_observation', { observable_now: false, requires_field_station: true, importance: 'high' }),

  // H safety_risk
  t('boating_risk_low', 'مخاطر قوارب منخفضة', 'safety_risk', { risk_relations: ['boating'] }),
  t('boating_risk_medium', 'مخاطر قوارب متوسطة', 'safety_risk', { risk_relations: ['boating'] }),
  t('boating_risk_high', 'مخاطر قوارب عالية', 'safety_risk', { risk_relations: ['boating'], importance: 'high' }),
  t('shore_activity_risk_low', 'مخاطر شاطئ منخفضة', 'safety_risk', { risk_relations: ['shore_activity'] }),
  t('shore_activity_risk_medium', 'مخاطر شاطئ متوسطة', 'safety_risk', { risk_relations: ['shore_activity'] }),
  t('shore_activity_risk_high', 'مخاطر شاطئ عالية', 'safety_risk', { risk_relations: ['shore_activity'], importance: 'high' }),
  t('diving_risk_low', 'مخاطر غوص منخفضة', 'safety_risk', { risk_relations: ['diving'] }),
  t('diving_risk_medium', 'مخاطر غوص متوسطة', 'safety_risk', { risk_relations: ['diving'] }),
  t('diving_risk_high', 'مخاطر غوص عالية', 'safety_risk', { risk_relations: ['diving'], importance: 'high' }),
  t('current_risk_high', 'مخاطر تيار عالية', 'safety_risk', { importance: 'high' }),
  t('wave_risk_high', 'مخاطر أمواج عالية', 'safety_risk', { validation_rule: rule('marine_variables.wave_height', '>=', 1.8, 'm'), importance: 'high' }),
  t('night_activity_risk', 'مخاطر نشاط ليلي', 'safety_risk', { observable_now: false }),
  t('abnormal_temperature_spike', 'قفزة حرارية غير طبيعية', 'anomaly_intelligence', { future_use: 'alert' }),
  t('abnormal_temperature_drop', 'انخفاض حراري غير طبيعي', 'anomaly_intelligence', { future_use: 'alert' }),
  t('abnormal_current_shift', 'انزياح تيار غير طبيعي', 'anomaly_intelligence', { future_use: 'alert' }),
  t('abnormal_wave_jump', 'قفزة موج غير طبيعية', 'anomaly_intelligence', { future_use: 'alert' }),
  t('abnormal_wind_shift', 'انزياح رياح غير طبيعي', 'anomaly_intelligence', { future_use: 'alert' }),
  t('abnormal_activity_drop', 'انخفاض نشاط غير طبيعي', 'anomaly_intelligence', { future_use: 'alert' }),
  t('abnormal_activity_rise', 'ارتفاع نشاط غير طبيعي', 'anomaly_intelligence', { future_use: 'alert' }),
  t('heritage_behavior_mismatch', 'عدم مطابقة سلوك تراثي', 'anomaly_intelligence', { match_logic: 'manual' }),
  t('station_behavior_drift', 'انجراف سلوك المحطة', 'anomaly_intelligence', { future_use: 'trend' }),
  t('regional_mismatch', 'عدم مطابقة إقليمية', 'anomaly_intelligence', { match_logic: 'manual' }),
  t('repeated_unmatched_trait', 'سمة غير مطابقة متكررة', 'anomaly_intelligence', { future_use: 'alert' }),
  t('station_thermal_stability', 'استقرار حراري للمحطة', 'station_signature', { future_use: 'signature' }),
  t('station_wave_stability', 'استقرار أمواج للمحطة', 'station_signature', { future_use: 'signature' }),
  t('station_current_stability', 'استقرار تيار للمحطة', 'station_signature', { future_use: 'signature' }),
  t('station_fish_activity_pattern', 'نمط نشاط سمك للمحطة', 'station_signature', { future_use: 'signature' }),
  t('station_risk_pattern', 'نمط مخاطر للمحطة', 'station_signature', { future_use: 'signature' }),
  t('station_seasonal_personality', 'شخصية موسمية للمحطة', 'station_signature', { future_use: 'signature' }),
  t('station_reference_reliability', 'موثوقية مرجع المحطة', 'station_signature', { expected_value_type: 'score', future_use: 'signature' }),
  t('data_complete', 'بيانات مكتملة', 'data_quality', { match_logic: 'rule_based', importance: 'high' }),
  t('data_missing_partial', 'بيانات ناقصة جزئياً', 'data_quality', { importance: 'medium' }),
  t('data_missing_critical', 'بيانات ناقصة حرجة', 'data_quality', { importance: 'high' }),
  t('source_confidence_high', 'ثقة مصدر عالية', 'data_quality', { expected_value_type: 'score' }),
  t('source_confidence_medium', 'ثقة مصدر متوسطة', 'data_quality', { expected_value_type: 'score' }),
  t('source_confidence_low', 'ثقة مصدر منخفضة', 'data_quality', { expected_value_type: 'score' }),
  t('enough_history_available', 'تاريخ كافٍ متوفر', 'data_quality', { observable_sources: ['navidur_memory'] }),
  t('insufficient_history', 'تاريخ غير كافٍ', 'data_quality', { observable_sources: ['navidur_memory'] }),
  t('manual_review_needed', 'مراجعة يدوية مطلوبة', 'data_quality', { requires_human_review: true, importance: 'high' })
];

function buildGenomeDocument() {
  return {
    version: 'v1',
    created_at: new Date().toISOString(),
    scope: 'all_reference_stations',
    description_ar: 'الجين البحري المركزي للدرور والمحطات في NAVIDUR',
    trait_categories: TRAIT_CATEGORIES,
    traits: TRAIT_ENTRIES
  };
}

module.exports = {
  TRAIT_CATEGORIES: TRAIT_CATEGORIES,
  TRAIT_ENTRIES: TRAIT_ENTRIES,
  buildGenomeDocument: buildGenomeDocument
};
