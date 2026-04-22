'use strict';

/**
 * Explicit in-cycle manual Suhail anchor semantics for station-local dur generation.
 * Keys are NFC-normalized workbook city keys (same convention as workbook_city_key).
 *
 * manual_suhail_anchor_date names a calendar day inside anchor_dur_name_ar at anchor_day_in_dur,
 * NOT the start of dur_01 and NOT the start of the full 28-dur cycle.
 */
const { normalizeWorkbookCityName } = require('./workbook-city-index');

/** @type {Record<string, { anchor_dur_name_ar: string, anchor_day_in_dur: number }>} */
const ANCHOR_RULE_BY_WORKBOOK_CITY_KEY = {
  // جدة (NAVIDUR local workflow): anchor day is inside النثرة
  [normalizeWorkbookCityName('جدة')]: {
    anchor_dur_name_ar: 'النثرة',
    anchor_day_in_dur: 11
  }
};

/**
 * @param {{ workbook_city_key?: string | null, workbook_city_name?: string | null }} station
 * @returns {{ anchor_dur_name_ar: string, anchor_day_in_dur: number } | null}
 */
function getManualAnchorRuleForStation(station) {
  if (!station) return null;
  const key = normalizeWorkbookCityName(station.workbook_city_key || '');
  if (key && ANCHOR_RULE_BY_WORKBOOK_CITY_KEY[key]) {
    return ANCHOR_RULE_BY_WORKBOOK_CITY_KEY[key];
  }
  const nameKey = normalizeWorkbookCityName(station.workbook_city_name || '');
  if (nameKey && ANCHOR_RULE_BY_WORKBOOK_CITY_KEY[nameKey]) {
    return ANCHOR_RULE_BY_WORKBOOK_CITY_KEY[nameKey];
  }
  return null;
}

module.exports = {
  ANCHOR_RULE_BY_WORKBOOK_CITY_KEY,
  getManualAnchorRuleForStation
};
