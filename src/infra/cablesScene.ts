import * as THREE from 'three';
import { pickPointsNearestCursor, type PickHit } from '../domains/pick';
import {
  geoToOceanFloor,
  type CableSystemDef,
  type LandingStationNode,
} from './cables';

/** Stable per-cable color palette (hash id -> palette slot). */
const CABLE_COLORS = [
  0x00f5d4, 0x00d4f5, 0x4cc9f0, 0x7ee8fa, 0x90e0ef, 0x5ef0a0, 0x80ed99,
  0xff9f1c, 0xffd166, 0xc77dff, 0xa0c4ff, 0xff8fab,
];

function colorForId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CABLE_COLORS[h % CABLE_COLORS.length];
}

export class SubmarineCablesScene {
  readonly group = new THREE.Group();
  private cableLines: THREE.Line[] = [];
  private materialsByColor = new Map<number, THREE.LineBasicMaterial>();
  private stationGeo: THREE.BufferGeometry | null = null;
  private stationsMesh: THREE.Points | null = null;
  private stationMat: THREE.PointsMaterial;
  private stationList: LandingStationNode[] = [];
  private isVisible = false;

  constructor() {
    this.stationMat = new THREE.PointsMaterial({
      color: 0x00f5d4,
      size: 0.02,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.group.visible = false;
  }

  get stations(): LandingStationNode[] {
    return this.stationList;
  }

  /** Replace the whole cable/station scene with a loaded dataset. */
  setData(cables: CableSystemDef[], stations: LandingStationNode[]): void {
    // Tear down previous geometry/material state
    for (const line of this.cableLines) {
      this.group.remove(line);
      line.geometry.dispose();
    }
    this.cableLines = [];
    for (const mat of this.materialsByColor.values()) mat.dispose();
    this.materialsByColor.clear();
    if (this.stationGeo) {
      this.group.remove(this.stationsMesh!);
      this.stationGeo.dispose();
      this.stationGeo = null;
      this.stationsMesh = null;
    }
    this.stationList = stations;

    // Cable polylines — one Line per segment, materials shared per color
    for (const cable of cables) {
      const color = colorForId(cable.id);
      let mat = this.materialsByColor.get(color);
      if (!mat) {
        mat = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.65,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        this.materialsByColor.set(color, mat);
      }
      for (const seg of cable.segments) {
        if (seg.length < 2) continue;
        const pts: number[] = [];
        for (const wp of seg) {
          const [x, y, z] = geoToOceanFloor(wp.lat, wp.lon);
          pts.push(x, y, z);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const line = new THREE.Line(geo, mat);
        this.cableLines.push(line);
        this.group.add(line);
      }
    }

    // Landing stations point cloud
    const positions = new Float32Array(stations.length * 3);
    for (let i = 0; i < stations.length; i++) {
      positions[i * 3] = stations[i].x;
      positions[i * 3 + 1] = stations[i].y;
      positions[i * 3 + 2] = stations[i].z;
    }
    this.stationGeo = new THREE.BufferGeometry();
    this.stationGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stationsMesh = new THREE.Points(this.stationGeo, this.stationMat);
    this.group.add(this.stationsMesh);
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
    // Subtle data-pulse brightness modulation (shared materials = one pass)
    const pulse = 0.5 + 0.35 * Math.sin(wallTimeSec * 3.0);
    for (const mat of this.materialsByColor.values()) {
      mat.opacity = pulse;
    }
  }

  pick(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
    pointerNdc: THREE.Vector2,
  ): PickHit | null {
    if (!this.isVisible || !this.stationsMesh) return null;
    return pickPointsNearestCursor(raycaster, camera, pointerNdc, this.stationsMesh);
  }
}
