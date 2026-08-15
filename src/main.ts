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
import { AircraftScene } from './flight/aircraftScene';
import { FlightEngine } from './flight/engine';
import { CyclonesScene } from './geo/cyclonesScene';
import { EarthquakeSystem } from './geo/earthquakes';
import { VolcanoesScene } from './geo/volcanoesScene';
import { WildfiresScene } from './geo/wildfiresScene';
import { LANDING_STATIONS } from './infra/cables';
import { SubmarineCablesScene } from './infra/cablesScene';
import { NUCLEAR_PLANTS } from './infra/nuclear';
import { NuclearScene } from './infra/nuclearScene';
import { MarineEngine } from './marine/engine';
import { MarineScene } from './marine/marineScene';
import { propagateCatalog } from './orbit/propagator';
import { createEarth, createStarfield } from './scene/earth';
import { TacticalGrids } from './scene/grids';
import { SelectionOverlays } from './scene/overlays';
import { SatelliteCloud } from './scene/satellites';
import { TargetLockController } from './scene/targetLock';
import { AsteroidsScene } from './space/asteroidsScene';
import { AuroraScene } from './space/auroraScene';
import { DSN_COMPLEXES } from './space/dsn';
import { DsnScene } from './space/dsnScene';
import { LaunchesScene } from './space/launchesScene';
import { GpsJamScene } from './tactical/gpsJamScene';
import { GPS_JAM_ZONES } from './tactical/gpsJam';
import { loadCatalog } from './tle/catalog';
import { CommandCenterUI, type OverlayType } from './ui/commandCenter';

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

// 1. Orbital Satellites
const satCloud = new SatelliteCloud();
scene.add(satCloud.points);

const satOverlays = new SelectionOverlays();
scene.add(satOverlays.group);

// 2. Aviation (ADS-B Flights)
const flightEngine = new FlightEngine();
const flightScene = new AircraftScene();
flightScene.setAircraft(flightEngine.list);
scene.add(flightScene.points);

// 3. Maritime Traffic (AIS Ships)
const marineEngine = new MarineEngine();
const marineScene = new MarineScene();
marineScene.setVessels(marineEngine.list);
scene.add(marineScene.points);

// 4. Geosphere (USGS Earthquakes)
const earthquakeSystem = new EarthquakeSystem();
scene.add(earthquakeSystem.points);

// 5. Tactical Grids & Solar Terminator
const tacticalGrids = new TacticalGrids();
scene.add(tacticalGrids.group);

// 6. Submarine Fiber Cables & Landing Stations
const cablesScene = new SubmarineCablesScene();
scene.add(cablesScene.group);
cablesScene.setVisible(true);

// 7. Global Nuclear Power Facilities
const nuclearScene = new NuclearScene();
scene.add(nuclearScene.points);
nuclearScene.setVisible(true);

// 8. NASA Deep Space Network (DSN)
const dsnScene = new DsnScene();
scene.add(dsnScene.group);
dsnScene.setVisible(true);

// 9. NOAA Space Weather Auroral Oval
const auroraScene = new AuroraScene();
scene.add(auroraScene.group);
auroraScene.setVisible(true);

// 10. NASA JPL Near-Earth Asteroids
const asteroidsScene = new AsteroidsScene();
scene.add(asteroidsScene.group);
asteroidsScene.setVisible(true);

// 11. Rocket Launch Sites & Countdowns
const launchesScene = new LaunchesScene();
scene.add(launchesScene.group);
launchesScene.setVisible(true);

// 12. NASA FIRMS Live Wildfires
const wildfiresScene = new WildfiresScene();
scene.add(wildfiresScene.points);
wildfiresScene.setVisible(true);

// 13. Active Volcano Alert Network
const volcanoesScene = new VolcanoesScene();
scene.add(volcanoesScene.points);
volcanoesScene.setVisible(true);

// 14. Tropical Cyclones & Severe Storms
const cyclonesScene = new CyclonesScene();
scene.add(cyclonesScene.points);
cyclonesScene.setVisible(true);

