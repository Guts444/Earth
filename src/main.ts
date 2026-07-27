import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  CAMERA_FAR,
  CAMERA_NEAR,
  GROUP_BY_ID,
  PROPAGATE_INTERVAL_MS,
  SAT_GROUPS,
  type SatGroupId,
} from './config';
import { createEarth, createStarfield } from './scene/earth';
import { SatelliteCloud } from './scene/satellites';
import { SelectionOverlays } from './scene/overlays';
import { loadCatalog, type CatalogSatellite } from './tle/catalog';
import { propagateCatalog, propagateSatellite } from './orbit/propagator';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const groupListEl = document.querySelector<HTMLDivElement>('#group-list')!;
const reloadBtn = document.querySelector<HTMLButtonElement>('#reload-btn')!;
const loadStatus = document.querySelector<HTMLParagraphElement>('#load-status')!;
const sizeSlider = document.querySelector<HTMLInputElement>('#size-slider')!;
const toggleOrbits = document.querySelector<HTMLInputElement>('#toggle-orbits')!;
const toggleFootprint = document.querySelector<HTMLInputElement>('#toggle-footprint')!;
const toggleEarthRotate = document.querySelector<HTMLInputElement>('#toggle-earth-rotate')!;
const toggleLabels = document.querySelector<HTMLInputElement>('#toggle-labels')!;
const speedSlider = document.querySelector<HTMLInputElement>('#speed-slider')!;
const speedLabel = document.querySelector<HTMLSpanElement>('#speed-label')!;
const nowBtn = document.querySelector<HTMLButtonElement>('#now-btn')!;
const pauseBtn = document.querySelector<HTMLButtonElement>('#pause-btn')!;
const simTimeEl = document.querySelector<HTMLParagraphElement>('#sim-time')!;
const selectionEmpty = document.querySelector<HTMLParagraphElement>('#selection-empty')!;
const selectionBody = document.querySelector<HTMLDivElement>('#selection-body')!;
const selName = document.querySelector<HTMLParagraphElement>('#sel-name')!;
const selId = document.querySelector<HTMLElement>('#sel-id')!;
const selGroup = document.querySelector<HTMLElement>('#sel-group')!;
const selLat = document.querySelector<HTMLElement>('#sel-lat')!;
const selLon = document.querySelector<HTMLElement>('#sel-lon')!;
const selAlt = document.querySelector<HTMLElement>('#sel-alt')!;
const selVel = document.querySelector<HTMLElement>('#sel-vel')!;
const statsEl = document.querySelector<HTMLSpanElement>('#stats')!;
const tooltip = document.querySelector<HTMLDivElement>('#tooltip')!;
const loadingEl = document.querySelector<HTMLDivElement>('#loading')!;

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02040a);
scene.fog = new THREE.FogExp2(0x02040a, 0.012);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  CAMERA_NEAR,
  CAMERA_FAR,
);
camera.position.set(0, 1.2, 3.6);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.25;
controls.maxDistance = 18;
controls.enablePan = false;
controls.rotateSpeed = 0.65;
controls.zoomSpeed = 0.9;

scene.add(new THREE.AmbientLight(0x223355, 0.35));
const stars = createStarfield(7000);
scene.add(stars);

const cloud = new SatelliteCloud();
scene.add(cloud.points);

const overlays = new SelectionOverlays();
scene.add(overlays.group);

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------

let simTimeMs = Date.now();
let timeScale = 1;
let paused = false;
let lastFrameWall = performance.now();
let lastPropagateSimMs = 0;
let selectedIndex = -1;
let fpsFrames = 0;
let fpsLast = performance.now();
let fps = 0;
let orbitRefreshAccum = 0;
let earthSystem: Awaited<ReturnType<typeof createEarth>> | null = null;
let lastSunUpdateMs = Number.NEGATIVE_INFINITY;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// ---------------------------------------------------------------------------
// Group UI
// ---------------------------------------------------------------------------

const groupChecks = new Map<SatGroupId, HTMLInputElement>();

