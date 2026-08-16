import * as THREE from 'three';
import { pickPointsNearestCursor, type PickHit } from '../domains/pick';
import { geoToOceanFloor, LANDING_STATIONS, SUBMARINE_CABLES, type LandingStationNode } from './cables';

export class SubmarineCablesScene {
  readonly group = new THREE.Group();
  private cableLines: THREE.Line[] = [];
  private stationsMesh: THREE.Points;
  private isVisible = false;

  constructor() {
    // 1. Build Cable Polyline Geometries
    for (const cable of SUBMARINE_CABLES) {
      const pts: number[] = [];
      for (const wp of cable.waypoints) {
        const [x, y, z] = geoToOceanFloor(wp.lat, wp.lon);
        pts.push(x, y, z);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));

      const mat = new THREE.LineBasicMaterial({
        color: 0x00f5d4,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const line = new THREE.Line(geo, mat);
      this.cableLines.push(line);
      this.group.add(line);
    }

    // 2. Landing Stations Point Cloud
    const stationPositions: number[] = [];
    for (const st of LANDING_STATIONS) {
      stationPositions.push(st.x, st.y, st.z);
    }

    const stationGeo = new THREE.BufferGeometry();
    stationGeo.setAttribute('position', new THREE.Float32BufferAttribute(stationPositions, 3));

    const stationMat = new THREE.PointsMaterial({
      color: 0x00f5d4,
      size: 0.024,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.stationsMesh = new THREE.Points(stationGeo, stationMat);
    this.group.add(this.stationsMesh);

    this.group.visible = false;
  }

  get stations(): LandingStationNode[] {
    return LANDING_STATIONS;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.group.visible = visible;
  }

  highlight(_stationIdx: number): void {
    // highlight state
  }

  update(wallTimeSec: number): void {
    if (!this.isVisible) return;

    // Subtle data-pulse brightness modulation
    const pulse = 0.5 + 0.35 * Math.sin(wallTimeSec * 3.0);
    for (const line of this.cableLines) {
      (line.material as THREE.LineBasicMaterial).opacity = pulse;
    }
  }

  pick(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
    pointerNdc: THREE.Vector2,
  ): PickHit | null {
    if (!this.isVisible) return null;
    return pickPointsNearestCursor(raycaster, camera, pointerNdc, this.stationsMesh);
  }
}
