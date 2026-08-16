/**
 * Shared lat/lon → scene-coordinate projection.
 *
 * THE single convention for placing geographic coordinates in Earth Command:
 * ECEF (x=cos(lat)cos(lon), y=cos(lat)sin(lon), z=sin(lat)) mapped to scene
 * axes as X → X, Z → Y, Y → −Z. Identical to the math used by the satellite
 * propagator, flights, marine, and every static geo domain. Do NOT introduce a
 * second convention — import this.
 *
 * Verified by scripts/verify-geo.mjs (representative world cities land in the
 * right countries; scene axes match ECEF orientation).
 */
import { EARTH_RADIUS_KM, KM_TO_UNITS } from '../config';

export function geoToScene(
  latDeg: number,
  lonDeg: number,
  altKm = 0,
): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const r = (EARTH_RADIUS_KM + altKm) * KM_TO_UNITS;

  const clat = Math.cos(lat);
  const ecfX = r * clat * Math.cos(lon);
  const ecfY = r * clat * Math.sin(lon);
  const ecfZ = r * Math.sin(lat);

  // ECEF → Scene (X → X, Z → Y, Y → −Z)
  return [ecfX, ecfZ, -ecfY];
}
