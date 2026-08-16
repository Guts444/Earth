#!/usr/bin/env node
/**
 * build-geo-data.mjs — Earth Command geographic context dataset builder.
 *
 * Converts Natural Earth vector data (public domain) into the compact
 * app-specific `public/data/geo-context.json` consumed at runtime by
 * `src/geo/context/`. No runtime GeoJSON parsing, no huge raw files.
 *
 * Pipeline
 * --------
 *  1. Download pinned Natural Earth v5.1.2 GeoJSON (cached in .geo-cache/).
 *  2. Country borders: ne_50m_admin_0_boundary_lines_land → DP-simplified,
 *     dateline-checked polylines. Kind 0 = international boundary,
 *     kind 1 = disputed / line of control / indefinite (kept for future
 *     styling; rendered the same for now).
 *  3. Country labels: ne_50m_admin_0_countries — Natural Earth's own
 *     cartographic label points (LABEL_X/LABEL_Y), LABELRANK as priority.
 *  4. Admin-1 (states/provinces):
 *     - 50m dataset covers 9 countries (AUS BRA CAN CHN IDN IND RUS USA ZAF);
 *     - every other country in ADMIN1_EXTRA comes from the 10m dataset.
 *     - Internal admin-1 boundary lines are DERIVED from polygon rings:
 *       a ring segment shared by 2+ units of the same country is an internal
 *       boundary (coastlines and country borders are shared by 1 unit and are
 *       dropped). Endpoints are snapped to a quantization grid so the two
 *       digitizations of the same edge match, then chains are simplified.
 *       (Validated against NE's own 50m admin-1 lines file, see summary.)
 *  5. Cities: ne_50m_populated_places — capitals/world cities/region
 *     capitals/population centers, tiered (0..3) and priority-ranked for the
 *     runtime LOD + collision system. Each city is verified against its
 *     country's 50m polygon (inside, or within the generalization buffer of
 *     the polygon edge — NE 50m coastlines are coarse and many coastal
 *     cities legitimately fall slightly outside).
 *  6. Emits scripts/data/geo-verify-countries.json (coarse country polygons)
 *     used by `npm run verify:geo` for offline point-in-country checks.
 *
 * Coordinates: lines are stored as flat [lon*1000, lat*1000, ...] integer
 * arrays; labels/cities keep float degrees. The runtime projects lat/lon with
 * the SAME geoToScene convention as every other domain (ECEF → scene).
 *
 * Sources (Natural Earth, public domain — naturalearthdata.com):
 *  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/...
 *
 * Usage:  node scripts/build-geo-data.mjs [--offline]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, '.geo-cache');
const OUT_FILE = join(ROOT, 'public', 'data', 'geo-context.json');
const VERIFY_POLY_FILE = join(ROOT, 'scripts', 'data', 'geo-verify-countries.json');
const OFFLINE = process.argv.includes('--offline') || process.env.GEO_OFFLINE === '1';

const NE_TAG = 'v5.1.2';
const NE_BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_TAG}/geojson`;

const FILES = {
  admin0: 'ne_50m_admin_0_countries.geojson',
  admin0Lines: 'ne_50m_admin_0_boundary_lines_land.geojson',
  admin1_50: 'ne_50m_admin_1_states_provinces.geojson',
  admin1Lines_50: 'ne_50m_admin_1_states_provinces_lines.geojson', // validation only
  admin1_10: 'ne_10m_admin_1_states_provinces.geojson',
  places: 'ne_50m_populated_places.geojson',
};

/**
 * Extra admin-1 countries pulled from the 10m dataset (ISO 3166-1 alpha-3).
 * The 50m dataset already covers AUS BRA CAN CHN IDN IND RUS USA ZAF.
 */
