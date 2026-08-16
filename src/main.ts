import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  CAMERA_FAR,
  CAMERA_NEAR,
  PROPAGATE_INTERVAL_MS,
  SAT_GROUPS,
  type DomainType,
  type FlightCategory,
  type HotspotPreset,
  type MarineCategory,
  type SatGroupId,
  type SelectedTarget,
} from './config';
import {
  createDomainLayers,
  type DomainAdapter,
  type SearchResult,
} from './domains/registry';
import { FlightEngine } from './flight/engine';
import { AircraftScene } from './flight/aircraftScene';
import { MarineEngine } from './marine/engine';
import { MarineScene } from './marine/marineScene';
import { EarthquakeSystem } from './geo/earthquakes';
import { SubmarineCablesScene } from './infra/cablesScene';
import { NuclearScene } from './infra/nuclearScene';
import { DsnScene } from './space/dsnScene';
import { AuroraScene } from './space/auroraScene';
import { AsteroidsScene } from './space/asteroidsScene';
import { LaunchesScene } from './space/launchesScene';
import { WildfiresScene } from './geo/wildfiresScene';
import { VolcanoesScene } from './geo/volcanoesScene';
import { CyclonesScene } from './geo/cyclonesScene';
import { GpsJamScene } from './tactical/gpsJamScene';
import { propagateCatalog } from './orbit/propagator';
import { createEarth, createStarfield } from './scene/earth';
import { TacticalGrids } from './scene/grids';
import { SelectionOverlays } from './scene/overlays';
import { SatelliteCloud } from './scene/satellites';
import { TargetLockController } from './scene/targetLock';
import type { PickHit } from './domains/pick';
import { fetchLiveCyclones, setLiveCyclones } from './geo/cyclones';
import { loadCableData } from './infra/cables';
import {
  applyUpcomingLaunches,
  fetchUpcomingLaunches,
  formatTMinus,
} from './space/launches';
import { gScaleForKp, kpToAuroraBrightness, refreshSpaceWeather } from './space/spaceWeather';
import { loadCatalog } from './tle/catalog';
import { CommandCenterUI, type FeedStatus, type OverlayType } from './ui/commandCenter';

// ---------------------------------------------------------------------------
// Canvas & Scene Setup
// ---------------------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const reticleEl = document.querySelector<HTMLElement>('#target-reticle')!;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020408, 0.01);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  CAMERA_NEAR,
  CAMERA_FAR,
);
camera.position.set(0, 1.4, 3.8);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.2;
controls.maxDistance = 24;
controls.enablePan = false;
controls.rotateSpeed = 0.65;
controls.zoomSpeed = 0.85;

scene.add(new THREE.AmbientLight(0x223355, 0.35));
const stars = createStarfield(8000);
scene.add(stars);

// ---------------------------------------------------------------------------
// Multi-Domain Engines & Renderers
// ---------------------------------------------------------------------------

const satCloud = new SatelliteCloud();
scene.add(satCloud.points);

const satOverlays = new SelectionOverlays();
scene.add(satOverlays.group);

const flightEngine = new FlightEngine();
const flightScene = new AircraftScene();
flightScene.setAircraft(flightEngine.list);
scene.add(flightScene.points);

const marineEngine = new MarineEngine();
const marineScene = new MarineScene();
marineScene.setVessels(marineEngine.list);
scene.add(marineScene.points);

const earthquakeSystem = new EarthquakeSystem();
scene.add(earthquakeSystem.points);

const tacticalGrids = new TacticalGrids();
scene.add(tacticalGrids.group);

const cablesScene = new SubmarineCablesScene();
scene.add(cablesScene.group);
cablesScene.setVisible(true);

const nuclearScene = new NuclearScene();
scene.add(nuclearScene.points);
nuclearScene.setVisible(true);

const dsnScene = new DsnScene();
scene.add(dsnScene.group);
dsnScene.setVisible(true);

const auroraScene = new AuroraScene();
scene.add(auroraScene.group);
auroraScene.setVisible(true);

