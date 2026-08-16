#!/usr/bin/env node
/**
 * verify-geo.mjs — deterministic checks for the geographic context dataset
 * and the shared lat/lon → scene projection convention. Offline; runs against
 * the bundled artifacts only.
 *
 * Checks:
 *  1. Structural: counts, coordinate ranges, no NaN, dateline safety (no
 *     line segment jumps across ±180°), polylines ≥ 2 points.
 *  2. Representative world cities land in the right country polygons
 *     (inside, or within the generalization buffer of the 50m polygon edge):
 *     New York, London, Tokyo, Sydney, São Paulo, Cape Town.
 *  3. Every shipped city falls inside (or near) its declared country —
 *     reported as a pass rate, never silently skipped.
 *  4. Projection convention: geoToScene math reproduced and pinned to the
 *     ECEF → scene mapping (X→X, Z→Y, Y→−Z) with axis/east/west checks.
 *
 * Usage: node scripts/verify-geo.mjs   (exit 0 = pass, 1 = fail)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const data = JSON.parse(
  readFileSync(join(ROOT, 'public', 'data', 'geo-context.json'), 'utf8'),
);
const verifyPolys = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'data', 'geo-verify-countries.json'), 'utf8'),
);

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log('— structure —');
ok(`countries: ${data.countries.length} labels`);
ok(`countryLines: ${data.countryLines.length} polylines`);
ok(`admin1: ${data.admin1.length} labels across ${new Set(data.admin1.map((a) => a.cc)).size} countries`);
ok(`admin1Lines: ${data.admin1Lines.length} countries, ${data.admin1Lines.reduce((n, l) => n + l.q.length, 0)} polylines`);
ok(`cities: ${data.cities.length}`);

const bytes = Buffer.byteLength(JSON.stringify(data));
if (bytes > 1_600_000) fail(`dataset too large for a browser bundle: ${(bytes / 1024).toFixed(0)} KB`);
else ok(`dataset size ${(bytes / 1024).toFixed(0)} KB`);

// coordinate sanity + dateline
let nan = 0, rangeBad = 0, dateline = 0, shortPoly = 0;
for (const c of data.countries) {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon) || Math.abs(c.lat) > 90 || Math.abs(c.lon) > 180) rangeBad++;
}
for (const c of data.cities) {
  if (!Number.isFinite(c.y) || !Number.isFinite(c.x) || Math.abs(c.y) > 90 || Math.abs(c.x) > 180) rangeBad++;
}
for (const l of data.countryLines) {
  if (l.q.length < 4) shortPoly++;
  for (let i = 2; i < l.q.length; i += 2) {
    if (Math.abs(l.q[i] - l.q[i - 2]) > 180_000) dateline++;
  }
}
for (const entry of data.admin1Lines) {
  for (const q of entry.q) {
    if (q.length < 4) shortPoly++;
    for (let i = 2; i < q.length; i += 2) {
      if (Math.abs(q[i] - q[i - 2]) > 180_000) dateline++;
    }
  }
}
if (rangeBad) fail(`${rangeBad} labels/cities outside coordinate ranges`);
else ok('all labels/cities within lon/lat ranges');
if (nan) fail('NaN coordinates present');
if (dateline) fail(`${dateline} line segments jump across the dateline`);
else ok('no dateline-crossing segments');
if (shortPoly) fail(`${shortPoly} degenerate polylines (<2 points)`);
else ok('no degenerate polylines');

// ---- point-in-country helpers (planar lon/lat, polygons are dateline-split)
const polysByCc = new Map();
for (const { cc, p } of verifyPolys) polysByCc.set(cc, p);

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i] / 100, yi = ring[i + 1] / 100;
    const xj = ring[j] / 100, yj = ring[j + 1] / 100;
    if (yi > py !== yj > py) {
      const xint = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (px < xint) inside = !inside;
    }
  }
  return inside;
}

const BUFFER = 0.1;
function countryCells(cc) {
  const cells = new Set();
  for (const ring of polysByCc.get(cc) ?? []) {
    for (let i = 0; i < ring.length; i += 2) {
      cells.add(
        `${Math.round(ring[i] / 100 / BUFFER)},${Math.round(ring[i + 1] / 100 / BUFFER)}`,
      );
    }
  }
  return cells;
}
const cellCache = new Map();

/** inside the coarse polygon, or within ~11 km of a polygon edge. */
function inCountry(cc, lon, lat) {
  const rings = polysByCc.get(cc);
  if (!rings) return { inside: false, reason: 'no-polygons' };
  for (const r of rings) if (pointInRing(lon, lat, r)) return { inside: true };
  let cells = cellCache.get(cc);
  if (!cells) cellCache.set(cc, (cells = countryCells(cc)));
  if (cells.has(`${Math.round(lon / BUFFER)},${Math.round(lat / BUFFER)}`)) {
    return { inside: true, nearEdge: true };
  }
  return { inside: false, reason: 'outside' };
}