const ADMIN1_EXTRA = [
  'DEU', 'FRA', 'ESP', 'ITA', 'GBR', 'JPN', 'KOR', 'MEX', // prompt examples + big economies
  'ARG', 'CHL', 'PER', 'COL', 'VEN', // South America
  'VNM', 'THA', 'PHL', 'MYS', // Southeast Asia
  'NGA', 'EGY', 'TUR', 'KEN', // Africa / Near East
  'SWE', 'NOR', 'FIN', 'POL', 'UKR', 'ROU', 'GRC', 'PRT', 'CZE', 'AUT', 'CHE', 'NLD', 'BEL', 'DNK', 'IRL', // Europe
  'KAZ', 'SAU', 'IRN', 'PAK', // Central / West Asia
  'NZL', 'ISR',
];

/**
 * City country-code fixes: populated-places codes that differ from admin-0.
 * - PLACE_CC_ALIAS: place ADM0_A3 → final ISO alpha-2 cc for the city record.
 * - PLACE_VERIFY_A3: place ADM0_A3 → admin-0 feature A3 for polygon checks.
 */
const PLACE_CC_ALIAS = { SSD: 'SS', GIB: 'GI', SJM: 'SJ' };
const PLACE_VERIFY_A3 = { SSD: 'SDS', GIB: 'GBR', SJM: 'NOR' };

/**
 * Countries where the 10m admin-1 dataset is digitized at admin-2 level; the
 * `region` property holds the true admin-1 grouping. Aggregate units by region
 * (region = admin-1 name; internal edges between regions survive derivation).
 * PHL regions are the official first-level divisions; VNM regions are
 * statistical only, so VNM stays at province level.
 */
const AGGREGATE_BY_REGION = new Set(['FRA', 'ITA', 'ESP', 'PHL']);
/**
 * GBR districts map to NUTS regions — not admin-1. Map each NUTS region to the
 * four home nations so aggregation produces England/Scotland/Wales/NI borders.
 */
function ukRegionToCountry(region) {
  if (!region) return 'England';
  if (region === 'Northern Ireland') return 'Northern Ireland';
  if (/Wales/.test(region)) return 'Wales';
  if (region === 'Highlands and Islands' || region === 'North Eastern' || region === 'South Western') return 'Scotland';
  return 'England';
}

// Simplification / quantization (degrees)
const DP_COUNTRY_LINES = 0.03;
const DP_ADMIN1_50 = 0.04; // after cell-snapping; polylines are already clean
const DP_ADMIN1_10 = 0.08;
const DP_VERIFY_POLYS = 0.15;
const SNAP_50 = 0.015; // dedup cell size, 50m rings
const SNAP_10 = 0.05; // dedup cell size, 10m rings
const LINE_SCALE = 1000; // line coords stored as ints (1e-3 deg)
const VERIFY_SCALE = 100; // verify polygons: 1e-2 deg

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

async function loadSource(key) {
  const file = FILES[key];
  const dest = join(CACHE_DIR, file);
  if (OFFLINE && existsSync(dest)) {
    return JSON.parse(readFileSync(dest, 'utf8'));
  }
  const url = `${NE_BASE}/${file}`;
  console.log(`  fetch ${key}: ${file}`);
  const data = await fetchJson(url);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(dest, JSON.stringify(data));
  return data;
}

/** Douglas–Peucker on flat [lon,lat,lon,lat...]; tolerance in degrees. */
function simplifyDP(flat, tolDeg) {
  const n = flat.length / 2;
  if (n <= 2) return flat;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tol2 = tolDeg * tolDeg;
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = flat[2 * a], ay = flat[2 * a + 1];
    const bx = flat[2 * b], by = flat[2 * b + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = 0, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const px = flat[2 * i] - ax, py = flat[2 * i + 1] - ay;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const ex = ax + t * dx - flat[2 * i];
      const ey = ay + t * dy - flat[2 * i + 1];
      const d2 = ex * ex + ey * ey;
      if (d2 > maxD) { maxD = d2; maxI = i; }
    }
    if (maxD > tol2 && maxI >= 0) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(flat[2 * i], flat[2 * i + 1]);
  return out;
}

function geomRings(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0]);
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}

/** Shoelace area in deg² for ordering tie-breaks (dateline-split polygons are fine). */
function ringAreaDeg2(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a) / 2;
}

/** Ray-cast point-in-ring (lon/lat degrees). */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y) {
      const xint = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xint) inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Admin-1 internal boundary derivation
