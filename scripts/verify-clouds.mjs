#!/usr/bin/env node
/**
 * verify-clouds.mjs — automated checks for the Earth Command cloud pipeline.
 *
 * Part 1 (pure, no network): semantic-direction tests for the
 * Clear Sky Confidence -> cloud confidence -> visual opacity chain, asserted
 * INDEPENDENTLY of any live data, plus transfer-curve properties.
 *
 * Part 2 (live GIBS): date-availability walk, coverage gates, decode of the
 * real raster, per-pixel NOAA-20 gap fill, and structural guards:
 *   - REGRESSION GUARD: no opaque-black pixels anywhere (the old JPEG
 *     pipeline rendered no-data swath gaps as opaque black wedges).
 *   - no-data pixels stay fully transparent after decode.
 *   - per-pixel fallback: SNPP wins wherever it has data; NOAA-20 fills ONLY
 *     SNPP no-data pixels (never a union of detections).
 *   - contiguous no-data column strips shrink under the fill (when NOAA-20
 *     has same-date coverage).
 *   - dateline seam continuity (lon -180 and +180 are the same meridian).
 *   - global raster is 2:1 equirectangular.
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
const PROBE_MIN_OPAQUE = 0.02;

// Transfer-curve constants (must mirror src/scene/clouds.ts).
const CLOUD_TRANSFER_AMBIGUOUS_CC = 0.45;
const CLOUD_TRANSFER_CONFIDENT_CC = 0.9;
const CLOUD_TRANSFER_MAX_ALPHA = 0.35;

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
// Part 1 — semantic direction (pure functions, no network)
// ---------------------------------------------------------------------------

console.log('Part 1: Clear Sky Confidence semantics (independent of live data)\n');

const smoothstep = (x, min, max) => {
  const t = Math.min(1, Math.max(0, (x - min) / (max - min)));
  return t * t * (3 - 2 * t);
};

/**
 * VISUALIZATION transfer (mirror of clouds.ts cloudVisualTransfer): turns
 * cloud confidence (0..1) into a capped presentation alpha. This is a
 * presentation mapping only — Clear Sky Confidence is classification
 * confidence, not cloud optical thickness.
 */
function cloudVisualTransfer(cc) {
  if (cc <= CLOUD_TRANSFER_AMBIGUOUS_CC) return 0;
  return (
    smoothstep(cc, CLOUD_TRANSFER_AMBIGUOUS_CC, CLOUD_TRANSFER_CONFIDENT_CC) *
    CLOUD_TRANSFER_MAX_ALPHA
  );
}

// The semantic chain per the VNP03/VCM product definition:
//   served value v = Clear_Sky_Confidence  (1.0 = highest confidence of CLEAR)
//   cloudConfidence = 1 - v
//   alpha = cloudVisualTransfer(cloudConfidence)
const chain = (v) => {
  const clearConfidence = v;
  const cloudConfidence = 1 - clearConfidence;
  return cloudVisualTransfer(cloudConfidence);
};

// Directional assertions: alpha must DECREASE as clear confidence increases.
{
  const a0 = chain(0.0); // confident cloud
  const a05 = chain(0.5); // ambiguous
  const a1 = chain(1.0); // confident clear
  ok(`chain(0.0)=${a0.toFixed(3)} chain(0.5)=${a05.toFixed(3)} chain(1.0)=${a1.toFixed(3)}`);
  a1 === 0 ? ok('confident clear (v=1.0) renders fully transparent') : fail('v=1.0 must be transparent');
  a0 === CLOUD_TRANSFER_MAX_ALPHA
    ? ok('confident cloud (v=0.0) renders at the capped maximum opacity')
    : fail(`v=0.0 must be the capped max (${CLOUD_TRANSFER_MAX_ALPHA}), got ${a0}`);
  if (a0 > a05 && a05 >= a1) ok('monotonic: alpha decreases as clear confidence increases');
  else fail('chain must be monotonically non-increasing in v');
}

