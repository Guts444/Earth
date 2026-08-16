import * as THREE from 'three';

/**
 * Unified screen-space picking for Earth Command.
 *
 * Domain scenes expose THREE.Points clouds of pickable entities. Instead of
 * trusting raycaster hit cones (distance-scaled, ranked by depth along the
 * ray — wrong winner in dense clusters), we project every point to screen
 * space and return the one visually nearest the cursor. The click radius,
 * globe occlusion, and the cross-layer winner are applied by main.ts.
 */
export interface PickHit {
  /** Index into the domain's entity list / point cloud. */
  index: number;
  /** Squared NDC distance from the cursor to the point's screen position. */
  dist2: number;
  /** Distance along the pick ray (scene units) — used for globe occlusion. */
  rayDist: number;
}

/** Points with length < 1 are inside the unit globe — nothing pickable there. */
const INSIDE_GLOBE_R2 = 0.99;

const _world = new THREE.Vector3();
const _toOrigin = new THREE.Vector3();
const _proj = new THREE.Vector3();

/**
 * Pick the point visually nearest the cursor from a THREE.Points cloud.
 *
 * Skips hidden points objects (including hidden ancestors, e.g. a hidden
 * group), points inside the globe, and points behind the camera. Returns
 * null when the cloud is empty/hidden — the caller applies the click radius
 * and occlusion filters.
 */
export function pickPointsNearestCursor(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  pointerNdc: THREE.Vector2,
  points: THREE.Points,
): PickHit | null {
  // Skip fully hidden layers, including hidden ancestors (group.visible).
  let obj: THREE.Object3D | null = points;
  while (obj) {
    if (!obj.visible) return null;
    obj = obj.parent;
  }

  const posAttr = (points.geometry as THREE.BufferGeometry).getAttribute('position');
  if (!posAttr) return null;
  const count = posAttr.count;
  if (count === 0) return null;
  const arr = posAttr.array as Float32Array;

  const matrixWorld = points.matrixWorld;
  const rayOrigin = raycaster.ray.origin;
  const rayDir = raycaster.ray.direction;

  let best: PickHit | null = null;
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    _world.set(arr[i3], arr[i3 + 1], arr[i3 + 2]).applyMatrix4(matrixWorld);

    // Nothing pickable lives inside the globe (also skips invalid entities
    // collapsed to the origin by their engines).
    if (_world.lengthSq() < INSIDE_GLOBE_R2) continue;

    // Along-ray distance; skip anything behind the camera.
    _toOrigin.subVectors(_world, rayOrigin);
    const rayT = _toOrigin.dot(rayDir);
    if (rayT <= 0) continue;

    // Screen-space distance to the cursor (NDC, y up — same as pointer).
    _proj.copy(_world).project(camera);
    const dx = _proj.x - pointerNdc.x;
    const dy = _proj.y - pointerNdc.y;
    const dist2 = dx * dx + dy * dy;

    if (!best || dist2 < best.dist2) {
      best = { index: i, dist2, rayDist: rayT };
    }
  }
  return best;
}