function buildGroupList(): void {
  groupListEl.innerHTML = '';
  for (const g of SAT_GROUPS) {
    const label = document.createElement('label');
    label.className = 'group-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = g.defaultOn;
    groupChecks.set(g.id, input);

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.color = g.color;
    swatch.style.background = g.color;

    const name = document.createElement('span');
    name.textContent = g.label;

    const count = document.createElement('span');
    count.className = 'group-count';
    count.dataset.group = g.id;
    count.textContent = '—';

    label.append(input, swatch, name, count);
    groupListEl.append(label);
  }
}

function selectedGroups(): SatGroupId[] {
  const ids: SatGroupId[] = [];
  for (const [id, input] of groupChecks) {
    if (input.checked) ids.push(id);
  }
  return ids;
}

function updateGroupCounts(sats: CatalogSatellite[]): void {
  const counts = new Map<string, number>();
  for (const s of sats) {
    counts.set(s.groupId, (counts.get(s.groupId) ?? 0) + 1);
  }
  groupListEl.querySelectorAll<HTMLElement>('.group-count').forEach((el) => {
    const id = el.dataset.group!;
    const n = counts.get(id);
    el.textContent = n != null ? String(n) : '—';
  });
}

// ---------------------------------------------------------------------------
// Catalog load
// ---------------------------------------------------------------------------

async function reloadCatalog(): Promise<void> {
  const groups = selectedGroups();
  if (groups.length === 0) {
    loadStatus.textContent = 'Select at least one group.';
    loadStatus.className = 'status error';
    return;
  }

  reloadBtn.disabled = true;
  loadStatus.textContent = 'Loading…';
  loadStatus.className = 'status';
  loadingEl.classList.remove('fade', 'hidden');

  try {
    const sats = await loadCatalog(groups, (msg) => {
      loadStatus.textContent = msg;
      const p = loadingEl.querySelector('p');
      if (p) p.textContent = msg;
    });

    cloud.setCatalog(sats);
    updateGroupCounts(sats);
    selectedIndex = -1;
    overlays.clear();
    selectionEmpty.classList.remove('hidden');
    selectionBody.classList.add('hidden');

    // Dense catalogs (e.g. full Starlink) need smaller points so Earth stays visible
    const autoSize =
      sats.length > 8000 ? 0.3 : sats.length > 4000 ? 0.35 : sats.length > 1500 ? 0.4 : 0.45;
    sizeSlider.value = String(autoSize);
    cloud.setSizeScale(autoSize);

    // Immediate full propagate
    lastPropagateSimMs = simTimeMs;
    propagateCatalog(sats, new Date(simTimeMs), cloud.getBuffers());
    cloud.extrapolate(0);

    loadStatus.textContent = `Loaded ${sats.length.toLocaleString()} satellites.`;
    loadStatus.className = 'status ok';
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    loadStatus.textContent = `Load failed: ${msg}. Is the Vite proxy running?`;
    loadStatus.className = 'status error';
  } finally {
    reloadBtn.disabled = false;
    loadingEl.classList.add('fade');
    window.setTimeout(() => loadingEl.classList.add('hidden'), 400);
  }
}

// ---------------------------------------------------------------------------
// Selection / picking
// ---------------------------------------------------------------------------

function setSelection(index: number): void {
  selectedIndex = index;
  if (index < 0 || index >= cloud.count) {
    overlays.clear();
    selectionEmpty.classList.remove('hidden');
    selectionBody.classList.add('hidden');
    cloud.highlightIndex(-1);
    return;
  }

  const sat = cloud.catalog[index];
  selectionEmpty.classList.add('hidden');
  selectionBody.classList.remove('hidden');
  selName.textContent = sat.name;
  selId.textContent = sat.noradId;
  selGroup.textContent = GROUP_BY_ID[sat.groupId]?.label ?? sat.groupId;
  cloud.highlightIndex(index);

  overlays.updateOrbit(sat, new Date(simTimeMs));
  refreshSelectionDetails(true);
}

