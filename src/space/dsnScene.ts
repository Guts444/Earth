import * as THREE from 'three';
import { pickPointsNearestCursor, type PickHit } from '../domains/pick';
import { DSN_COMPLEXES, type DsnComplex } from './dsn';

export class DsnScene {
  readonly group = new THREE.Group();
  private dishPoints: THREE.Points;
  private beamLines: THREE.Line[] = [];
  private isVisible = false;

  constructor() {
    const positions: number[] = [];
    for (const c of DSN_COMPLEXES) {
      positions.push(c.x, c.y, c.z);

      // Deep space carrier beam pointing outwards from Earth
      const dir = new THREE.Vector3(c.x, c.y, c.z).normalize();
      const beamEnd = dir.clone().multiplyScalar(3.2);

      const beamGeo = new THREE.BufferGeometry();
      beamGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([c.x, c.y, c.z, beamEnd.x, beamEnd.y, beamEnd.z], 3),
      );

      const beamMat = new THREE.LineDashedMaterial({
        color: 0x4cc9f0,
        dashSize: 0.1,
        gapSize: 0.05,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
      });

      const beamLine = new THREE.Line(beamGeo, beamMat);
      beamLine.computeLineDistances();
      this.beamLines.push(beamLine);
      this.group.add(beamLine);
    }

    const dishGeo = new THREE.BufferGeometry();
    dishGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const dishMat = new THREE.PointsMaterial({
      color: 0x4cc9f0,
      size: 0.028,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.dishPoints = new THREE.Points(dishGeo, dishMat);
    this.group.add(this.dishPoints);

    this.group.visible = false;
  }

  get list(): DsnComplex[] {
    return DSN_COMPLEXES;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.group.visible = visible;
  }

  highlight(_index: number): void {
    // highlight state
  }

  update(wallTimeSec: number): void {
    if (!this.isVisible) return;
    const pulse = 0.4 + 0.35 * Math.sin(wallTimeSec * 4.0);
    for (const line of this.beamLines) {
      (line.material as THREE.LineDashedMaterial).opacity = pulse;
    }
  }

  pick(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
    pointerNdc: THREE.Vector2,
  ): PickHit | null {
    if (!this.isVisible) return null;
    return pickPointsNearestCursor(raycaster, camera, pointerNdc, this.dishPoints);
  }
}
