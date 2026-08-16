/**
 * Cartographic label layer — a single 2D canvas drawn over the WebGL canvas.
 *
 * Architecture choice (vs DOM labels / SDF / sprite atlas):
 *   - One <canvas> with pointer-events:none sits between the WebGL canvas and
 *     the HUD panels: no DOM churn (no thousands of divs), no framework, no
 *     interference with the existing HUD, full control of collision logic.
 *   - Text is re-drawn only when the camera moves materially or the obstacle
 *     set changes (dirty-check on position/orientation/distance plus the
 *     obstacle array reference) — idle frames cost nothing.
 *   - Hemisphere occlusion: a label anchor on the sphere is visible iff
 *     dot(anchorNormal, viewDir) > 0, so far-side labels never leak through
 *     the globe; labels fade out near the limb for a clean disappearance.
 *   - Horizon clipping: the EXACT projected silhouette of the sphere (sampled
 *     tangent circle, correct for a perspective camera at any distance) both
 *     clips the canvas and bounds candidate containment — labels near the
 *     limb stay visible until genuinely occluded.
 *   - Decluttering: priority-ordered greedy placement (per semantic band —
 *     see lod.labelPriGroup) with exact AABB collision; city labels retry
 *     right/left/below/above the dot; reserved TACTICAL obstacle rects
 *     (cable stations, pads, plants, reticle) are consumed as generic screen
 *     rectangles — this module knows nothing about tactical domains.
 */
import * as THREE from 'three';
import { geoToScene } from '../projection';
import type { GeoContextData } from './data';
import {
  ADMIN1_MAX_RANK,
  ADMIN1_RANK_MIN_DIST,
  CITY_TIER_MIN_DIST,
  COUNTRY_RANK_TIERS,
  SHORT_ACTIVE_MAX,
  SHORT_ACTIVE_MIN,
  admin1LabelAlpha,
  admin1LabelCap,
  admin1ShortAlpha,
  admin1ShortCap,
  cityLabelAlpha,
  cityLabelCap,
  countryLabelAlpha,
  countryLabelCap,
  labelPriGroup,
} from './lod';

export type LabelKind = 0 | 1 | 2 | 3; // country, admin-1 full, city, admin-1 short
export type ScreenRect = readonly [number, number, number, number]; // css px x0,y0,x1,y1

interface LabelEntry {
  kind: LabelKind;
  name: string;
  /** Anchor on the unit sphere (local, group space). */
  ax: number;
  ay: number;
  az: number;
  /** Placement order within its group (higher first). */
  order: number;
  /** LOD tier (city tier / country rank / admin-1 rank). */
  tier: number;
  /** National capital flag (cities only). */
  cap: number;
}

const FONT = [
  '600 12px "Segoe UI", "Helvetica Neue", sans-serif',
  '500 10px "Segoe UI", "Helvetica Neue", sans-serif',
  '400 9px "Segoe UI", "Helvetica Neue", sans-serif',
  '600 10px "Segoe UI", "Helvetica Neue", sans-serif', // admin-1 short codes
] as const;

const COLOR = [
  '#cfdfee', // country: pale steel — same family as borders
  '#9db6cc', // admin-1: dimmer, smaller
  '#e8e2d4', // city: warm parchment — visually distinct from country names
  '#b9cbdd', // admin-1 short code: brighter than full names, smaller than countries
] as const;

const HALO = 'rgba(0, 0, 0, 0.85)';
const PAD = 2; // padding around label rects, css px
const CITY_DOT_R = 1.8;
/** Rect height per kind — honest glyph metrics, not inflated boxes. */
const RECT_H = [13, 11, 10, 11];
/** Acceptable distance beyond the silhouette edge for a label anchor. */
const DISC_MARGIN_PX = 10;
/** Silhouette polygon resolution (exact tangent circle sampled). */
const DISC_SAMPLES = 72;