// ---------------------------------------------------------------------------

/**
 * Derive internal admin-1 boundary lines for one country from its units'
 * polygon rings: a ring segment whose quantized endpoints are shared by 2+
 * distinct units is an internal boundary. Returns flat polyline point arrays
 * (chained, DP-simplified) and the segment count for validation.
 */
function deriveAdmin1Lines(units, snapDeg) {
  // key -> Set of unit codes
  const segUnits = new Map();
  const unitCounts = new Map();
  let rawSegments = 0;
  for (const unit of units) {
    const code = unit.code;
    for (const ring of unit.rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i];
        const ca = [Math.round(a[0] / snapDeg), Math.round(a[1] / snapDeg)];
        const cb = [Math.round(b[0] / snapDeg), Math.round(b[1] / snapDeg)];
        const key = ca <= cb ? `${ca[0]},${ca[1]}|${cb[0]},${cb[1]}` : `${cb[0]},${cb[1]}|${ca[0]},${ca[1]}`;
        let set = segUnits.get(key);
        if (!set) segUnits.set(key, (set = new Set()));
        set.add(code);
        rawSegments++;
      }
    }
    unitCounts.set(code, (unitCounts.get(code) ?? 0) + 1);
  }

  // Internal edges → representative segments at cell centers.
  const segs = [];
  for (const [key, codes] of segUnits) {
    if (codes.size < 2) continue;
    const [a, b] = key.split('|').map((s) => s.split(',').map(Number));
    const pts = [
      (a[0] + 0.5) * snapDeg, (a[1] + 0.5) * snapDeg,
      (b[0] + 0.5) * snapDeg, (b[1] + 0.5) * snapDeg,
    ];
    if (Math.abs(pts[0] - pts[2]) > 180) continue; // dateline safety
    segs.push(pts);
  }
  return { segs, unitCount: unitCounts.size, rawSegments };
}

/** Chain flat [x0,y0,x1,y1,...] segments into polylines (undirected walk). */
function chainSegments(segs, snapDeg) {
  const q = (v) => Math.round(v / snapDeg);
  const adj = new Map(); // endpoint key -> [segment indices]
  const used = new Uint8Array(segs.length);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (const k of [`${q(s[0])},${q(s[1])}`, `${q(s[2])},${q(s[3])}`]) {
      let list = adj.get(k);
      if (!list) adj.set(k, (list = []));
      list.push(i);
    }
  }
  const chains = [];
  /** Reverse a flat [x0,y0,x1,y1,...] array in coordinate pairs. */
  const reversePairs = (arr) => {
    for (let i = 0, j = arr.length - 2; i < j; i += 2, j -= 2) {
      const ax = arr[i], ay = arr[i + 1];
      arr[i] = arr[j]; arr[i + 1] = arr[j + 1];
      arr[j] = ax; arr[j + 1] = ay;
    }
    return arr;
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const seg = segs[i];
    const chain = [seg[0], seg[1], seg[2], seg[3]];
    for (;;) {
      // extend from the tail of the chain
      const tailX = chain[chain.length - 2];
      const tailY = chain[chain.length - 1];
      const key = `${q(tailX)},${q(tailY)}`;
      const list = adj.get(key);
      if (!list) break;
      let nextIdx = -1;
      for (const idx of list) if (!used[idx]) { nextIdx = idx; break; }
      if (nextIdx < 0) break;
      used[nextIdx] = 1;
      const n = segs[nextIdx];
      if (q(n[0]) === q(tailX) && q(n[1]) === q(tailY)) {
        chain.push(n[2], n[3]);
      } else {
        chain.push(n[0], n[1]);
      }
    }
    // reverse, then extend again from the new tail (former head)
    reversePairs(chain);
    for (;;) {
      const tailX = chain[chain.length - 2];
      const tailY = chain[chain.length - 1];
      const key = `${q(tailX)},${q(tailY)}`;
      const list = adj.get(key);
      if (!list) break;
      let nextIdx = -1;
      for (const idx of list) if (!used[idx]) { nextIdx = idx; break; }
      if (nextIdx < 0) break;
      used[nextIdx] = 1;
      const n = segs[nextIdx];
      if (q(n[0]) === q(tailX) && q(n[1]) === q(tailY)) {
        chain.push(n[2], n[3]);
      } else {
        chain.push(n[0], n[1]);
      }
    }
    reversePairs(chain); // restore direction
    if (chain.length >= 6) chains.push(chain);
  }
  return chains;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