const asteroidsScene = new AsteroidsScene();
scene.add(asteroidsScene.group);
asteroidsScene.setVisible(true);

const launchesScene = new LaunchesScene();
scene.add(launchesScene.group);
launchesScene.setVisible(true);

const wildfiresScene = new WildfiresScene();
scene.add(wildfiresScene.points);
wildfiresScene.setVisible(true);

const volcanoesScene = new VolcanoesScene();
scene.add(volcanoesScene.points);
volcanoesScene.setVisible(true);

const cyclonesScene = new CyclonesScene();
scene.add(cyclonesScene.points);
cyclonesScene.setVisible(true);

const gpsJamScene = new GpsJamScene();
scene.add(gpsJamScene.points);
gpsJamScene.setVisible(true);

// ---------------------------------------------------------------------------
// Domain Registry — selection, picking, search, toggles, animation ticks
// ---------------------------------------------------------------------------

const layers = createDomainLayers({
  satCloud,
  satOverlays,
  flightEngine,
  flightScene,
  marineEngine,
  marineScene,
  earthquakeSystem,
  cablesScene,
  nuclearScene,
  dsnScene,
  auroraScene,
  asteroidsScene,
  launchesScene,
  wildfiresScene,
  volcanoesScene,
  cyclonesScene,
  gpsJamScene,
});
const layerById = new Map(layers.map((l) => [l.id, l]));

/** Overlay panel toggles that map 1:1 onto a registered domain layer. */
const OVERLAY_DOMAIN: Partial<Record<OverlayType, DomainType>> = {
  quakes: 'earthquake',
  volcanoes: 'volcano',
  wildfires: 'wildfire',
  cyclones: 'cyclone',
  dsn: 'dsn',
  asteroids: 'asteroid',
  launches: 'launch',
  gpsjam: 'gpsjam',
  cables: 'cable',
  nuclear: 'nuclear',
};

// ---------------------------------------------------------------------------
// Simulation State
// ---------------------------------------------------------------------------

let simTimeMs = Date.now();
let timeScale = 1;
let paused = false;
let autoRotate = false;
let lastFrameWall = performance.now();
let lastPropagateSimMs = 0;
let lastFlightPollMs = 0;
let lastQuakePollMs = 0;
let lastSunUpdateMs = Number.NEGATIVE_INFINITY;
let earthSystem: Awaited<ReturnType<typeof createEarth>> | null = null;

// Feed-status tracking for honest ticker/status reporting
let lastFlightMode: 'live' | 'sim' | null = null;
let lastQuakeMaxMs = 0;

// Multi-domain selection state: active index per domain (-1 = none)
let currentSelectedTarget: SelectedTarget | null = null;
const selectedIndexByDomain = new Map<DomainType, number>(
  layers.map((l) => [l.id, -1]),
);

// Active satellite group filters
const activeSatGroups = new Set<SatGroupId>(
  SAT_GROUPS.filter((g) => g.defaultOn).map((g) => g.id),
);

// Raycaster & pointer
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragMoved = false;
let pointerDownPos = { x: 0, y: 0 };

/** Max cursor distance (CSS px) for a click to count as a hit. */
const PICK_RADIUS_PX = 10;
/**
 * Tolerance (scene units) for surface entities sitting exactly on the globe
 * when testing occlusion: a target is behind the Earth when its along-ray
 * distance exceeds the globe hit by more than this.
 */
const PICK_OCCLUSION_EPS = 1e-3;

// FPS
let fpsFrames = 0;
let fpsLast = performance.now();

// ---------------------------------------------------------------------------
// Solar Vector Calculation (NOAA Equations)
// ---------------------------------------------------------------------------