const TMP = {
  world: new THREE.Vector3(),
  view: new THREE.Vector3(),
  rotY: new THREE.Matrix4(),
  axis: new THREE.Vector3(),
  u: new THREE.Vector3(),
  v: new THREE.Vector3(),
  center: new THREE.Vector3(),
  point: new THREE.Vector3(),
};

export class LabelLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private entries: LabelEntry[] = [];
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;

  // Dirty-check state
  private lastX = NaN;
  private lastY = NaN;
  private lastZ = NaN;
  private lastCamDist = NaN;
  private lastSceneRotY = NaN;
  private lastVisible = false;
  private needRedraw = true;

  // Obstacle array from the last layout pass. The caller reuses the same
  // array while the obstacle set is unchanged, so a fresh reference here
  // means selection/reticle/data changed and a relayout is required even
  // when the camera is perfectly still.
  private lastObstacles: ReadonlyArray<ScreenRect> | null = null;

  // Width cache: name → measured text width (per kind font)
  private widthCache = new Map<string, number>();

  // Placed labels for the current frame (kept for debugging/tests)
  private placedCount = 0;
  private lastPlacedNames: string[] = [];
  private lastCandidateNames: string[] = [];
  private dbg = { entries: [0, 0, 0, 0], candidates: [0, 0, 0, 0], placed: [0, 0, 0, 0] };
  private lastDisc = { cx: 0, cy: 0, rMax: 0 };
  private rejectedSample: string[] = [];
  private lastPlacedRects: Array<{ n: string; r: [number, number, number, number] }> = [];

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'geo-label-layer';
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '1';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Build the label table from the dataset (once). */
  build(data: GeoContextData): void {
    const entries: LabelEntry[] = [];

    for (const c of data.countries) {
      const [ax, ay, az] = geoToScene(c.lat, c.lon);
      entries.push({
        kind: 0,
        name: c.name,
        ax, ay, az,
        order: (7 - c.rank) * 1e9 + c.pop,
        tier: c.rank,
        cap: 0,
      });
    }

    for (const a of data.admin1) {
      const [ax, ay, az] = geoToScene(a.y, a.x);
      if (!Number.isFinite(ax)) continue;
      const order = (10 - a.r) * 1e8;
      if (a.s) {
        // country-scale abbreviated phase (CA/TX/FL, BY, UP…)
        entries.push({ kind: 3, name: a.s, ax, ay, az, order, tier: a.r, cap: 0 });
      }
      entries.push({ kind: 1, name: a.n, ax, ay, az, order, tier: a.r, cap: 0 });
    }

    for (const c of data.cities) {
      const [ax, ay, az] = geoToScene(c.y, c.x);
      if (!Number.isFinite(ax)) continue;
      entries.push({
        kind: 2,
        name: c.n,
        ax, ay, az,
        order: c.pr,
        tier: c.t,
        cap: c.c0,
      });
    }

    this.entries = entries;
    this.dbg.entries = [0, 1, 2, 3].map((k) => entries.filter((e) => e.kind === k).length);
    this.needRedraw = true;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = Math.min(dpr, 2);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.needRedraw = true;
  }

  /**
   * Per-frame update. Recomputes layout + redraws only when the camera moved
   * materially; otherwise the previous canvas content stays (zero cost).
   * `sceneRotY` is the current frame's scene.rotation.y (auto-rotate drift).
   * `obstacles` are reserved screen rectangles (tactical markers, reticle)
   * provided by the caller as generic rects — never domain objects.
   */
  update(
    camera: THREE.PerspectiveCamera,
    sceneRotY: number,
    visible: boolean,
    obstacles: ReadonlyArray<ScreenRect> = [],
  ): void {
    if (!visible) {
      if (this.lastVisible) {
        this.lastVisible = false;
        this.ctx.clearRect(0, 0, this.cssW, this.cssH);
      }
      return;
    }
    if (!this.lastVisible) {
      this.lastVisible = true;
      this.needRedraw = true;
    }

    const camDist = camera.position.length();
    const moved =
      Math.abs(camera.position.x - this.lastX) > 1e-4 ||
      Math.abs(camera.position.y - this.lastY) > 1e-4 ||
      Math.abs(camera.position.z - this.lastZ) > 1e-4 ||
      Math.abs(camDist - this.lastCamDist) > 0.012 ||
      Math.abs(sceneRotY - this.lastSceneRotY) > 1e-5;

    if (obstacles !== this.lastObstacles) {
      this.lastObstacles = obstacles;
      this.needRedraw = true;
    }
    if (!moved && !this.needRedraw) return;
    this.lastX = camera.position.x;
    this.lastY = camera.position.y;
    this.lastZ = camera.position.z;
    this.lastCamDist = camDist;
    this.lastSceneRotY = sceneRotY;
    this.needRedraw = false;

    camera.updateMatrixWorld();
    TMP.rotY.makeRotationY(sceneRotY);

    // Exact projected silhouette of the sphere for this camera (tangent
    // circle sampled in 3D, projected per point — correct for any distance).
    const disc = this.globeSilhouette(camera);
    this.lastDisc = { cx: disc.cx, cy: disc.cy, rMax: disc.rMax };

    // ---- 1. Collect candidates (tier gate + hemisphere + disc + limb) -----
    const candidates: Array<{
      entry: LabelEntry;
      sx: number;
      sy: number;
      alpha: number;
      w: number;
      h: number;
    }> = [];
    this.dbg.candidates = [0, 0, 0, 0];

    for (const e of this.entries) {
      if (!labelTierActive(e, camDist)) continue;
      TMP.world.set(e.ax, e.ay, e.az).applyMatrix4(TMP.rotY);
      // EXACT horizon for the unit sphere: a surface point P is visible iff
      // P · camera > 1 — equality holds precisely on the tangent circle, and
      // beyond the limb the product is < 1 even though the point still
      // projects inside the silhouette. The old test compared the
      // normal·viewDir cosine (which is 0 at the tangent) against 1/d, which
      // hid labels well inside the visible disc; those must stay candidates.
      if (TMP.world.dot(camera.position) <= 1) continue;
      TMP.view.copy(camera.position).sub(TMP.world);
      // The same visibility in cosine form — exactly 0 at the tangent circle
      // and strictly positive on the visible side; kept for the limb fade.
      const dotN = TMP.world.dot(TMP.view) / (TMP.world.length() * TMP.view.length());

      const ndc = TMP.world.project(camera);
      if (ndc.z > 1 || ndc.z < -1) continue;
      const sx = (ndc.x * 0.5 + 0.5) * this.cssW;
      const sy = (0.5 - ndc.y * 0.5) * this.cssH;

      // Must sit on the visible disc: O(1) bounding-circle check against the
      // silhouette polygon (slightly over-inclusive when the camera doesn't
      // look at the origin — the exact polygon clip still prevents any visual
      // bleed; this test only saves collision slots).
      const ddx = sx - disc.cx;
      const ddy = sy - disc.cy;
      const margin = DISC_MARGIN_PX;
      if (ddx * ddx + ddy * ddy > (disc.rMax + margin) * (disc.rMax + margin)) continue;

      const w = this.textWidth(e);
      const h = RECT_H[e.kind];
      // fade out as the anchor approaches the exact horizon (dotN = 0 there)
      const alpha =
        labelKindAlpha(e.kind, camDist) * smoothstep(0, 0.06, dotN);
      // Invisible labels must not consume placement slots or collision rects
      // (a faded-out country name must never block local city labels).
      if (alpha <= 0.02) continue;
      candidates.push({
        entry: e,
        sx,
        sy,
        alpha,
        w: e.kind === 2 ? w + CITY_DOT_R * 2 + 5 : w,
        h,
      });
      this.dbg.candidates[e.kind]++;
    }

    // ---- 2. Per-band semantic priority -------------------------------------
    this.rejectedSample = [];
    this.lastPlacedRects = [];
    candidates.sort(
      (a, b) =>
        labelPriGroup(a.entry.kind, { tier: a.entry.tier, cap: a.entry.cap }, camDist) -
          labelPriGroup(b.entry.kind, { tier: b.entry.tier, cap: b.entry.cap }, camDist) ||
        b.entry.order - a.entry.order,
    );

    // ---- 3. Greedy collision placement (grid-indexed exact rect overlap) ---
    // Candidate counts reach ~3.5k at local zoom (7.3k city set), so rects
    // are indexed in a screen-space grid: each candidate tests only the few
    // rects sharing its cells instead of all ~2.2k. Exact AABB overlap beats
    // cell quantization for the FINAL decision. City labels try alternative
    // offsets (right → left → below → above the dot) before giving up, so a
    // capital under its own country/province label still gets placed. Both
    // label rects and reserved tactical obstacle rects are honored.
    const caps = [
      countryLabelCap(camDist),
      admin1LabelCap(camDist),
      cityLabelCap(camDist),
      admin1ShortCap(camDist),
    ];
    const placedByKind = [0, 0, 0, 0];
    const GRID_CELL = 24;
    // Obstacle severity by rendered size: tiny markers (≤18px) block only the
    // pixels under their center; mid markers (≤32px) must materially cover a
    // label (≥30% of its rect); large boxes (reticle, big pads) reject on any
    // overlap — text must never sit inside them.
    const POINT_OBSTACLE_MAX = 18;
    const MID_OBSTACLE_MAX = 32;
    const OBSTACLE_MIN_COVER = 0.3;
    /** Label-label corner clips below this area don't reject placement. */
    const TINY_OVERLAP_PX2 = 48;
    interface GridEntry {
      r: [number, number, number, number];
      kind: 0 | 1 | 2 | 3; // 0 = placed label, 1 = point, 2 = mid, 3 = large
      owner: string;
    }
    const grid = new Map<number, GridEntry[]>();
    const insertRect = (
      r: [number, number, number, number],
      kind: 0 | 1 | 2 | 3,
      owner = '',
    ): void => {
      const x0 = Math.floor(r[0] / GRID_CELL);
      const x1 = Math.floor(r[2] / GRID_CELL);
      const y0 = Math.floor(r[1] / GRID_CELL);
      const y1 = Math.floor(r[3] / GRID_CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const key = gx + gy * 4096;
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push({ r, kind, owner });
        }
      }
    };
    const rectOverlaps = (
      a: [number, number, number, number],
      aText: [number, number, number, number],
    ): GridEntry | null => {
      const x0 = Math.floor(a[0] / GRID_CELL);
      const x1 = Math.floor(a[2] / GRID_CELL);
      const y0 = Math.floor(a[1] / GRID_CELL);
      const y1 = Math.floor(a[3] / GRID_CELL);
      const aW = aText[2] - aText[0];
      const aH = aText[3] - aText[1];
      const aArea = aW * aH;
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const list = grid.get(gx + gy * 4096);
          if (!list) continue;
          for (const e of list) {
            const r = e.r;
            if (e.kind === 0) {
              // placed labels: material overlap rejects (tiny corner clips,
              // ≤48px², are tolerated — glyphs don't fill padded corners)
              if (a[0] < r[2] && a[2] > r[0] && a[1] < r[3] && a[3] > r[1]) {
                const ix = Math.min(a[2], r[2]) - Math.max(a[0], r[0]);
                const iy = Math.min(a[3], r[3]) - Math.max(a[1], r[1]);
                if (ix * iy > TINY_OVERLAP_PX2) return e;
              }
            } else if (e.kind === 1) {
              // a small marker dot only blocks text it actually sits on
              const cx = (r[0] + r[2]) / 2;
              const cy = (r[1] + r[3]) / 2;
              if (cx > aText[0] && cx < aText[2] && cy > aText[1] && cy < aText[3]) return e;
            } else {
              // any box marker (mid or large): reject only when it materially
              // covers the text. A big station at the city's own dot overlaps
              // just the offset text's near edge (~25%) → the city label still
              // places; text drawn through the middle of a large marker or the
              // reticle covers ≥30% → rejected.
              const ix = Math.max(0, Math.min(aText[2], r[2]) - Math.max(aText[0], r[0]));
              const iy = Math.max(0, Math.min(aText[3], r[3]) - Math.max(aText[1], r[1]));
              if (ix * iy > aArea * OBSTACLE_MIN_COVER) return e;
            }
          }
        }
      }
      return null;
    };
    for (const r of obstacles) {
      const w = r[2] - r[0];
      const h = r[3] - r[1];
      const kind = w <= POINT_OBSTACLE_MAX && h <= POINT_OBSTACLE_MAX ? 1
        : w <= MID_OBSTACLE_MAX && h <= MID_OBSTACLE_MAX ? 2
        : 3;
      insertRect([r[0] - 2, r[1] - 2, r[2] + 2, r[3] + 2], kind);
    }
    const placed: typeof candidates = [];

    for (const c of candidates) {
      const k = c.entry.kind;
      if (placedByKind[k] >= caps[k]) continue;

      const textW = k === 2 ? c.w - CITY_DOT_R * 2 - 5 : c.w;
      const attempts: Array<{
        ox: number;
        oy: number;
        off: number;
        rect: [number, number, number, number];
        textRect: [number, number, number, number];
      }> = [];
      // cities: 4 offsets around the dot; admin-1: centered then ±14px vertical
      // (a state name sits above/below its capital's label instead of losing);
      // countries and short codes: centered only.
      const offs = k === 2 ? [0, 1, 2, 3] : k === 1 ? [4, 5, 6] : [4];
      for (const off of offs) {
        let ox = c.sx;
        let oy = c.sy;
        let left: number;
        let right: number;
        if (off === 0) { // text right of dot, left-aligned from ox
          ox = c.sx + CITY_DOT_R + 4;
          left = ox - PAD;
          right = ox + textW + PAD;
        } else if (off === 1) { // text left of dot, right-aligned ending at ox
          ox = c.sx - CITY_DOT_R - 4;
          left = ox - textW - PAD;
          right = ox + PAD;
        } else if (off === 2) { // text below dot, left-aligned from ox
          ox = c.sx + CITY_DOT_R;
          oy = c.sy + 9;
          left = ox - PAD;
          right = ox + textW + PAD;
        } else if (off === 3) { // text above dot, left-aligned from ox
          ox = c.sx + CITY_DOT_R;
          oy = c.sy - 9;
          left = ox - PAD;
          right = ox + textW + PAD;
        } else { // centered: 4 = on anchor, 5 = +14px, 6 = −14px
          if (off === 5) oy += 14;
          if (off === 6) oy -= 14;
          left = c.sx - textW / 2 - PAD;
          right = c.sx + textW / 2 + PAD;
        }
        const top = oy - c.h / 2 - PAD;
        const bottom = oy + c.h / 2 + PAD;
        // text-only rect: obstacle checks use this (the city dot may legally
        // sit on a tactical marker — the marker IS at the city's location);
        // label-label collision uses the full rect below.
        const textRect: [number, number, number, number] = [left, top, right, bottom];
        // include the city dot in the rect so it never sits under other text
        if (k === 2) {
          left = Math.min(left, c.sx - CITY_DOT_R - PAD);
          right = Math.max(right, c.sx + CITY_DOT_R + PAD);
        }
        attempts.push({ ox, oy, off, rect: [left, top, right, bottom], textRect });
      }

      let chosen: (typeof attempts)[number] | null = null;
      let blocker: GridEntry | null = null;
      for (const a of attempts) {
        const b = rectOverlaps(a.rect, a.textRect);
        if (!b) { chosen = a; break; }
        blocker = blocker ?? b;
      }
      if (!chosen) {
        if (this.rejectedSample.length < 40) {
          const bname = blocker && blocker.kind === 0 ? `'${blocker.owner}'` : `kind ${blocker?.kind ?? '?'}`;
          this.rejectedSample.push(`${c.entry.name} [blocked by ${bname}]`);
        }
        continue;
      }

      insertRect(chosen.rect, 0, c.entry.name); // placed labels reject any overlap
      placedByKind[k]++;
      placed.push(c);
      this.lastPlacedRects.push({ n: c.entry.name, r: chosen.rect });
      (c as unknown as { ox: number; oy: number; off: number }).ox = chosen.ox;
      (c as unknown as { ox: number; oy: number; off: number }).oy = chosen.oy;
      (c as unknown as { ox: number; oy: number; off: number }).off = chosen.off;
    }
    this.placedCount = placed.length;
    this.lastPlacedNames = placed.map((p) => p.entry.name);
    this.lastCandidateNames = candidates.map((p) => p.entry.name);
    this.dbg.placed = [0, 1, 2, 3].map((k) => placed.filter((p) => p.entry.kind === k).length);

    // ---- 4. Draw ------------------------------------------------------------
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.textBaseline = 'middle';
    ctx.shadowColor = HALO;
    ctx.shadowBlur = 2.5;

    // Clip to the exact globe silhouette (+4px so surface dots on the limb
    // survive): labels can fade at the horizon but never float past Earth.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(disc.px[0], disc.py[0]);
    for (let i = 1; i < disc.px.length; i++) ctx.lineTo(disc.px[i], disc.py[i]);
    ctx.closePath();
    ctx.clip();

    for (const c of placed) {
      ctx.globalAlpha = Math.min(c.alpha, 1);
      ctx.fillStyle = COLOR[c.entry.kind];
      ctx.font = FONT[c.entry.kind];
      const info = c as unknown as { ox: number; oy: number; off: number };
      if (c.entry.kind === 2) {
        // city: dot marker + text (right / left / below / above per placement)
        ctx.beginPath();
        ctx.arc(c.sx, c.sy, CITY_DOT_R, 0, Math.PI * 2);
        ctx.fill();
        if (info.off === 1) {
          ctx.textAlign = 'right';
          ctx.fillText(c.entry.name, info.ox, info.oy);
          ctx.textAlign = 'left';
        } else {
          ctx.fillText(c.entry.name, info.ox, info.oy);
        }
      } else {
        ctx.fillText(c.entry.name, c.sx, c.sy);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /**
   * EXACT projected silhouette of the unit sphere for a perspective camera
   * at any distance/orientation: the tangent cone's base circle — center
   * C·(R²/d²), radius R·√(1−R²/d²), perpendicular to C — sampled in 3D and
   * projected per point. (The distance-only approximation underestimates the
   * silhouette by ~1.8× at the closest camera distance — the sampled circle
   * is exact.)
   */
  private globeSilhouette(camera: THREE.PerspectiveCamera): {
    px: number[];
    py: number[];
    cx: number;
    cy: number;
    rMax: number;
  } {
    const C = camera.position;
    const d = C.length();
    const R = 1;
    const h = (R * R) / d; // distance from origin to the silhouette plane along C
    const r0 = R * Math.sqrt(1 - (R / d) ** 2); // silhouette circle radius
    TMP.axis.copy(C).normalize();
    TMP.u.set(0, 1, 0);
    if (Math.abs(TMP.axis.y) > 0.95) TMP.u.set(1, 0, 0);
    TMP.u.crossVectors(TMP.axis, TMP.u).normalize();
    TMP.v.crossVectors(TMP.axis, TMP.u).normalize();
    TMP.center.copy(TMP.axis).multiplyScalar(h);

    const px: number[] = [];
    const py: number[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < DISC_SAMPLES; i++) {
      const t = (i / DISC_SAMPLES) * Math.PI * 2;
      const cosT = Math.cos(t) * r0;
      const sinT = Math.sin(t) * r0;
      TMP.point
        .copy(TMP.center)
        .addScaledVector(TMP.u, cosT)
        .addScaledVector(TMP.v, sinT);
      const ndc = TMP.point.project(camera);
      const x = (ndc.x * 0.5 + 0.5) * this.cssW;
      const y = (0.5 - ndc.y * 0.5) * this.cssH;
      px.push(x);
      py.push(y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let rMax = 0;
    for (let i = 0; i < px.length; i++) {
      const dx = px[i] - cx;
      const dy = py[i] - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > rMax) rMax = d2;
    }
    return { px, py, cx, cy, rMax: Math.sqrt(rMax) };
  }

  /** Clear the canvas and mark the layer hidden (master toggle OFF). */
  clear(): void {
    if (this.lastVisible) {
      this.lastVisible = false;
      this.ctx.clearRect(0, 0, this.cssW, this.cssH);
    }
  }

  /** Number of labels drawn in the last layout pass (tests/debug). */
  get lastPlacedCount(): number {
    return this.placedCount;
  }

  /** Names of the labels drawn in the last layout pass (tests/debug). */
  get placedNames(): string[] {
    return this.lastPlacedNames;
  }

  /** Per-kind pipeline counters (tests/debug). */
  get debugCounts(): { entries: number[]; candidates: number[]; placed: number[] } {
    return this.dbg;
  }

  /** Names that survived the candidate filters (tests/debug). */
  get candidateNames(): string[] {
    return this.lastCandidateNames;
  }

  /** Last silhouette bounding circle (tests/debug). */
  get disc(): { cx: number; cy: number; rMax: number } {
    return this.lastDisc;
  }

  /** Candidates rejected at placement (tests/debug). */
  get rejected(): string[] {
    return this.rejectedSample;
  }

  /** Placed label rects (tests/debug). */
  get placedRects(): Array<{ n: string; r: [number, number, number, number] }> {
    return this.lastPlacedRects;
  }

  private textWidth(e: LabelEntry): number {
    const key = `${e.kind}:${e.name}`;
    const cached = this.widthCache.get(key);
    if (cached !== undefined) return cached;
    this.ctx.font = FONT[e.kind];
    const w = this.ctx.measureText(e.name).width;
    this.widthCache.set(key, w);
    return w;
  }
}

function labelTierActive(e: LabelEntry, camDist: number): boolean {
  if (e.kind === 0) {
    for (let i = 0; i < COUNTRY_RANK_TIERS.length; i++) {
      const tier = COUNTRY_RANK_TIERS[i];
      if (e.tier <= tier.rank) {
        return i === 0 || camDist < tier.minDist;
      }
    }
    return false;
  }
  if (e.kind === 3) {
    // admin-1 short codes — country-scale band only
    return camDist < SHORT_ACTIVE_MAX && camDist > SHORT_ACTIVE_MIN;
  }
  if (e.kind === 1) {
    for (let i = 0; i < ADMIN1_RANK_MIN_DIST.length; i++) {
      if (e.tier <= ADMIN1_MAX_RANK[i]) return camDist < ADMIN1_RANK_MIN_DIST[i];
    }
    return false;
  }
  return camDist < CITY_TIER_MIN_DIST[Math.min(e.tier, CITY_TIER_MIN_DIST.length - 1)];
}

function labelKindAlpha(kind: LabelKind, camDist: number): number {
  if (kind === 0) return countryLabelAlpha(camDist);
  if (kind === 1) return admin1LabelAlpha(camDist);
  if (kind === 3) return admin1ShortAlpha(camDist);
  return cityLabelAlpha(camDist);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