console.log(`Building geographic context dataset (Natural Earth ${NE_TAG}${OFFLINE ? ', offline cache' : ''})`);

const [admin0, admin0Lines, admin1_50, admin1Lines_50, admin1_10, places] = await Promise.all([
  loadSource('admin0'),
  loadSource('admin0Lines'),
  loadSource('admin1_50'),
  loadSource('admin1Lines_50'),
  loadSource('admin1_10'),
  loadSource('places'),
]);

// ---- Countries (labels + ranks + area) -------------------------------------

const countries = [];
const isoByAdm0A3 = new Map();
const admin0PolysByA3 = new Map(); // full-res rings, for city verification
const verifyPolysByCc = new Map(); // coarse, for the verify script
const countryAreaByCc = new Map(); // dedup: keep the largest feature per cc
let countryOrder = 0;

for (const f of admin0.features) {
  const p = f.properties;
  const a3 = p.ADM0_A3;
  let cc = p.ISO_A2;
  if (!cc || cc === '-99' || cc.length !== 2) cc = p.ISO_A2_EH && p.ISO_A2_EH.length === 2 ? p.ISO_A2_EH : null;
  if (!cc) { console.warn(`  drop country without ISO A2: ${p.ADMIN} (${a3})`); continue; }
  isoByAdm0A3.set(a3, cc);

  const rings = geomRings(f.geometry);
  admin0PolysByA3.set(a3, rings);
  let area = 0;
  for (const r of rings) area += ringAreaDeg2(r);

  // Verification polygons always merge (dependencies are part of the country).
  // DP-simplified for size, then DENSIFIED (intermediate points every ≤0.05°)
  // so the verify script's edge-buffer check works on a real edge, not just
  // sparse simplified vertices.
  const poly = [];
  for (const r of rings) {
    const flat = [];
    for (const [x, y] of r) flat.push(x, y);
    const simp = simplifyDP(flat, DP_VERIFY_POLYS);
    const dense = [];
    for (let i = 0; i + 3 < simp.length; i += 2) {
      const x0 = simp[i], y0 = simp[i + 1];
      const x1 = simp[i + 2], y1 = simp[i + 3];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 0.05));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        dense.push(Math.round((x0 + (x1 - x0) * t) * VERIFY_SCALE));
        dense.push(Math.round((y0 + (y1 - y0) * t) * VERIFY_SCALE));
      }
    }
    const n = simp.length;
    dense.push(Math.round(simp[n - 2] * VERIFY_SCALE), Math.round(simp[n - 1] * VERIFY_SCALE));
    poly.push(dense);
  }
  const prev = verifyPolysByCc.get(cc);
  verifyPolysByCc.set(cc, prev ? prev.concat(poly) : poly);

  // Label entry: only the largest feature per country code (drops duplicate
  // labels for tiny dependencies like Ashmore and Cartier Islands).
  const bestArea = countryAreaByCc.get(cc) ?? -1;
  if (area > bestArea) {
    countryAreaByCc.set(cc, area);
    countries.push({
      cc,
      name: p.NAME ?? p.NAME_EN ?? p.ADMIN, // cartographic short name ('China', not 'People's Republic of China')
      rank: Number.isFinite(p.LABELRANK) ? p.LABELRANK : 5,
      lon: round6(p.LABEL_X),
      lat: round6(p.LABEL_Y),
      pop: p.POP_EST ?? 0,
      area: Math.round(area),
      o: countryOrder++,
    });
  }
}
console.log(`  countries: ${countries.length} labels (${verifyPolysByCc.size} codes)`);

// ---- Country border lines ---------------------------------------------------

