import * as THREE from 'three';
import { pickPointsNearestCursor, type PickHit } from '../domains/pick';
import type { FlightCategory } from '../config';
import type { AircraftState } from './engine';

const planeVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uPixelRatio;
  uniform float uScale;

  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.2);
    gl_PointSize = aSize * uScale * uPixelRatio * (24.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 1.0, 7.0);
    vAlpha = 0.92;
    gl_Position = projectionMatrix * mv;
  }
`;

const planeFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    // Diamond / delta shape for tactical aircraft blips
    float d = abs(c.x) + abs(c.y);
    if (d > 0.5) discard;

    float core = smoothstep(0.45, 0.1, d);
    float glow = exp(-d * 6.0) * 0.3;
    float alpha = (core * 0.95 + glow) * vAlpha;
    vec3 col = vColor * (0.9 + core * 0.4);

    gl_FragColor = vec4(col, alpha);
  }
`;

const CATEGORY_COLORS: Record<FlightCategory, [number, number, number]> = {
  commercial: [0.0, 0.94, 1.0],
  cargo: [1.0, 0.72, 0.01],
  'high-altitude': [0.85, 0.25, 0.95],
  military: [0.95, 0.15, 0.25],
  general: [0.45, 0.95, 0.2],
};

export class AircraftScene {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;

  private positions = new Float32Array(0);
  private colors = new Float32Array(0);
  private sizes = new Float32Array(0);
  private activeList: AircraftState[] = [];
  private posAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;

  private categoryVisibility: Record<FlightCategory, boolean> = {
    commercial: true,
    cargo: true,
    'high-altitude': true,
    military: true,
    general: true,
  };
  private isVisible = true;
  private highlightIdx = -1;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);

    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colorAttr);
    geo.setAttribute('aSize', this.sizeAttr);

    this.material = new THREE.ShaderMaterial({
      vertexShader: planeVertex,
      fragmentShader: planeFragment,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uScale: { value: 0.55 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  get count(): number {
    return this.activeList.length;
  }

  get list(): AircraftState[] {
    return this.activeList;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.points.visible = visible;
  }

  setCategoryVisible(cat: FlightCategory, visible: boolean): void {
    this.categoryVisibility[cat] = visible;
    this.syncBuffers();
  }

  setAircraft(list: AircraftState[]): void {
    this.activeList = list;
    const n = list.length;
    if (this.positions.length !== n * 3) {
      this.positions = new Float32Array(n * 3);
      this.colors = new Float32Array(n * 3);
      this.sizes = new Float32Array(n);

      const geo = this.points.geometry;
      this.posAttr = new THREE.BufferAttribute(this.positions, 3);
      this.posAttr.setUsage(THREE.DynamicDrawUsage);
      this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
      this.colorAttr.setUsage(THREE.DynamicDrawUsage);
      this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1);
      this.sizeAttr.setUsage(THREE.DynamicDrawUsage);

      geo.setAttribute('position', this.posAttr);
      geo.setAttribute('aColor', this.colorAttr);
      geo.setAttribute('aSize', this.sizeAttr);
    }
    this.syncBuffers();
  }

  syncBuffers(): void {
    const list = this.activeList;
    const n = list.length;
    const p = this.positions;
    const c = this.colors;
    const s = this.sizes;

    for (let i = 0; i < n; i++) {
      const ac = list[i];
      const i3 = i * 3;
      const visible = this.isVisible && (this.categoryVisibility[ac.category] ?? true);

      if (!visible) {
        p[i3] = 0;
        p[i3 + 1] = 0;
        p[i3 + 2] = 0;
        s[i] = 0;
        continue;
      }

      p[i3] = ac.x;
      p[i3 + 1] = ac.y;
      p[i3 + 2] = ac.z;

      const rgb = CATEGORY_COLORS[ac.category] ?? [0.3, 0.8, 1.0];
      c[i3] = rgb[0];
      c[i3 + 1] = rgb[1];
      c[i3 + 2] = rgb[2];

      const isSelected = i === this.highlightIdx;
      s[i] = isSelected ? 2.5 : 1.1;
    }

    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  updatePositions(): void {
    if (!this.isVisible) return;
    const list = this.activeList;
    const n = list.length;
    const p = this.positions;

    for (let i = 0; i < n; i++) {
      const ac = list[i];
      const i3 = i * 3;
      if (!this.categoryVisibility[ac.category]) {
        p[i3] = 0;
        p[i3 + 1] = 0;
        p[i3 + 2] = 0;
        continue;
      }
      p[i3] = ac.x;
      p[i3 + 1] = ac.y;
      p[i3 + 2] = ac.z;
    }
    this.posAttr.needsUpdate = true;
  }

  highlight(index: number): void {
    this.highlightIdx = index;
    const n = this.activeList.length;
    for (let i = 0; i < n; i++) {
      this.sizes[i] = i === index ? 2.5 : 1.1;
    }
    this.sizeAttr.needsUpdate = true;
  }

  pick(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
    pointerNdc: THREE.Vector2,
  ): PickHit | null {
    if (!this.isVisible || this.activeList.length === 0) return null;
    return pickPointsNearestCursor(raycaster, camera, pointerNdc, this.points);
  }
}