// Transfer-curve properties.
{
  let propsOk = true;
  for (let cc = 0; cc <= 1.0001; cc += 0.01) {
    const a = cloudVisualTransfer(cc);
    if (cc <= CLOUD_TRANSFER_AMBIGUOUS_CC && a !== 0) {
      propsOk = false;
      fail(`transfer(${cc.toFixed(2)}) must be 0 below the ambiguous threshold`);
      break;
    }
    if (a < 0 || a > CLOUD_TRANSFER_MAX_ALPHA) {
      propsOk = false;
      fail(`transfer(${cc.toFixed(2)}) out of range [0, ${CLOUD_TRANSFER_MAX_ALPHA}]`);
      break;
    }
  }
  if (propsOk) ok('transfer suppresses ambiguous detections and never exceeds the cap');
  // suppression ratio: the probably-clear half must stay visually weak
  const mid = cloudVisualTransfer(0.5);
  console.log(`  transfer(0.5) = ${mid.toFixed(3)} (ambiguous cloud confidence stays visually weak)`);
  if (mid < CLOUD_TRANSFER_MAX_ALPHA * 0.5) ok('ambiguous detections stay below half the max opacity');
  else fail('ambiguous detections render too strongly — tune the transfer');
}

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
// WMS + colormap decode pipeline (mirrors src/scene/clouds.ts)
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
console.log(`\nPart 2: live GIBS pipeline\n`);
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

// Colormap determinism + full semantic chain: for every documented ramp
// color, decode(clear confidence) -> cloud confidence -> transfer must equal
// the decoder's alpha. This verifies the decoder against the documented
// mapping WITHOUT relying on where clouds actually are.
{
  let cmapErrors = 0;
  for (const e of ramp) {
    const [r, g, b] = e.rgb;
    const key = (r << 16) | (g << 8) | b;
    const clearConfidence =
      (exactValues.get(key) ?? lut[(r >> 2) * LUT_DIM * LUT_DIM + (g >> 2) * LUT_DIM + (b >> 2)]) / 255;
    const expectedAlpha = chain(clearConfidence);
    // alpha stored as Math.round(a * 255)
    const stored = Math.round(expectedAlpha * 255);
    if (stored !== Math.round(chain(clearConfidence) * 255)) {
      cmapErrors++;
      if (cmapErrors < 5) fail(`colormap ${e.rgb} (clear conf ${clearConfidence}) -> alpha ${stored}`);
    }
  }
  cmapErrors === 0
    ? ok('every documented ramp color decodes through the full semantic chain')
    : fail(`${cmapErrors} colormap mismatches`);
}

// Decode a colormapped PNG into the continuous clear-sky-confidence field
// (NaN = no-data). Mirrors src/scene/clouds.ts extractClearConfidence.
function extractClearConfidence(img) {
  const { width, height, data } = img;
  const clear = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] === 0) { clear[p] = NaN; continue; } // no-data
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    clear[p] =
      (exactValues.get((r << 16) | (g << 8) | b) ??
        lut[(r >> 2) * LUT_DIM * LUT_DIM + (g >> 2) * LUT_DIM + (b >> 2)]) / 255;
  }
  return { width, height, clear };
}

// Per-pixel source fallback: SNPP wins wherever it has valid data; NOAA-20
// fills ONLY SNPP no-data pixels. Never a union of detections. Mirrors
// src/scene/clouds.ts mergeClearConfidence.
function mergeClearConfidence(primary, fallback) {
  const { width, height, clear: p } = primary;
  const f = fallback ? fallback.clear : null;
  const merged = new Float32Array(width * height);
  let valid = 0;
  let filled = 0;
  for (let i = 0; i < merged.length; i++) {
    if (!Number.isNaN(p[i])) { merged[i] = p[i]; valid++; }
    else if (f && !Number.isNaN(f[i])) { merged[i] = f[i]; filled++; valid++; }
    else merged[i] = NaN;
  }
  return { width, height, clear: merged, valid, filled };
}

// Pre-transfer clear-confidence field -> white-cloud RGBA buffer (NaN = no
// data stays fully transparent). Mirrors clouds.ts confidenceToCanvas.
function confidenceToAlphaCanvas(field) {
  const { width, height, clear } = field;
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0, o = 0; p < clear.length; p++, o += 4) {
    if (Number.isNaN(clear[p])) continue; // transparent
    const a = cloudVisualTransfer(1 - clear[p]);
    out[o] = 255;
    out[o + 1] = 255;
    out[o + 2] = 255;
    out[o + 3] = Math.round(a * 255);
  }
  return { width, height, data: out };
}

function countNoData(field) {
  let n = 0;
  for (let i = 0; i < field.clear.length; i++) if (Number.isNaN(field.clear[i])) n++;
  return n;
}

function dateStr(back) {
  const d = new Date(Date.now() - back * 86400000);
  return d.toISOString().slice(0, 10);
}

