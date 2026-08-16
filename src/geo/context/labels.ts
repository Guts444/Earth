/**
 * Cartographic label layer — a single 2D canvas drawn over the WebGL canvas.
 *
 * Architecture choice (vs DOM labels / SDF / sprite atlas):
 *   - One <canvas> with pointer-events:none sits between the WebGL canvas and
 *     the HUD panels: no DOM churn (no thousands of divs), no framework, no
 *     interference with the existing HUD, full control of collision logic.
 *   - Text is re-drawn only when the camera moves materially (dirty-check on
 *     position/orientation/distance) — idle frames cost nothing.
 *   - Hemisphere occlusion: a label anchor on the sphere is visible iff
 *     dot(anchorNormal, viewDir) > 0, so far-side labels never leak through
 *     the globe; labels fade out near the limb for a clean disappearance.
 *   - Decluttering: priority-ordered greedy placement into a screen-space
 *     grid hash; countries beat admin-1 beat cities; density caps per kind.
 */
import * as THREE from 'three';
import { geoToScene } from '../projection';
import type { GeoContextData } from './data';
import {
  ADMIN1_RANK_MIN_DIST,
  CITY_TIER_MIN_DIST,
  COUNTRY_RANK_TIERS,
  admin1LabelAlpha,
  admin1LabelCap,
  cityLabelAlpha,
  cityLabelCap,
  countryLabelAlpha,
  countryLabelCap,
} from './lod';

export type LabelKind = 0 | 1 | 2; // country, admin-1, city

interface LabelEntry {
  kind: LabelKind;
  name: string;
  /** Anchor on the unit sphere (local, group space). */
  ax: number;
  ay: number;
  az: number;
  /** Placement order within its kind (higher first). */
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
] as const;

const COLOR = [
  '#cfdfee', // country: pale steel — same family as borders
  '#9db6cc', // admin-1: dimmer, smaller
  '#e8e2d4', // city: warm parchment — visually distinct from country names
] as const;

const HALO = 'rgba(0, 0, 0, 0.85)';
const PAD = 2; // padding around label rects, css px
const CITY_DOT_R = 1.8;
/** Rect height per kind — honest glyph metrics, not inflated boxes. */
const RECT_H = [13, 11, 10];

