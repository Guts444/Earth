import * as THREE from 'three';
import { EARTH_RADIUS } from '../config';

export class TacticalGrids {
  readonly group = new THREE.Group();
  private gridMesh: THREE.LineSegments;
  private terminatorLine: THREE.LineLoop;
  private showGrid = false;
  private showTerminator = false;

  constructor() {
    // 1. Lat/Lon Coordinate Grid
    const gridPositions: number[] = [];
    const gridColors: number[] = [];
    const r = EARTH_RADIUS * 1.0012; // slightly above terrain

    // Parallels (Latitude lines every 15 degrees)
    for (let latDeg = -75; latDeg <= 75; latDeg += 15) {
      const lat = (latDeg * Math.PI) / 180;
      const clat = Math.cos(lat);
      const slat = Math.sin(lat);
      const isEquator = latDeg === 0;
      const isTropic = Math.abs(latDeg) === 23.5;
      const segs = 96;

      for (let i = 0; i < segs; i++) {
        const lon1 = (i / segs) * Math.PI * 2;
        const lon2 = ((i + 1) / segs) * Math.PI * 2;

        const x1 = r * clat * Math.cos(lon1);
        const y1 = r * slat;
        const z1 = -r * clat * Math.sin(lon1);

        const x2 = r * clat * Math.cos(lon2);
        const y2 = r * slat;
        const z2 = -r * clat * Math.sin(lon2);

        gridPositions.push(x1, y1, z1, x2, y2, z2);

        const col = isEquator ? [0.3, 0.8, 1.0] : isTropic ? [0.9, 0.7, 0.2] : [0.15, 0.35, 0.6];
        gridColors.push(...col, ...col);
      }
    }

    // Meridians (Longitude lines every 30 degrees)
    for (let lonDeg = 0; lonDeg < 360; lonDeg += 30) {
      const lon = (lonDeg * Math.PI) / 180;
      const isPrime = lonDeg === 0;
      const isIntlDate = lonDeg === 180;
      const segs = 72;

      for (let i = 0; i < segs; i++) {
        const lat1 = (-Math.PI / 2) + (i / segs) * Math.PI;
        const lat2 = (-Math.PI / 2) + ((i + 1) / segs) * Math.PI;

        const x1 = r * Math.cos(lat1) * Math.cos(lon);
        const y1 = r * Math.sin(lat1);
        const z1 = -r * Math.cos(lat1) * Math.sin(lon);

        const x2 = r * Math.cos(lat2) * Math.cos(lon);
        const y2 = r * Math.sin(lat2);
        const z2 = -r * Math.cos(lat2) * Math.sin(lon);

        gridPositions.push(x1, y1, z1, x2, y2, z2);

        const col = isPrime ? [0.3, 0.8, 1.0] : isIntlDate ? [0.9, 0.3, 0.4] : [0.15, 0.35, 0.6];
        gridColors.push(...col, ...col);
      }
    }

    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
    gridGeo.setAttribute('color', new THREE.Float32BufferAttribute(gridColors, 3));

    const gridMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.gridMesh = new THREE.LineSegments(gridGeo, gridMat);
    this.gridMesh.visible = false;
    this.group.add(this.gridMesh);

    // 2. Solar Terminator Circle (Perpendicular to sun vector)
    const termSegs = 128;
    const termPositions = new Float32Array((termSegs + 1) * 3);
    const termGeo = new THREE.BufferGeometry();
    termGeo.setAttribute('position', new THREE.BufferAttribute(termPositions, 3));

    const termMat = new THREE.LineBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.terminatorLine = new THREE.LineLoop(termGeo, termMat);
    this.terminatorLine.visible = false;
    this.group.add(this.terminatorLine);
  }

  get isGridVisible(): boolean {
    return this.showGrid;
  }

  get isTerminatorVisible(): boolean {
    return this.showTerminator;
  }

  setGridVisible(visible: boolean): void {
    this.showGrid = visible;
    this.gridMesh.visible = visible;
  }

  setTerminatorVisible(visible: boolean): void {
    this.showTerminator = visible;
    this.terminatorLine.visible = visible;
  }

  updateTerminator(sunDir: THREE.Vector3): void {
    if (!this.showTerminator) return;

    // Construct orthonormal basis around sunDir
    const normal = sunDir.clone().normalize();
    const up = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(normal, up).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();

    const r = EARTH_RADIUS * 1.002;
    const termSegs = 128;
    const positions = (this.terminatorLine.geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;

    for (let i = 0; i <= termSegs; i++) {
      const theta = (i / termSegs) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const p = new THREE.Vector3()
        .addScaledVector(u, cosT * r)
        .addScaledVector(v, sinT * r);

      const idx = i * 3;
      positions[idx] = p.x;
      positions[idx + 1] = p.y;
      positions[idx + 2] = p.z;
    }

    this.terminatorLine.geometry.getAttribute('position').needsUpdate = true;
  }
}