function sunDirectionForDate(date: Date): THREE.Vector3 {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - yearStart) / 86400000) + 1;
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);

  const equationOfTimeMinutes =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const utcMinutes = utcHours * 60;
  const longitude = THREE.MathUtils.degToRad(
    (720 - utcMinutes - equationOfTimeMinutes) / 4,
  );
  const cosDeclination = Math.cos(declination);

  return new THREE.Vector3(
    cosDeclination * Math.cos(longitude),
    Math.sin(declination),
    -cosDeclination * Math.sin(longitude),
  ).normalize();
}

// ---------------------------------------------------------------------------
// Multi-Domain Selection (registry-driven)
// ---------------------------------------------------------------------------

function clearSelection(): void {
  for (const layer of layers) selectedIndexByDomain.set(layer.id, -1);
  currentSelectedTarget = null;

  satOverlays.clear();
  targetLock.setTarget(null);
  commandUI.showTarget(null);
}

function selectVia(layer: DomainAdapter, index: number, flyTo = false): void {
  if (index < 0 || index >= layer.count()) {
    clearSelection();
    return;
  }
  clearSelection();
  selectedIndexByDomain.set(layer.id, index);
  layer.highlight(index);

  const simDate = new Date(simTimeMs);
  const target = layer.buildTarget(index, simDate);
  if (!target) {
    clearSelection();
    return;
  }

  currentSelectedTarget = target;
  commandUI.showTarget(target);
  targetLock.setTarget(
    {
      x: target.scenePos[0],
      y: target.scenePos[1],
      z: target.scenePos[2],
      label: target.name,
      speedKmh: target.speedKmh,
      altKm: target.altKm,
    },
    flyTo,
  );
  layer.afterSelect?.(index, target, simDate);
}

// ---------------------------------------------------------------------------
// Unified Pointer Raycasting Across All Domains
// ---------------------------------------------------------------------------

function onPointerDown(e: MouseEvent): void {
  dragMoved = false;
  pointerDownPos = { x: e.clientX, y: e.clientY };
}

function onPointerMove(e: MouseEvent): void {
  if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 5) {
    dragMoved = true;
  }
}

function onPointerUp(e: MouseEvent): void {
  if (dragMoved || e.button !== 0) return;

  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  // The globe is solid: anything behind its near side is not selectable.
  let tEarth = Infinity;
  if (earthSystem) {
    const earthHits = raycaster.intersectObject(earthSystem.earth, false);
    if (earthHits.length > 0) tEarth = earthHits[0].distance;
  }

  // Click radius in squared-NDC terms (NDC spans the canvas height).
  const ndcRadius = PICK_RADIUS_PX / (rect.height / 2);
  const maxDist2 = ndcRadius * ndcRadius;

  // Collect the best candidate from every layer, then pick the global
  // winner — the dot visually nearest the cursor, not the first layer
  // that happens to have any hit.
  let best: { layer: DomainAdapter; hit: PickHit } | null = null;
  for (const layer of layers) {
    const hit = layer.pick(raycaster, camera, pointer);
    if (!hit || hit.dist2 > maxDist2) continue;
    if (hit.rayDist > tEarth + PICK_OCCLUSION_EPS) continue;
    if (!best || hit.dist2 < best.hit.dist2) {
      best = { layer, hit };
    }
  }

  if (best) {
    selectVia(best.layer, best.hit.index);
  } else {
    clearSelection();
  }
}

canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('mousemove', onPointerMove);
canvas.addEventListener('mouseup', onPointerUp);

// ---------------------------------------------------------------------------
// Command Center UI Wiring
// ---------------------------------------------------------------------------

