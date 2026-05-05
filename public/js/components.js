(function (root) {
  var H = root.NavidurHelpers;

  function card(title, bodyHtml) {
    return '<section class="card"><h3>' + title + '</h3>' + bodyHtml + '</section>';
  }

  function metricCard(title, value, unit) {
    return card(title, '<div class="metric">' + value + (unit ? ' <span class="muted">' + unit + '</span>' : '') + '</div>');
  }

  function fishRow(name, reason) {
    return '<div class="fish-row"><strong>' + name + '</strong><span class="muted">' + reason + '</span></div>';
  }

  function marineIntroCard() {
    return '<section class="card marine-summary-card"><h3>تحليل البحر</h3>'
      + '<p class="muted marine-summary-text">حالة البحر الحالية بناءً على الرياح، الموج، التيار، والمد.</p>'
      + '</section>';
  }

  function marineMetricCard(label, valueHtml) {
    return '<div class="marine-metric-card">'
      + '<div class="marine-metric-label">' + label + '</div>'
      + '<div class="marine-metric-value">' + valueHtml + '</div>'
      + '</div>';
  }

  function decisionCard(fishing, decision, hero) {
    var label = decision && decision.label ? decision.label : 'غير معروف';
    var badgeClass = 'decision-caution';
    if (label === 'مناسب') badgeClass = 'decision-good';
    if (label === 'غير مناسب') badgeClass = 'decision-bad';
    var scoreText = decision && decision.score != null ? ' (درجة: ' + String(decision.score) + ')' : '';
    var reasonText = fishing && fishing.advice_text ? fishing.advice_text : 'لا توجد توصية حالياً';
    var inner = '<div class="decision-main' + (hero ? ' decision-main--hero' : '') + '">'
      + '<div><span class="decision-pill ' + badgeClass + (hero ? ' decision-pill--hero' : '') + '">' + label + scoreText + '</span>'
      + '<p class="muted decision-reason' + (hero ? ' decision-reason--hero' : '') + '">' + reasonText + '</p>'
      + (hero ? '<p class="muted decision-hint">هل أطلع؟ انظر للقرار أعلاه — للتفاصيل انتقل لتحليل البحر.</p>' : '')
      + '</div>'
      + '<div class="decision-icon' + (hero ? ' decision-icon--hero' : '') + '">' + (label === 'مناسب' ? '✅' : label === 'حذر' ? '⚠️' : '⛔') + '</div>'
      + '</div>';
    if (hero) {
      return '<section class="card decision-hero"><h3>قرار اليوم</h3>' + inner + '</section>';
    }
    return card('قرار اليوم', inner);
  }

  var WIND_ROSE = [
    { rot: 0, en: 'N', ar: 'شمال' },
    { rot: 45, en: 'NE', ar: 'شمال شرقي' },
    { rot: 90, en: 'E', ar: 'شرق' },
    { rot: 135, en: 'SE', ar: 'جنوب شرقي' },
    { rot: 180, en: 'S', ar: 'جنوب' },
    { rot: 225, en: 'SW', ar: 'جنوب غربي' },
    { rot: 270, en: 'W', ar: 'غرب' },
    { rot: 315, en: 'NW', ar: 'شمال غربي' }
  ];

  function windDirectionFullAr(deg) {
    var d = ((deg % 360) + 360) % 360;
    var idx = Math.round(d / 45) % 8;
    var full = ['شمال', 'شمال شرقي', 'شرق', 'جنوب شرقي', 'جنوب', 'جنوب غربي', 'غرب', 'شمال غربي'];
    return full[idx];
  }

  function windRoseTicksHtml() {
    return WIND_ROSE.map(function (t) {
      return '<div class="rose-tick" style="--rot:' + t.rot + 'deg">'
        + '<div class="rose-tick-inner">'
        + '<span class="rose-en">' + t.en + '</span>'
        + '<span class="rose-ar">' + t.ar + '</span>'
        + '</div></div>';
    }).join('');
  }

  function renderWindCompass(dto) {
    var env = dto && dto.environment ? dto.environment : {};
    var raw = env.wind_direction_deg;
    var deg = H.toNumber(raw, null);
    var faceTicks = windRoseTicksHtml();
    var bodyIdle = '<div class="wind-compass-card__body">'
      + '<div class="compass-face compass-face--idle" dir="ltr">'
      + '<div class="compass-rose">' + faceTicks + '</div>'
      + '<div class="compass-arrow-layer compass-arrow-layer--idle" aria-hidden="true"><div class="compass-arrow-fat"></div></div>'
      + '</div>'
      + '<div class="compass-summary">'
      + '<div class="compass-dir-name">—</div>'
      + '<div class="compass-dir-deg">—</div>'
      + '</div></div>';

    if (deg == null || !Number.isFinite(deg)) {
      return '<section class="card wind-compass-card" aria-label="اتجاه الرياح"><h3>اتجاه الرياح</h3>' + bodyIdle + '</section>';
    }
    deg = ((deg % 360) + 360) % 360;
    var dirAr = windDirectionFullAr(deg);
    var degRounded = Math.round(deg);
    var body = '<div class="wind-compass-card__body">'
      + '<div class="compass-face" dir="ltr">'
      + '<div class="compass-rose">' + faceTicks + '</div>'
      + '<div class="compass-arrow-layer" style="transform: rotate(' + deg + 'deg)" role="presentation">'
      + '<div class="compass-arrow-fat"></div>'
      + '</div>'
      + '</div>'
      + '<div class="compass-summary">'
      + '<div class="compass-dir-name">' + dirAr + '</div>'
      + '<div class="compass-dir-deg">' + degRounded + '°</div>'
      + '</div></div>';

    return '<section class="card wind-compass-card" aria-label="اتجاه الرياح"><h3>اتجاه الرياح</h3>' + body + '</section>';
  }

  root.NavidurComponents = {
    card: card,
    metricCard: metricCard,
    fishRow: fishRow,
    marineIntroCard: marineIntroCard,
    marineMetricCard: marineMetricCard,
    decisionCard: decisionCard,
    renderWindCompass: renderWindCompass
  };
})(window);
