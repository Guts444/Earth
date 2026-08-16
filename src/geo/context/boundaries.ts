/**
 * Country + admin-1 boundary rendering.
 *
 * Batched: ONE BufferGeometry + ONE LineSegments + ONE shared material per
 * layer (countries, admin-1) — no per-country objects, no per-frame geometry
 * work. Geometry is built once from the dataset; LOD only tweaks material
 * opacity. Lines sit slightly above the surface (radius offset) so they never
 * z-fight the Earth mesh, and rely on the depth buffer so far-side lines are
 * occluded by the globe.
 */
import * as THREE from 'three';
import { EARTH_RADIUS } from '../../config';
import { geoToScene } from '../projection';
import type { GeoContextData } from './data';
import { admin1LineAlpha, countryLineAlpha } from './lod';

/** Radial offset above the surface (scene units, Earth radius = 1). */
const COUNTRY_LINE_RADIUS = EARTH_RADIUS * 1.0015;
const ADMIN1_LINE_RADIUS = EARTH_RADIUS * 1.0022;

export class BoundaryLayers {
  readonly group = new THREE.Group();
  private countryLines: THREE.LineSegments;
  private admin1Lines: THREE.LineSegments;
  private countryMat: THREE.LineBasicMaterial;
  private admin1Mat: THREE.LineBasicMaterial;
  private wantVisible = true;

  constructor(data: GeoContextData) {
    // --- Country borders ----------------------------------------------------
    const countryPositions: number[] = [];
    for (const line of data.countryLines) {
      pushPolylineSegments(line.q, COUNTRY_LINE_RADIUS, countryPositions);
    }
    const countryGeo = new THREE.BufferGeometry();
    countryGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(countryPositions, 3),
    );
    this.countryMat = new THREE.LineBasicMaterial({
      color: 0x6f9cc0, // muted steel blue — tactical, not neon
      transparent: true,
      opacity: countryLineAlpha(4.2),
      depthWrite: false,
    });
    this.countryLines = new THREE.LineSegments(countryGeo, this.countryMat);
    this.countryLines.renderOrder = 1;
    this.group.add(this.countryLines);

    // --- Admin-1 borders -----------------------------------------------------
    const admin1Positions: number[] = [];
    for (const entry of data.admin1Lines) {
      for (const poly of entry.q) {
        pushPolylineSegments(poly, ADMIN1_LINE_RADIUS, admin1Positions);
      }
    }
    const admin1Geo = new THREE.BufferGeometry();
    admin1Geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(admin1Positions, 3),
    );
    this.admin1Mat = new THREE.LineBasicMaterial({
      color: 0x86a9c4, // slightly lighter than country borders
      transparent: true,
      opacity: 0, // hidden until regional zoom
      depthWrite: false,
    });
    this.admin1Lines = new THREE.LineSegments(admin1Geo, this.admin1Mat);
    this.admin1Lines.renderOrder = 1;
    this.group.add(this.admin1Lines);
  }

  /** Update line opacities from camera distance (cheap — uniforms only). */
  update(camDist: number): void {
    if (!this.wantVisible) return;
    const ca = countryLineAlpha(camDist);
    const aa = admin1LineAlpha(camDist);
    if (Math.abs(this.countryMat.opacity - ca) > 1e-3) this.countryMat.opacity = ca;
    if (Math.abs(this.admin1Mat.opacity - aa) > 1e-3) this.admin1Mat.opacity = aa;
    this.group.visible = ca > 1e-3 || aa > 1e-3;
  }

  setVisible(v: boolean): void {
    this.wantVisible = v;
    this.group.visible = v;
  }

  get segmentCount(): number {
    return (
      this.countryLines.geometry.getAttribute('position').count / 2 +
      this.admin1Lines.geometry.getAttribute('position').count / 2
    );
  }
}

/**
 * Append the polyline's consecutive-pair segments (flat int array, ×1000
 * degrees) to a positions buffer, projected at the given radius.
 */
function pushPolylineSegments(
  flatInts: number[],
  radius: number,
  out: number[],
): void {
  const n = flatInts.length / 2;
  if (n < 2) return;
  for (let i = 0; i + 1 < n; i++) {
    const lon0 = flatInts[2 * i] / 1000;
    const lat0 = flatInts[2 * i + 1] / 1000;
    const lon1 = flatInts[2 * i + 2] / 1000;
    const lat1 = flatInts[2 * i + 3] / 1000;
    if (Math.abs(lon1 - lon0) > 180) continue; // dateline safety

    const [x0, y0, z0] = geoToScene(lat0, lon0);
    out.push(x0 * radius, y0 * radius, z0 * radius);
    const [x1, y1, z1] = geoToScene(lat1, lon1);
    out.push(x1 * radius, y1 * radius, z1 * radius);
  }
}
