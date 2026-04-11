#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Marine-point validation unit tests
// Tests classifyIsInElements, classifyNearbyLandFeatures, minDistToCoastline,
// classifyWaterResult, formatMarinePlaceSuggestion, and applyFallbackWaterHint.
//
// Run: node test-marine-validation.js
// ─────────────────────────────────────────────────────────────────────────────

const results = { passed: [], failed: [] };

function pass(name) {
  results.passed.push(name);
  console.log('  ✓', name);
}
function fail(name, detail) {
  results.failed.push(name);
  console.error('  ✗', name, detail ? '— ' + detail : '');
}
function assert(name, condition, detail) {
  condition ? pass(name) : fail(name, detail);
}

// ── Inline pure functions extracted from admin.js (no DOM, no fetch) ─────────

function classifyIsInElements(elements) {
  var WATER_NATURAL = ['sea', 'bay', 'water', 'strait', 'ocean'];
  var WATER_LANDUSE = ['basin', 'reservoir', 'harbour', 'port'];
  var LAND_LANDUSE = ['residential', 'commercial', 'industrial', 'retail', 'construction', 'farmland', 'farmyard', 'allotments'];
  var LAND_PLACE = ['city', 'town', 'village', 'suburb', 'neighbourhood', 'quarter'];
  var LAND_HIGHWAY = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'footway', 'path', 'cycleway', 'living_street'];
  var waterScore = 0, landScore = 0;
  (elements || []).forEach(function (el) {
    var tags = el.tags || {};
    if (WATER_NATURAL.indexOf(tags.natural) !== -1) waterScore += 3;
    if (tags.place === 'sea' || tags.place === 'ocean') waterScore += 3;
    if (tags.waterway && tags.waterway !== 'riverbank') waterScore += 2;
    if (tags.waterway === 'dock') waterScore += 2;
    if (WATER_LANDUSE.indexOf(tags.landuse) !== -1) waterScore += 2;
    if (tags.leisure === 'marina') waterScore += 3;
    if (tags.seamark) waterScore += 3;
    if (LAND_LANDUSE.indexOf(tags.landuse) !== -1) landScore += 3;
    if (LAND_PLACE.indexOf(tags.place) !== -1) landScore += 2;
    if (tags.building) landScore += 4;
    if (LAND_HIGHWAY.indexOf(tags.highway) !== -1) landScore += 2;
  });
  return { waterScore: waterScore, landScore: landScore };
}

function classifyNearbyLandFeatures(elements) {
  var LAND_HIGHWAY = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service'];
  var score = 0;
  (elements || []).forEach(function (el) {
    var tags = el.tags || {};
    if (tags.building) score += 4;
    if (LAND_HIGHWAY.indexOf(tags.highway) !== -1) score += 2;
  });
  return score;
}

function minDistToCoastline(lat, lon, coastlineWays) {
  var EARTH_R = 6371000;
  var cosLat = Math.cos(lat * Math.PI / 180);
  var minDist = Infinity;
  (coastlineWays || []).forEach(function (way) {
    var nodes = way.geometry || [];
    for (var i = 0; i < nodes.length - 1; i++) {
      var midLat = (nodes[i].lat + nodes[i + 1].lat) / 2;
      var midLon = (nodes[i].lon + nodes[i + 1].lon) / 2;
      var dy = (midLat - lat) * EARTH_R * (Math.PI / 180);
      var dx = (midLon - lon) * EARTH_R * (Math.PI / 180) * cosLat;
      var dist = Math.sqrt(dy * dy + dx * dx);
      if (dist < minDist) minDist = dist;
    }
  });
  return minDist === Infinity ? null : minDist;
}

function classifyWaterResult(scores, hasCoastlineNearby, coastlineDist, nearbyLandScore) {
  var W = scores.waterScore;
  var L = scores.landScore;
  var NL = nearbyLandScore || 0;
  var effectiveL = L + NL;

  if (W === 0 && effectiveL === 0) {
    return hasCoastlineNearby ? 'uncertain' : 'confirmed_water';
  }

  if (coastlineDist !== null && coastlineDist < 60) {
    if (W > effectiveL + 2) return 'confirmed_water';
    if (effectiveL > W + 2) return 'confirmed_land';
    return 'uncertain';
  }

  if (W > effectiveL) return 'confirmed_water';
  if (effectiveL >= W + 2) return 'confirmed_land';
  return 'uncertain';
}

