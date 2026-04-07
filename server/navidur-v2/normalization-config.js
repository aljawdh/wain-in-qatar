'use strict';

module.exports = {
  currentSpeed: { min: 0, max: 3.5, unit: 'm/s' },
  waveHeight: { min: 0, max: 4.0, unit: 'm' },
  windSpeed: { min: 0, max: 25.0, unit: 'm/s' },
  temperature: { min: 18, max: 36, unit: 'celsius' },
  salinity: { min: 30, max: 45, unit: 'psu' },
  oxygen: { min: 2, max: 9, unit: 'mg/l' },
  chlorophyll: { min: 0.05, max: 3.0, unit: 'mg/m3' },
  depth: { min: 0, max: 2000, unit: 'm' },
  slope: { min: 0, max: 45, unit: 'deg' },
  tidal: { min: 0, max: 1, unit: 'normalized' }
};
