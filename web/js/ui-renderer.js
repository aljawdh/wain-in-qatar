(function (root) {
  var C = root.NavidurComponents;
  var H = root.NavidurHelpers;
  var NO_DATA_TEXT = 'لا تتوفر بيانات لهذا اليوم';

  function noDataCard(title) {
    return C.card(title, '<p class="muted">' + NO_DATA_TEXT + '</p>');
  }

  function renderDashboard(dto, state) {
    var app = H.byId('appContent');
    if (!app) return;
    if (!dto || typeof dto !== 'object') {
      app.innerHTML = noDataCard('لوحة NAVIDUR');
      return;
    }
    var dur = dto && dto.dur ? dto.dur : {};
    var env = dto && dto.environment ? dto.environment : {};
    var tide = dto && dto.tide ? dto.tide : {};
    var fish = dto && dto.fishing ? dto.fishing : {};
    var fishList = (fish.species_activity || []).slice(0, 3).map(function (name) {
      return C.fishRow(name, 'نشاط متوقع');
    }).join('');

    app.innerHTML = ''
      + '<div class="cards-grid">'
      + C.card('الدر الحالي', '<div class="metric">' + (dur.period_name || '—') + '</div><p class="muted">اليوم: ' + (dur.day_in_period || '—') + ' · التالي: ' + (dur.next_period_name || '—') + '</p>')
      + C.metricCard('حالة البحر', tide.state || '—', '')
      + C.metricCard('ارتفاع الموج', env.wave_height_m != null ? env.wave_height_m : '—', 'م')
      + C.metricCard('الرياح', env.wind_speed_kmh != null ? env.wind_speed_kmh : '—', 'كم/س')
      + C.metricCard('اتجاه الرياح', H.formatDirection(env.wind_direction_deg), '')
      + C.metricCard('التيار', tide.current_speed_ms != null ? tide.current_speed_ms : '—', 'م/ث')
      + C.metricCard('حرارة الماء', env.water_temp_c != null ? env.water_temp_c : '—', '°')
      + C.decisionCard(fish, dto && dto.decision ? dto.decision : null)
      + '</div>'
      + '<div class="map-and-gauge">'
      + C.card('مؤشر النشاط', '<div class="gauge-bar"><div class="gauge-fill" style="width:' + Math.max(0, Math.min(100, Number(fish.confidence_score || 0))) + '%"></div></div><p class="muted">الثقة: ' + (fish.confidence_score != null ? fish.confidence_score : '—') + '%</p>')
      + C.card('Heatmap Preview', '<p class="muted">' + ((dto && dto.hotspot && dto.hotspot.reason_if_unknown) || 'جاهز لعرض نقاط النشاط حسب الخريطة') + '</p>')
      + '</div>'
      + C.card('ملخص الصيد', fishList || '<p class="muted">لا توجد أنواع نشطة حالياً.</p>');
  }

  function renderMarineAnalysis(dto) {
    var el = H.byId('pageMarine');
    if (!el) return;
    if (!dto || typeof dto !== 'object') {
      el.innerHTML = noDataCard('تحليل البحر');
      return;
    }
    var env = dto && dto.environment ? dto.environment : {};
    var tide = dto && dto.tide ? dto.tide : {};
    el.innerHTML = ''
      + C.metricCard('سرعة الرياح', env.wind_speed_kmh != null ? env.wind_speed_kmh : '—', 'كم/س')
      + C.metricCard('اتجاه الرياح', H.formatDirection(env.wind_direction_deg), '')
      + C.metricCard('ارتفاع الموج', env.wave_height_m != null ? env.wave_height_m : '—', 'م')
      + C.metricCard('سرعة التيار', tide.current_speed_ms != null ? tide.current_speed_ms : '—', 'م/ث')
      + C.metricCard('حرارة الماء', env.water_temp_c != null ? env.water_temp_c : '—', '°')
      + C.metricCard('الرطوبة', env.humidity_percent != null ? env.humidity_percent : '—', '%');
  }

  function renderFishingRecommendation(dto) {
    var el = H.byId('pageFishing');
    if (!el) return;
    if (!dto || typeof dto !== 'object') {
      el.innerHTML = noDataCard('توصية الصيد');
      return;
    }
    var fish = dto && dto.fishing ? dto.fishing : {};
    var species = (fish.species_activity || []).slice(0, 3);
    el.innerHTML = C.card('التوصية المختصرة', '<p>' + (fish.advice_text || 'لا توجد توصية حالياً') + '</p>')
      + C.card('أفضل وقت', '<p class="muted">اعتماداً على حالة البحر الحالية</p>')
      + C.card('نوع النشاط', '<p>' + ((dto && dto.dur && dto.dur.depth_mode) || 'ساحلي') + '</p>')
      + C.card('الأنواع المتوقعة', species.length ? species.map(function (s) { return C.fishRow(s, 'ملاءمة الظروف'); }).join('') : '<p class="muted">لا توجد أنواع الآن</p>');
  }

  function renderMap(dto) {
    var el = H.byId('pageMap');
    if (!el) return;
    if (!dto || typeof dto !== 'object') {
      el.innerHTML = noDataCard('الخريطة / Heatmap');
      return;
    }
    var station = dto && dto.station_id ? dto.station_id : '—';
    el.innerHTML = C.card('الخريطة', '<p class="muted">عرض المحطة الحالية: ' + station + '</p>');
  }

  function renderLocationModal(state) {
    var modal = H.byId('locationModal');
    if (!modal) return;
    modal.classList.toggle('hidden', !!state.locationPromptDismissed || !!state.userLocation);
  }

  root.NavidurUI = {
    renderDashboard: renderDashboard,
    renderMarineAnalysis: renderMarineAnalysis,
    renderFishingRecommendation: renderFishingRecommendation,
    renderMap: renderMap,
    renderLocationModal: renderLocationModal
  };
})(window);