const countryLines = [];
let droppedSegs = 0;
for (const f of admin0Lines.features) {
  const g = f.geometry;
  if (!g) continue;
  const kind = f.properties.FEATURECLA === 'International boundary (verify)' ? 0 : 1;
  for (const ring of geomRings(g)) {
    const flat = [];
    for (const [x, y] of ring) flat.push(x, y);
    const simp = simplifyDP(flat, DP_COUNTRY_LINES);
    // dateline sanity: NE splits at ±180, so no segment may jump across
    let ok = true;
    for (let i = 2; i < simp.length; i += 2) {
      if (Math.abs(simp[i] - simp[i - 2]) > 180) { ok = false; droppedSegs++; break; }
    }
    if (ok && simp.length >= 4) {
      countryLines.push({ k: kind, q: simp.map((v) => Math.round(v * LINE_SCALE)) });
    }
  }
}
if (droppedSegs > 0) console.warn(`  dropped ${droppedSegs} country line(s) crossing the dateline`);

// ---- Admin-1: units per country from 50m + 10m ------------------------------

function collectUnits(dataset, filter) {
  const byCc = new Map();
  for (const f of dataset.features) {
    const p = f.properties;
    const a3 = p.adm0_a3;
    const cc = isoByAdm0A3.get(a3);
    if (!cc || !filter(a3)) continue;
    if (!byCc.has(cc)) byCc.set(cc, []);
    byCc.get(cc).push({
      code: p.adm1_code ?? p.iso_3166_2 ?? '',
      name: p.name ?? p.name_en ?? '',
      rank: Number.isFinite(p.labelrank) ? p.labelrank : 5,
      lon: round6(p.longitude),
      lat: round6(p.latitude),
      region: p.region ?? '',
      rings: geomRings(f.geometry),
    });
  }
  return byCc;
}

const admin1_50_by_cc = collectUnits(admin1_50, () => true);
const admin1_10_by_cc = collectUnits(admin1_10, (a3) => ADMIN1_EXTRA.includes(a3));

/**
 * Aggregate units into their true admin-1 level:
 * - AGGREGATE_BY_REGION countries: group by `region` (region name = admin-1).
 * - GBR: group by mapped home nation.
 * Everything else passes through unchanged (already admin-1).
 * Returns [{ code, name, rank, lon, lat, rings[] }] — rings of all members.
 */
function aggregateToAdmin1(a3, units) {
  if (!AGGREGATE_BY_REGION.has(a3) && a3 !== 'GBR') {
    return units; // already admin-1: pass through unchanged (rings: array of rings)
  }
  const groups = new Map();
  for (const u of units) {
    const key = a3 === 'GBR' ? ukRegionToCountry(u.region) : u.region || u.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }
  const out = [];
  for (const [name, members] of groups) {
    const lons = [], lats = [];
    const rings = [];
    let rank = 10;
    for (const m of members) {
      if (Number.isFinite(m.lon) && Number.isFinite(m.lat)) { lons.push(m.lon); lats.push(m.lat); }
      for (const r of m.rings) rings.push(r);
      rank = Math.min(rank, m.rank);
    }
    out.push({
      code: name,
      name,
      rank,
      lon: lons.length ? round6(lons.reduce((s, v) => s + v, 0) / lons.length) : null,
      lat: lats.length ? round6(lats.reduce((s, v) => s + v, 0) / lats.length) : null,
      rings,
    });
  }
  return out;
}

// Ground truth for validation: NE's own 50m admin-1 lines (9 countries).
// NOTE: in this NE file the ADM0_A3 codes for India and Indonesia are swapped
// ('IND' features hold Indonesian geometry and vice versa) — remap before use.
const GT_CC_SWAP = { IND: 'IDN', IDN: 'IND' };
const gt50 = new Map();
for (const f of admin1Lines_50.features) {
  const g = f.geometry;
  if (!g) continue;
  const cc = isoByAdm0A3.get(GT_CC_SWAP[f.properties.ADM0_A3] ?? f.properties.ADM0_A3);
  if (!cc) continue;
  if (!gt50.has(cc)) gt50.set(cc, new Set());
  const set = gt50.get(cc);
  for (const ring of geomRings(g)) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i], b = ring[i + 1];
      const ca = `${Math.round(a[0] / SNAP_50)},${Math.round(a[1] / SNAP_50)}`;
      const cb = `${Math.round(b[0] / SNAP_50)},${Math.round(b[1] / SNAP_50)}`;
      set.add(ca <= cb ? `${ca}|${cb}` : `${cb}|${ca}`);
    }
  }
}