const commandUI = new CommandCenterUI({
  onSatelliteGroupToggle(id: SatGroupId, checked: boolean) {
    if (checked) activeSatGroups.add(id);
    else activeSatGroups.delete(id);
    loadSatellites();
  },
  onFlightCategoryToggle(cat: FlightCategory, checked: boolean) {
    flightScene.setCategoryVisible(cat, checked);
  },
  onMarineCategoryToggle(cat: MarineCategory, checked: boolean) {
    marineScene.setCategoryVisible(cat, checked);
  },
  onQuakeMagChange(minMag: number) {
    earthquakeSystem.setMinMag(minMag);
  },
  onOverlayToggle(overlay: OverlayType, checked: boolean) {
    if (overlay === 'daylight' && earthSystem) {
      earthSystem.setFullDaylight(checked);
    } else if (overlay === 'clouds' && earthSystem?.clouds) {
      earthSystem.clouds.setVisible(checked);
    } else if (overlay === 'grid') {
      tacticalGrids.setGridVisible(checked);
    } else if (overlay === 'terminator') {
      tacticalGrids.setTerminatorVisible(checked);
    } else if (overlay === 'orbits') {
      satOverlays.setShowOrbit(checked);
      const satIdx = selectedIndexByDomain.get('satellite') ?? -1;
      if (checked && satIdx >= 0) {
        satOverlays.updateOrbit(satCloud.catalog[satIdx], new Date(simTimeMs));
      }
    } else if (overlay === 'footprints') {
      satOverlays.setShowFootprint(checked);
    } else if (overlay === 'aurora') {
      auroraScene.setVisible(checked);
    } else {
      const domain = OVERLAY_DOMAIN[overlay];
      if (domain) layerById.get(domain)?.setVisible(checked);
    }
  },
  onHotspotSelect(hotspot: HotspotPreset) {
    targetLock.flyToCoord(hotspot.lat, hotspot.lon, hotspot.altitudeUnits, 1.4);
  },
  onTargetSearchSelect({ domain, index }) {
    const layer = layerById.get(domain);
    if (layer) selectVia(layer, index, true);
  },
  onChaseCamToggle(active: boolean) {
    targetLock.setChaseCam(active);
  },
  onFocusTarget() {
    if (currentSelectedTarget) {
      targetLock.flyToTarget(
        {
          x: currentSelectedTarget.scenePos[0],
          y: currentSelectedTarget.scenePos[1],
          z: currentSelectedTarget.scenePos[2],
        },
        1.0,
      );
    }
  },
  onTimeSpeedChange(speed: number) {
    timeScale = speed;
  },
  onTimeNow() {
    simTimeMs = Date.now();
  },
  onTimePause() {
    paused = !paused;
    return paused;
  },
  onReloadSatellites() {
    loadSatellites();
  },
});

// ---------------------------------------------------------------------------
// DATA FEEDS status registry — drives the bottom status chips
// ---------------------------------------------------------------------------

const feedStatuses = new Map<
  string,
  { label: string; status: FeedStatus; detail: string }
>();

function setFeed(id: string, label: string, status: FeedStatus, detail: string): void {
  const prev = feedStatuses.get(id);
  feedStatuses.set(id, { label, status, detail });
  if (!prev || prev.status !== status || prev.detail !== detail) {
    commandUI.setFeedStatus(
      [...feedStatuses.entries()].map(([k, v]) => ({ id: k, ...v })),
    );
  }
}

// Static/curated sources are honest from the start
setFeed('marine', 'Marine', 'static', 'curated fleet + simulated movement');
setFeed('geo', 'Geo', 'static', 'curated: volcanoes, wildfires, DSN, asteroids, nuclear, GPS jam');
setFeed('cables', 'Cables', 'off', 'dataset loading…');
setFeed('sats', 'Sats', 'off', 'connecting…');
setFeed('quakes', 'Quakes', 'off', 'connecting…');
setFeed('flights', 'Flights', 'off', 'connecting…');
setFeed('cyclones', 'Cyclones', 'off', 'connecting…');
setFeed('spacewx', 'SpaceWx', 'off', 'connecting…');
setFeed('launches', 'Launches', 'off', 'connecting…');

// Target lock & chase cam controller (after UI so the disengage callback is safe)
const targetLock = new TargetLockController(reticleEl, camera, controls, canvas, () => {
  commandUI?.setChaseButtonState(false);
});

// Auto-rotate toggle
document.querySelector<HTMLInputElement>('#toggle-auto-rotate')?.addEventListener('change', (e) => {
  autoRotate = (e.target as HTMLInputElement).checked;
});

