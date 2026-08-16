import * as THREE from 'three';
import { CLOUDS_SCALE, EARTH_RADIUS } from '../config';
import CLOUD_COLORMAP from './cloudColormap.json';

/**
 * Real cloud layer — NASA GIBS VIIRS cloud-mask products, fetched as a single
 * global equirectangular WMS raster (no tile-matrix arithmetic).
 *
 * Products: VIIRS Clear Sky Confidence (Day + Night) for SNPP, with NOAA-20
 * (JPSS-1) as a clean fallback. The colormapped PNG is decoded through the
 * official GIBS colormap (cloudColormap.json) into the product's continuous
 * CLEAR-SKY CONFIDENCE field:
 *
 *   value 1.0 (dark red 127,0,0) -> highest confidence of CLEAR sky
 *   value 0.0 (cream 255,247,236) -> confident cloud
 *
 * (VNP03/VCM product definition; verified against independent true-color
 * imagery — see scripts/verify-clouds.mjs.) From it we derive:
 *
 *   clearConfidence = decodedValue
 *   cloudConfidence = 1 - clearConfidence
 *   alpha           = cloudVisualTransfer(cloudConfidence)   // VISUALIZATION
 *
 * The transfer is a presentation curve only — Clear Sky Confidence is
 * classification confidence, not cloud optical thickness (see
 * VIIRS Cloud Optical Thickness as a future enhancement if true density is
 * needed). No-data pixels are transparent in the WMS PNG and stay
 * transparent — never black.
 *
 * Day product covers the sunlit side; Night product (IR-based) covers the
 * rest. The shader blends them at the live terminator so the night side shows
 * dimmed real clouds and the day side stays clean, and applies a continuous
 * zoom-driven visibility multiplier (global view: full; local/detail view:
 * faded out).
 */

// ---------------------------------------------------------------------------
// Sources & constants
// ---------------------------------------------------------------------------

interface CloudSource {
  id: 'SNPP' | 'NOAA-20';
  label: string;
  day: string;
  night: string;
}

const CLOUD_SOURCES: CloudSource[] = [
  {
    id: 'SNPP',
    label: 'VIIRS SNPP',
    day: 'VIIRS_SNPP_Clear_Sky_Confidence_Day',
    night: 'VIIRS_SNPP_Clear_Sky_Confidence_Night',
  },
  {
    id: 'NOAA-20',
    label: 'VIIRS NOAA-20',
    day: 'VIIRS_NOAA20_Clear_Sky_Confidence_Day',
    night: 'VIIRS_NOAA20_Clear_Sky_Confidence_Night',
  },
];

const WMS_BASE = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

/** Global equirectangular raster size (2:1, matches the stylized day map). */
export const CLOUD_TEX_W = 2048;
export const CLOUD_TEX_H = 1024;

/** Tiny probe size used for date-availability checks. */
const PROBE_W = 64;
const PROBE_H = 32;

const MAX_BACKTRACK_DAYS = 4;

/**
 * Completeness gates ("newest sufficiently complete dataset"): a published
 * date can still be partially processed. Typical opaque fractions: day ~0.86
 * (night side is no-data), night ~0.94. These thresholds reject half-baked
 * days without rejecting a complete winter day (day side ~0.55+).
 */
const DAY_MIN_OPAQUE = 0.45;
const NIGHT_MIN_OPAQUE = 0.55;

/** Probe counts as "has data" above this opaque fraction (empty = no data). */
const PROBE_MIN_OPAQUE = 0.02;

/** Night-side cloud dimming (subtle visibility, per product spec). */
const NIGHT_CLOUD_DIM = 0.35;

// ---------------------------------------------------------------------------
// Clear-sky confidence -> cloud confidence -> visual opacity
// ---------------------------------------------------------------------------

/**
 * VISUALIZATION transfer curve (not physical cloud thickness — Clear Sky
 * Confidence is classification confidence only).
 *
 * Tuned so the tactical map stays readable:
 *  - cloudConfidence <= CLOUD_TRANSFER_AMBIGUOUS_CC ("probably/confident
 *    clear" and ambiguous low-confidence detections) renders fully
 *    transparent;
 *  - cloudConfidence >= CLOUD_TRANSFER_CONFIDENT_CC ("confident cloud")
 *    renders at the capped maximum;
 *  - in between, a smoothstep ramp.
 */
export const CLOUD_TRANSFER_AMBIGUOUS_CC = 0.3;
export const CLOUD_TRANSFER_CONFIDENT_CC = 0.85;
export const CLOUD_TRANSFER_MAX_ALPHA = 0.7;

export function cloudVisualTransfer(cloudConfidence: number): number {
  if (cloudConfidence <= CLOUD_TRANSFER_AMBIGUOUS_CC) return 0;
  const t = THREE.MathUtils.smoothstep(
    cloudConfidence,
    CLOUD_TRANSFER_AMBIGUOUS_CC,
    CLOUD_TRANSFER_CONFIDENT_CC,
  );
  return t * CLOUD_TRANSFER_MAX_ALPHA;
}

