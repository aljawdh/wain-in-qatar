'use strict';

/** Legacy: dur_sequence_map + star_events → dur_windows. Removed. */
module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(410).json({ ok: false, error: 'dur_generator_removed' });
};
