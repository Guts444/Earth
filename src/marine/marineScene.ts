import * as THREE from 'three';
import type { MarineCategory } from '../config';
import type { VesselState } from './engine';

const shipVertex = /* glsl */ `
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
    gl_PointSize = aSize * uScale * uPixelRatio * (22.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 1.0, 6.5);
    vAlpha = 0.90;
    gl_Position = projectionMatrix * mv;
  }
`;

const shipFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;

    // Sharp beacon ring + center pulse
    float ring = smoothstep(0.48, 0.38, d) * smoothstep(0.18, 0.28, d);
    float dot = smoothstep(0.2, 0.05, d);
    float alpha = (dot * 0.95 + ring * 0.75) * vAlpha;
    vec3 col = vColor * (0.85 + dot * 0.35);

    gl_FragColor = vec4(col, alpha);
  }
`;

const CATEGORY_COLORS: Record<MarineCategory, [number, number, number]> = {
  container: [0.22, 0.85, 0.25],
  tanker: [1.0, 0.55, 0.0],
  cargo: [0.3, 0.8, 0.95],
  passenger: [1.0, 0.45, 0.7],
  naval: [0.95, 0.2, 0.25],
  fishing: [0.7, 0.45, 0.98],
};

export class MarineScene {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;

  private positions = new Float32Array(0);
  private colors = new Float32Array(0);
  private sizes = new Float32Array(0);
  private vessels: VesselState[] = [];
  private posAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;

  private categoryVisibility: Record<MarineCategory, boolean> = {
    container: true,
    tanker: true,
    cargo: true,
    passenger: true,
    naval: true,
    fishing: false,
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
      vertexShader: shipVertex,
      fragmentShader: shipFragment,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uScale: { value: 0.5 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  get count(): number {
    return this.vessels.length;
  }

  get list(): VesselState[] {
    return this.vessels;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.points.visible = visible;
  }

  setCategoryVisible(cat: MarineCategory, visible: boolean): void {
    this.categoryVisibility[cat] = visible;
    this.syncBuffers();
  }

  setVessels(vessels: VesselState[]): void {
    this.vessels = vessels;
    const n = vessels.length;
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
    const list = this.vessels;
    const n = list.length;
    const p = this.positions;
    const c = this.colors;
    const s = this.sizes;

    for (let i = 0; i < n; i++) {
      const v = list[i];
      const i3 = i * 3;
      const visible = this.isVisible && (this.categoryVisibility[v.category] ?? true);

      if (!visible) {
        p[i3] = 0;
        p[i3 + 1] = 0;
        p[i3 + 2] = 0;
        s[i] = 0;
        continue;
      }

      p[i3] = v.x;
      p[i3 + 1] = v.y;
      p[i3 + 2] = v.z;

      const rgb = CATEGORY_COLORS[v.category] ?? [0.3, 0.8, 0.9];
      c[i3] = rgb[0];
      c[i3 + 1] = rgb[1];
      c[i3 + 2] = rgb[2];

      const isSelected = i === this.highlightIdx;
      s[i] = isSelected ? 2.4 : 1.0;
    }

    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  updatePositions(): void {
    if (!this.isVisible) return;
    const list = this.vessels;
    const n = list.length;
    const p = this.positions;

    for (let i = 0; i < n; i++) {
      const v = list[i];
      const i3 = i * 3;
      if (!this.categoryVisibility[v.category]) {
        p[i3] = 0;
        p[i3 + 1] = 0;
        p[i3 + 2] = 0;
        continue;
      }
      p[i3] = v.x;
      p[i3 + 1] = v.y;
      p[i3 + 2] = v.z;
    }
    this.posAttr.needsUpdate = true;
  }

  highlight(index: number): void {
    this.highlightIdx = index;
    const n = this.vessels.length;
    for (let i = 0; i < n; i++) {
      this.sizes[i] = i === index ? 2.4 : 1.0;
    }
    this.sizeAttr.needsUpdate = true;
  }

  pick(raycaster: THREE.Raycaster, camera: THREE.Camera): number {
    if (!this.isVisible || this.vessels.length === 0) return -1;
    const camDist = camera.position.length();
    raycaster.params.Points = { threshold: 0.025 * (camDist / 3) };
    const hits = raycaster.intersectObject(this.points, false);
    if (hits.length === 0) return -1;
    return hits[0].index ?? -1;
  }
}
