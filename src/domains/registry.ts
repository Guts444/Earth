/**
 * Domain Registry — one adapter per visual domain.
 *
 * Every domain exposes the same small surface (pick / buildTarget / search /
 * setVisible / update), so main.ts can drive selection, picking, search, and
 * overlay toggles generically instead of 14 copy-pasted blocks.
 * Adding a new domain = adding one adapter entry here.
 */
import * as THREE from 'three';
import type { DomainType, SelectedTarget } from '../config';
import { DSN_COMPLEXES } from '../space/dsn';
import { GPS_JAM_ZONES } from '../tactical/gpsJam';
import { LANDING_STATIONS } from '../infra/cables';
import { NUCLEAR_PLANTS } from '../infra/nuclear';
import type { AircraftScene } from '../flight/aircraftScene';
import type { FlightEngine } from '../flight/engine';
import type { MarineEngine } from '../marine/engine';
import type { MarineScene } from '../marine/marineScene';
import type { EarthquakeSystem } from '../geo/earthquakes';
import type { SubmarineCablesScene } from '../infra/cablesScene';
import type { NuclearScene } from '../infra/nuclearScene';
import type { DsnScene } from '../space/dsnScene';
import type { AuroraScene } from '../space/auroraScene';
import type { AsteroidsScene } from '../space/asteroidsScene';
import type { LaunchesScene } from '../space/launchesScene';
import type { WildfiresScene } from '../geo/wildfiresScene';
import type { VolcanoesScene } from '../geo/volcanoesScene';
import type { CyclonesScene } from '../geo/cyclonesScene';
import type { GpsJamScene } from '../tactical/gpsJamScene';
import type { SatelliteCloud } from '../scene/satellites';
import type { SelectionOverlays } from '../scene/overlays';
import { formatTMinus } from '../space/launches';
import type { PickHit } from './pick';

export interface SearchResult {
  domain: DomainType;
  index: number;
  name: string;
  extra: string;
}

export interface DomainAdapter {
  id: DomainType;
  /** Pick the entity visually nearest the cursor; null when nothing hit. */
  pick(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
    pointerNdc: THREE.Vector2,
  ): PickHit | null;
  count(): number;
  highlight(index: number): void;
  setVisible(visible: boolean): void;
  /** Build the telemetry panel payload for a picked/search result. */
  buildTarget(index: number, simDate: Date): SelectedTarget | null;
  /** Extra work right after selection (e.g. satellite orbit overlays). */
  afterSelect?(index: number, target: SelectedTarget, simDate: Date): void;
  /** Called every frame while this domain's target is selected (live telemetry). */
  refreshSelected?(target: SelectedTarget, index: number, simDate: Date): void;
  /** Push matching entities into the global search results. */
  search(query: string, push: (r: SearchResult) => void): void;
  /** Per-frame animation tick (animations / shader time). */
  update?(timeSec: number): void;
}

export interface DomainDeps {
  satCloud: SatelliteCloud;
  satOverlays: SelectionOverlays;
  flightEngine: FlightEngine;
  flightScene: AircraftScene;
  marineEngine: MarineEngine;
  marineScene: MarineScene;
  earthquakeSystem: EarthquakeSystem;
  cablesScene: SubmarineCablesScene;
  nuclearScene: NuclearScene;
  dsnScene: DsnScene;
  auroraScene: AuroraScene;
  asteroidsScene: AsteroidsScene;
  launchesScene: LaunchesScene;
  wildfiresScene: WildfiresScene;
  volcanoesScene: VolcanoesScene;
  cyclonesScene: CyclonesScene;
  gpsJamScene: GpsJamScene;
}