// 15. GPS Jamming & EW Denial Zones
const gpsJamScene = new GpsJamScene();
scene.add(gpsJamScene.points);
gpsJamScene.setVisible(true);

// 16. Target Lock & Chase Cam Controller
const targetLock = new TargetLockController(reticleEl, camera, controls, canvas, () => {
  commandUI?.setChaseButtonState(false);
});

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

// Multi-domain selection state
let currentSelectedTarget: SelectedTarget | null = null;
let selectedSatelliteIndex = -1;
let selectedFlightIndex = -1;
let selectedMarineIndex = -1;

// Active satellite group filters
const activeSatGroups = new Set<SatGroupId>(
  SAT_GROUPS.filter((g) => g.defaultOn).map((g) => g.id),
);

// Raycaster & pointer
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragMoved = false;
let pointerDownPos = { x: 0, y: 0 };

// FPS
let fpsFrames = 0;
let fpsLast = performance.now();
const tmpPos = new THREE.Vector3();

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
// Multi-Domain Picking & Selection Logic
// ---------------------------------------------------------------------------

function clearSelection(): void {
  selectedSatelliteIndex = -1;
  selectedFlightIndex = -1;
  selectedMarineIndex = -1;
  currentSelectedTarget = null;

  satOverlays.clear();
  targetLock.setTarget(null);
  commandUI.showTarget(null);
}