const TMP = {
  world: new THREE.Vector3(),
  view: new THREE.Vector3(),
  rotY: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
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

  // Width cache: name → measured text width (per kind font)
  private widthCache = new Map<string, number>();

  // Placed labels for the current frame (kept for debugging/tests)
  private placedCount = 0;
  private lastPlacedNames: string[] = [];
  private dbg = { entries: [0, 0, 0], candidates: [0, 0, 0], placed: [0, 0, 0] };
  private lastCandidateNames: string[] = [];

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
      entries.push({
        kind: 1,
        name: a.n,
        ax, ay, az,
        order: (10 - a.r) * 1e8,
        tier: a.r,
        cap: 0,
      });
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
    this.dbg.entries = [0, 1, 2].map((k) => entries.filter((e) => e.kind === k).length);
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
   */
  update(camera: THREE.PerspectiveCamera, sceneRotY: number, visible: boolean): void {
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

    if (!moved && !this.needRedraw) return;
    this.lastX = camera.position.x;
    this.lastY = camera.position.y;
    this.lastZ = camera.position.z;
    this.lastCamDist = camDist;
    this.lastSceneRotY = sceneRotY;
    this.needRedraw = false;

    camera.updateMatrixWorld();
    TMP.rotY.makeRotationY(sceneRotY);

    // Globe disc on screen (for horizon clipping of labels): the earth's
    // silhouette projected from this camera. Labels never bleed past it.
    const disc = this.globeDisc(camera);

    // ---- 1. Collect candidates (tier gate + hemisphere + limb fade) -------
    const candidates: Array<{
      entry: LabelEntry;
      sx: number;
      sy: number;
      alpha: number;
      w: number;
      h: number;
    }> = [];
    this.dbg.candidates = [0, 0, 0];

    for (const e of this.entries) {
      if (!labelTierActive(e, camDist)) continue;
      TMP.world.set(e.ax, e.ay, e.az).applyMatrix4(TMP.rotY);
      TMP.view.copy(camera.position).sub(TMP.world);
      const dotN = TMP.world.dot(TMP.view) / (TMP.world.length() * TMP.view.length());
      if (dotN <= 0.06) continue; // far side or crowded right at the limb

      const ndc = TMP.world.project(camera);
      if (ndc.z > 1 || ndc.z < -1) continue;
      const sx = (ndc.x * 0.5 + 0.5) * this.cssW;
      const sy = (0.5 - ndc.y * 0.5) * this.cssH;

      // The label must sit on the VISIBLE disc, not merely in the forward
      // hemisphere (a point 45° past the limb still has dotN > 0 — its text
      // would be clipped away, wasting a collision slot).
      if (Math.hypot(sx - disc.cx, sy - disc.cy) > disc.r + 8) continue;

      const w = this.textWidth(e);
      const h = RECT_H[e.kind];
      candidates.push({
        entry: e,
        sx,
        sy,
        alpha: labelKindAlpha(e.kind, camDist) * smoothstep(0, 0.12, dotN),
        w: e.kind === 2 ? w + CITY_DOT_R * 2 + 5 : w,
        h,
      });
      this.dbg.candidates[e.kind]++;
    }

    // ---- 2. Priority order ------------------------------------------------
    // countries → NATIONAL CAPITALS → admin-1 → other cities, then
    // best-in-kind first. Capitals outrank provinces so Tokyo isn't blocked
    // by the Gunma prefecture label; ordinary cities stay below admin-1 so a
    // secondary city (Tampa) never drops its state name (Florida).
    const priKind = (c: (typeof candidates)[number]): number => {
      if (c.entry.kind === 0) return 0;
      if (c.entry.kind === 2 && c.entry.cap === 1) return 1;
      if (c.entry.kind === 1) return 2;
      return 3;
    };
    candidates.sort((a, b) => priKind(a) - priKind(b) || b.entry.order - a.entry.order);

    // ---- 3. Greedy collision placement (exact rect overlap) ----------------
    // Exact AABB overlap beats a grid hash here: candidate counts are small
    // (≤ ~600) and cell quantization inflates rects, falsely culling labels
    // that fit with a few px to spare (e.g. London vs Paris at country zoom).
    // City labels try alternative offsets (right → left → below the dot)
    // before giving up, so a capital under its own country/province label
    // (Tokyo vs Japan, Melbourne vs Victoria) still gets placed.
    const caps = [countryLabelCap(camDist), admin1LabelCap(camDist), cityLabelCap(camDist)];
    const placedByKind = [0, 0, 0];
    const rects: Array<[number, number, number, number]> = [];
    const placed: typeof candidates = [];

    for (const c of candidates) {
      const k = c.entry.kind;
      if (placedByKind[k] >= caps[k]) continue;

      const textW = k === 2 ? c.w - CITY_DOT_R * 2 - 5 : c.w;
      const attempts: Array<{ ox: number; oy: number; off: number; rect: [number, number, number, number] }> = [];
      const offs = k === 2 ? [0, 1, 2, 3] : [4];
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
        } else { // centered (countries / admin-1)
          left = c.sx - textW / 2 - PAD;
          right = c.sx + textW / 2 + PAD;
        }
        const top = oy - c.h / 2 - PAD;
        const bottom = oy + c.h / 2 + PAD;
        // include the city dot in the rect so it never sits under other text
        if (k === 2) {
          left = Math.min(left, c.sx - CITY_DOT_R - PAD);
          right = Math.max(right, c.sx + CITY_DOT_R + PAD);
        }
        attempts.push({ ox, oy, off, rect: [left, top, right, bottom] });
      }

      let chosen: (typeof attempts)[number] | null = null;
      for (const a of attempts) {
        let free = true;
        for (const [rl, rt, rr, rb] of rects) {
          if (a.rect[0] < rr && a.rect[2] > rl && a.rect[1] < rb && a.rect[3] > rt) {
            free = false;
            break;
          }
        }
        if (free) { chosen = a; break; }
      }
      if (!chosen) continue;

      rects.push(chosen.rect);
      placedByKind[k]++;
      placed.push(c);
      (c as unknown as { ox: number; oy: number; off: number }).ox = chosen.ox;
      (c as unknown as { ox: number; oy: number; off: number }).oy = chosen.oy;
      (c as unknown as { ox: number; oy: number; off: number }).off = chosen.off;
    }
    this.placedCount = placed.length;
    this.lastPlacedNames = placed.map((p) => p.entry.name);
    this.lastCandidateNames = candidates.map((p) => p.entry.name);
    this.dbg.placed = [0, 1, 2].map((k) => placed.filter((p) => p.entry.kind === k).length);

    // ---- 4. Draw ------------------------------------------------------------
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.textBaseline = 'middle';
    ctx.shadowColor = HALO;
    ctx.shadowBlur = 2.5;

    // Clip to the globe silhouette (+4px so surface dots on the limb survive):
    // labels can fade at the horizon but never float visibly past the Earth.
    ctx.save();
    ctx.beginPath();
    ctx.arc(disc.cx, disc.cy, disc.r + 4, 0, Math.PI * 2);
    ctx.clip();

    for (const c of placed) {
      ctx.globalAlpha = Math.min(c.alpha, 1);
      ctx.fillStyle = COLOR[c.entry.kind];
      ctx.font = FONT[c.entry.kind];
      const info = c as unknown as { ox: number; oy: number; off: number };
      if (c.entry.kind === 2) {
        // city: dot marker + text (right / left / below per placement choice)
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
   * The earth's screen-space silhouette: center = projection of the origin,
   * radius = (earth radius) in pixels at this camera distance. Earth radius is
   * 1 scene unit and the camera always looks at the origin (OrbitControls),
   * so this is exact.
   */
  private globeDisc(camera: THREE.PerspectiveCamera): { cx: number; cy: number; r: number } {
    TMP.world.set(0, 0, 0).project(camera);
    const cx = (TMP.world.x * 0.5 + 0.5) * this.cssW;
    const cy = (0.5 - TMP.world.y * 0.5) * this.cssH;
    const dist = camera.position.length();
    const r = this.cssH / 2 / (dist * Math.tan((camera.fov * Math.PI) / 360));
    return { cx, cy, r };
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
        // the first (most important) tier is visible at ALL distances
        return i === 0 || camDist < tier.minDist;
      }
    }
    return false;
  }
  if (e.kind === 1) {
    for (let i = 0; i < ADMIN1_RANK_MIN_DIST.length; i++) {
      const maxRank = [2, 5, 7, 99][i];
      if (e.tier <= maxRank) return camDist < ADMIN1_RANK_MIN_DIST[i];
    }
    return false;
  }
  return camDist < CITY_TIER_MIN_DIST[Math.min(e.tier, 3)];
}

function labelKindAlpha(kind: LabelKind, camDist: number): number {
  if (kind === 0) return countryLabelAlpha(camDist);
  if (kind === 1) return admin1LabelAlpha(camDist);
  return cityLabelAlpha(camDist);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
