import * as THREE from 'three';
import { CLOUDS_SCALE, EARTH_RADIUS } from '../config';
import CLOUD_COLORMAP from './cloudColormap.json';

/**
 * Real cloud layer — NASA GIBS VIIRS cloud-mask products, fetched as a single
 * global equirectangular WMS raster (no tile-matrix arithmetic).
 *
 * Products: VIIRS Clear Sky Confidence (Day + Night). SNPP is the PRIMARY
 * source; NOAA-20 provides per-pixel gap fill (see below) and remains a
 * whole-source fallback when SNPP has no usable date. The colormapped PNG is
 * decoded through the official GIBS colormap (cloudColormap.json) into the
 * product's continuous CLEAR-SKY CONFIDENCE field:
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
 * Per-pixel source fallback: a single-date raster can pass the overall
 * opaque-fraction gate yet still contain large contiguous no-data swath gaps
 * (overpasses not yet processed). To close those, the same-date NOAA-20
 * raster is merged PER PIXEL for each product independently:
 *
 *   if SNPP pixel has valid source data -> use SNPP
 *   else if NOAA-20 pixel has valid source data -> use NOAA-20
 *   else -> transparent
 *
 * NOAA-20 fills ONLY SNPP no-data pixels — detections are never unioned
 * where both sources observed (different overpass times would inflate
 * coverage). If the same-date NOAA-20 product is unavailable, the remaining
 * gap stays transparent rather than fabricating data. The merge happens on
 * the pre-transfer clear-confidence field, so the clear-sky-confidence
 * semantics and the visualization transfer are unchanged by it.
 *
 * Day product covers the sunlit side; Night product (IR-based) covers the
 * rest. The shader blends them at the live terminator so the night side shows
 * faint real clouds and the day side stays clean, and applies a continuous
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

/** Night-side cloud dimming — faint context, never a dominant texture. */
const NIGHT_CLOUD_DIM = 0.12;

// ---------------------------------------------------------------------------
// Clear-sky confidence -> cloud confidence -> visual opacity
// ---------------------------------------------------------------------------

/**
 * VISUALIZATION transfer curve (not physical cloud thickness — Clear Sky
 * Confidence is classification confidence only).
 *
 * Tuned so the tactical map stays readable and clouds feel like an overlay,
 * not a replacement surface:
 *  - cloudConfidence <= CLOUD_TRANSFER_AMBIGUOUS_CC ("probably/confident
 *    clear" and ambiguous low-confidence detections) renders fully
 *    transparent;
 *  - cloudConfidence >= CLOUD_TRANSFER_CONFIDENT_CC ("confident cloud")
 *    renders at the capped maximum;
 *  - in between, a smoothstep ramp.
 */
export const CLOUD_TRANSFER_AMBIGUOUS_CC = 0.45;
export const CLOUD_TRANSFER_CONFIDENT_CC = 0.9;
export const CLOUD_TRANSFER_MAX_ALPHA = 0.35;

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

// ---------------------------------------------------------------------------
// Clear-confidence field: decode -> merge -> transfer
// ---------------------------------------------------------------------------

interface ConfField {
  width: number;
  height: number;
  /** Continuous clear-sky confidence per pixel; NaN = no source data. */
  conf: Float32Array;
}

/**
 * Decode a colormapped GIBS PNG into the continuous clear-sky-confidence
 * field (NaN = no-data, source alpha 0). No transfer yet — source merging
 * happens on this pre-transfer field so semantics are source-independent.
 */
function extractClearConfidence(img: ImageData): ConfField {
  const { width, height, data } = img;
  const conf = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const srcA = data[i + 3];
    if (srcA === 0) {
      conf[p] = NaN; // no data
      continue;
    }
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Exact ramp colors decode exactly; edge blends fall back to the LUT.
    let clearConfidence = EXACT_VALUES.get((r << 16) | (g << 8) | b);
    clearConfidence =
      clearConfidence === undefined
        ? VALUE_LUT[(r >> 2) * LUT_DIM * LUT_DIM + (g >> 2) * LUT_DIM + (b >> 2)] / 255
        : clearConfidence / 255;
    conf[p] = clearConfidence;
  }
  return { width, height, conf };
}

/**
 * Per-pixel source fallback: SNPP wins wherever it has valid data; NOAA-20
 * fills ONLY SNPP no-data pixels. Detections are never unioned/merged where
 * both sources observed (different overpass times must not inflate
 * coverage). Applied to the day and night masks independently.
 */
