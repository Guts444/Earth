import * as THREE from 'three';

/**
 * Live satellite imagery — NASA GIBS (CORS-open).
 *
 * Composites MODIS Terra corrected-reflectance tiles (8x4 at zoom 3 ->
 * 4096x2048, the same grid as the stylized day texture) into a texture used
 * as the day-side earth map: real land, ocean, and clouds, refreshed per
 * page load. GIBS serves black tiles (HTTP 200) for dates with no published
 * imagery, so the date probe verifies actual content before accepting it.
 */

const GIBS_CR_LAYER = 'MODIS_Terra_CorrectedReflectance_TrueColor';
const GIBS_GRID_Z = 3; // 8x4 tiles at 512px -> 4096x2048 world texture
const GIBS_COLS = 8;
const GIBS_ROWS = 4;
const GIBS_TILE_PX = 512;
const MAX_DATE_BACKTRACK_DAYS = 3;

const IMAGERY_W = GIBS_COLS * GIBS_TILE_PX;
const IMAGERY_H = GIBS_ROWS * GIBS_TILE_PX;

const tileUrl = (date: string, row: number, col: number) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${GIBS_CR_LAYER}/default/${date}/250m/${GIBS_GRID_Z}/${row}/${col}.jpeg`;

async function fetchBitmap(url: string, timeoutMs = 20000): Promise<ImageBitmap> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GIBS tile HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
}

/** GIBS returns 200 + black tiles for dates with no imagery yet — detect them. */
async function tileHasContent(url: string): Promise<boolean> {
  const bmp = await fetchBitmap(url);
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, 16, 16);
  bmp.close();
  const d = ctx.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  return sum / ((d.length / 4) * 3) > 6; // mean channel > 6/255
}

export interface LiveImageryResult {
  texture: THREE.CanvasTexture;
  date: string;
}

export async function loadLiveImagery(): Promise<LiveImageryResult> {
  // Newest day with real content (imagery lags a few hours)
  let usedDate = '';
  for (let back = 0; back <= MAX_DATE_BACKTRACK_DAYS; back++) {
    const date = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    try {
      if (await tileHasContent(tileUrl(date, 0, 0))) {
        usedDate = date;
        break;
      }
    } catch {
      // try the previous day
    }
  }
  if (!usedDate) {
    throw new Error(`GIBS: no usable imagery in the last ${MAX_DATE_BACKTRACK_DAYS} days`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = IMAGERY_W;
  canvas.height = IMAGERY_H;
  const ctx = canvas.getContext('2d')!;
  await Promise.all(
    Array.from({ length: GIBS_ROWS * GIBS_COLS }, async (_, i) => {
      const row = Math.floor(i / GIBS_COLS);
      const col = i % GIBS_COLS;
      const bmp = await fetchBitmap(tileUrl(usedDate, row, col));
      ctx.drawImage(bmp, col * GIBS_TILE_PX, row * GIBS_TILE_PX);
      bmp.close();
    }),
  );

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace; // real imagery, not data
  tex.anisotropy = 8;
  return { texture: tex, date: usedDate };
}
