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

  function decisionCard(fishing, decision) {
    var label = decision && decision.label ? decision.label : 'غير معروف';
    var badgeClass = 'decision-caution';
    if (label === 'مناسب') badgeClass = 'decision-good';
    if (label === 'غير مناسب') badgeClass = 'decision-bad';
    var scoreText = decision && decision.score != null ? ' (درجة: ' + String(decision.score) + ')' : '';
    var reasonText = fishing && fishing.advice_text ? fishing.advice_text : 'لا توجد توصية حالياً';
    return card(
      'قرار اليوم',
      '<div class="decision-main">'
      + '<div><span class="decision-pill ' + badgeClass + '">' + label + scoreText + '</span><p class="muted">' + reasonText + '</p></div>'
      + '<div style="font-size:1.8rem;line-height:1">' + (label === 'مناسب' ? '✅' : label === 'حذر' ? '⚠️' : '⛔') + '</div>'
      + '</div>'
    );
  }

  root.NavidurComponents = {
    card: card,
    metricCard: metricCard,
    fishRow: fishRow,
    decisionCard: decisionCard
  };
})(window);