function mergeClearConfidence(
  primary: ConfField,
  fallback: ConfField | null,
): { field: ConfField; filled: number; valid: number } {
  const { width, height, conf: p } = primary;
  const f = fallback?.conf;
  const merged = new Float32Array(width * height);
  let valid = 0;
  let filled = 0;
  for (let i = 0; i < merged.length; i++) {
    if (!Number.isNaN(p[i])) {
      merged[i] = p[i]; // SNPP observed: always wins
      valid++;
    } else if (f && !Number.isNaN(f[i])) {
      merged[i] = f[i]; // SNPP no-data: NOAA-20 fills the gap
      filled++;
      valid++;
    } else {
      merged[i] = NaN; // no data in either source: stay transparent
    }
  }
  return { field: { width, height, conf: merged }, filled, valid };
}

/**
 * Pre-transfer clear-confidence field -> white-cloud RGBA canvas:
 *
 *   cloudConfidence = 1 - clearConfidence
 *   alpha           = cloudVisualTransfer(cloudConfidence)
 *
 * RGB is white (cloud color); no-data pixels stay fully transparent —
 * never black.
 */
function confidenceToCanvas(field: ConfField): HTMLCanvasElement {
  const { width, height, conf } = field;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(width, height);
  const od = out.data;
  for (let p = 0, o = 0; p < conf.length; p++, o += 4) {
    const c = conf[p];
    if (Number.isNaN(c)) continue; // transparent (createImageData zeroes alpha)
    const a = cloudVisualTransfer(1 - c);
    od[o] = 255;
    od[o + 1] = 255;
    od[o + 2] = 255;
    od[o + 3] = Math.round(a * 255);
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

/**
 * Best-effort same-date NOAA-20 gap-fill fields. A fetch failure or an
 * unpublished date (fully transparent raster) simply contributes no fill
 * pixels — the SNPP gaps stay transparent, never fabricated.
 */
async function fetchFillFields(
  date: string,
): Promise<{ day: ConfField; night: ConfField } | null> {
  const n20 = CLOUD_SOURCES.find((s) => s.id === 'NOAA-20')!;
  try {
    const [dayImg, nightImg] = await Promise.all([
      fetchPngImageData(wmsUrl(n20.day, date, CLOUD_TEX_W, CLOUD_TEX_H)),
      fetchPngImageData(wmsUrl(n20.night, date, CLOUD_TEX_W, CLOUD_TEX_H)),
    ]);
    return { day: extractClearConfidence(dayImg), night: extractClearConfidence(nightImg) };
  } catch (err) {
    console.warn(`NOAA-20 gap fill (${date}) unavailable — SNPP gaps stay transparent:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CloudFillInfo {
  /** NOAA-20 same-date per-pixel gap fill contributed usable pixels. */
  used: boolean;
  /** Fraction of merged coverage that came from the fill source. */
  dayFrac: number;
  nightFrac: number;
}

export interface CloudLayer {
  mesh: THREE.Mesh;
  date: string;
  source: 'SNPP' | 'NOAA-20';
  fill: CloudFillInfo;
  setSunDirection(dir: THREE.Vector3): void;
  setFullDaylight(detail: number): void;
  setCloudVisibility(v: number): void;
}

/**
 * Fetch day+night cloud masks from the newest sufficiently-complete published
 * date. SNPP is primary; its no-data gaps are filled per pixel from the
 * same-date NOAA-20 raster (day and night independently). NOAA-20 remains a
 * whole-source fallback if SNPP has no usable date. Returns null when no
 * source/date yields usable data (caller keeps the stylized Earth, clouds
 * hidden).
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

        let dayField = extractClearConfidence(dayImg);
        let nightField = extractClearConfidence(nightImg);
        let fill: CloudFillInfo = { used: false, dayFrac: 0, nightFrac: 0 };

        // Per-pixel gap fill (SNPP primary only — never "fill" with itself).
        if (src.id === 'SNPP') {
          const fillFields = await fetchFillFields(date);
          if (fillFields) {
            const dayMerge = mergeClearConfidence(dayField, fillFields.day);
            const nightMerge = mergeClearConfidence(nightField, fillFields.night);
            if (dayMerge.filled > 0 || nightMerge.filled > 0) {
              fill = {
                used: true,
                dayFrac: dayMerge.valid > 0 ? dayMerge.filled / dayMerge.valid : 0,
                nightFrac: nightMerge.valid > 0 ? nightMerge.filled / nightMerge.valid : 0,
              };
              dayField = dayMerge.field;
              nightField = nightMerge.field;
            }
          }
        }

        const dayTex = new THREE.CanvasTexture(confidenceToCanvas(dayField));
        const nightTex = new THREE.CanvasTexture(confidenceToCanvas(nightField));
        const maxAniso = renderer.capabilities.getMaxAnisotropy();
        for (const tex of [dayTex, nightTex]) {
          tex.colorSpace = THREE.NoColorSpace; // opacity data, not color
          tex.wrapS = THREE.RepeatWrapping; // lon ±180 are the same meridian
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.anisotropy = maxAniso;
        }
        const layer = createCloudMesh(dayTex, nightTex);
        return { mesh: layer.mesh, date, source: src.id, fill, ...layer.hooks };
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