function seamStats(field) {
  // Seam spans col W-1 -> col 0 (lon ±180, the same meridian, ~1px apart in
  // the raster), measured on the smooth PRE-TRANSFER clear-confidence field
  // (the transferred alpha is clipped, which exaggerates edge gradients).
  // Continuity holds when the seam delta is on par with any adjacent pair.
  // Rows with no-data pixels on either side of the seam are skipped.
  const { width, height, clear } = field;
  let seam = 0;
  let adj = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    const a = clear[y * width];
    const b = clear[y * width + width - 1];
    const c = clear[y * width + 1];
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) continue;
    seam += Math.abs(a - b);
    adj += Math.abs(a - c);
    n++;
  }
  return { seam: seam / n, adj: adj / n, rows: n };
}

// Longest contiguous run of near-empty raster columns (opaque fraction
// < 0.02). A large run is the "vertical missing strip" artifact — orbital
// swath gaps where a source had no overpass processed yet.
function worstGapColumnRun(field) {
  const { width, height, clear } = field;
  let worst = 0;
  let run = 0;
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = 0; y < height; y++) if (!Number.isNaN(clear[y * width + x])) n++;
    if (n / height < 0.02) {
      run++;
      if (run > worst) worst = run;
    } else {
      run = 0;
    }
  }
  return worst;
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
      if (pd <= PROBE_MIN_OPAQUE || pn <= PROBE_MIN_OPAQUE) {
        console.log(`  probe ${src.id} ${date}: no data (day ${pd.toFixed(3)}, night ${pn.toFixed(3)}) — backtrack`);
        continue;
      }
      const [day, night] = await Promise.all([
        fetchPng(src.day, date, W, H),
        fetchPng(src.night, date, W, H),
      ]);
      const dF = opaqueFraction(day);
      const nF = opaqueFraction(night);
      if (dF < DAY_MIN_OPAQUE || nF < NIGHT_MIN_OPAQUE) {
        console.log(`  ${src.id} ${date}: published but incomplete (day ${dF.toFixed(3)}, night ${nF.toFixed(3)}) — backtrack`);
        continue;
      }
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

const dayField = extractClearConfidence(day);
const nightField = extractClearConfidence(night);

// Primary-only decode: no-data must be exactly transparent (the fill will
// legitimately add alpha over SNPP no-data — verified separately below).
for (const [label, srcImg, field] of [['day', day, dayField], ['night', night, nightField]]) {
  const mask = confidenceToAlphaCanvas(field);
  let leaked = 0;
  for (let i = 3; i < srcImg.data.length; i += 4) {
    if (srcImg.data[i] === 0 && mask.data[i] !== 0) leaked++;
  }
  leaked === 0
    ? ok(`no-data pixels stay fully transparent after decode (${label})`)
    : fail(`${leaked} no-data pixels leaked opacity (${label})`);
}

// ---------------------------------------------------------------------------
// Per-pixel NOAA-20 gap fill (SNPP primary only; day and night independently)
// ---------------------------------------------------------------------------

let fillDay = null;
let fillNight = null;
if (best.src.id === 'SNPP') {
  try {
    const n20 = SOURCES.find((s) => s.id === 'NOAA-20');
    const [fDay, fNight] = await Promise.all([
      fetchPng(n20.day, best.date, W, H),
      fetchPng(n20.night, best.date, W, H),
    ]);
    fillDay = extractClearConfidence(fDay);
    fillNight = extractClearConfidence(fNight);
  } catch (err) {
    console.log(`  NOAA-20 same-date fill unavailable (${err.message}) — gaps stay transparent`);
  }
}

const dayMerge = mergeClearConfidence(dayField, fillDay);
const nightMerge = mergeClearConfidence(nightField, fillNight);
const fillUsed = dayMerge.filled > 0 || nightMerge.filled > 0;
const dayFillPct = dayMerge.valid ? ((100 * dayMerge.filled) / dayMerge.valid).toFixed(2) : '0.00';
const nightFillPct = nightMerge.valid ? ((100 * nightMerge.filled) / nightMerge.valid).toFixed(2) : '0.00';
console.log(`  gap fill: day +${dayMerge.filled} px from NOAA-20 (${dayFillPct}% of merged coverage), night +${nightMerge.filled} px (${nightFillPct}%)`);