const admin1 = [];
const admin1Lines = [];
let admin1TotalPolys = 0;
for (const [cc, units] of [...admin1_50_by_cc, ...admin1_10_by_cc]) {
  const from50 = admin1_50_by_cc.has(cc);
  const a3 = countryA3ForCc(cc);
  const agg = aggregateToAdmin1(a3, units);
  const aggregated = !from50 && (AGGREGATE_BY_REGION.has(a3) || a3 === 'GBR');
  const snap = from50 ? SNAP_50 : SNAP_10;
  const dpTol = from50 ? DP_ADMIN1_50 : DP_ADMIN1_10;

  const { segs } = deriveAdmin1Lines(agg, snap);
  const chains = chainSegments(segs, snap * 2);
  const polys = [];
  for (const ch of chains) {
    const simp = simplifyDP(ch, dpTol);
    if (simp.length >= 4) polys.push(simp.map((v) => Math.round(v * LINE_SCALE)));
  }
  admin1TotalPolys += polys.length;
  admin1Lines.push({ cc, q: polys });

  // validation against NE's own lines file (50m countries only)
  if (gt50.has(cc)) {
    const gt = gt50.get(cc);
    let matched = 0;
    for (const s of segs) {
      // derived segs are cell centers; floor() recovers the exact cell index
      const ca = `${Math.floor(s[0] / SNAP_50)},${Math.floor(s[1] / SNAP_50)}`;
      const cb = `${Math.floor(s[2] / SNAP_50)},${Math.floor(s[3] / SNAP_50)}`;
      const key = ca <= cb ? `${ca}|${cb}` : `${cb}|${ca}`;
      if (gt.has(key)) matched++;
    }
    const recall = gt.size > 0 ? matched / gt.size : 1;
    // Straight-line borders (AU) legitimately score lower: the lines file
    // places vertices at different positions along the same straight border,
    // so quantized-cell recall undercounts even though the geometry coincides
    // (verified separately: every derived AU segment lies within ~2 km of the
    // lines file). 0.5 is a tripwire for real regressions, not a quality gate.
    const warn = recall < 0.5 ? '  ⚠ LOW RECALL — investigate' : '';
    console.log(`  admin1 ${cc}: ${agg.length} units, ${segs.length} internal segs → ${polys.length} polylines (gt recall ${(recall * 100).toFixed(1)}%)${warn}`);
  } else {
    console.log(`  admin1 ${cc}: ${agg.length} units${aggregated ? ' (aggregated)' : ''}, ${segs.length} internal segs → ${polys.length} polylines (10m)`);
  }

  for (const u of agg) {
    if (Number.isFinite(u.lon) && Number.isFinite(u.lat)) {
      admin1.push({ cc, c: u.code, n: u.name, r: u.rank, x: u.lon, y: u.lat });
    }
  }
}

/** ADM0_A3 for a cc (needed only for aggregation detection). */
function countryA3ForCc(cc) {
  for (const [a3, code] of isoByAdm0A3) if (code === cc) return a3;
  return null;
}

// ---- Cities ----------------------------------------------------------------

// Cell sets of country ring edges (for the generalization buffer check).
const countryEdgeCells = new Map();
const BUFFER = 0.1; // degrees ≈ 11 km — NE 50m generalization slop
for (const [a3, rings] of admin0PolysByA3) {
  const cells = new Set();
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      cells.add(`${Math.round(a[0] / BUFFER)},${Math.round(a[1] / BUFFER)}`);
      cells.add(`${Math.round(b[0] / BUFFER)},${Math.round(b[1] / BUFFER)}`);
    }
  }
  countryEdgeCells.set(a3, cells);
}

