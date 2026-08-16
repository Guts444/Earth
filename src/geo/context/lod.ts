/**
 * LOD policy for the geographic context layers.
 *
 * All thresholds are camera distance in EARTH RADII (same metric as the
 * global → detail blend: `camera.position.length()`, minDistance 1.2,
 * maxDistance 4.2, default ≈4.05). Values were tuned against the existing
 * 3.0–3.8 cloud/daylight blend so geography strengthens as atmosphere thins:
 *
 *   d ≥ 3.55  GLOBAL   — major country names, faint country borders
 *   3.55…2.55 MID      — stronger borders, more country names, major cities
 *   2.55…1.8  REGIONAL — admin-1 borders + labels, more cities
 *   d < 1.8   LOCAL    — geographic context dominant, full city set
 *
 * Every gate ramps with a smooth alpha so nothing pops. The subsystem
 * owns these constants (not config.ts) — they are presentation policy.
 */

/**
 * Country-label tier gates by NE LABELRANK: the first tier (rank ≤ 2 — major
 * countries) is visible at ALL camera distances; each next tier activates
 * below its minDist. (The labelTierActive implementation special-cases tier 0.)
 */
export const COUNTRY_RANK_TIERS = [
  { rank: 2, minDist: 3.55 }, // major countries — visible at max zoom-out
  { rank: 3, minDist: 3.2 },
  { rank: 4, minDist: 2.8 },
  { rank: 5, minDist: 2.2 },
  { rank: 7, minDist: 1.85 }, // everything
] as const;

/** City-label tier gates (tier from the build pipeline). */
export const CITY_TIER_MIN_DIST = [3.35, 2.55, 2.0, 1.7] as const;

/** Admin-1 label tier gates by label rank. */
export const ADMIN1_RANK_MIN_DIST = [2.35, 2.05, 1.8, 1.55] as const; // rank ≤2, ≤5, ≤7, all

/** Country border line alpha across camera distance. */
export function countryLineAlpha(d: number): number {
  return piecewise(d, [
    [3.8, 0.14],
    [3.55, 0.3],
    [2.9, 0.5],
    [2.6, 0.55],
  ]);
}

/** Admin-1 border line alpha across camera distance (hidden at global). */
export function admin1LineAlpha(d: number): number {
  return piecewise(d, [
    [2.6, 0],
    [2.15, 0.42],
    [1.7, 0.5],
  ]);
}

/** Country label text alpha. */
export function countryLabelAlpha(d: number): number {
  return piecewise(d, [
    [3.55, 0.85],
    [3.2, 0.95],
    [1.7, 0.95],
  ]);
}

/** Admin-1 label text alpha (labels trail the lines slightly). */
export function admin1LabelAlpha(d: number): number {
  return piecewise(d, [
    [2.45, 0],
    [2.0, 0.78],
    [1.7, 0.85],
  ]);
}

/** City label text alpha. */
export function cityLabelAlpha(d: number): number {
  return piecewise(d, [
    [3.45, 0],
    [3.05, 0.85],
    [1.7, 0.9],
  ]);
}

/** Max simultaneous city labels on screen (collision prunes first). */
export function cityLabelCap(d: number): number {
  if (d >= 2.55) return 120;
  if (d >= 1.8) return 170;
  return 240;
}

/** Max simultaneous country labels. */
export function countryLabelCap(d: number): number {
  return d >= 3.2 ? 50 : d >= 2.2 ? 90 : 120;
}

/** Max simultaneous admin-1 labels. */
export function admin1LabelCap(d: number): number {
  if (d >= 2.0) return 100;
  if (d >= 1.55) return 150;
  return 190;
}

/**
 * Piecewise-linear alpha ramp over camera distance: pairs must be sorted by
 * distance descending; outside the range the nearest extreme wins.
 */
function piecewise(d: number, points: ReadonlyArray<readonly [number, number]>): number {
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

export { piecewise };
