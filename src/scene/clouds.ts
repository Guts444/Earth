import * as THREE from 'three';
import { EARTH_RADIUS } from '../config';

// Relative path so the static cloud layer resolves under any deploy base
// (used only as fallback when NASA GIBS imagery is unreachable).
const CLOUDS_TEXTURE = 'textures/earth-clouds.png';
const BASE_EARTH_TEXTURE = 'textures/earth-blue-marble.jpg';

// ---------------------------------------------------------------------------
// Real clouds — NASA GIBS satellite imagery (CORS-open).
//
// Composites MODIS Terra corrected-reflectance tiles (8x4 at zoom 3 ->
// 4096x2048, the same grid as the base earth texture), then derives a cloud
// alpha mask by diffing against the cloud-free base texture: where the live
// imagery is much brighter than the base (and low-saturation), that's cloud.
// ---------------------------------------------------------------------------

const GIBS_CR_LAYER = 'MODIS_Terra_CorrectedReflectance_TrueColor';
const GIBS_TILE_URL = (date: string, row: number, col: number) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${GIBS_CR_LAYER}/default/${date}/250m/3/${row}/${col}.jpeg`;

const CLOUD_GRID_COLS = 8;
const CLOUD_GRID_ROWS = 4;
const CLOUD_TILE_PX = 512;
const CLOUD_W = CLOUD_TILE_PX * CLOUD_GRID_COLS;
const CLOUD_H = CLOUD_TILE_PX * CLOUD_GRID_ROWS;
const MAX_DATE_BACKTRACK_DAYS = 3;

async function loadImageBitmap(url: string, timeoutMs = 20000): Promise<ImageBitmap> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GIBS tile HTTP ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

async function loadBaseEarthCanvas(): Promise<ImageData | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('base texture load failed'));
      el.src = BASE_EARTH_TEXTURE;
    });
    const c = document.createElement('canvas');
    c.width = CLOUD_W;
    c.height = CLOUD_H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, CLOUD_W, CLOUD_H);
    return ctx.getImageData(0, 0, CLOUD_W, CLOUD_H);
  } catch {
    return null;
  }
}

async function loadRealCloudTexture(): Promise<{
  texture: THREE.CanvasTexture;
  date: string;
}> {
  // Find the newest day with available tiles (imagery lags a few hours)
  let usedDate = '';
  for (let back = 0; back <= MAX_DATE_BACKTRACK_DAYS; back++) {
    const date = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    try {
      await loadImageBitmap(GIBS_TILE_URL(date, 0, 0));
      usedDate = date;
      break;
    } catch {
      // try the previous day
    }
  }
  if (!usedDate) throw new Error(`GIBS: no imagery in the last ${MAX_DATE_BACKTRACK_DAYS} days`);

  // Fetch the 8x4 tile mosaic in parallel
  const tiles: Array<[ImageBitmap, number, number]> = [];
  await Promise.all(
    Array.from({ length: CLOUD_GRID_ROWS * CLOUD_GRID_COLS }, async (_, i) => {
      const row = Math.floor(i / CLOUD_GRID_COLS);
      const col = i % CLOUD_GRID_COLS;
      const bmp = await loadImageBitmap(GIBS_TILE_URL(usedDate, row, col));
      tiles.push([bmp, row, col]);
    }),
  );

  const canvas = document.createElement('canvas');
  canvas.width = CLOUD_W;
  canvas.height = CLOUD_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  for (const [bmp, row, col] of tiles) {
    ctx.drawImage(bmp, col * CLOUD_TILE_PX, row * CLOUD_TILE_PX);
  }
  tiles.forEach(([bmp]) => bmp.close());

  const [gibsData, baseData] = await Promise.all([
    ctx.getImageData(0, 0, CLOUD_W, CLOUD_H),
    loadBaseEarthCanvas(),
  ]);
  const g = gibsData.data;
  const b = baseData ? baseData.data : null;

  // Cloud alpha: bright-white regions in live imagery that are much brighter
  // than the cloud-free base -> clouds (snow stays matched to the base).
  for (let i = 0; i < g.length; i += 4) {
    const r = g[i] / 255;
    const gr = g[i + 1] / 255;
    const bl = g[i + 2] / 255;
    const lum = 0.299 * r + 0.587 * gr + 0.114 * bl;
    const mx = Math.max(r, gr, bl);
    const mn = Math.min(r, gr, bl);
    const sat = mx - mn;

    let diff: number;
    if (b) {
      diff = lum - (0.299 * b[i] / 255 + 0.587 * b[i + 1] / 255 + 0.114 * b[i + 2] / 255);
    } else {
      diff = lum - 0.55;
    }

    const alpha = smoothstep(0.05, 0.25, diff) * (1 - smoothstep(0.3, 0.55, sat));
    const a = Math.round(alpha * 255);
    g[i] = a;
    g[i + 1] = a;
    g[i + 2] = a;
    g[i + 3] = 255;
  }
  ctx.putImageData(gibsData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return { texture: tex, date: usedDate };
}

const cloudsVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const cloudsFragment = /* glsl */ `
  uniform sampler2D cloudMap;
  uniform vec3 sunDirection;
  uniform float opacity;
  uniform float fullDaylight;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vec4 sampleVal = texture2D(cloudMap, vUv);
    float density = sampleVal.r;

    // Discard clear sky so continents & oceans are 100% visible
    if (density < 0.08) discard;

    vec3 n = normalize(vNormalW);
    float ndl = dot(n, normalize(sunDirection));
    float dayness = mix(smoothstep(-0.2, 0.25, ndl), 1.0, fullDaylight);

    // Warm white in daylight, dark deep blue in night shadow
    vec3 dayColor = vec3(0.96, 0.98, 1.0);
    vec3 nightColor = vec3(0.015, 0.025, 0.05);
    vec3 col = mix(nightColor, dayColor, dayness);

    // Subtle cloud opacity
    float alpha = density * opacity * (0.15 + 0.65 * dayness);

    gl_FragColor = vec4(col, alpha);
  }
