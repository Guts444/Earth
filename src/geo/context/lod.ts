/**
 * LOD policy for the geographic context layers — SEMANTIC zoom hierarchy.
 *
 * All thresholds are camera distance in EARTH RADII (same metric as the
 * global → detail blend: `camera.position.length()`, minDistance 1.2,
 * maxDistance 4.2, default ≈4.05).
 *
 * The bands replace additive accumulation with a semantic progression:
 *
 *   GLOBAL    d ≥ 3.55   major country names + subtle borders
 *   COUNTRY   3.55→2.80  country borders, more country names, admin-1 SHORT
 *                        codes (CA/TX/FL, BY, UP…), country labels begin fading
 *   REGIONAL  2.80→2.15  admin-1 borders + full names, national + admin-1
 *                        capitals, major cities; country labels subordinate
 *   DETAILED  2.15→1.65  full admin-1 names, more cities, density grows
 *   LOCAL     d < 1.65   rich city/town set (10m places tier 4), no giant
 *                        country label
 *
 * Ordering is always: country → subdivision → subdivision + important cities
 * → richer local places. Every gate ramps with a smooth alpha so nothing pops.
 * The subsystem owns these constants (not config.ts) — they are presentation
 * policy; tune visually here.
 */

export const BAND_GLOBAL = 3.55;
export const BAND_COUNTRY = 2.8;
export const BAND_REGIONAL = 2.15;
export const BAND_DETAILED = 1.65;

// ---------------------------------------------------------------------------
// Tier gates
// ---------------------------------------------------------------------------

/** Country-label tier gates by NE LABELRANK (rank ≤ 2 = always on). */
export const COUNTRY_RANK_TIERS = [
  { rank: 2, minDist: Infinity }, // major countries — visible at max zoom-out
  { rank: 3, minDist: 3.55 },
  { rank: 4, minDist: 2.9 },
  { rank: 5, minDist: 2.75 },
  { rank: 7, minDist: 2.6 },
] as const;

/** Admin-1 full-name tier gates by label rank (maxRank per slot). */
export const ADMIN1_RANK_MIN_DIST = [2.8, 2.55, 2.3, 2.1] as const; // rank ≤2, ≤5, ≤7, all
export const ADMIN1_MAX_RANK = [2, 5, 7, 99] as const;

/**
 * City tier gates (tier 0 = capitals/world cities … tier 4 = small towns).
 * Tier 0 opens exactly at the REGIONAL boundary (d < 2.8) so cities never
 * appear while the COUNTRY band is still active.
 */
export const CITY_TIER_MIN_DIST = [2.8, 2.8, 2.15, 1.8, 1.45] as const;

/**
 * Admin-1 SHORT-label band (country scale): candidates exist only while the
 * short phase is meaningful; alpha ramps in/out inside this range.
 */
export const SHORT_ACTIVE_MAX = 3.62;
export const SHORT_ACTIVE_MIN = 2.65;

// ---------------------------------------------------------------------------
// Alpha ramps (piecewise-linear over camera distance, descending pairs)
// ---------------------------------------------------------------------------

/** Country border line alpha. */
export function countryLineAlpha(d: number): number {
  return piecewise(d, [
    [3.8, 0.14],
    [3.55, 0.3],
    [2.9, 0.5],
    [2.6, 0.55],
  ]);
}

/** Admin-1 border line alpha (regional band onward). */
export function admin1LineAlpha(d: number): number {
  return piecewise(d, [
    [2.85, 0],
    [2.5, 0.42],
    [2.0, 0.5],
  ]);
}

/** Country label text alpha — subordinate by regional, gone before detailed. */
export function countryLabelAlpha(d: number): number {
  return piecewise(d, [
    [3.55, 0.85],
    [3.2, 0.95],
    [2.8, 0.9],
    [2.45, 0.35],
    [2.2, 0],
  ]);
}

/** Admin-1 short-code alpha (country scale only). */
export function admin1ShortAlpha(d: number): number {
  return piecewise(d, [
    [3.62, 0],
    [3.45, 0.8],
    [2.95, 0.8],
    [2.65, 0],
  ]);
}

/** Admin-1 full-name alpha. */
export function admin1LabelAlpha(d: number): number {
  return piecewise(d, [
    [2.85, 0],
    [2.55, 0.8],
    [1.7, 0.85],
  ]);
}

/** City label text alpha. */
export function cityLabelAlpha(d: number): number {
  return piecewise(d, [
    [2.9, 0],
    [2.6, 0.85],
    [1.7, 0.9],
  ]);
}

// ---------------------------------------------------------------------------
// Density caps (max simultaneous labels on screen; collision prunes first)
// ---------------------------------------------------------------------------

export function countryLabelCap(d: number): number {
  if (d >= 3.2) return 50;
  if (d >= 2.7) return 90;
  return 60; // fading anyway
}

export function admin1ShortCap(d: number): number {
  void d;
  return 130;
}

export function admin1LabelCap(d: number): number {
  if (d >= 2.15) return 110;
  if (d >= 1.6) return 150;
  return 160;
}

export function cityLabelCap(d: number): number {
  if (d >= 2.15) return 120;
  if (d >= 1.65) return 170;
  return 240;
}

// ---------------------------------------------------------------------------
// Per-band placement priority
// ---------------------------------------------------------------------------

/**
 * Placement group per semantic band (lower = placed earlier).
 *
 * GLOBAL:    countries > everything
 * COUNTRY:   countries → admin-1 short codes
 * REGIONAL:  capitals/major cities → admin-1 names → fading countries
 * DETAILED:  important cities → admin-1 → more cities → fading countries
 * LOCAL:     important local cities → admin-1 context → country (invisible)
 */
export function labelPriGroup(
  kind: 0 | 1 | 2 | 3, // country, admin1, city, admin1-short
  opts: { tier: number; cap: number },
  d: number,
): number {
  if (d >= BAND_GLOBAL) return kind === 0 ? 0 : 9;
  if (d >= BAND_COUNTRY) {
    if (kind === 0) return 0;
    if (kind === 3) return 1;
    return 9;
  }
  if (d >= BAND_REGIONAL) {
    if (kind === 2 && opts.tier === 0) return 0; // national capitals/megacities
    if (kind === 1) return 1; // then subdivision names
    if (kind === 2 && opts.tier <= 1) return 2; // then admin-1 capitals/majors
    if (kind === 0) return 3; // fading countries last
    return 9;
  }
  if (d >= BAND_DETAILED) {
    if (kind === 2 && opts.tier <= 1) return 0;
    if (kind === 1) return 1;
    if (kind === 2 && opts.tier <= 2) return 1;
    if (kind === 2) return 2;
    if (kind === 0) return 3;
    return 9;
  }
  // LOCAL
  if (kind === 2 && opts.tier <= 2) return 0;
  if (kind === 2 || kind === 1) return 1;
  if (kind === 0) return 3;
  return 9;
}

/**
 * Piecewise-linear alpha ramp over camera distance: pairs must be sorted by
 * distance descending; outside the range the nearest extreme wins.
 */
export function piecewise(d: number, points: ReadonlyArray<readonly [number, number]>): number {
  if (d >= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [d0, a0] = points[i - 1];
    const [d1, a1] = points[i];
    if (d >= d1) {
      const t = (d0 - d) / (d0 - d1);
      return a0 + (a1 - a0) * t;
    }
  }
  return points[points.length - 1][1];
}