function refreshSelectionDetails(forceOrbit = false): void {
  if (selectedIndex < 0 || selectedIndex >= cloud.count) return;
  const sat = cloud.catalog[selectedIndex];
  const state = propagateSatellite(sat.satrec, new Date(simTimeMs));
  if (!state.valid) return;

  selLat.textContent = `${state.lat.toFixed(3)}°`;
  selLon.textContent = `${state.lon.toFixed(3)}°`;
  selAlt.textContent = `${state.altKm.toFixed(1)} km`;
  selVel.textContent = `${state.speedKms.toFixed(3)} km/s`;

  overlays.updateMarker(state.x, state.y, state.z);
  overlays.updateFootprint(state.lat, state.lon, state.altKm);

  if (forceOrbit) {
    overlays.updateOrbit(sat, new Date(simTimeMs));
  }
}

function onPointerMove(ev: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const idx = cloud.pick(raycaster, camera);

  if (idx >= 0) {
    const sat = cloud.catalog[idx];
    tooltip.textContent = `${sat.name}  ·  ${sat.noradId}`;
    tooltip.classList.remove('hidden');
    tooltip.style.left = `${ev.clientX}px`;
    tooltip.style.top = `${ev.clientY}px`;
    canvas.style.cursor = 'pointer';
  } else {
    tooltip.classList.add('hidden');
    canvas.style.cursor = 'grab';
  }
}

function onPointerClick(ev: PointerEvent): void {
  // Ignore drag-clicks
  if (dragMoved) return;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const idx = cloud.pick(raycaster, camera);
  setSelection(idx);
}

let dragMoved = false;
let pointerDownPos = { x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => {
  dragMoved = false;
  pointerDownPos = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', (e) => {
  if (
    Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 4
  ) {
    dragMoved = true;
  }
  onPointerMove(e);
});
canvas.addEventListener('pointerup', onPointerClick);
canvas.addEventListener('pointerleave', () => {
  tooltip.classList.add('hidden');
});

// ---------------------------------------------------------------------------
// Controls wiring
// ---------------------------------------------------------------------------

sizeSlider.addEventListener('input', () => {
  cloud.setSizeScale(parseFloat(sizeSlider.value));
});

toggleOrbits.addEventListener('change', () => {
  overlays.setShowOrbit(toggleOrbits.checked);
  if (toggleOrbits.checked && selectedIndex >= 0) {
    overlays.updateOrbit(cloud.catalog[selectedIndex], new Date(simTimeMs));
  }
});

toggleFootprint.addEventListener('change', () => {
  overlays.setShowFootprint(toggleFootprint.checked);
  refreshSelectionDetails();
});

toggleLabels.addEventListener('change', () => {
  cloud.setEmphasizeStations(toggleLabels.checked);
  if (selectedIndex >= 0) cloud.highlightIndex(selectedIndex);
});

speedSlider.addEventListener('input', () => {
  timeScale = parseFloat(speedSlider.value);
  speedLabel.textContent = timeScale === 0 ? '0×' : `${timeScale}×`;
});

nowBtn.addEventListener('click', () => {
  simTimeMs = Date.now();
  lastPropagateSimMs = simTimeMs;
  if (cloud.count > 0) {
    propagateCatalog(cloud.catalog, new Date(simTimeMs), cloud.getBuffers());
    cloud.extrapolate(0);
  }
  refreshSelectionDetails(true);
});

pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
});