function selectSatellite(index: number, flyTo = false): void {
  if (index < 0 || index >= satCloud.count) {
    clearSelection();
    return;
  }
  clearSelection();
  selectedSatelliteIndex = index;

  const meta = satCloud.catalog[index];
  satCloud.getDisplayPosition(index, tmpPos);
  const simDate = new Date(simTimeMs);

  const altKm = satCloud.altKm[index] || 500;
  const lat = satCloud.lat[index] || 0;
  const lon = satCloud.lon[index] || 0;
  const speedKmh = (satCloud.speedKms[index] || 7.5) * 3600;

  currentSelectedTarget = {
    domain: 'satellite',
    id: `NORAD ${meta.noradId}`,
    name: meta.name,
    subType: meta.groupId.toUpperCase(),
    lat,
    lon,
    altKm,
    speedKmh,
    scenePos: [tmpPos.x, tmpPos.y, tmpPos.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  satOverlays.updateOrbit(meta, simDate);
  satOverlays.updateFootprint(lat, lon, altKm);
  satOverlays.updateMarker(tmpPos.x, tmpPos.y, tmpPos.z);

  targetLock.setTarget(
    { x: tmpPos.x, y: tmpPos.y, z: tmpPos.z, label: meta.name, speedKmh, altKm },
    flyTo,
  );
}

function selectFlight(index: number, flyTo = false): void {
  if (index < 0 || index >= flightEngine.count) {
    clearSelection();
    return;
  }
  clearSelection();
  selectedFlightIndex = index;
  flightScene.highlight(index);

  const a = flightEngine.list[index];
  currentSelectedTarget = {
    domain: 'flight',
    id: `ICAO ${a.icao24.toUpperCase()}`,
    name: a.callsign || 'AIRCRAFT',
    subType: a.category.toUpperCase(),
    lat: a.lat,
    lon: a.lon,
    altKm: a.altKm,
    speedKmh: a.speedKmh,
    heading: a.headingDeg,
    origin: a.origin,
    destination: a.destination,
    country: a.country,
    scenePos: [a.x, a.y, a.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget(
    { x: a.x, y: a.y, z: a.z, label: a.callsign || 'FLIGHT', speedKmh: a.speedKmh, altKm: a.altKm },
    flyTo,
  );
}

function selectMarine(index: number, flyTo = false): void {
  if (index < 0 || index >= marineEngine.count) {
    clearSelection();
    return;
  }
  clearSelection();
  selectedMarineIndex = index;
  marineScene.highlight(index);

  const v = marineEngine.list[index];
  currentSelectedTarget = {
    domain: 'marine',
    id: `MMSI ${v.mmsi}`,
    name: v.name,
    subType: v.category.toUpperCase(),
    lat: v.lat,
    lon: v.lon,
    altKm: 0,
    speedKmh: v.speedKmh,
    heading: v.headingDeg,
    origin: v.originPort,
    destination: v.destPort,
    country: v.flag,
    scenePos: [v.x, v.y, v.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget(
    { x: v.x, y: v.y, z: v.z, label: v.name, speedKmh: v.speedKmh, altKm: 0 },
    flyTo,
  );
}

function selectQuake(index: number, flyTo = false): void {
  if (index < 0 || index >= earthquakeSystem.list.length) {
    clearSelection();
    return;
  }
  clearSelection();
  earthquakeSystem.highlight(index);

  const q = earthquakeSystem.list[index];
  currentSelectedTarget = {
    domain: 'earthquake',
    id: `USGS ${q.id}`,
    name: q.place,
    subType: `Mag ${q.mag.toFixed(1)} Seismic`,
    lat: q.lat,
    lon: q.lon,
    altKm: -q.depthKm,
    speedKmh: 0,
    origin: `${q.depthKm} km Focal Depth`,
    destination: new Date(q.timeMs).toUTCString(),
    country: 'Tectonic Fault',
    scenePos: [q.x, q.y, q.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget(
    { x: q.x, y: q.y, z: q.z, label: `M${q.mag.toFixed(1)} QUAKE`, speedKmh: 0, altKm: 0 },
    flyTo,
  );
}

function selectCable(index: number, flyTo = false): void {
  if (index < 0 || index >= LANDING_STATIONS.length) return;
  clearSelection();
  cablesScene.highlight(index);

  const st = LANDING_STATIONS[index];
  currentSelectedTarget = {
    domain: 'cable',
    id: `CABLE-HUB`,
    name: st.name,
    subType: 'Subsea Fiber Hub',
    lat: st.lat,
    lon: st.lon,
    altKm: 0,
    speedKmh: 0,
    country: st.country,
    extra: {
      'Connected Cables': st.cables.join(', '),
      'Global Capacity': '100+ Tbps DWDM',
    },
    scenePos: [st.x, st.y, st.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget({ x: st.x, y: st.y, z: st.z, label: st.name, speedKmh: 0, altKm: 0 }, flyTo);
}

function selectNuclear(index: number, flyTo = false): void {
  if (index < 0 || index >= NUCLEAR_PLANTS.length) return;
  clearSelection();
  nuclearScene.highlight(index);

  const p = NUCLEAR_PLANTS[index];
  currentSelectedTarget = {
    domain: 'nuclear',
    id: `NUC-${p.id.toUpperCase()}`,
    name: p.name,
    subType: `${p.reactorType} (${p.activeUnits} Units)`,
    lat: p.lat,
    lon: p.lon,
    altKm: 0,
    speedKmh: 0,
    country: p.country,
    operator: p.operator,
    extra: {
      'Capacity (Net)': `${p.capacityMwe.toLocaleString()} MWe`,
      'Reactor Type': p.reactorType,
      'Active Units': `${p.activeUnits} Reactors`,
    },
    scenePos: [p.x, p.y, p.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget({ x: p.x, y: p.y, z: p.z, label: p.name, speedKmh: 0, altKm: 0 }, flyTo);
}

function selectDsn(index: number, flyTo = false): void {
  if (index < 0 || index >= DSN_COMPLEXES.length) return;
  clearSelection();
  dsnScene.highlight(index);

  const c = DSN_COMPLEXES[index];
  currentSelectedTarget = {
    domain: 'dsn',
    id: `DSN-${c.id.toUpperCase()}`,
    name: c.name,
    subType: 'Deep Space Ground Station',
    lat: c.lat,
    lon: c.lon,
    altKm: 0,
    speedKmh: 0,
    country: `${c.country} (${c.location})`,
    extra: {
      'Active Probe Track': c.activeProbe,
      'Antenna Array': c.antennas.join(', '),
      'Carrier Band': c.frequencyBand,
      'Data Downlink': c.dataRate,
    },
    scenePos: [c.x, c.y, c.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget({ x: c.x, y: c.y, z: c.z, label: c.name, speedKmh: 0, altKm: 0 }, flyTo);
}

function selectAsteroid(index: number, flyTo = false): void {
  if (index < 0 || index >= asteroidsScene.list.length) return;
  clearSelection();
  asteroidsScene.highlight(index);

  const a = asteroidsScene.list[index];
  currentSelectedTarget = {
    domain: 'asteroid',
    id: `NEO ${a.id}`,
    name: a.name,
    subType: a.orbitClass,
    lat: 0,
    lon: 0,
    altKm: a.missDistanceKm,
    speedKmh: a.velocityKms * 3600,
    country: 'Solar System Heliocentric Orbit',
    extra: {
      'Estimated Diameter': `${a.diameterM} m`,
      'Miss Distance': `${a.missDistanceLd} LD (${a.missDistanceKm.toLocaleString()} km)`,
      'Relative Velocity': `${a.velocityKms} km/s`,
      'Hazard Classification': a.hazardLevel,
      'Close Approach': a.closeApproachDate,
    },
    scenePos: [a.sceneX, a.sceneY, a.sceneZ],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget({ x: a.sceneX, y: a.sceneY, z: a.sceneZ, label: a.name, speedKmh: a.velocityKms * 3600, altKm: a.missDistanceKm }, flyTo);
}

function selectLaunch(index: number, flyTo = false): void {
  if (index < 0 || index >= launchesScene.list.length) return;
  clearSelection();
  launchesScene.highlight(index);

  const sp = launchesScene.list[index];
  currentSelectedTarget = {
    domain: 'launch',
    id: `PAD-${sp.id.toUpperCase()}`,
    name: sp.name,
    subType: 'Orbital Spaceport',
    lat: sp.lat,
    lon: sp.lon,
    altKm: 0,
    speedKmh: 0,
    country: sp.country,
    operator: sp.operator,
    extra: {
      'Next Mission': sp.nextMission,
      'Rocket Vehicle': sp.nextRocket,
      'Target Orbit': sp.targetOrbit,
      'Launch Azimuth': `${sp.launchAzimuthDeg}° True`,
    },
    scenePos: [sp.x, sp.y, sp.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget({ x: sp.x, y: sp.y, z: sp.z, label: sp.name, speedKmh: 0, altKm: 0 }, flyTo);
}

function selectVolcano(index: number, flyTo = false): void {
  if (index < 0 || index >= volcanoesScene.list.length) return;
  clearSelection();
  volcanoesScene.highlight(index);

  const v = volcanoesScene.list[index];
  currentSelectedTarget = {
    domain: 'volcano',
    id: `VOLC-${v.id.toUpperCase()}`,
    name: v.name,
    subType: v.type,
    lat: v.lat,
    lon: v.lon,
    altKm: v.elevationM / 1000,
    speedKmh: 0,
    country: v.country,
    extra: {
      'Alert Level': v.alertLevel,
      'Caldera Elevation': `${v.elevationM} m`,
      'Volcano Type': v.type,
      'Activity Status': v.recentActivity,
    },
    scenePos: [v.x, v.y, v.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget({ x: v.x, y: v.y, z: v.z, label: v.name, speedKmh: 0, altKm: v.elevationM / 1000 }, flyTo);
}

function selectWildfire(index: number, flyTo = false): void {
  if (index < 0 || index >= wildfiresScene.list.length) return;
  clearSelection();
  wildfiresScene.highlight(index);

  const f = wildfiresScene.list[index];
  currentSelectedTarget = {
    domain: 'wildfire',
    id: `FIRMS-${f.id.toUpperCase()}`,
    name: f.name,
    subType: 'Thermal Fire Cluster',
    lat: f.lat,
    lon: f.lon,
    altKm: 0,
    speedKmh: 0,
    country: `${f.country} (${f.region})`,
    extra: {
      'Brightness Temp': `${f.brightnessK} K`,
      'Fire Radiative Power': `${f.frpMw} MW`,
      'Detection Satellite': f.satellite,
      'Algorithm Confidence': f.confidence,
    },
    scenePos: [f.x, f.y, f.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget({ x: f.x, y: f.y, z: f.z, label: f.name, speedKmh: 0, altKm: 0 }, flyTo);
}

function selectCyclone(index: number, flyTo = false): void {
  if (index < 0 || index >= cyclonesScene.list.length) return;
  clearSelection();
  cyclonesScene.highlight(index);

  const c = cyclonesScene.list[index];
  currentSelectedTarget = {
    domain: 'cyclone',
    id: `STORM-${c.id.toUpperCase()}`,
    name: c.name,
    subType: c.categoryLabel,
    lat: c.lat,
    lon: c.lon,
    altKm: 12.0,
    speedKmh: c.movementSpeedKmh,
    country: c.basin,
    extra: {
      'Sustained Winds': `${c.maxWindsKts} kts (${c.maxWindsKmh} km/h)`,
      'Central Pressure': `${c.pressureHpa} hPa`,
      'Movement Track': `${c.movementDirDeg}° at ${c.movementSpeedKmh} km/h`,
      'Storm Classification': `Category ${c.category}`,
    },
    scenePos: [c.x, c.y, c.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget({ x: c.x, y: c.y, z: c.z, label: c.name, speedKmh: c.movementSpeedKmh, altKm: 12.0 }, flyTo);
}

function selectGpsJam(index: number, flyTo = false): void {
  if (index < 0 || index >= gpsJamScene.list.length) return;
  clearSelection();
  gpsJamScene.highlight(index);

  const z = gpsJamScene.list[index];
  currentSelectedTarget = {
    domain: 'gpsjam',
    id: `EW-${z.id.toUpperCase()}`,
    name: z.name,
    subType: z.severity,
    lat: z.lat,
    lon: z.lon,
    altKm: 0,
    speedKmh: 0,
    country: z.region,
    extra: {
      'GNSS Degradation': `${z.interferencePct}% High Interference`,
      'Affected Signals': z.affectedBands.join(', '),
      'Affected Radius': `${z.radiusKm} km`,
      'Interference Class': z.severity,
    },
    scenePos: [z.x, z.y, z.z],
  };

  commandUI.showTarget(currentSelectedTarget);
  targetLock.setTarget({ x: z.x, y: z.y, z: z.z, label: z.name, speedKmh: 0, altKm: 0 }, flyTo);
}

// ---------------------------------------------------------------------------
// Unified Pointer Raycasting Across All 10 Domains
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

  // 1. Asteroids
  const astIdx = asteroidsScene.pick(raycaster, camera);
  if (astIdx >= 0) {
    selectAsteroid(astIdx);
    return;
  }

  // 2. Spaceports
  const launchIdx = launchesScene.pick(raycaster, camera);
  if (launchIdx >= 0) {
    selectLaunch(launchIdx);
    return;
  }

  // 3. DSN Dishes
  const dsnIdx = dsnScene.pick(raycaster, camera);
  if (dsnIdx >= 0) {
    selectDsn(dsnIdx);
    return;
  }

  // 4. Volcanoes
  const volcIdx = volcanoesScene.pick(raycaster, camera);
  if (volcIdx >= 0) {
    selectVolcano(volcIdx);
    return;
  }

  // 5. Wildfires
  const fireIdx = wildfiresScene.pick(raycaster, camera);
  if (fireIdx >= 0) {
    selectWildfire(fireIdx);
    return;
  }

  // 6. Cyclones
  const cycIdx = cyclonesScene.pick(raycaster, camera);
  if (cycIdx >= 0) {
    selectCyclone(cycIdx);
    return;
  }

  // 7. GPS Jamming
  const jamIdx = gpsJamScene.pick(raycaster, camera);
  if (jamIdx >= 0) {
    selectGpsJam(jamIdx);
    return;
  }

  // 8. Nuclear Plants
  const nucIdx = nuclearScene.pick(raycaster, camera);
  if (nucIdx >= 0) {
    selectNuclear(nucIdx);
    return;
  }

  // 9. Submarine Cable Landing Stations
  const cableIdx = cablesScene.pick(raycaster, camera);
  if (cableIdx >= 0) {
    selectCable(cableIdx);
    return;
  }

  // 10. Earthquakes
  const quakeIdx = earthquakeSystem.pick(raycaster, camera);
  if (quakeIdx >= 0) {
    selectQuake(quakeIdx);
    return;
  }

  // 11. Flights
  const flightIdx = flightScene.pick(raycaster, camera);
  if (flightIdx >= 0) {
    selectFlight(flightIdx);
    return;
  }

  // 12. Ships
  const marineIdx = marineScene.pick(raycaster, camera);
  if (marineIdx >= 0) {
    selectMarine(marineIdx);
    return;
  }

  // 13. Satellites
  const satIdx = satCloud.pick(raycaster, camera);
  if (satIdx >= 0) {
    selectSatellite(satIdx);
    return;
  }

  clearSelection();
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
      if (checked && selectedSatelliteIndex >= 0) {
        satOverlays.updateOrbit(satCloud.catalog[selectedSatelliteIndex], new Date(simTimeMs));
      }
    } else if (overlay === 'footprints') {
      satOverlays.setShowFootprint(checked);
    } else if (overlay === 'quakes') {
      earthquakeSystem.setVisible(checked);
    } else if (overlay === 'volcanoes') {
      volcanoesScene.setVisible(checked);
    } else if (overlay === 'wildfires') {
      wildfiresScene.setVisible(checked);
    } else if (overlay === 'cyclones') {
      cyclonesScene.setVisible(checked);
    } else if (overlay === 'aurora') {
      auroraScene.setVisible(checked);
    } else if (overlay === 'dsn') {
      dsnScene.setVisible(checked);
    } else if (overlay === 'asteroids') {
      asteroidsScene.setVisible(checked);
    } else if (overlay === 'launches') {
      launchesScene.setVisible(checked);
    } else if (overlay === 'gpsjam') {
      gpsJamScene.setVisible(checked);
    } else if (overlay === 'cables') {
      cablesScene.setVisible(checked);
    } else if (overlay === 'nuclear') {
      nuclearScene.setVisible(checked);
    }
  },
  onHotspotSelect(hotspot: HotspotPreset) {
    targetLock.flyToCoord(hotspot.lat, hotspot.lon, hotspot.altitudeUnits, 1.4);
  },
  onTargetSearchSelect({ domain, index }) {
    if (domain === 'satellite') selectSatellite(index, true);
    else if (domain === 'flight') selectFlight(index, true);
    else if (domain === 'marine') selectMarine(index, true);
    else if (domain === 'earthquake') selectQuake(index, true);
    else if (domain === 'cable') selectCable(index, true);
    else if (domain === 'nuclear') selectNuclear(index, true);
    else if (domain === 'dsn') selectDsn(index, true);
    else if (domain === 'asteroid') selectAsteroid(index, true);
    else if (domain === 'launch') selectLaunch(index, true);
    else if (domain === 'volcano') selectVolcano(index, true);
    else if (domain === 'wildfire') selectWildfire(index, true);
    else if (domain === 'cyclone') selectCyclone(index, true);
    else if (domain === 'gpsjam') selectGpsJam(index, true);
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

// Auto-rotate toggle
document.querySelector<HTMLInputElement>('#toggle-auto-rotate')?.addEventListener('change', (e) => {
  autoRotate = (e.target as HTMLInputElement).checked;
});

// ---------------------------------------------------------------------------
// Global Search Event Ingestion Across All 10 Domains
// ---------------------------------------------------------------------------

window.addEventListener('commandcenter:search', (e: Event) => {
  const query = ((e as CustomEvent).detail?.query || '').toLowerCase().trim();
  if (!query) return;

  const results: Array<{ domain: DomainType; index: number; name: string; extra: string }> = [];

  // 1. Satellites
  satCloud.catalog.forEach((s, idx) => {
    if (results.length >= 20) return;
    if (s.name.toLowerCase().includes(query) || s.noradId.toString().includes(query)) {
      results.push({ domain: 'satellite', index: idx, name: s.name, extra: `NORAD ${s.noradId} (${s.groupId})` });
    }
  });

  // 2. Flights
  flightEngine.list.forEach((f, idx) => {
    if (results.length >= 20) return;
    if (f.callsign.toLowerCase().includes(query) || f.icao24.toLowerCase().includes(query)) {
      results.push({ domain: 'flight', index: idx, name: f.callsign || f.icao24, extra: `${f.origin} → ${f.destination}` });
    }
  });

  // 3. Ships
  marineEngine.list.forEach((m, idx) => {
    if (results.length >= 20) return;
    if (m.name.toLowerCase().includes(query) || m.mmsi.includes(query)) {
      results.push({ domain: 'marine', index: idx, name: m.name, extra: `${m.category.toUpperCase()} (${m.flag})` });
    }
  });

  // 4. Earthquakes
  earthquakeSystem.list.forEach((q, idx) => {
    if (results.length >= 20) return;
    if (q.place.toLowerCase().includes(query)) {
      results.push({ domain: 'earthquake', index: idx, name: `M${q.mag.toFixed(1)} ${q.place}`, extra: `Depth: ${q.depthKm} km` });
    }
  });

  // 5. Cables
  LANDING_STATIONS.forEach((st, idx) => {
    if (results.length >= 20) return;
    if (st.name.toLowerCase().includes(query) || st.country.toLowerCase().includes(query)) {
      results.push({ domain: 'cable', index: idx, name: st.name, extra: `${st.country} (${st.cables.join(', ')})` });
    }
  });

  // 6. Nuclear
  NUCLEAR_PLANTS.forEach((p, idx) => {
    if (results.length >= 20) return;
    if (p.name.toLowerCase().includes(query) || p.country.toLowerCase().includes(query)) {
      results.push({ domain: 'nuclear', index: idx, name: p.name, extra: `${p.capacityMwe} MWe (${p.country})` });
    }
  });

  // 7. DSN
  DSN_COMPLEXES.forEach((c, idx) => {
    if (results.length >= 20) return;
    if (c.name.toLowerCase().includes(query) || c.activeProbe.toLowerCase().includes(query)) {
      results.push({ domain: 'dsn', index: idx, name: c.name, extra: `Tracking: ${c.activeProbe}` });
    }
  });

  // 8. Asteroids
  asteroidsScene.list.forEach((a, idx) => {
    if (results.length >= 20) return;
    if (a.name.toLowerCase().includes(query)) {
      results.push({ domain: 'asteroid', index: idx, name: a.name, extra: `${a.missDistanceLd} LD (${a.hazardLevel})` });
    }
  });

  // 9. Spaceports
  launchesScene.list.forEach((sp, idx) => {
    if (results.length >= 20) return;
    if (sp.name.toLowerCase().includes(query) || sp.nextMission.toLowerCase().includes(query)) {
      results.push({ domain: 'launch', index: idx, name: sp.name, extra: `${sp.nextRocket} - ${sp.nextMission}` });
    }
  });

  // 10. Volcanoes
  volcanoesScene.list.forEach((v, idx) => {
    if (results.length >= 20) return;
    if (v.name.toLowerCase().includes(query) || v.country.toLowerCase().includes(query)) {
      results.push({ domain: 'volcano', index: idx, name: v.name, extra: `${v.alertLevel} - ${v.elevationM}m (${v.country})` });
    }
  });

  // 11. Wildfires
  wildfiresScene.list.forEach((f, idx) => {
    if (results.length >= 20) return;
    if (f.name.toLowerCase().includes(query) || f.region.toLowerCase().includes(query)) {
      results.push({ domain: 'wildfire', index: idx, name: f.name, extra: `${f.frpMw} MW FRP (${f.country})` });
    }
  });

  // 12. Cyclones
  cyclonesScene.list.forEach((c, idx) => {
    if (results.length >= 20) return;
    if (c.name.toLowerCase().includes(query)) {
      results.push({ domain: 'cyclone', index: idx, name: c.name, extra: `${c.categoryLabel} (${c.maxWindsKts} kts)` });
    }
  });

  // 13. GPS Jamming
  GPS_JAM_ZONES.forEach((z, idx) => {
    if (results.length >= 20) return;
    if (z.name.toLowerCase().includes(query) || z.region.toLowerCase().includes(query)) {
      results.push({ domain: 'gpsjam', index: idx, name: z.name, extra: `${z.interferencePct}% Denial (${z.region})` });
    }
  });

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
  } catch (err) {
    console.warn('CelesTrak fetch error:', err);
    if (statusEl) statusEl.textContent = `Sync Offline — Fallback Active (${satCloud.count} sats)`;
  }
}

async function pollFlights(): Promise<void> {
  try {
    await flightEngine.fetchLiveStates();
    flightScene.setAircraft(flightEngine.list);
  } catch {
    // handled in engine
  }
}

async function pollQuakes(): Promise<void> {
  try {
    await earthquakeSystem.fetchQuakes();
  } catch {
    // handled in system
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

  // Update 3D Signal Layer Animations
  earthSystem?.update(deltaWallSec);
  earthquakeSystem.update(deltaWallSec);
  cablesScene.update(now / 1000);
  dsnScene.update(now / 1000);
  auroraScene.update(now / 1000);
  launchesScene.update(now / 1000);
  wildfiresScene.update(now / 1000);
  volcanoesScene.update(now / 1000);
  cyclonesScene.update(now / 1000);
  gpsJamScene.update(now / 1000);

  // Update OrbitControls & Target Tracking Reticle
  targetLock.update(deltaWallSec);
  controls.update();

  // Keep telemetry panel synchronized with moving target
  if (currentSelectedTarget) {
    if (currentSelectedTarget.domain === 'satellite' && selectedSatelliteIndex >= 0) {
      satCloud.getDisplayPosition(selectedSatelliteIndex, tmpPos);
      const altKm = satCloud.altKm[selectedSatelliteIndex] || 500;
      const lat = satCloud.lat[selectedSatelliteIndex] || 0;
      const lon = satCloud.lon[selectedSatelliteIndex] || 0;
      const speedKmh = (satCloud.speedKms[selectedSatelliteIndex] || 7.5) * 3600;

      currentSelectedTarget.lat = lat;
      currentSelectedTarget.lon = lon;
      currentSelectedTarget.altKm = altKm;
      currentSelectedTarget.speedKmh = speedKmh;
      currentSelectedTarget.scenePos = [tmpPos.x, tmpPos.y, tmpPos.z];

      satOverlays.updateOrbit(satCloud.catalog[selectedSatelliteIndex], simDate);
      satOverlays.updateFootprint(lat, lon, altKm);
      satOverlays.updateMarker(tmpPos.x, tmpPos.y, tmpPos.z);
    } else if (currentSelectedTarget.domain === 'flight' && selectedFlightIndex >= 0) {
      const a = flightEngine.list[selectedFlightIndex];
      if (a) {
        currentSelectedTarget.lat = a.lat;
        currentSelectedTarget.lon = a.lon;
        currentSelectedTarget.altKm = a.altKm;
        currentSelectedTarget.speedKmh = a.speedKmh;
        currentSelectedTarget.heading = a.headingDeg;
        currentSelectedTarget.scenePos = [a.x, a.y, a.z];
      }
    } else if (currentSelectedTarget.domain === 'marine' && selectedMarineIndex >= 0) {
      const v = marineEngine.list[selectedMarineIndex];
      if (v) {
        currentSelectedTarget.lat = v.lat;
        currentSelectedTarget.lon = v.lon;
        currentSelectedTarget.speedKmh = v.speedKmh;
        currentSelectedTarget.heading = v.headingDeg;
        currentSelectedTarget.scenePos = [v.x, v.y, v.z];
      }
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

  // Background async loaders
  loadSatellites().catch((e) => console.warn('Satellite loader warning:', e));
  pollFlights().catch((e) => console.warn('Flight poller warning:', e));
  pollQuakes().catch((e) => console.warn('Quake poller warning:', e));
}

init();
