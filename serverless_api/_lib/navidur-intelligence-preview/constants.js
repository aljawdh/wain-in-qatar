'use strict';

var MARINE_ZONES = [
  'coast',
  'shallow',
  'island_coast',
  'reef_or_rock',
  'open_water',
  'deep_future',
  'unknown'
];

var MARINE_LABELS = ['excellent', 'good', 'medium', 'poor', 'dangerous', 'unknown'];
var ACTIVITY_LABELS = ['high', 'medium', 'low', 'unknown'];
var RISK_LEVELS = ['low', 'medium', 'high', 'unknown'];
var TREND_LABELS = ['improving', 'stable', 'declining', 'unknown'];
var HAMAL_FASAD = ['hamal', 'fasad', 'unknown'];

var FISH_GROUPS = ['coastal_fish', 'bottom_fish', 'pelagic_fish', 'reef_fish'];

var PREVIEW_MODE = 'preview_read_only';
var DEFAULT_ALL_LIMIT = 5;
var MAX_ALL_LIMIT = 10;
var ALL_BATCH_NOTE =
  'Full-station intelligence should run through cron/background jobs, not a single HTTP request.';

module.exports = {
  MARINE_ZONES: MARINE_ZONES,
  MARINE_LABELS: MARINE_LABELS,
  ACTIVITY_LABELS: ACTIVITY_LABELS,
  RISK_LEVELS: RISK_LEVELS,
  TREND_LABELS: TREND_LABELS,
  HAMAL_FASAD: HAMAL_FASAD,
  FISH_GROUPS: FISH_GROUPS,
  PREVIEW_MODE: PREVIEW_MODE,
  DEFAULT_ALL_LIMIT: DEFAULT_ALL_LIMIT,
  MAX_ALL_LIMIT: MAX_ALL_LIMIT,
  ALL_BATCH_NOTE: ALL_BATCH_NOTE
};