reloadBtn.addEventListener('click', () => {
  void reloadCatalog();
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function onResize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  cloud.setPixelRatio(window.devicePixelRatio);
}
window.addEventListener('resize', onResize);

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------

function formatUtc(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(ms) || Number.isNaN(d.getTime())) {
    return '—';
  }
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${day} ${h}:${mi}:${s} UTC`;
}

/**
 * Approximate the subsolar point and return an Earth-fixed scene direction.
 * NOAA's fractional-year equations are comfortably accurate for a visual
 * terminator and follow the simulation clock.
 */
function sunDirectionForDate(date: Date): THREE.Vector3 {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - yearStart) / 86400000) + 1;
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);

  const equationOfTimeMinutes = 229.18 * (
    0.000075 +
    0.001868 * Math.cos(gamma) -
    0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) -
    0.040849 * Math.sin(2 * gamma)
  );
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // Longitude where local apparent solar time is noon.
  const utcMinutes = utcHours * 60;
  const longitude = THREE.MathUtils.degToRad(
    (720 - utcMinutes - equationOfTimeMinutes) / 4,
  );
  const cosDeclination = Math.cos(declination);

  // ECEF → scene mapping: X → X, Z → Y, Y → -Z.
  return new THREE.Vector3(
    cosDeclination * Math.cos(longitude),
    Math.sin(declination),
    -cosDeclination * Math.sin(longitude),
  ).normalize();
}

function animate(now: number): void {
  requestAnimationFrame(animate);

  const wallDt = Math.min((now - lastFrameWall) / 1000, 0.1);
  lastFrameWall = now;

  if (!paused) {
    simTimeMs += wallDt * 1000 * timeScale;
  }

  // Full SGP4 on adaptive interval; velocity-extrapolate between snapshots
  if (cloud.count > 0) {
    const sinceProp = simTimeMs - lastPropagateSimMs;
    // Larger catalogs: propagate less often so frames stay smooth
    const intervalMs = Math.max(
      PROPAGATE_INTERVAL_MS,
      Math.min(2000, cloud.count * 0.08),
    ) * Math.max(timeScale, 1);
    if (Math.abs(sinceProp) >= intervalMs || sinceProp < 0) {
      propagateCatalog(cloud.catalog, new Date(simTimeMs), cloud.getBuffers());
      lastPropagateSimMs = simTimeMs;
      cloud.extrapolate(0);
    } else {
      cloud.extrapolate(sinceProp / 1000);
    }
  }

  // Selection details ~4 Hz; orbit refresh slower when time is accelerating
  orbitRefreshAccum += wallDt;
  if (selectedIndex >= 0 && orbitRefreshAccum > 0.25) {
    refreshSelectionDetails(orbitRefreshAccum > 2);
    if (orbitRefreshAccum > 2) orbitRefreshAccum = 0;
    else orbitRefreshAccum = 0.01;
  }

  if (toggleEarthRotate.checked) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
  } else {
    controls.autoRotate = false;
  }

  controls.update();
  stars.rotation.y += wallDt * 0.003;

  // Follow simulated time, including accelerated and reverse playback.
  if (earthSystem && Math.abs(simTimeMs - lastSunUpdateMs) >= 1000) {
    earthSystem.setSunDirection(sunDirectionForDate(new Date(simTimeMs)));
    lastSunUpdateMs = simTimeMs;
  }

  renderer.render(scene, camera);

  // HUD
  simTimeEl.textContent = formatUtc(simTimeMs);
  fpsFrames += 1;
  if (now - fpsLast >= 500) {
    fps = Math.round((fpsFrames * 1000) / (now - fpsLast));
    fpsFrames = 0;
    fpsLast = now;
    statsEl.textContent = `${cloud.count.toLocaleString()} sats · ${fps} fps`;
  }

}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  buildGroupList();
  overlays.setShowOrbit(toggleOrbits.checked);
  overlays.setShowFootprint(toggleFootprint.checked);
  cloud.setSizeScale(parseFloat(sizeSlider.value));

  try {
    earthSystem = await createEarth(renderer);
    scene.add(earthSystem.group);
    earthSystem.setSunDirection(sunDirectionForDate(new Date(simTimeMs)));
    lastSunUpdateMs = simTimeMs;
  } catch (err) {
    console.warn('Earth textures failed, using fallback globe', err);
    const fallback = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      new THREE.MeshPhongMaterial({
        color: 0x1a4a8a,
        emissive: 0x041018,
        specular: 0x335577,
        shininess: 12,
      }),
    );
    scene.add(fallback);
    scene.add(new THREE.DirectionalLight(0xffffff, 1.2));
  }

  await reloadCatalog();
  requestAnimationFrame(animate);
}

void boot();
