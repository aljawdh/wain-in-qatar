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

  function renderWindCompass(dto) {
    var env = dto && dto.environment ? dto.environment : {};
    var raw = env.wind_direction_deg;
    var deg = H.toNumber(raw, null);
    if (deg == null || !Number.isFinite(deg)) {
      return '<div class="wind-compass" aria-hidden="true"><div class="compass-circle"><div class="compass-arrow-rotate compass-arrow-rotate--idle"><div class="compass-arrow"></div></div></div><div class="compass-label">—</div></div>';
    }
    deg = ((deg % 360) + 360) % 360;
    var name = H.formatDirection(deg);
    var labelText = name === '—' ? '—' : name + ' ' + Math.round(deg) + '°';
    return '<div class="wind-compass" role="img" aria-label="اتجاه الرياح">'
      + '<div class="compass-circle">'
      + '<div class="compass-arrow-rotate" style="transform: rotate(' + deg + 'deg)">'
      + '<div class="compass-arrow"></div>'
      + '</div>'
      + '</div>'
      + '<div class="compass-label">' + labelText + '</div>'
      + '</div>';
  }

  root.NavidurComponents = {
    card: card,
    metricCard: metricCard,
    fishRow: fishRow,
    decisionCard: decisionCard,
    renderWindCompass: renderWindCompass
  };
})(window);