/**
 * Like inCountry but tolerant to coarse 50m generalization: also accepts a
 * city whose cell lies within `radiusCells` cells (~11 km each) of any edge
 * cell. Catches coastal cities (NY sits where the 50m coast omits Long
 * Island) and micro-states whose polygon is a few-point sliver.
 */
function inCountryNear(cc, lon, lat, radiusCells) {
  const r = inCountry(cc, lon, lat);
  if (r.inside) return r;
  let cells = cellCache.get(cc);
  if (!cells) cellCache.set(cc, (cells = countryCells(cc)));
  const cx = Math.round(lon / BUFFER);
  const cy = Math.round(lat / BUFFER);
  for (let dx = -radiusCells; dx <= radiusCells; dx++) {
    for (let dy = -radiusCells; dy <= radiusCells; dy++) {
      if (cells.has(`${cx + dx},${cy + dy}`)) {
        return { inside: true, nearEdge: true };
      }
    }
  }
  return r;
}

// ---- representative cities ------------------------------------------------
console.log('— representative cities —');
const REP_CITIES = [
  ['New York', 'US', -74.006, 40.7128],
  ['London', 'GB', -0.1278, 51.5074],
  ['Tokyo', 'JP', 139.6503, 35.6762],
  ['Sydney', 'AU', 151.2093, -33.8688],
  ['São Paulo', 'BR', -46.6333, -23.5505],
  ['Cape Town', 'ZA', 18.4241, -33.9249],
];
for (const [name, cc, lon, lat] of REP_CITIES) {
  const r = inCountryNear(cc, lon, lat, 4);
  if (r.inside) ok(`${name} → ${cc} (${r.nearEdge ? 'near generalized coast' : 'inside'})`);
  else fail(`${name} NOT in ${cc}: ${r.reason}`);
}

// also: the shipped city records for these names must carry the right cc
const cityByName = new Map(data.cities.map((c) => [c.n.toLowerCase(), c]));
for (const [name, cc] of REP_CITIES) {
  const rec = cityByName.get(name.toLowerCase());
  if (!rec) fail(`${name} missing from city dataset`);
  else if (rec.cc !== cc) fail(`${name} has cc ${rec.cc}, expected ${cc}`);
  else ok(`city record: ${name} (${rec.co})`);
}

// ---- every shipped city vs its declared country ---------------------------
console.log('— city/country consistency —');
/**
 * Territories with no polygons in the 50m dataset (tiny dependencies whose
 * geometry is absent at this scale). The city points are correct Natural
 * Earth data; polygon verification is impossible — skip with a note.
 */