export function createDomainLayers(d: DomainDeps): DomainAdapter[] {
  const tmpPos = new THREE.Vector3();

  const satellite: DomainAdapter = {
    id: 'satellite',
    pick: (r, c, p) => d.satCloud.pick(r, c, p),
    count: () => d.satCloud.count,
    highlight: (i) => d.satCloud.highlightIndex(i),
    setVisible: () => {}, // satellite visibility is driven by group toggles
    buildTarget(index, simDate) {
      if (index < 0 || index >= d.satCloud.count) return null;
      const meta = d.satCloud.catalog[index];
      d.satCloud.getDisplayPosition(index, tmpPos);
      const altKm = d.satCloud.altKm[index] || 500;
      const lat = d.satCloud.lat[index] || 0;
      const lon = d.satCloud.lon[index] || 0;
      const speedKmh = (d.satCloud.speedKms[index] || 7.5) * 3600;
      void simDate;
      return {
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
    },
    afterSelect(index, target, simDate) {
      const meta = d.satCloud.catalog[index];
      d.satOverlays.updateOrbit(meta, simDate);
      d.satOverlays.updateFootprint(target.lat, target.lon, target.altKm);
      d.satOverlays.updateMarker(target.scenePos[0], target.scenePos[1], target.scenePos[2]);
    },
    refreshSelected(target, index, simDate) {
      d.satCloud.getDisplayPosition(index, tmpPos);
      const altKm = d.satCloud.altKm[index] || 500;
      const lat = d.satCloud.lat[index] || 0;
      const lon = d.satCloud.lon[index] || 0;
      const speedKmh = (d.satCloud.speedKms[index] || 7.5) * 3600;

      target.lat = lat;
      target.lon = lon;
      target.altKm = altKm;
      target.speedKmh = speedKmh;
      target.scenePos = [tmpPos.x, tmpPos.y, tmpPos.z];

      const meta = d.satCloud.catalog[index];
      if (meta) {
        d.satOverlays.updateOrbit(meta, simDate);
        d.satOverlays.updateFootprint(lat, lon, altKm);
        d.satOverlays.updateMarker(tmpPos.x, tmpPos.y, tmpPos.z);
      }
    },
    search(query, push) {
      d.satCloud.catalog.forEach((s, idx) => {
        if (s.name.toLowerCase().includes(query) || s.noradId.toString().includes(query)) {
          push({
            domain: 'satellite',
            index: idx,
            name: s.name,
            extra: `NORAD ${s.noradId} (${s.groupId})`,
          });
        }
      });
    },
  };

  const flight: DomainAdapter = {
    id: 'flight',
    pick: (r, c, p) => d.flightScene.pick(r, c, p),
    count: () => d.flightEngine.count,
    highlight: (i) => d.flightScene.highlight(i),
    setVisible: () => {}, // category filters drive flight visibility
    buildTarget(index) {
      if (index < 0 || index >= d.flightEngine.count) return null;
      const a = d.flightEngine.list[index];
      return {
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
    },
    refreshSelected(target, index) {
      const a = d.flightEngine.list[index];
      if (!a) return;
      target.lat = a.lat;
      target.lon = a.lon;
      target.altKm = a.altKm;
      target.speedKmh = a.speedKmh;
      target.heading = a.headingDeg;
      target.scenePos = [a.x, a.y, a.z];
    },
    search(query, push) {
      d.flightEngine.list.forEach((f, idx) => {
        if (f.callsign.toLowerCase().includes(query) || f.icao24.toLowerCase().includes(query)) {
          push({
            domain: 'flight',
            index: idx,
            name: f.callsign || f.icao24,
            extra: f.origin && f.destination ? `${f.origin} → ${f.destination}` : f.category.toUpperCase(),
          });
        }
      });
    },
  };

  const marine: DomainAdapter = {
    id: 'marine',
    pick: (r, c, p) => d.marineScene.pick(r, c, p),
    count: () => d.marineEngine.count,
    highlight: (i) => d.marineScene.highlight(i),
    setVisible: () => {},
    buildTarget(index) {
      if (index < 0 || index >= d.marineEngine.count) return null;
      const v = d.marineEngine.list[index];
      return {
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
    },
    refreshSelected(target, index) {
      const v = d.marineEngine.list[index];
      if (!v) return;
      target.lat = v.lat;
      target.lon = v.lon;
      target.speedKmh = v.speedKmh;
      target.heading = v.headingDeg;
      target.scenePos = [v.x, v.y, v.z];
    },
    search(query, push) {
      d.marineEngine.list.forEach((m, idx) => {
        if (m.name.toLowerCase().includes(query) || m.mmsi.includes(query)) {
          push({
            domain: 'marine',
            index: idx,
            name: m.name,
            extra: `${m.category.toUpperCase()} (${m.flag})`,
          });
        }
      });
    },
  };

  const earthquake: DomainAdapter = {
    id: 'earthquake',
    pick: (r, c, p) => d.earthquakeSystem.pick(r, c, p),
    count: () => d.earthquakeSystem.list.length,
    highlight: (i) => d.earthquakeSystem.highlight(i),
    setVisible: (v) => d.earthquakeSystem.setVisible(v),
    buildTarget(index) {
      if (index < 0 || index >= d.earthquakeSystem.list.length) return null;
      const q = d.earthquakeSystem.list[index];
      return {
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
    },
    search(query, push) {
      d.earthquakeSystem.list.forEach((q, idx) => {
        if (q.place.toLowerCase().includes(query)) {
          push({
            domain: 'earthquake',
            index: idx,
            name: `M${q.mag.toFixed(1)} ${q.place}`,
            extra: `Depth: ${q.depthKm} km`,
          });
        }
      });
    },
    update: (t) => d.earthquakeSystem.update(t),
  };

  const cable: DomainAdapter = {
    id: 'cable',
    pick: (r, c, p) => d.cablesScene.pick(r, c, p),
    count: () => LANDING_STATIONS.length,
    highlight: (i) => d.cablesScene.highlight(i),
    setVisible: (v) => d.cablesScene.setVisible(v),
    buildTarget(index) {
      if (index < 0 || index >= LANDING_STATIONS.length) return null;
      const st = LANDING_STATIONS[index];
      return {
        domain: 'cable',
        id: 'CABLE-HUB',
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
    },
    search(query, push) {
      LANDING_STATIONS.forEach((st, idx) => {
        if (st.name.toLowerCase().includes(query) || st.country.toLowerCase().includes(query)) {
          push({
            domain: 'cable',
            index: idx,
            name: st.name,
            extra: `${st.country} (${st.cables.join(', ')})`,
          });
        }
      });
    },
    update: (t) => d.cablesScene.update(t),
  };

  const nuclear: DomainAdapter = {
    id: 'nuclear',
    pick: (r, c, p) => d.nuclearScene.pick(r, c, p),
    count: () => NUCLEAR_PLANTS.length,
    highlight: (i) => d.nuclearScene.highlight(i),
    setVisible: (v) => d.nuclearScene.setVisible(v),
    buildTarget(index) {
      if (index < 0 || index >= NUCLEAR_PLANTS.length) return null;
      const p = NUCLEAR_PLANTS[index];
      return {
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
    },
    search(query, push) {
      NUCLEAR_PLANTS.forEach((p, idx) => {
        if (p.name.toLowerCase().includes(query) || p.country.toLowerCase().includes(query)) {
          push({
            domain: 'nuclear',
            index: idx,
            name: p.name,
            extra: `${p.capacityMwe} MWe (${p.country})`,
          });
        }
      });
    },
  };

  const dsn: DomainAdapter = {
    id: 'dsn',
    pick: (r, c, p) => d.dsnScene.pick(r, c, p),
    count: () => DSN_COMPLEXES.length,
    highlight: (i) => d.dsnScene.highlight(i),
    setVisible: (v) => d.dsnScene.setVisible(v),
    buildTarget(index) {
      if (index < 0 || index >= DSN_COMPLEXES.length) return null;
      const c = DSN_COMPLEXES[index];
      return {
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
    },
    search(query, push) {
      DSN_COMPLEXES.forEach((c, idx) => {
        if (c.name.toLowerCase().includes(query) || c.activeProbe.toLowerCase().includes(query)) {
          push({
            domain: 'dsn',
            index: idx,
            name: c.name,
            extra: `Tracking: ${c.activeProbe}`,
          });
        }
      });
    },
    update: (t) => d.dsnScene.update(t),
  };

  const asteroid: DomainAdapter = {
    id: 'asteroid',
    pick: (r, c, p) => d.asteroidsScene.pick(r, c, p),
    count: () => d.asteroidsScene.list.length,
    highlight: (i) => d.asteroidsScene.highlight(i),
    setVisible: (v) => d.asteroidsScene.setVisible(v),
    buildTarget(index) {
      if (index < 0 || index >= d.asteroidsScene.list.length) return null;
      const a = d.asteroidsScene.list[index];
      return {
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
    },
    search(query, push) {
      d.asteroidsScene.list.forEach((a, idx) => {
        if (a.name.toLowerCase().includes(query)) {
          push({
            domain: 'asteroid',
            index: idx,
            name: a.name,
            extra: `${a.missDistanceLd} LD (${a.hazardLevel})`,
          });
        }
      });
    },
  };

  const launch: DomainAdapter = {
    id: 'launch',
    pick: (r, c, p) => d.launchesScene.pick(r, c, p),
    count: () => d.launchesScene.list.length,
    highlight: (i) => d.launchesScene.highlight(i),
    setVisible: (v) => d.launchesScene.setVisible(v),
    buildTarget(index) {
      if (index < 0 || index >= d.launchesScene.list.length) return null;
      const sp = d.launchesScene.list[index];
      const extra: Record<string, string | number> = {
        'Next Mission': sp.nextMission,
        'Rocket Vehicle': sp.nextRocket,
        'Target Orbit': sp.targetOrbit,
        'Launch Azimuth': `${sp.launchAzimuthDeg}° True`,
      };
      if (sp.nextLaunchAtMs) {
        extra['T-Minus'] = formatTMinus(sp.nextLaunchAtMs);
        extra['Data Source'] = 'Live (Launch Library 2)';
      }
      return {
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
        extra,
        scenePos: [sp.x, sp.y, sp.z],
      };
    },
    refreshSelected(target, index) {
      const sp = d.launchesScene.list[index];
      if (sp?.nextLaunchAtMs && target.extra) {
        target.extra['T-Minus'] = formatTMinus(sp.nextLaunchAtMs);
      }
    },
    search(query, push) {
      d.launchesScene.list.forEach((sp, idx) => {
        if (sp.name.toLowerCase().includes(query) || sp.nextMission.toLowerCase().includes(query)) {
          push({
            domain: 'launch',
            index: idx,
            name: sp.name,
            extra: `${sp.nextRocket} - ${sp.nextMission}`,
          });
        }
      });
    },
    update: (t) => d.launchesScene.update(t),
  };

  const volcano: DomainAdapter = {
    id: 'volcano',
    pick: (r, c, p) => d.volcanoesScene.pick(r, c, p),
    count: () => d.volcanoesScene.list.length,
    highlight: (i) => d.volcanoesScene.highlight(i),
    setVisible: (v) => d.volcanoesScene.setVisible(v),
    buildTarget(index) {
      if (index < 0 || index >= d.volcanoesScene.list.length) return null;
      const v = d.volcanoesScene.list[index];
      return {
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
    },
    search(query, push) {
      d.volcanoesScene.list.forEach((v, idx) => {
        if (v.name.toLowerCase().includes(query) || v.country.toLowerCase().includes(query)) {
          push({
            domain: 'volcano',
            index: idx,
            name: v.name,
            extra: `${v.alertLevel} - ${v.elevationM}m (${v.country})`,
          });
        }
      });
    },
    update: (t) => d.volcanoesScene.update(t),
  };

  const wildfire: DomainAdapter = {
    id: 'wildfire',
    pick: (r, c, p) => d.wildfiresScene.pick(r, c, p),
    count: () => d.wildfiresScene.list.length,
    highlight: (i) => d.wildfiresScene.highlight(i),
    setVisible: (v) => d.wildfiresScene.setVisible(v),
    buildTarget(index) {
      if (index < 0 || index >= d.wildfiresScene.list.length) return null;
      const f = d.wildfiresScene.list[index];
      return {
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
    },
    search(query, push) {
      d.wildfiresScene.list.forEach((f, idx) => {
        if (f.name.toLowerCase().includes(query) || f.region.toLowerCase().includes(query)) {
          push({
            domain: 'wildfire',
            index: idx,
            name: f.name,
            extra: `${f.frpMw} MW FRP (${f.country})`,
          });
        }
      });
    },
    update: (t) => d.wildfiresScene.update(t),
  };

  const cyclone: DomainAdapter = {
    id: 'cyclone',
    pick: (r, c, p) => d.cyclonesScene.pick(r, c, p),
    count: () => d.cyclonesScene.list.length,
    highlight: (i) => d.cyclonesScene.highlight(i),
    setVisible: (v) => d.cyclonesScene.setVisible(v),
    buildTarget(index) {
      if (index < 0 || index >= d.cyclonesScene.list.length) return null;
      const c = d.cyclonesScene.list[index];
      return {
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
    },
    search(query, push) {
      d.cyclonesScene.list.forEach((c, idx) => {
        if (c.name.toLowerCase().includes(query)) {
          push({
            domain: 'cyclone',
            index: idx,
            name: c.name,
            extra: `${c.categoryLabel} (${c.maxWindsKts} kts)`,
          });
        }
      });
    },
    update: (t) => d.cyclonesScene.update(t),
  };

  const gpsjam: DomainAdapter = {
    id: 'gpsjam',
    pick: (r, c, p) => d.gpsJamScene.pick(r, c, p),
    count: () => d.gpsJamScene.list.length,
    highlight: (i) => d.gpsJamScene.highlight(i),
    setVisible: (v) => d.gpsJamScene.setVisible(v),
    buildTarget(index) {
      if (index < 0 || index >= d.gpsJamScene.list.length) return null;
      const z = d.gpsJamScene.list[index];
      return {
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
    },
    search(query, push) {
      GPS_JAM_ZONES.forEach((z, idx) => {
        if (z.name.toLowerCase().includes(query) || z.region.toLowerCase().includes(query)) {
          push({
            domain: 'gpsjam',
            index: idx,
            name: z.name,
            extra: `${z.interferencePct}% Denial (${z.region})`,
          });
        }
      });
    },
    update: (t) => d.gpsJamScene.update(t),
  };

  return [
    asteroid,
    launch,
    dsn,
    volcano,
    wildfire,
    cyclone,
    gpsjam,
    nuclear,
    cable,
    earthquake,
    flight,
    marine,
    satellite,
  ];
}
