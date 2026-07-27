import * as THREE from 'three';
import type { CatalogSatellite } from '../tle/catalog';
import { GROUP_BY_ID, type SatGroupId } from '../config';

const pointVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.2);
    // Small sharp dots so dense shells (Starlink) don't obscure Earth
    gl_PointSize = aSize * uSizeScale * uPixelRatio * (28.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 0.75, 6.0);
    vAlpha = 0.85;
    gl_Position = projectionMatrix * mv;
  }
`;

const pointFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;
    // Tight core, minimal bloom so thousands of points stay readable
    float core = smoothstep(0.5, 0.15, d);
    float glow = exp(-d * 7.0) * 0.25;
    float alpha = (core * 0.95 + glow) * vAlpha;
    vec3 col = vColor * (0.85 + core * 0.35);
    gl_FragColor = vec4(col, alpha);
  }
`;

export class SatelliteCloud {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;

  private positions: Float32Array;
  private displayPositions: Float32Array;
  private velocities: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private valid: Uint8Array;
  lat: Float32Array;
  lon: Float32Array;
  altKm: Float32Array;
  speedKms: Float32Array;

  private posAttr: THREE.BufferAttribute;
  private sats: CatalogSatellite[] = [];
  private sizeScale = 0.45;
  private emphasizeStations = true;

  constructor() {
    this.positions = new Float32Array(0);
    this.displayPositions = new Float32Array(0);
    this.velocities = new Float32Array(0);
    this.colors = new Float32Array(0);
    this.sizes = new Float32Array(0);
    this.valid = new Uint8Array(0);
    this.lat = new Float32Array(0);
    this.lon = new Float32Array(0);
    this.altKm = new Float32Array(0);
    this.speedKms = new Float32Array(0);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.displayPositions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: pointFragment,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uSizeScale: { value: this.sizeScale },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  get count(): number {
    return this.sats.length;
  }

  get catalog(): CatalogSatellite[] {
    return this.sats;
  }

  getBuffers() {
    return {
      positions: this.positions,
      velocities: this.velocities,
      valid: this.valid,
      lat: this.lat,
      lon: this.lon,
      altKm: this.altKm,
      speedKms: this.speedKms,
    };
  }

  setCatalog(sats: CatalogSatellite[]): void {
    this.sats = sats;
    const n = sats.length;
    this.positions = new Float32Array(n * 3);
    this.displayPositions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);
    this.valid = new Uint8Array(n);
    this.lat = new Float32Array(n);
    this.lon = new Float32Array(n);
    this.altKm = new Float32Array(n);
    this.speedKms = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const g = GROUP_BY_ID[sats[i].groupId as SatGroupId];
      const rgb = g?.rgb ?? [0.8, 0.8, 0.85];
      const i3 = i * 3;
      this.colors[i3] = rgb[0];
      this.colors[i3 + 1] = rgb[1];
      this.colors[i3 + 2] = rgb[2];
      const emphasize = g?.emphasize && this.emphasizeStations;
      this.sizes[i] = emphasize ? 1.8 : 1.0;
    }

    const geo = this.points.geometry as THREE.BufferGeometry;
    this.posAttr = new THREE.BufferAttribute(this.displayPositions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }

  setSizeScale(scale: number): void {
    this.sizeScale = scale;
    this.material.uniforms.uSizeScale.value = scale;
  }

  setEmphasizeStations(on: boolean): void {
    this.emphasizeStations = on;
    const n = this.sats.length;
    for (let i = 0; i < n; i++) {
      const g = GROUP_BY_ID[this.sats[i].groupId as SatGroupId];
      this.sizes[i] = g?.emphasize && on ? 1.8 : 1.0;
    }
    const attr = (this.points.geometry as THREE.BufferGeometry).getAttribute(
      'aSize',
    ) as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }

  setPixelRatio(pr: number): void {
    this.material.uniforms.uPixelRatio.value = Math.min(pr, 2);
  }

  /**
   * Extrapolate from last SGP4 snapshot using velocity (scene units / second).
   * dtSec is simulation seconds since last full propagate.
   */
  extrapolate(dtSec: number): void {
    const n = this.sats.length;
    const p = this.positions;
    const v = this.velocities;
    const d = this.displayPositions;
    const valid = this.valid;

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      if (!valid[i]) {
        // Hide invalid by collapsing to origin inside Earth (will be covered)
        d[i3] = 0;
        d[i3 + 1] = 0;
        d[i3 + 2] = 0;
        continue;
      }
      d[i3] = p[i3] + v[i3] * dtSec;
      d[i3 + 1] = p[i3 + 1] + v[i3 + 1] * dtSec;
      d[i3 + 2] = p[i3 + 2] + v[i3 + 2] * dtSec;
    }
    this.posAttr.needsUpdate = true;
  }

  /** Ray-pick nearest satellite in NDC-ish screen space. */
  pick(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
    thresholdUnits = 0.035,
  ): number {
    if (this.sats.length === 0) return -1;

    // Adaptive threshold based on camera distance
    const camDist = camera.position.length();
    raycaster.params.Points = { threshold: thresholdUnits * (camDist / 3) };

    const hits = raycaster.intersectObject(this.points, false);
    if (hits.length === 0) return -1;
    return hits[0].index ?? -1;
  }

  getDisplayPosition(index: number, target: THREE.Vector3): THREE.Vector3 {
    const i3 = index * 3;
    return target.set(
      this.displayPositions[i3],
      this.displayPositions[i3 + 1],
      this.displayPositions[i3 + 2],
    );
  }

  highlightIndex(index: number): void {
    // Boost selected point size temporarily via size attribute
    const n = this.sats.length;
    for (let i = 0; i < n; i++) {
      const g = GROUP_BY_ID[this.sats[i].groupId as SatGroupId];
      const base = g?.emphasize && this.emphasizeStations ? 1.8 : 1.0;
      this.sizes[i] = i === index ? base * 2.2 : base;
    }
    const attr = (this.points.geometry as THREE.BufferGeometry).getAttribute(
      'aSize',
    ) as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }
}