function formatMarinePlaceSuggestion(address) {
  var addr = address && typeof address === 'object' ? address : {};
  var country = String(addr.country || '').trim();
  var locality = String(
    addr.city || addr.town || addr.municipality || addr.state_district || addr.county || addr.state || ''
  ).trim();
  if (locality && country) return 'نقطة بحرية قرب ' + locality + '، ' + country;
  if (country) return 'موقع بحري داخل المياه ' + country;
  if (locality) return 'مياه ' + locality;
  return 'موقع بحري داخل المياه الإقليمية';
}

// Inline copy from admin.js — must stay in sync
function applyFallbackWaterHint(displayName, nearbyLandScore, coastlineDist) {
  var WATER_KEYWORDS = ['sea', 'bay', 'gulf', 'water', 'ocean', 'strait', 'بحر', 'خليج', 'مياه', 'بحيرة'];
  var score = 0;
  var lowerName = String(displayName || '').toLowerCase();
  var hasWaterKeyword = WATER_KEYWORDS.some(function (kw) { return lowerName.indexOf(kw) !== -1; });
  if (hasWaterKeyword) score += 2;
  if (nearbyLandScore !== null && nearbyLandScore === 0) score += 1;
  if (coastlineDist === null || coastlineDist > 100) score += 1;
  return score >= 2 ? 'confirmed_water' : 'uncertain';
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Open sea point (deep water, no OSM features, no coastline)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 1: Open Sea Point ──');
{
  // Persian Gulf deep water — is_in returns nothing, no coastline within 300 m
  const scores = classifyIsInElements([]);
  const result = classifyWaterResult(scores, false, null, 0);
  assert('open sea → confirmed_water', result === 'confirmed_water', result);

  // Scores should be zero
  assert('open sea scores are zero', scores.waterScore === 0 && scores.landScore === 0,
    JSON.stringify(scores));
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Land point (inland residential area)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 2: Land Point ──');
{
  // is_in returns: landuse=residential, place=city
  const isInEls = [
    { tags: { landuse: 'residential' } },
    { tags: { place: 'city' } },
  ];
  const nearbyEls = [
    // building 50 m away, road 30 m away
    { tags: { building: 'yes' } },
    { tags: { highway: 'primary' } },
  ];
  const scores = classifyIsInElements(isInEls);
  const NL = classifyNearbyLandFeatures(nearbyEls);
  const result = classifyWaterResult(scores, false, null, NL);

  assert('land point → confirmed_land', result === 'confirmed_land', result);
  assert('land scores > water scores', scores.landScore > scores.waterScore,
    JSON.stringify(scores));
  assert('nearby land score > 0', NL > 0, String(NL));
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Uncertain point (coastal fringe — coastline within 30 m, mixed signals)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 3: Uncertain Point (Coastal Fringe) ──');
{
  // is_in: natural=sea (water), place=suburb (land) → W=3, L=2
  const isInEls = [
    { tags: { natural: 'sea' } },
    { tags: { place: 'suburb' } },
  ];
  const scores = classifyIsInElements(isInEls);

  // Coastline 25 m away → strict zone
  const coastlineDist = 25;
  // No nearby buildings/roads
  const NL = classifyNearbyLandFeatures([]);
  const result = classifyWaterResult(scores, true, coastlineDist, NL);

  // W=3, effectiveL=2, coastlineDist=25 < 60 → W > eL+2? 3 > 4? No → uncertain
  assert('coastal fringe (25 m from coastline) → uncertain', result === 'uncertain', result);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3b: Point far from coastline (>80 m) with water signals wins
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 3b: Uncertain vs Confirmed Water (coastline distance matters) ──');
{
  // Same mixed signals but 150 m from coastline
  const isInEls = [
    { tags: { natural: 'sea' } },
    { tags: { place: 'suburb' } },
  ];
  const scores = classifyIsInElements(isInEls);
  const NL = 0;
  // 150 m away — outside the 60 m strict zone, W=3 > L=2 → confirmed_water
  const result = classifyWaterResult(scores, true, 150, NL);
  assert('sea + suburb 150 m from coast → confirmed_water', result === 'confirmed_water', result);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3c: Equal scores → uncertain
// ─────────────────────────────────────────────────────────────────────────────
{
  // W == L, no coastline nearby
  const scores = { waterScore: 3, landScore: 3 };
  const result = classifyWaterResult(scores, false, null, 0);
  assert('equal waterScore and landScore → uncertain (not confirmed_water)', result === 'uncertain', result);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Marina / Harbor edge cases
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 4: Marina / Harbor Edge Cases ──');
{
  // 4a: Inside marina water basin — leisure=marina + natural=water, no nearby buildings
  const marinaClearEls = [
    { tags: { leisure: 'marina' } },
    { tags: { natural: 'water' } },
  ];
  const scores4a = classifyIsInElements(marinaClearEls);
  const res4a = classifyWaterResult(scores4a, true, 120, 0);
  // W=3+3=6, L=0, dist=120 > 60 → W > eL → confirmed_water
  assert('marina basin (clear water) → confirmed_water', res4a === 'confirmed_water', res4a);

  // 4b: Marina entrance — marina polygon + city suburb + buildings 60 m away
  const marinaEntranceEls = [
    { tags: { leisure: 'marina' } },
    { tags: { place: 'suburb' } },
  ];
  const nearbyBuildings = [
    { tags: { building: 'commercial' } },
  ];
  const scores4b = classifyIsInElements(marinaEntranceEls);
  const NL4b = classifyNearbyLandFeatures(nearbyBuildings);
  // coastline 40 m — in strict zone
  const res4b = classifyWaterResult(scores4b, true, 40, NL4b);
  // W=3, effectiveL=2+4=6, dist=40 < 60 → W > eL+2? 3>8? No → eL > W+2? 6>5? Yes → confirmed_land
  assert('marina entrance + building 60m + 40m coastline → confirmed_land', res4b === 'confirmed_land', res4b);

  // 4c: Harbour (landuse=harbour) in open water, no nearby land
  const harbourEls = [
    { tags: { landuse: 'harbour' } },
  ];
  const scores4c = classifyIsInElements(harbourEls);
  const res4c = classifyWaterResult(scores4c, true, 200, 0);
  // W=2, L=0, dist=200 > 60 → W > eL=0 → confirmed_water
  assert('harbour (open water side, 200m from coast) → confirmed_water', res4c === 'confirmed_water', res4c);

  // 4d: Harbour boundary with residential nearby
  const harbourLandEls = [
    { tags: { landuse: 'harbour' } },
    { tags: { landuse: 'residential' } },
  ];
  const scores4d = classifyIsInElements(harbourLandEls);
  const res4d = classifyWaterResult(scores4d, true, 80, 0);
  // W=2, L=3, dist=80 > 60 → W > eL? 2>3? No → eL >= W+2? 3>=4? No → uncertain
  assert('harbour + residential → uncertain', res4d === 'uncertain', res4d);

  // 4e: Corniche road (land side) — suburb + road within 30 m of coastline
  const cornicheEls = [
    { tags: { place: 'suburb' } },
    { tags: { landuse: 'residential' } },
  ];
  const cornicheRoad = [
    { tags: { highway: 'primary' } },
  ];
  const scores4e = classifyIsInElements(cornicheEls);
  const NL4e = classifyNearbyLandFeatures(cornicheRoad);
  const res4e = classifyWaterResult(scores4e, true, 10, NL4e);
  // W=0, effectiveL=2+3+2=7, dist=10 < 60 → eL > W+2? 7>2? Yes → confirmed_land
  assert('corniche road 10m from coastline → confirmed_land', res4e === 'confirmed_land', res4e);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Marine labels for confirmed_water points
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 5: Marine Labels for confirmed_water Points ──');
{
  const LAND_LABELS = ['road', 'street', 'building', 'district'];

  // 5a: city + country → "نقطة بحرية قرب {city}، {country}"
  const label5a = formatMarinePlaceSuggestion({ city: 'الدوحة', country: 'قطر' });
  assert('marine label has city and country', label5a === 'نقطة بحرية قرب الدوحة، قطر', label5a);
  LAND_LABELS.forEach(function (w) {
    assert('marine label does not contain "' + w + '"', !label5a.toLowerCase().includes(w),
      label5a);
  });

  // 5b: country only → "موقع بحري داخل المياه {country}"
  const label5b = formatMarinePlaceSuggestion({ country: 'الإمارات' });
  assert('marine label country-only format', label5b === 'موقع بحري داخل المياه الإمارات', label5b);

  // 5c: locality (county/state) only → "مياه {locality}"
  const label5c = formatMarinePlaceSuggestion({ county: 'خليج عمان' });
  assert('marine label locality-only format', label5c === 'مياه خليج عمان', label5c);

  // 5d: no address fields → fallback
  const label5d = formatMarinePlaceSuggestion({});
  assert('marine label fallback when no address', label5d === 'موقع بحري داخل المياه الإقليمية', label5d);

  // 5e: Nominatim returns road/street — confirmed_water must override with marine label
  const nominatimAddr = { road: 'Corniche Road', city: 'أبوظبي', country: 'الإمارات' };
  const label5e = formatMarinePlaceSuggestion(nominatimAddr); // called only when confirmed_water
  assert('road in Nominatim but marine label used for confirmed_water', label5e.includes('نقطة بحرية'), label5e);
  assert('marine label does not surface road name', !label5e.toLowerCase().includes('corniche road'), label5e);

  // 5f: town fallback
  const label5f = formatMarinePlaceSuggestion({ town: 'مسقط', country: 'عُمان' });
  assert('marine label uses town as locality', label5f === 'نقطة بحرية قرب مسقط، عُمان', label5f);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Fallback behavior (Overpass unavailable)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 6: Fallback Behavior ──');
{
  // 6a: Display name contains "sea" → score=2 (keyword) +1 (no land) +1 (dist unknown) = 4 → water
  const r6a = applyFallbackWaterHint('Arabian Sea, somewhere', 0, null);
  assert('fallback: "sea" in display name + no land → confirmed_water', r6a === 'confirmed_water', r6a);

  // 6b: Display name contains "gulf" → score=2+1+1=4 → water
  const r6b = applyFallbackWaterHint('Persian Gulf, Qatar', 0, null);
  assert('fallback: "gulf" in display name → confirmed_water', r6b === 'confirmed_water', r6b);

  // 6c: Display name contains "bay" + no land score null (unknown) + dist > 100
  const r6c = applyFallbackWaterHint('Doha Bay Area', null, 150);
  // score: keyword=2, nearbyLandScore=null (skip), dist=150>100 → +1 → total=3 → water
  assert('fallback: "bay" + dist>100 → confirmed_water', r6c === 'confirmed_water', r6c);

  // 6d: Display name contains "water" + 0 nearby land + dist unknown
  const r6d = applyFallbackWaterHint('Water body near Ras Laffan', 0, null);
  assert('fallback: "water" keyword → confirmed_water', r6d === 'confirmed_water', r6d);

  // 6e: Display name contains Arabic خليج
  const r6e = applyFallbackWaterHint('خليج عمان، سلطنة عمان', 0, null);
  assert('fallback: Arabic خليج → confirmed_water', r6e === 'confirmed_water', r6e);

  // 6f: Residential address, no water keywords, land nearby → score=0 → uncertain
  const r6f = applyFallbackWaterHint('15 King Fahd Road, Doha, Qatar', null, null);
  assert('fallback: land address, no keywords → uncertain', r6f === 'uncertain', r6f);

  // 6g: Empty display name + no land + dist unknown → score=0+1+1=2 → confirmed_water
  const r6g = applyFallbackWaterHint('', 0, null);
  assert('fallback: empty name + no land + dist unknown → confirmed_water', r6g === 'confirmed_water', r6g);

  // 6h: Empty display name + nearby land detected (score>0) + dist unknown → 0+0+1=1 → uncertain
  const r6h = applyFallbackWaterHint('', 4, null);
  assert('fallback: empty name + buildings nearby + dist unknown → uncertain', r6h === 'uncertain', r6h);

  // 6i: Fallback NEVER returns confirmed_land (rule: only upgrades uncertain → water)
  const r6i_keyword = applyFallbackWaterHint('Residential Area, Doha', 6, 40);
  assert('fallback: NEVER returns confirmed_land', r6i_keyword !== 'confirmed_land', r6i_keyword);

  // 6j: Point 50 m from coastline (< 100 m) with no water keyword → +0+1+0 = 1 → uncertain
  const r6j = applyFallbackWaterHint('Corniche Promenade', 0, 50);
  assert('fallback: no water keyword + 50m from coast → uncertain', r6j === 'uncertain', r6j);

  // 6k: Point 50 m from coastline but has "bay" keyword → +2+1+0 = 3 → confirmed_water
  const r6k = applyFallbackWaterHint('Corniche Bay, Doha', 0, 50);
  assert('fallback: "bay" keyword + 50m from coast → confirmed_water', r6k === 'confirmed_water', r6k);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Summary ──────────────────────────────────────────────────────');
console.log('  Total :', results.passed.length + results.failed.length);
console.log('  Passed:', results.passed.length);
console.log('  Failed:', results.failed.length);
if (results.failed.length > 0) {
  console.error('\nFailed tests:');
  results.failed.forEach(function (n) { console.error('  ✗', n); });
  process.exit(1);
} else {
  console.log('\nAll tests passed ✓');
}
