import * as THREE from 'three';
import type { CatalogSatellite } from '../tle/catalog';
import { sampleFootprintRing, sampleOrbitPath } from '../orbit/propagator';

export class SelectionOverlays {
  readonly group = new THREE.Group();
  private orbitLine: THREE.Line;
  private footprintLine: THREE.Line;
  private marker: THREE.Mesh;
  private showOrbit = false;
  private showFootprint = true;

  constructor() {
    const orbitGeo = new THREE.BufferGeometry();
    const orbitMat = new THREE.LineBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.orbitLine = new THREE.Line(orbitGeo, orbitMat);
    this.orbitLine.visible = false;
    this.group.add(this.orbitLine);

    const fpGeo = new THREE.BufferGeometry();
    const fpMat = new THREE.LineBasicMaterial({
      color: 0x4cc9f0,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.footprintLine = new THREE.Line(fpGeo, fpMat);
    this.footprintLine.visible = false;
    this.group.add(this.footprintLine);

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffd166,
        transparent: true,
        opacity: 0.95,
      }),
    );
    this.marker.visible = false;
    this.group.add(this.marker);
  }

  setShowOrbit(on: boolean): void {
    this.showOrbit = on;
    if (!on) this.orbitLine.visible = false;
  }

  setShowFootprint(on: boolean): void {
    this.showFootprint = on;
    if (!on) this.footprintLine.visible = false;
  }

  clear(): void {
    this.orbitLine.visible = false;
    this.footprintLine.visible = false;
    this.marker.visible = false;
  }

  updateOrbit(sat: CatalogSatellite, date: Date): void {
    if (!this.showOrbit) {
      this.orbitLine.visible = false;
      return;
    }
    const pts = sampleOrbitPath(sat, date, 160);
    if (pts.length < 6) {
      this.orbitLine.visible = false;
      return;
    }
    const geo = this.orbitLine.geometry as THREE.BufferGeometry;
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    geo.computeBoundingSphere();
    this.orbitLine.visible = true;
  }

  updateFootprint(lat: number, lon: number, altKm: number): void {
    if (!this.showFootprint || altKm <= 0) {
      this.footprintLine.visible = false;
      return;
    }
    const pts = sampleFootprintRing(lat, lon, altKm, 10, 72);
    if (pts.length < 6) {
      this.footprintLine.visible = false;
      return;
    }
    // Lift slightly above surface to avoid z-fight
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i];
      const y = pts[i + 1];
      const z = pts[i + 2];
      const len = Math.hypot(x, y, z) || 1;
      const s = 1.004 / len;
      pts[i] = x * s;
      pts[i + 1] = y * s;
      pts[i + 2] = z * s;
    }
    const geo = this.footprintLine.geometry as THREE.BufferGeometry;
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    geo.computeBoundingSphere();
    this.footprintLine.visible = true;
  }

  updateMarker(x: number, y: number, z: number): void {
    this.marker.position.set(x, y, z);
    this.marker.visible = true;
  }
}
