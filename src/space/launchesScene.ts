import * as THREE from 'three';
import { pickPointsNearestCursor, type PickHit } from '../domains/pick';
import { SPACEPORTS, type SpaceportRecord } from './launches';

export class LaunchesScene {
  readonly group = new THREE.Group();
  private padPoints: THREE.Points;
  private azimuthLines: THREE.Line[] = [];
  private isVisible = false;

  constructor() {
    const positions: number[] = [];

    for (const sp of SPACEPORTS) {
      positions.push(sp.x, sp.y, sp.z);

      const lon = (sp.lon * Math.PI) / 180;
      const az = (sp.launchAzimuthDeg * Math.PI) / 180;

      // Surface normal & eastward / northward vectors
      const normal = new THREE.Vector3(sp.x, sp.y, sp.z).normalize();
      const east = new THREE.Vector3(-Math.sin(lon), 0, -Math.cos(lon)).normalize();
      const north = new THREE.Vector3().crossVectors(east, normal).normalize();

      const launchDir = new THREE.Vector3()
        .addScaledVector(north, Math.cos(az))
        .addScaledVector(east, Math.sin(az))
        .addScaledVector(normal, 0.4) // Climb altitude
        .normalize();

      const lineStart = new THREE.Vector3(sp.x, sp.y, sp.z);
      const lineEnd = lineStart.clone().addScaledVector(launchDir, 0.45);

      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([lineStart.x, lineStart.y, lineStart.z, lineEnd.x, lineEnd.y, lineEnd.z], 3),
      );

      const lineMat = new THREE.LineBasicMaterial({
        color: 0xffb703,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
      });

      const line = new THREE.Line(lineGeo, lineMat);
      this.azimuthLines.push(line);
      this.group.add(line);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xffb703,
      size: 0.026,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.padPoints = new THREE.Points(geo, mat);
    this.group.add(this.padPoints);

    this.group.visible = false;
  }

  get list(): SpaceportRecord[] {
    return SPACEPORTS;
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
    const pulse = 0.5 + 0.3 * Math.sin(wallTimeSec * 3.5);
    for (const line of this.azimuthLines) {
      (line.material as THREE.LineBasicMaterial).opacity = pulse;
    }
  }

  pick(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
    pointerNdc: THREE.Vector2,
  ): PickHit | null {
    if (!this.isVisible) return null;
    return pickPointsNearestCursor(raycaster, camera, pointerNdc, this.padPoints);
  }
}