// ---------------------------------------------------------------------------
// Global Search Event Ingestion Across All Domains
// ---------------------------------------------------------------------------

window.addEventListener('commandcenter:search', (e: Event) => {
  const query = ((e as CustomEvent).detail?.query || '').toLowerCase().trim();
  if (!query) return;

  const results: SearchResult[] = [];
  const push = (r: SearchResult) => {
    if (results.length < 20) results.push(r);
  };

  for (const layer of layers) {
    layer.search(query, push);
  }

  commandUI.renderSearchResults(results);
});

// ---------------------------------------------------------------------------
// Data Ingestion & Periodic Loaders
// ---------------------------------------------------------------------------

async function loadSatellites(): Promise<void> {
  const statusEl = document.querySelector<HTMLElement>('#sat-load-status');
  if (statusEl) statusEl.textContent = 'Syncing orbital elements from CelesTrak…';

  try {
    const catalog = await loadCatalog(Array.from(activeSatGroups), (msg: string) => {
      if (statusEl) statusEl.textContent = msg;
    });
    satCloud.setCatalog(catalog);
    if (statusEl) statusEl.textContent = `Catalog Loaded: ${satCloud.count.toLocaleString()} Active Satellites`;
    setFeed('sats', 'Sats', 'live', `CelesTrak · ${satCloud.count.toLocaleString()} TLEs · 6h sync`);
    commandUI.pushEvent(`[CelesTrak] ${satCloud.count.toLocaleString()} satellite elements loaded (${Array.from(activeSatGroups).join(', ')})`);
  } catch (err) {
    console.warn('CelesTrak fetch error:', err);
    if (statusEl) statusEl.textContent = `Sync Offline — Fallback Active (${satCloud.count} sats)`;
    setFeed('sats', 'Sats', 'off', 'CelesTrak unreachable — cached elements only');
  }
}

async function pollFlights(): Promise<void> {
  try {
    await flightEngine.fetchLiveStates();
    flightScene.setAircraft(flightEngine.list);
  } catch {
    // handled in engine
  }
  const mode: FeedStatus = flightEngine.isLive ? 'live' : 'sim';
  if (mode !== lastFlightMode) {
    lastFlightMode = mode;
    commandUI.pushEvent(
      mode === 'live'
        ? `[OpenSky] ADS-B live — ${flightEngine.count.toLocaleString()} aircraft (${flightEngine.feedSource})`
        : '[SIM] OpenSky unreachable — scheduled fleet active',
    );
  }
  setFeed(
    'flights',
    'Flights',
    mode,
    mode === 'live'
      ? `OpenSky ADS-B · ${flightEngine.count.toLocaleString()} ac · ${flightEngine.feedSource} · 20 min`
      : 'Simulated fleet (OpenSky unreachable)',
  );
}

async function pollQuakes(): Promise<void> {
  try {
    await earthquakeSystem.fetchQuakes();
    const list = earthquakeSystem.list;
    setFeed('quakes', 'Quakes', 'live', `USGS · ${list.length} events · 60s poll`);
    let maxTime = 0;
    for (const q of list) if (q.timeMs > maxTime) maxTime = q.timeMs;
    if (lastQuakeMaxMs > 0) {
      const fresh = list
        .filter((q) => q.timeMs > lastQuakeMaxMs && q.mag >= 5.0)
        .sort((a, b) => b.mag - a.mag);
      const top = fresh[0];
      if (top) {
        commandUI.pushEvent(`[USGS] M${top.mag.toFixed(1)} earthquake — ${top.place}`);
      }
    }
    lastQuakeMaxMs = Math.max(lastQuakeMaxMs, maxTime);
  } catch {
    setFeed('quakes', 'Quakes', 'off', 'USGS unreachable');
  }
}

// ---------------------------------------------------------------------------
// Live Feeds: Space Weather, Cyclones, Launches
// ---------------------------------------------------------------------------