function cityVerified(a3, lon, lat) {
  const rings = admin0PolysByA3.get(a3);
  if (!rings) return { status: 'no-polygons' };
  for (const r of rings) if (pointInRing(lon, lat, r)) return { status: 'inside' };
  const cells = countryEdgeCells.get(a3);
  const key = `${Math.round(lon / BUFFER)},${Math.round(lat / BUFFER)}`;
  if (cells && cells.has(key)) return { status: 'near-edge' };
  return { status: 'outside' };
}

const cities = [];
let cityVerifyFail = 0;
for (const f of places.features) {
  const p = f.properties;
  const a3 = p.ADM0_A3;
  const cc = isoByAdm0A3.get(a3) ?? PLACE_CC_ALIAS[a3] ?? p.ISO_A2;
  const verA3 = PLACE_VERIFY_A3[a3] ?? a3;
  const ver = cityVerified(verA3, p.LONGITUDE, p.LATITUDE);
  if (ver.status === 'outside') {
    cityVerifyFail++;
    if (cityVerifyFail <= 25) console.warn(`  city outside country polygon: ${p.NAME} (${p.ADM0NAME}) @ ${p.LONGITUDE},${p.LATITUDE}`);
  }

  const cap0 = p.ADM0CAP === 1;
  const cap1 = !cap0 && String(p.FEATURECLA ?? '').toLowerCase().includes('capital');
  const lr = Number.isFinite(p.LABELRANK) && p.LABELRANK >= 1 && p.LABELRANK <= 8 ? p.LABELRANK : null;
  const effRank = lr ?? (Number.isFinite(p.SCALERANK) ? p.SCALERANK : 5);
  const pop = p.POP_MAX ?? 0;
  let tier = 3;
  if (cap0 || p.MEGACITY === 1 || (p.WORLDCITY === 1 && pop >= 500_000)) tier = 0;
  else if (cap1 || effRank <= 2 || pop >= 1_000_000) tier = 1;
  else if (effRank <= 5 || pop >= 500_000) tier = 2;
  const pri =
    (4 - tier) * 10_000_000 +
    (cap0 ? 2_000_000 : cap1 ? 1_000_000 : 0) +
    (10 - Math.min(effRank, 10)) * 10_000 +
    Math.min(Math.floor(pop / 10_000), 9_999);

  cities.push({
    n: p.NAME ?? p.NAMEASCII,
    cc: typeof cc === 'string' && cc.length === 2 ? cc : '??',
    co: p.ADM0NAME ?? '',
    ad: p.ADM1NAME ?? '',
    x: round6(p.LONGITUDE),
    y: round6(p.LATITUDE),
    p: pop,
    t: tier,
    pr: pri,
    c0: cap0 ? 1 : 0,
    c1: cap1 ? 1 : 0,
  });
}
console.log(`  cities: ${cities.length} (outside-country: ${cityVerifyFail})`);

// ---------------------------------------------------------------------------

function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

const meta = {
  s: 'Natural Earth',
  v: NE_TAG,
  l: 'Public Domain',
  u: `${NE_BASE}/`,
  b: new Date().toISOString().slice(0, 10),
  f: Object.values(FILES),
};

const out = { meta, countries, countryLines, admin1, admin1Lines, cities };
mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(out));
mkdirSync(dirname(VERIFY_POLY_FILE), { recursive: true });
writeFileSync(
  VERIFY_POLY_FILE,
  JSON.stringify([...verifyPolysByCc.entries()].map(([cc, p]) => ({ cc, p }))),
);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log('');
console.log(`Wrote ${OUT_FILE} (${kb(Buffer.byteLength(JSON.stringify(out)))}), ${verifyPolysByCc.size} verify polygons`);
console.log(`  countries: ${countries.length} labels, ${countryLines.length} border polylines`);
console.log(`  admin1: ${admin1.length} labels across ${new Set(admin1.map((a) => a.cc)).size} countries, ${admin1TotalPolys} boundary polylines`);
console.log(`  cities: ${cities.length} (tiers: ${[0, 1, 2, 3].map((t) => `${t}=${cities.filter((c) => c.t === t).length}`).join(' ')})`);
