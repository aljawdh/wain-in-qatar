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
    var fish = dto && dto.fishing ? dto.fishing : {};
    var waveVal = env.wave_height_m != null ? String(env.wave_height_m) : '—';
    var windVal = env.wind_speed_kmh != null ? String(env.wind_speed_kmh) : '—';
    var heatHint = 'نظرة مصغرة للنشاط — للتفاصيل انتقل للخريطة.';
    var heatBars = [0.35, 0.55, 0.4, 0.7, 0.5, 0.85, 0.45, 0.6].map(function (h) {
      return '<span class="heatmap-mini__bar" style="height:' + Math.round(h * 100) + '%"></span>';
    }).join('');

    app.innerHTML = ''
      + '<div class="dashboard-stack">'
      + C.card('الدور الحالي', '<div class="metric">' + (dur.period_name || '—') + '</div><p class="muted">اليوم داخل الدر: ' + (dur.day_in_period || '—') + ' · الدر التالي: ' + (dur.next_period_name || '—') + '</p>')
      + C.decisionCard(fish, dto && dto.decision ? dto.decision : null, true)
      + C.renderWindCompass(dto)
      + '<div class="dashboard-quick">'
      + '<div class="dashboard-quick__item"><span class="dashboard-quick__label">ارتفاع الموج</span><span class="dashboard-quick__value">' + waveVal + ' <span class="muted">م</span></span></div>'
      + '<div class="dashboard-quick__item"><span class="dashboard-quick__label">سرعة الرياح</span><span class="dashboard-quick__value">' + windVal + ' <span class="muted">كم/س</span></span></div>'
      + '</div>'
      + '<div class="map-and-gauge map-and-gauge--dashboard">'
      + C.card('مؤشر النشاط', '<div class="gauge-wrap"><div class="gauge-bar gauge-bar--dashboard"><div class="gauge-fill" style="width:' + Math.max(0, Math.min(100, Number(fish.confidence_score || 0))) + '%"></div></div><p class="muted">النشاط: ' + (fish.confidence_score != null ? fish.confidence_score : '—') + '%</p></div>')
      + C.card('خريطة النشاط', '<div class="heatmap-mini" aria-hidden="true"><div class="heatmap-mini__crosshair"></div><div class="heatmap-mini__bars">' + heatBars + '</div></div><p class="muted heatmap-mini__hint">' + heatHint + '</p>')
      + '</div>'
      + '</div>';
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
    try {
      console.debug('NAVIDUR_TIDE_UI_RENDER', {
        has_series: !!(dto && dto.tide_series),
        source: dto && dto.tide_series ? dto.tide_series.source : undefined,
        timeline_count: dto && dto.tide_series && Array.isArray(dto.tide_series.timeline) ? dto.tide_series.timeline.length : 0,
        extremes_count: dto && dto.tide_series && Array.isArray(dto.tide_series.extremes) ? dto.tide_series.extremes.length : 0
      });
    } catch (_te) { /* ignore */ }
    el.innerHTML = '<div class="marine-stack">'
      + C.metricCard('حالة البحر (FASAD)', tide.state || '—', '')
      + C.metricCard('ارتفاع الموج', env.wave_height_m != null ? env.wave_height_m : '—', 'م')
      + C.metricCard('سرعة الرياح', env.wind_speed_kmh != null ? env.wind_speed_kmh : '—', 'كم/س')
      + C.metricCard('اتجاه الرياح', H.formatDirection(env.wind_direction_deg), '')
      + C.metricCard('التيار', tide.current_speed_ms != null ? tide.current_speed_ms : '—', 'م/ث')
      + C.metricCard('حرارة الماء', env.water_temp_c != null ? env.water_temp_c : '—', '°')
      + '</div>'
      + C.marineTideTimelineSection(dto && dto.tide_series);
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
      + C.card('أفضل وقت', '<p class="muted">من 05:30 صباحاً إلى 09:30 صباحاً (مثال تشغيلي)</p>')
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
    var hs = dto && dto.hotspot ? dto.hotspot : {};
    el.innerHTML = C.card('الخريطة', '<p class="muted">المحطة الحالية: ' + station + '</p><p class="muted">متوسط النشاط: ' + (hs.avg_score != null ? hs.avg_score : '—') + '</p><p class="muted">سبب التقييم: ' + (hs.reason_if_unknown || 'محسوب من النقاط البحرية') + '</p>');
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
