#!/usr/bin/env node
/**
 * verify-clouds.mjs — automated checks for the Earth Command cloud pipeline.
 *
 * Runs against LIVE NASA GIBS data (no browser needed):
 *   1. Date-availability walk finds the newest published date (probe = tiny
 *      WMS GetMap; a gap date returns a fully transparent PNG).
 *   2. Full day+night masks fetch at 2048x1024 and pass completeness gates.
 *   3. The documented GIBS colormap decodes deterministically to cloud
 *      opacity (0 = clear, 1 = cloud); no-data stays transparent.
 *   4. REGRESSION GUARD: no opaque-black pixels may exist anywhere in the
 *      source or the decoded mask (the old JPEG pipeline rendered no-data
 *      swath gaps as opaque black wedges).
 *   5. Dateline seam continuity (lon -180 and +180 are the same meridian).
 *
 * Usage: npm run verify:clouds   (or: node scripts/verify-clouds.mjs)
 * Exits non-zero on any hard failure.
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COLORMAP = JSON.parse(
  readFileSync(join(__dirname, '..', 'src', 'scene', 'cloudColormap.json'), 'utf8'),
);

const WMS_BASE = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const W = 2048;
const H = 1024;
const PROBE_W = 64;
const PROBE_H = 32;
const MAX_BACKTRACK_DAYS = 4;
const DAY_MIN_OPAQUE = 0.45;
const NIGHT_MIN_OPAQUE = 0.55;

const SOURCES = [
  {
    id: 'SNPP',
    day: 'VIIRS_SNPP_Clear_Sky_Confidence_Day',
    night: 'VIIRS_SNPP_Clear_Sky_Confidence_Night',
  },
  {
    id: 'NOAA-20',
    day: 'VIIRS_NOAA20_Clear_Sky_Confidence_Day',
    night: 'VIIRS_NOAA20_Clear_Sky_Confidence_Night',
  },
];

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`  FAIL: ${msg}`);
};
const ok = (msg) => console.log(`  ok: ${msg}`);

// ---------------------------------------------------------------------------
// Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced — what GIBS WMS serves)
// ---------------------------------------------------------------------------

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} unsupported`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (channels === null) throw new Error(`color type ${colorType} unsupported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? out.subarray((y - 1) * width * 4, y * width * 4) : null;
    for (let x = 0; x < stride; x++) {
      const c = x < channels ? 0 : row[x - channels];
      const u = prev ? prev[x] : 0;
      const ul = prev && x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + c) & 0xff; break;
        case 2: v = (v + u) & 0xff; break;
        case 3: v = (v + ((c + u) >> 1)) & 0xff; break;
        case 4: v = (v + paeth(c, u, ul)) & 0xff; break;
        default: throw new Error(`bad filter ${filter}`);
      }
      row[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      out[di] = row[si];
      out[di + 1] = channels > 1 ? row[si + 1] : row[si];
      out[di + 2] = channels > 2 ? row[si + 2] : row[si];
      out[di + 3] = channels === 4 ? row[si + 3] : 255;
    }
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------------------
// WMS + colormap pipeline (mirrors src/scene/clouds.ts)
// ---------------------------------------------------------------------------

function wmsUrl(layer, date, width, height) {
  const q = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: layer,
    STYLES: '', FORMAT: 'image/png', TRANSPARENT: 'TRUE', SRS: 'EPSG:4326',
    BBOX: '-180,-90,180,90', WIDTH: String(width), HEIGHT: String(height), TIME: date,
  });
  return `${WMS_BASE}?${q}`;
}

async function fetchPng(layer, date, width, height) {
  const res = await fetch(wmsUrl(layer, date, width, height), {
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`non-image response: ${type}`);
  return decodePng(Buffer.from(await res.arrayBuffer()));
}

function opaqueFraction(img) {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) n++;
  return n / (img.data.length / 4);
}

const ramp = [];
for (const e of COLORMAP) {
  if (!e.transparent && typeof e.value === 'number') ramp.push(e);
}
ok(`colormap: ${ramp.length} opaque entries (source: GIBS VIIRS_Clear_Sky_Confidence.xml)`);

const LUT_DIM = 64;
const lut = new Uint8Array(LUT_DIM * LUT_DIM * LUT_DIM);
for (let r = 0; r < LUT_DIM; r++) {
  for (let g = 0; g < LUT_DIM; g++) {
    for (let b = 0; b < LUT_DIM; b++) {
      const cr = (r * 255) / (LUT_DIM - 1);
      const cg = (g * 255) / (LUT_DIM - 1);
      const cb = (b * 255) / (LUT_DIM - 1);
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < ramp.length; i++) {
        const [er, eg, eb] = ramp[i].rgb;
        const d = (cr - er) ** 2 + (cg - eg) ** 2 + (cb - eb) ** 2;
        if (d < bestDist) { bestDist = d; best = i; }
      }
      lut[(r * LUT_DIM + g) * LUT_DIM + b] = Math.round(ramp[best].value * 255);
    }
  }
}

// Exact ramp colors decode exactly; the LUT handles antialiased edge blends.
const exactValues = new Map();
for (const e of ramp) {
  exactValues.set((e.rgb[0] << 16) | (e.rgb[1] << 8) | e.rgb[2], Math.round(e.value * 255));
}

// Colormap determinism: every documented ramp color must decode to its value.
let cmapErrors = 0;
for (const e of ramp) {
  const [r, g, b] = e.rgb;
  const key = (r << 16) | (g << 8) | b;
  const v = exactValues.get(key) ?? lut[(r >> 2) * LUT_DIM * LUT_DIM + (g >> 2) * LUT_DIM + (b >> 2)];
  if (Math.abs(v - e.value * 255) > 1) {
    cmapErrors++;
    if (cmapErrors < 5) fail(`colormap ${e.rgb} -> ${v} expected ${e.value * 255}`);
  }
}
cmapErrors === 0
  ? ok('colormap decodes every documented ramp color to its value')
  : fail(`${cmapErrors} colormap mismatches`);

function decodeMask(img) {
  const { width, height, data } = img;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const srcA = data[i + 3];
    if (srcA === 0) continue; // no-data stays transparent
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let v = exactValues.get((r << 16) | (g << 8) | b);
    if (v === undefined) {
      v = lut[(r >> 2) * LUT_DIM * LUT_DIM + (g >> 2) * LUT_DIM + (b >> 2)];
    }
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = v;
  }
  return { width, height, data: out };
}

function dateStr(back) {
  const d = new Date(Date.now() - back * 86400000);
  return d.toISOString().slice(0, 10);
}

function seamStats(img) {
  // The seam spans col W-1 -> col 0 (lon ±180, the same meridian, but ~1px
  // apart in the raster), so compare it against the adjacent-column baseline:
  // continuity holds when the seam delta is on par with any neighboring pair.
  const { width, height, data } = img;
  let seam = 0;
  let adj = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    const a = data[(y * width) * 4 + 3];
    const b = data[(y * width + width - 1) * 4 + 3];
    const c = data[(y * width + 1) * 4 + 3];
    seam += Math.abs(a - b);
    adj += Math.abs(a - c);
    n++;
  }
  return { seam: seam / n / 255, adj: adj / n / 255 };
}

// ---------------------------------------------------------------------------
// Main: date walk -> full fetch -> decode -> assertions
// ---------------------------------------------------------------------------

console.log('Earth Command cloud-pipeline verification (live GIBS)\n');

let best = null;
for (const src of SOURCES) {
  for (let back = 0; back <= MAX_BACKTRACK_DAYS && !best; back++) {
    const date = dateStr(back);
    try {
      const [pDay, pNight] = await Promise.all([
        fetchPng(src.day, date, PROBE_W, PROBE_H),
        fetchPng(src.night, date, PROBE_W, PROBE_H),
      ]);
      const pd = opaqueFraction(pDay);
      const pn = opaqueFraction(pNight);
      if (pd <= 0.02 || pn <= 0.02) {
        console.log(`  probe ${src.id} ${date}: no data (day ${pd.toFixed(3)}, night ${pn.toFixed(3)}) — backtrack`);
        continue;
      }
      const [day, night] = await Promise.all([
        fetchPng(src.day, date, W, H),
        fetchPng(src.night, date, W, H),
      ]);
      best = { src, date, day, night };
      break;
    } catch (err) {
      console.log(`  probe ${src.id} ${date}: ${err.message} — backtrack`);
    }
  }
  if (best) break;
}

if (!best) {
  fail('no source/date with usable data in the backtrack window');
  process.exit(1);
}

const { src, date, day, night } = best;
console.log(`source: ${src.id}, date: ${date}\n`);

if (day.width !== W || day.height !== H || night.width !== W || night.height !== H) {
  fail(`unexpected raster size ${day.width}x${day.height}`);
} else {
  ok('raster is 2048x1024 (2:1 equirectangular, matches the day texture UV layout)');
}

const dayFrac = opaqueFraction(day);
const nightFrac = opaqueFraction(night);
console.log(`  day opaque fraction: ${dayFrac.toFixed(3)} (typical ~0.86)`);
console.log(`  night opaque fraction: ${nightFrac.toFixed(3)} (typical ~0.94)`);
dayFrac >= DAY_MIN_OPAQUE ? ok('day coverage gate passed (>= 0.45)') : fail('day coverage below gate — incomplete dataset');
nightFrac >= NIGHT_MIN_OPAQUE ? ok('night coverage gate passed (>= 0.55)') : fail('night coverage below gate');

// REGRESSION GUARD: no opaque black anywhere in the source rasters.
for (const [label, img] of [['day', day], ['night', night]]) {
  let black = 0;
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && data[i] < 8 && data[i + 1] < 8 && data[i + 2] < 8) black++;
  }
  black === 0
    ? ok(`no opaque-black pixels in ${label} source (swath-gap regression guard)`)
    : fail(`${black} opaque-black pixels in ${label} source`);
}

const dayMask = decodeMask(day);
const nightMask = decodeMask(night);

// Decoded no-data must be exactly transparent.
for (const [label, srcImg, mask] of [['day', day, dayMask], ['night', night, nightMask]]) {
  let leaked = 0;
  for (let i = 3; i < srcImg.data.length; i += 4) {
    if (srcImg.data[i] === 0 && mask.data[i] !== 0) leaked++;
  }
  leaked === 0
    ? ok(`no-data pixels stay fully transparent after decode (${label})`)
    : fail(`${leaked} no-data pixels leaked opacity (${label})`);
}

const seamDay = seamStats(dayMask);
const seamNight = seamStats(nightMask);
console.log(`  dateline seam |delta|: day ${seamDay.seam.toFixed(3)} (adjacent-col baseline ${seamDay.adj.toFixed(3)}), night ${seamNight.seam.toFixed(3)} (baseline ${seamNight.adj.toFixed(3)})`);
seamDay.seam < seamDay.adj + 0.05 && seamNight.seam < seamNight.adj + 0.05
  ? ok('dateline seam continuous (lon ±180 map to the same meridian)')
  : fail('dateline seam discontinuity — UV mapping suspect');

// Geography sanity (informational — clouds move, so these are soft checks):
const pxAt = (img, lat, lon) => {
  const x = Math.round(((lon + 180) / 360) * img.width);
  const y = Math.round(((90 - lat) / 180) * img.height);
  const i = (y * img.width + x) * 4;
  return img.data[i + 3] / 255;
};
console.log(`  Atacama day cloud opacity: ${pxAt(dayMask, -24, -70).toFixed(2)} (expect < 0.5, world's clearest desert)`);
console.log(`  Amazon day cloud opacity: ${pxAt(dayMask, -5, -60).toFixed(2)} (expect > 0.3, usually cloudy)`);
console.log(`  Antarctic day cloud opacity: ${pxAt(dayMask, -78, 90).toFixed(2)} (expect ~0, polar night = no data)`);

console.log(`\n${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