`;

export interface CloudSystem {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Where the cloud layer came from — shown in the DATA FEEDS strip. */
  source: 'gibs' | 'static';
  /** Imagery date for real satellite clouds (null for the static texture). */
  imageryDate: string | null;
  update(dt: number, sunDir: THREE.Vector3): void;
  setVisible(visible: boolean): void;
  setFullDaylight(active: boolean): void;
}

export async function createClouds(): Promise<CloudSystem> {
  const loader = new THREE.TextureLoader();
  loader.crossOrigin = 'anonymous';

  let cloudTex: THREE.Texture;
  let source: 'gibs' | 'static';
  let imageryDate: string | null = null;

  try {
    const { texture, date } = await loadRealCloudTexture();
    cloudTex = texture;
    source = 'gibs';
    imageryDate = date;
  } catch (err) {
    console.warn('GIBS satellite clouds unavailable — static fallback:', err);
    cloudTex = await loader.loadAsync(CLOUDS_TEXTURE);
    cloudTex.wrapS = THREE.RepeatWrapping;
    source = 'static';
  }

  const mat = new THREE.ShaderMaterial({
    vertexShader: cloudsVertex,
    fragmentShader: cloudsFragment,
    uniforms: {
      cloudMap: { value: cloudTex },
      sunDirection: { value: new THREE.Vector3(1, 0.2, 0.4).normalize() },
      opacity: { value: 0.45 },
      fullDaylight: { value: 0.0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const geo = new THREE.SphereGeometry(EARTH_RADIUS * 1.004, 72, 72);
  const mesh = new THREE.Mesh(geo, mat);

  return {
    mesh,
    material: mat,
    source,
    imageryDate,
    update(dt: number, sunDir: THREE.Vector3) {
      mesh.rotation.y += dt * 0.0005;
      mat.uniforms.sunDirection.value.copy(sunDir);
    },
    setVisible(visible: boolean) {
      mesh.visible = visible;
    },
    setFullDaylight(active: boolean) {
      mat.uniforms.fullDaylight.value = active ? 1.0 : 0.0;
    },
  };
}