// ---------------------------------------------------------------------------
// Colormap decode
// ---------------------------------------------------------------------------

interface ColormapEntry {
  rgb: [number, number, number];
  value: number;
}

interface RawColormapEntry {
  rgb: [number, number, number];
  transparent: boolean;
  value?: number;
}

/** Opaque colormap entries (the first entry is the transparent fill). */
const RAW_COLORMAP = CLOUD_COLORMAP as RawColormapEntry[];
const COLORMAP: ColormapEntry[] = RAW_COLORMAP.flatMap((e) =>
  e.transparent || e.value === undefined ? [] : [{ rgb: e.rgb, value: e.value }],
);

/**
 * 64^3 RGB -> cloud-opacity LUT built from the documented GIBS colormap.
 * Deterministic: every color maps to the nearest colormap bin's value
 * (antialiased edge pixels blend two bins; nearest-bin keeps them stable).
 */
const LUT_DIM = 64;

/**
 * Exact rgb -> opacity map for the 101 documented ramp colors. GIBS serves
 * exact colormap colors for interior pixels, so this decodes them perfectly;
 * the LUT below only handles antialiased edge pixels (blends of two bins).
 */
const EXACT_VALUES = new Map<number, number>();
for (const e of COLORMAP) {
  EXACT_VALUES.set((e.rgb[0] << 16) | (e.rgb[1] << 8) | e.rgb[2], Math.round(e.value * 255));
}

function buildValueLut(): Uint8Array {
  const lut = new Uint8Array(LUT_DIM * LUT_DIM * LUT_DIM);
  for (let r = 0; r < LUT_DIM; r++) {
    for (let g = 0; g < LUT_DIM; g++) {
      for (let b = 0; b < LUT_DIM; b++) {
        const cr = (r * 255) / (LUT_DIM - 1);
        const cg = (g * 255) / (LUT_DIM - 1);
        const cb = (b * 255) / (LUT_DIM - 1);
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < COLORMAP.length; i++) {
          const [er, eg, eb] = COLORMAP[i].rgb;
          const dr = cr - er;
          const dg = cg - eg;
          const db = cb - eb;
          const d = dr * dr + dg * dg + db * db;
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
        lut[(r * LUT_DIM + g) * LUT_DIM + b] = Math.round(COLORMAP[best].value * 255);
      }
    }
  }
  return lut;
}
const VALUE_LUT = buildValueLut();

/**
 * Convert a colormapped GIBS PNG into a white-cloud RGBA canvas:
 *
 *   clearConfidence = colormap value   (VNP03 Clear_Sky_Confidence)
 *   cloudConfidence = 1 - clearConfidence
 *   alpha           = cloudVisualTransfer(cloudConfidence)
 *
 * RGB is white (cloud color); no-data pixels (source alpha 0) stay fully
 * transparent — never black.
 */
function decodeMask(img: ImageData): HTMLCanvasElement {
  const { width, height, data } = img;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(width, height);
  const od = out.data;
  const lut = VALUE_LUT;
  const exact = EXACT_VALUES;
  const D = LUT_DIM;
  for (let i = 0; i < data.length; i += 4) {
    const srcA = data[i + 3];
    const o = i;
    if (srcA === 0) {
      od[o] = 0;
      od[o + 1] = 0;
      od[o + 2] = 0;
      od[o + 3] = 0;
    } else {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Exact ramp colors decode exactly; edge blends fall back to the LUT.
      let clearConfidence = exact.get((r << 16) | (g << 8) | b);
      if (clearConfidence === undefined) {
        clearConfidence = lut[(r >> 2) * D * D + (g >> 2) * D + (b >> 2)] / 255;
      } else {
        clearConfidence /= 255;
      }
      const cloudConfidence = 1 - clearConfidence;
      const a = cloudVisualTransfer(cloudConfidence);
      od[o] = 255;
      od[o + 1] = 255;
      od[o + 2] = 255;
      od[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// WMS retrieval
// ---------------------------------------------------------------------------

function wmsUrl(layer: string, date: string, width: number, height: number): string {
  const q = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: layer,
    STYLES: '',
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    SRS: 'EPSG:4326',
    BBOX: '-180,-90,180,90',
    WIDTH: String(width),
    HEIGHT: String(height),
    TIME: date,
  });
  return `${WMS_BASE}?${q.toString()}`;
}

async function fetchPngImageData(
  url: string,
  timeoutMs = 30000,
): Promise<ImageData> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GIBS WMS HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) {
    throw new Error(`GIBS WMS non-image response (${type || 'no content-type'})`);
  }
  const bmp = await createImageBitmap(await res.blob());
  const w = bmp.width;
  const h = bmp.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close(); // detaches the bitmap — read w/h before this
  return ctx.getImageData(0, 0, w, h);
}

function opaqueFraction(img: ImageData): number {
  const { data } = img;
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) opaque++;
  }
  return opaque / (data.length / 4);
}

/** YYYY-MM-DD in UTC, `back` days before now. */
function dateStr(back: number): string {
  return new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
}