async function pollSpaceWeather(): Promise<void> {
  const kp = await refreshSpaceWeather();
  const valEl = document.querySelector<HTMLElement>('#space-weather-val');
  if (kp !== null && valEl) {
    valEl.textContent = `Kp ${kp.toFixed(1)} (${gScaleForKp(kp).split(' ')[0]})`;
  }
  if (kp !== null) {
    setFeed('spacewx', 'SpaceWx', 'live', `SWPC · Kp ${kp.toFixed(1)} · 15 min`);
  } else {
    setFeed('spacewx', 'SpaceWx', 'off', 'SWPC unreachable');
  }
  if (kp !== null && auroraScene) {
    auroraScene.setBrightness(kpToAuroraBrightness(kp));
    if (kp >= 5) {
      commandUI.pushEvent(`[SWPC] Geomagnetic storm in progress — Kp ${kp.toFixed(1)} (${gScaleForKp(kp)})`);
    }
  }
}

let lastCycloneCount = 0;
async function pollCyclones(): Promise<void> {
  try {
    const records = await fetchLiveCyclones();
    setLiveCyclones(records);
    cyclonesScene.setStorms(records);
    setFeed('cyclones', 'Cyclones', 'live', `NHC · ${records.length} storms · 30 min`);
    if (records.length !== lastCycloneCount) {
      lastCycloneCount = records.length;
      const summary = records
        .map((s) => `${s.name} (${s.maxWindsKts} kts)`)
        .join(', ');
      commandUI.pushEvent(
        `[NHC] ${records.length} active tropical cyclone${records.length > 1 ? 's' : ''} — ${summary}`,
      );
    }
  } catch {
    setFeed('cyclones', 'Cyclones', 'static', 'NHC unreachable — curated storm list');
  }
}

let lastLaunchEventMs = 0;
async function pollLaunches(): Promise<void> {
  try {
    const launches = await fetchUpcomingLaunches();
    applyUpcomingLaunches(launches);
    setFeed('launches', 'Launches', 'live', `Launch Library 2 · ${launches.length} upcoming · 30 min`);
    const next = launches.find((l) => l.netMs > Date.now());
    if (next && next.netMs - lastLaunchEventMs > 5 * 60 * 1000) {
      lastLaunchEventMs = next.netMs;
      commandUI.pushEvent(
        `[LL2] Next launch: ${next.name} from ${next.padName} — ${formatTMinus(next.netMs)}`,
      );
    }
  } catch {
    setFeed('launches', 'Launches', 'static', 'LL2 unreachable — curated pad list');
  }
}

// ---------------------------------------------------------------------------
// Main Animation & Simulation Loop
// ---------------------------------------------------------------------------