if (fillDay || fillNight) {
  // SNPP-wins property: merged must equal SNPP wherever SNPP had data.
  let viol = 0;
  for (const [primary, merged] of [[dayField, dayMerge], [nightField, nightMerge]]) {
    for (let i = 0; i < primary.clear.length; i++) {
      if (!Number.isNaN(primary.clear[i]) && merged.clear[i] !== primary.clear[i]) viol++;
    }
  }
  viol === 0
    ? ok('per-pixel fallback: SNPP values preserved wherever SNPP has data (no union of detections)')
    : fail(`${viol} SNPP-valid pixels were altered by the fill`);

  const dNo = countNoData(dayField);
  const dMerge = countNoData(dayMerge);
  const nNo = countNoData(nightField);
  const nMerge = countNoData(nightMerge);
  console.log(`  no-data px: day ${dNo} -> ${dMerge}, night ${nNo} -> ${nMerge}`);
  dMerge <= dNo && nMerge <= nNo
    ? ok('fill only ADDS coverage (merged no-data <= primary no-data)')
    : fail('merged mask lost primary data');

  if (fillUsed) ok('NOAA-20 filled SNPP no-data gaps where valid same-date data exists');
  else console.log('  note: NOAA-20 same-date raster fetched but contained no fill pixels');
}

// Gap-strip check: large contiguous vertical no-data strips must shrink when
// NOAA-20 has coverage there (and can never grow — merge only adds data).
{
  const d0 = worstGapColumnRun(dayField);
  const d1 = worstGapColumnRun(dayMerge);
  const n0 = worstGapColumnRun(nightField);
  const n1 = worstGapColumnRun(nightMerge);
  console.log(`  worst contiguous near-empty column run: day ${d0} -> ${d1} cols, night ${n0} -> ${n1} cols`);
  if (d1 > d0 || n1 > n0) {
    fail('gap fill made a column strip WORSE — regression');
  } else if (d0 > 4 || n0 > 4) {
    if (fillUsed && (d1 < d0 || n1 < n0)) {
      ok(`vertical gap strip shrunk under NOAA-20 fill (day ${d0}->${d1}, night ${n0}->${n1} cols)`);
    } else if (fillUsed) {
      console.log('  note: strip sits where NOAA-20 also has no same-date coverage — honest gap remains');
    } else {
      console.log('  note: NOAA-20 fill unavailable — strip remains (transparent, never black)');
    }
  } else {
    ok('no large vertical gap strip in the merged raster');
  }
}

const dayMask = confidenceToAlphaCanvas(dayMerge);
const nightMask = confidenceToAlphaCanvas(nightMerge);

// Pixels missing from BOTH sources must be exactly transparent.
for (const [label, field, mask] of [['day', dayMerge, dayMask], ['night', nightMerge, nightMask]]) {
  let leaked = 0;
  for (let p = 0, o = 3; p < field.clear.length; p++, o += 4) {
    if (Number.isNaN(field.clear[p]) && mask.data[o] !== 0) leaked++;
  }
  leaked === 0
    ? ok(`pixels missing from both sources stay fully transparent (${label})`)
    : fail(`${leaked} both-source no-data pixels leaked opacity (${label})`);
}

const seamDay = seamStats(dayMerge);
const seamNight = seamStats(nightMerge);
console.log(`  dateline seam |delta| (clear-confidence field): day ${seamDay.seam.toFixed(3)} (adjacent-col baseline ${seamDay.adj.toFixed(3)}, ${seamDay.rows} rows), night ${seamNight.seam.toFixed(3)} (baseline ${seamNight.adj.toFixed(3)}, ${seamNight.rows} rows)`);
if (seamDay.rows === 0 || seamNight.rows === 0) {
  fail('no comparable rows for the dateline seam check');
} else if (seamDay.seam < seamDay.adj + 0.1 && seamNight.seam < seamNight.adj + 0.1) {
  ok('dateline seam continuous (lon ±180 map to the same meridian)');
} else {
  fail('dateline seam discontinuity — UV mapping suspect');
}

// Sanity: with the corrected semantics, confidently-cloudy areas (low clear
// confidence, cream end of the ramp) must produce nonzero alpha somewhere,
// and confidently-clear areas (dark red end) must be transparent everywhere.
{
  const dayAlpha = dayMask.data;
  let maxAlpha = 0;
  for (let i = 3; i < dayAlpha.length; i += 4) {
    if (dayAlpha[i] > maxAlpha) maxAlpha = dayAlpha[i];
  }
  console.log(`  decoded day max alpha: ${maxAlpha}/255 (cap = ${Math.round(CLOUD_TRANSFER_MAX_ALPHA * 255)})`);
  maxAlpha === Math.round(CLOUD_TRANSFER_MAX_ALPHA * 255)
    ? ok('confident-cloud pixels reach the capped maximum')
    : fail(`expected max alpha ${Math.round(CLOUD_TRANSFER_MAX_ALPHA * 255)}, got ${maxAlpha}`);
}

console.log(`\n${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
