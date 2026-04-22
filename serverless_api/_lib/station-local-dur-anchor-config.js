'use strict';

/**
 * Legacy placeholder: station-local dur windows now derive anchor placement from
 * `data/navidur_operational_durur_*.xlsx` + `manual_suhail_anchor_date`.
 * City-specific anchor rules were removed — use suhail anchor resolution pipeline instead.
 */

function getManualAnchorRuleForStation() {
  return null;
}

module.exports = {
  ANCHOR_RULE_BY_WORKBOOK_CITY_KEY: {},
  getManualAnchorRuleForStation
};