function animate(now: number): void {
  requestAnimationFrame(animate);

  const deltaWallMs = Math.min(now - lastFrameWall, 100);
  lastFrameWall = now;
  const deltaWallSec = deltaWallMs / 1000;

  // FPS calculation
  fpsFrames++;
  if (now - fpsLast >= 1000) {
    const fpsVal = document.querySelector<HTMLElement>('#fps-stats') || document.querySelector<HTMLElement>('#fps-val');
    if (fpsVal) fpsVal.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsLast))} FPS`;
    fpsFrames = 0;
    fpsLast = now;
  }

  // Advance simulation time
  if (!paused) {
    simTimeMs += deltaWallMs * timeScale;
  }
  const simDate = new Date(simTimeMs);

  // Periodic polling
  if (now - lastFlightPollMs > 25000) {
    lastFlightPollMs = now;
    pollFlights();
  }
  if (now - lastQuakePollMs > 60000) {
    lastQuakePollMs = now;
    pollQuakes();
  }

  // Propagate Satellites
  if (now - lastPropagateSimMs > PROPAGATE_INTERVAL_MS) {
    lastPropagateSimMs = now;
    if (satCloud.count > 0) {
      propagateCatalog(satCloud.catalog, simDate, satCloud.getBuffers());
    }
  }

  // Extrapolate satellite positions between SGP4 passes
  const simDeltaSec = paused ? 0 : (deltaWallMs * timeScale) / 1000;
  satCloud.extrapolate(simDeltaSec);

  // Update Flight & Maritime Engines
  flightEngine.update(simDeltaSec);
  flightScene.updatePositions();

  marineEngine.update(simDeltaSec);
  marineScene.updatePositions();

  // Update Earth, Sun direction & Solar Terminator
  if (now - lastSunUpdateMs > 1000) {
    lastSunUpdateMs = now;
    const sunDir = sunDirectionForDate(simDate);
    earthSystem?.setSunDirection(sunDir);
    tacticalGrids.updateTerminator(sunDir);
  }

  // Auto planetary rotation drift
  if (autoRotate && !targetLock.isChaseCam) {
    const rotSpeed = 0.0003 * deltaWallSec * (timeScale || 1);
    scene.rotation.y += rotSpeed;
  } else {
    scene.rotation.y = 0;
  }

  // Update 3D Signal Layer Animations (registry-driven)
  earthSystem?.update(deltaWallSec);
  auroraScene.update(now / 1000);
  for (const layer of layers) {
    layer.update?.(now / 1000);
  }

  // Update OrbitControls & Target Tracking Reticle
  // Distance-adaptive orbit speed: slow & precise near the surface, fast far out
  controls.rotateSpeed = THREE.MathUtils.clamp(
    camera.position.length() * 0.16,
    0.16,
    0.65,
  );
  targetLock.update(deltaWallSec);
  controls.update();

  // Keep telemetry panel synchronized with moving target
  if (currentSelectedTarget) {
    const layer = layerById.get(currentSelectedTarget.domain);
    const idx = selectedIndexByDomain.get(currentSelectedTarget.domain) ?? -1;
    if (layer && idx >= 0) {
      layer.refreshSelected?.(currentSelectedTarget, idx, simDate);
    }
    commandUI.showTarget(currentSelectedTarget);
  }

  // Update HUD Clock & Counters
  commandUI.updateClock(simTimeMs);
  commandUI.updateCounters(
    satCloud.count,
    flightEngine.count,
    marineEngine.count,
    earthquakeSystem.count + volcanoesScene.list.length + wildfiresScene.list.length + cyclonesScene.list.length,
  );

  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Window Resize Handling
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// ---------------------------------------------------------------------------
// Bootstrap & Initialization
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  try {
    earthSystem = await createEarth(renderer);
    scene.add(earthSystem.group);
  } catch (err) {
    console.error('Failed to initialize Earth system:', err);
  }

  // Start rendering immediately
  requestAnimationFrame(animate);

  // Submarine cable dataset (TeleGeography full map, same-origin snapshot)
  loadCableData()
    .then((ds) => {
      cablesScene.setData(ds.cables, ds.stations);
      setFeed(
        'cables',
        'Cables',
        'static',
        `TeleGeography · ${ds.cables.length} systems · ${ds.stations.length} stations · weekly sync`,
      );
      commandUI.pushEvent(
        `[TeleGeography] ${ds.cables.length} cable systems / ${ds.stations.length} landing stations loaded`,
      );
    })
    .catch(() => setFeed('cables', 'Cables', 'off', 'dataset unavailable'));

  // Background async loaders
  loadSatellites().catch((e) => console.warn('Satellite loader warning:', e));
  pollFlights().catch((e) => console.warn('Flight poller warning:', e));
  pollQuakes().catch((e) => console.warn('Quake poller warning:', e));

  // Live feeds (once at boot, then on 15-30 min cadence)
  pollSpaceWeather().catch(() => {});
  pollCyclones().catch(() => {});
  pollLaunches().catch(() => {});
  setInterval(() => pollSpaceWeather().catch(() => {}), 15 * 60 * 1000);
  setInterval(() => pollCyclones().catch(() => {}), 30 * 60 * 1000);
  setInterval(() => pollLaunches().catch(() => {}), 30 * 60 * 1000);
}

init();