async function probeDate(
  src: CloudSource,
  date: string,
): Promise<boolean> {
  const [day, night] = await Promise.all([
    fetchPngImageData(wmsUrl(src.day, date, PROBE_W, PROBE_H), 15000),
    fetchPngImageData(wmsUrl(src.night, date, PROBE_W, PROBE_H), 15000),
  ]);
  return opaqueFraction(day) > PROBE_MIN_OPAQUE && opaqueFraction(night) > PROBE_MIN_OPAQUE;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CloudLayer {
  mesh: THREE.Mesh;
  date: string;
  source: 'SNPP' | 'NOAA-20';
  setSunDirection(dir: THREE.Vector3): void;
  setFullDaylight(detail: number): void;
  setCloudVisibility(v: number): void;
}

/**
 * Fetch day+night cloud masks from the newest sufficiently-complete published
 * date. Tries SNPP first, then NOAA-20. Returns null when no source/date
 * yields usable data (caller keeps the stylized Earth, clouds hidden).
 */
export async function loadCloudLayer(renderer: THREE.WebGLRenderer): Promise<CloudLayer | null> {
  for (const src of CLOUD_SOURCES) {
    for (let back = 0; back <= MAX_BACKTRACK_DAYS; back++) {
      const date = dateStr(back);
      try {
        if (!(await probeDate(src, date))) continue; // not published yet
        const [dayImg, nightImg] = await Promise.all([
          fetchPngImageData(wmsUrl(src.day, date, CLOUD_TEX_W, CLOUD_TEX_H)),
          fetchPngImageData(wmsUrl(src.night, date, CLOUD_TEX_W, CLOUD_TEX_H)),
        ]);
        if (
          opaqueFraction(dayImg) < DAY_MIN_OPAQUE ||
          opaqueFraction(nightImg) < NIGHT_MIN_OPAQUE
        ) {
          continue; // published but still incomplete — try the day before
        }
        const dayTex = new THREE.CanvasTexture(decodeMask(dayImg));
        const nightTex = new THREE.CanvasTexture(decodeMask(nightImg));
        const maxAniso = renderer.capabilities.getMaxAnisotropy();
        for (const tex of [dayTex, nightTex]) {
          tex.colorSpace = THREE.NoColorSpace; // opacity data, not color
          tex.wrapS = THREE.RepeatWrapping; // lon ±180 are the same meridian
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.anisotropy = maxAniso;
        }
        const layer = createCloudMesh(dayTex, nightTex);
        return { mesh: layer.mesh, date, source: src.id, ...layer.hooks };
      } catch (err) {
        console.warn(`GIBS cloud mask (${src.id}, ${date}) failed:`, err);
      }
    }
  }
  return null;
}

interface CloudMeshHooks {
  setSunDirection(dir: THREE.Vector3): void;
  setFullDaylight(active: number): void;
  setCloudVisibility(v: number): void;
}

function createCloudMesh(
  dayTex: THREE.Texture,
  nightTex: THREE.Texture,
): { mesh: THREE.Mesh; hooks: CloudMeshHooks } {
  const sunDirection = new THREE.Vector3(1, 0.2, 0.4).normalize();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      cloudDay: { value: dayTex },
      cloudNight: { value: nightTex },
      sunDirection: { value: sunDirection.clone() },
      fullDaylight: { value: 0 },
      nightDim: { value: NIGHT_CLOUD_DIM },
      cloudVisibility: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D cloudDay;
      uniform sampler2D cloudNight;
      uniform vec3 sunDirection;
      uniform float fullDaylight;
      uniform float nightDim;
      uniform float cloudVisibility;
      varying vec2 vUv;
      varying vec3 vNormalW;

      void main() {
        vec3 n = normalize(vNormalW);
        float ndl = dot(n, normalize(sunDirection));
        // Same terminator band as the Earth shader
        float dayness = mix(smoothstep(-0.16, 0.20, ndl), 1.0, fullDaylight);
        float dayA = texture2D(cloudDay, vUv).a;
        float nightA = texture2D(cloudNight, vUv).a;
        float alpha = dayA * dayness + nightA * (1.0 - dayness) * nightDim;
        alpha *= cloudVisibility; // zoom-driven global->detail fade (master toggle included)
        gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * CLOUDS_SCALE, 96, 96),
    mat,
  );
  mesh.visible = true;

  return {
    mesh,
    hooks: {
      setSunDirection(dir: THREE.Vector3) {
        sunDirection.copy(dir);
        mat.uniforms.sunDirection.value.copy(dir);
      },
      setFullDaylight(detail: number) {
        mat.uniforms.fullDaylight.value = detail;
      },
      setCloudVisibility(v: number) {
        mat.uniforms.cloudVisibility.value = v;
      },
    },
  };
}

// Re-export for the verify script parity (documented colormap source URL).
export const COLORMAP_SOURCE_URL =
  'https://gibs.earthdata.nasa.gov/colormaps/v1.0/VIIRS_Clear_Sky_Confidence.xml';