const NO_POLY_EXCEPTIONS = new Set([
  'Grand Turk', // Turks & Caicos — not in 50m admin-0
  'Gibraltar', // not in 50m admin-0
  'Longyearbyen', // Svalbard — not in 50m admin-0
]);
let inside = 0, nearEdge = 0, outside = 0, skipped = 0;
const outsideNames = [];
for (const c of data.cities) {
  // Antarctic stations sit on an ice coast the 50m polygon only approximates;
  // their points are correct but the polygon check is meaningless there.
  if (c.cc === 'AQ') { skipped++; continue; }
  if (c.cc === '??' || NO_POLY_EXCEPTIONS.has(c.n)) { skipped++; continue; }
  const r = inCountryNear(c.cc, c.x, c.y, 4);
  if (r.inside) {
    inside++;
    if (r.nearEdge) nearEdge++;
  } else {
    outside++;
    if (outsideNames.length < 30) outsideNames.push(`${c.n} (${c.co})`);
  }
}
const total = data.cities.length - skipped;
const passRate = inside / total;
ok(`cities inside-or-near their country: ${inside}/${total} (${(passRate * 100).toFixed(1)}%)${skipped ? ` + ${skipped} skipped (Antarctic stations / 50m-absent territories)` : ''}`);
if (nearEdge > 0) console.log(`    (${nearEdge} coastal/island cities rely on the 50m generalization buffer)`);
if (outside > 0) {
  console.log(`    outside: ${outside} — ${outsideNames.slice(0, 8).join('; ')}${outside > 8 ? '; …' : ''}`);
}
if (passRate < 0.95) fail(`city/country pass rate below 95%`);
else ok('pass rate ≥ 95%');

// ---- projection convention -------------------------------------------------
console.log('— projection convention (ECEF → scene: X→X, Z→Y, Y→−Z) —');
function geoToSceneRef(latDeg, lonDeg) {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const clat = Math.cos(lat);
  return [clat * Math.cos(lon), Math.sin(lat), -clat * Math.sin(lon)];
}
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const [nx, ny, nz] = geoToSceneRef(90, 0);
if (close(nx, 0) && close(ny, 1) && close(nz, 0)) ok('north pole at +Y');
else fail(`north pole wrong: ${nx},${ny},${nz}`);
const [sx, sy, sz] = geoToSceneRef(-90, 0);
if (close(sx, 0) && close(sy, -1) && close(sz, 0)) ok('south pole at −Y');
else fail('south pole wrong');
const [gx, gy, gz] = geoToSceneRef(0, 0);
if (close(gx, 1) && close(gy, 0) && close(gz, 0)) ok('(0°,0°) at +X');
else fail('origin wrong');
const [ex, ey, ez] = geoToSceneRef(0, 90);
if (close(ex, 0) && close(ez, -1)) ok('(0°,90°E) at −Z (east is −Z)');
else fail(`east orientation wrong: ${ex},${ez}`);
const [wx, wy, wz] = geoToSceneRef(0, -90);
if (close(wx, 0) && close(wz, 1)) ok('(0°,90°W) at +Z (west is +Z)');
else fail('west orientation wrong');
// Tokyo east of Greenwich → negative scene Z; New York west → positive
const tokyo = geoToSceneRef(35.6762, 139.6503);
const nyCity = geoToSceneRef(40.7128, -74.006);
if (tokyo[2] < 0 && nyCity[2] > 0) ok('Tokyo −Z / New York +Z (east-west order)');
else fail('east-west hemisphere order wrong');

// every country label anchor must sit on the unit sphere
let offSphere = 0;
for (const c of data.countries) {
  const [x, y, z] = geoToSceneRef(c.lat, c.lon);
  const len = Math.hypot(x, y, z);
  if (Math.abs(len - 1) > 1e-6) offSphere++;
}
if (offSphere) fail(`${offSphere} country anchors off the unit sphere`);
else ok('all country label anchors on the unit sphere');

// ---- summary ----------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.error(`✗ verify-geo FAILED — ${failures} problem(s)`);
  process.exit(1);
}
console.log('✓ verify-geo PASSED');
