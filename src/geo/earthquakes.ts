import * as THREE from 'three';
import { pickPointsNearestCursor, type PickHit } from '../domains/pick';
import { EARTH_RADIUS, USGS_BASE } from '../config';

export interface EarthquakeRecord {
  id: string;
  mag: number;
  place: string;
  timeMs: number;
  depthKm: number;
  tsunami: boolean;
  url: string;
  lat: number;
  lon: number;
  x: number;
  y: number;
  z: number;
}

interface GeoJsonFeature {
  id: string;
  properties: {
    mag: number;
    place: string;
    time: number;
    tsunami: number;
    url: string;
  };
  geometry: {
    coordinates: [number, number, number]; // lon, lat, depth
  };
}

interface GeoJsonCollection {
  features: GeoJsonFeature[];
}

function geoToSceneSurface(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const r = EARTH_RADIUS * 1.0015; // slightly above ground

  const clat = Math.cos(lat);
  const ecfX = r * clat * Math.cos(lon);
  const ecfY = r * clat * Math.sin(lon);
  const ecfZ = r * Math.sin(lat);

  return [ecfX, ecfZ, -ecfY];
}

const quakeVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vPhase;
  uniform float uTime;
  uniform float uPixelRatio;

  void main() {
    vColor = aColor;
    vPhase = fract(aPhase + uTime * 0.4);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.2);
    gl_PointSize = aSize * uPixelRatio * (28.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 2.0, 16.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const quakeFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vPhase;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;

    // Solid core epicenter
    float core = smoothstep(0.18, 0.04, d);

    // Expanding shockwave pulse ring
    float ringR = vPhase * 0.45;
    float ringDist = abs(d - ringR);
    float ring = smoothstep(0.06, 0.01, ringDist) * (1.0 - vPhase);

    float alpha = clamp(core * 0.95 + ring * 0.85, 0.0, 1.0);
    vec3 col = mix(vColor, vec3(1.0), core * 0.5);

    gl_FragColor = vec4(col, alpha);
  }
`;

export class EarthquakeSystem {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;

  private quakes: EarthquakeRecord[] = [];
  private positions = new Float32Array(0);
  private colors = new Float32Array(0);
  private sizes = new Float32Array(0);
  private phases = new Float32Array(0);

  private posAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private phaseAttr: THREE.BufferAttribute;

  private minMagFilter = 2.5;
  private isVisible = true;
  private highlightIdx = -1;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1);
    this.phaseAttr = new THREE.BufferAttribute(this.phases, 1);

    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colorAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aPhase', this.phaseAttr);

    this.material = new THREE.ShaderMaterial({
      vertexShader: quakeVertex,
      fragmentShader: quakeFragment,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  get count(): number {
    return this.quakes.length;
  }

  get list(): EarthquakeRecord[] {
    return this.quakes;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.points.visible = visible;
  }

  setMinMag(mag: number): void {
    this.minMagFilter = mag;
    this.syncBuffers();
  }

  async fetchQuakes(): Promise<void> {
    try {
      let res = await fetch(USGS_BASE);
      if (!res.ok) {
        res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
      }
      const data = (await res.json()) as GeoJsonCollection;

      const parsed: EarthquakeRecord[] = [];
      for (const feat of data.features ?? []) {
        const [lon, lat, depth] = feat.geometry.coordinates;
        if (lat == null || lon == null) continue;
        const [x, y, z] = geoToSceneSurface(lat, lon);

        parsed.push({
          id: feat.id,
          mag: feat.properties.mag ?? 3.0,
          place: feat.properties.place ?? 'Pacific Basin',
          timeMs: feat.properties.time,
          depthKm: depth ?? 10,
          tsunami: Boolean(feat.properties.tsunami),
          url: feat.properties.url,
          lat,
          lon,
          x,
          y,
          z,
        });
      }

      this.quakes = parsed;
      this.syncBuffers();
    } catch (err) {
      console.warn('Failed to load USGS earthquake feed:', err);
    }
  }

  private syncBuffers(): void {
    const n = this.quakes.length;
    if (this.positions.length !== n * 3) {
      this.positions = new Float32Array(n * 3);
      this.colors = new Float32Array(n * 3);
      this.sizes = new Float32Array(n);
      this.phases = new Float32Array(n);

      const geo = this.points.geometry;
      this.posAttr = new THREE.BufferAttribute(this.positions, 3);
      this.posAttr.setUsage(THREE.DynamicDrawUsage);
      this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
      this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1);
      this.phaseAttr = new THREE.BufferAttribute(this.phases, 1);

      geo.setAttribute('position', this.posAttr);
      geo.setAttribute('aColor', this.colorAttr);
      geo.setAttribute('aSize', this.sizeAttr);
      geo.setAttribute('aPhase', this.phaseAttr);
    }

    const p = this.positions;
    const c = this.colors;
    const s = this.sizes;
    const ph = this.phases;

    for (let i = 0; i < n; i++) {
      const q = this.quakes[i];
      const i3 = i * 3;
      const visible = this.isVisible && q.mag >= this.minMagFilter;

      if (!visible) {
        p[i3] = 0;
        p[i3 + 1] = 0;
        p[i3 + 2] = 0;
        s[i] = 0;
        continue;
      }

      p[i3] = q.x;
      p[i3 + 1] = q.y;
      p[i3 + 2] = q.z;

      // Color by magnitude
      if (q.mag >= 7.0) {
        c[i3] = 1.0; c[i3 + 1] = 0.05; c[i3 + 2] = 0.3; // severe red-pink
      } else if (q.mag >= 5.5) {
        c[i3] = 1.0; c[i3 + 1] = 0.45; c[i3 + 2] = 0.1; // bright orange
      } else if (q.mag >= 4.5) {
        c[i3] = 1.0; c[i3 + 1] = 0.8; c[i3 + 2] = 0.2; // gold
      } else {
        c[i3] = 0.2; c[i3 + 1] = 0.85; c[i3 + 2] = 0.75; // teal
      }

      const isSelected = i === this.highlightIdx;
      s[i] = (0.8 + q.mag * 0.25) * (isSelected ? 2.0 : 1.0);
      ph[i] = (i * 0.13) % 1.0;
    }

    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
  }

  update(wallTimeSec: number): void {
    this.material.uniforms.uTime.value = wallTimeSec;
  }

  highlight(index: number): void {
    this.highlightIdx = index;
    this.syncBuffers();
  }

  pick(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
    pointerNdc: THREE.Vector2,
  ): PickHit | null {
    if (!this.isVisible || this.quakes.length === 0) return null;
    return pickPointsNearestCursor(raycaster, camera, pointerNdc, this.points);
  }
}
