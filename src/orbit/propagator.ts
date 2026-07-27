import {
  propagate,
  gstime,
  eciToEcf,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  type SatRec,
} from 'satellite.js';
import type { CatalogSatellite } from '../tle/catalog';
import { EARTH_RADIUS_KM, KM_TO_UNITS } from '../config';

export interface PropagatedState {
  /** ECEF position in scene units (Earth radius = 1). */
  x: number;
  y: number;
  z: number;
  /** ECEF velocity in scene units per second. */
  vx: number;
  vy: number;
  vz: number;
  lat: number;
  lon: number;
  altKm: number;
  speedKms: number;
  valid: boolean;
}

const INVALID: PropagatedState = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  lat: 0,
  lon: 0,
  altKm: 0,
  speedKms: 0,
  valid: false,
};

/**
 * Propagate one satellite to ECEF scene coordinates.
 * satellite.js ECI is TEME; we convert with GMST for an Earth-fixed view.
 */
export function propagateSatellite(
  satrec: SatRec,
  date: Date,
  gmst?: number,
): PropagatedState {
  const state = propagate(satrec, date);
  if (!state?.position || !state.velocity) {
    return INVALID;
  }

  const positionEci = state.position;
  const velocityEci = state.velocity;
  const g = gmst ?? gstime(date);

  const posEcf = eciToEcf(positionEci, g);
  const velEcf = eciToEcf(velocityEci, g);
  const gd = eciToGeodetic(positionEci, g);

  const speedKms = Math.hypot(velocityEci.x, velocityEci.y, velocityEci.z);

  return {
    x: posEcf.x * KM_TO_UNITS,
    y: posEcf.z * KM_TO_UNITS, // Three.js Y-up: map ECEF Z → scene Y
    z: -posEcf.y * KM_TO_UNITS, // ECEF Y → -scene Z (common geo mapping)
    vx: velEcf.x * KM_TO_UNITS,
    vy: velEcf.z * KM_TO_UNITS,
    vz: -velEcf.y * KM_TO_UNITS,
    lat: degreesLat(gd.latitude),
    lon: degreesLong(gd.longitude),
    altKm: gd.height,
    speedKms,
    valid: true,
  };
}

/** Full SGP4 pass for the catalog; fills parallel typed arrays. */
export function propagateCatalog(
  sats: CatalogSatellite[],
  date: Date,
  out: {
    positions: Float32Array;
    velocities: Float32Array;
    valid: Uint8Array;
    lat: Float32Array;
    lon: Float32Array;
    altKm: Float32Array;
    speedKms: Float32Array;
  },
): void {
  const gmst = gstime(date);
  const n = sats.length;

  for (let i = 0; i < n; i++) {
    const s = propagateSatellite(sats[i].satrec, date, gmst);
    const i3 = i * 3;
    if (!s.valid) {
      out.valid[i] = 0;
      out.positions[i3] = 0;
      out.positions[i3 + 1] = 0;
      out.positions[i3 + 2] = 0;
      out.velocities[i3] = 0;
      out.velocities[i3 + 1] = 0;
      out.velocities[i3 + 2] = 0;
      continue;
    }
    out.valid[i] = 1;
    out.positions[i3] = s.x;
    out.positions[i3 + 1] = s.y;
    out.positions[i3 + 2] = s.z;
    out.velocities[i3] = s.vx;
    out.velocities[i3 + 1] = s.vy;
    out.velocities[i3 + 2] = s.vz;
    out.lat[i] = s.lat;
    out.lon[i] = s.lon;
    out.altKm[i] = s.altKm;
    out.speedKms[i] = s.speedKms;
  }
}

/**
 * Sample one orbital period (approx from mean motion) as ECEF path points.
 * Mean motion in satrec is revs/day.
 */
export function sampleOrbitPath(
  sat: CatalogSatellite,
  date: Date,
  samples = 128,
): Float32Array {
  // satrec.no is mean motion in radians per minute
  const periodMin = (2 * Math.PI) / sat.satrec.no;
  const periodMs = periodMin * 60 * 1000;
  const pts = new Float32Array(samples * 3);
  let written = 0;

  for (let i = 0; i < samples; i++) {
    const t = new Date(date.getTime() + (i / samples) * periodMs);
    const s = propagateSatellite(sat.satrec, t);
    if (!s.valid) continue;
    const o = written * 3;
    pts[o] = s.x;
    pts[o + 1] = s.y;
    pts[o + 2] = s.z;
    written += 1;
  }

  return pts.subarray(0, written * 3);
}

/** Approximate Earth-surface footprint ring for a conical FOV. */
export function sampleFootprintRing(
  latDeg: number,
  lonDeg: number,
  altKm: number,
  minElevationDeg = 10,
  samples = 64,
): Float32Array {
  // Earth-central angle for visibility with min elevation
  const el = (minElevationDeg * Math.PI) / 180;
  const r = EARTH_RADIUS_KM;
  const rho = Math.asin(r / (r + altKm));
  const eta = Math.PI / 2 - el - rho;
  // central half-angle of coverage
  const lambda = Math.PI / 2 - el - eta;
  if (!Number.isFinite(lambda) || lambda <= 0) {
    return new Float32Array(0);
  }

  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const pts = new Float32Array((samples + 1) * 3);

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);

  for (let i = 0; i <= samples; i++) {
    const az = (i / samples) * Math.PI * 2;
    const sinAz = Math.sin(az);
    const cosAz = Math.cos(az);
    const sinL = Math.sin(lambda);
    const cosL = Math.cos(lambda);

    // Destination point on the sphere at central angle lambda from sub-satellite point
    const lat2 = Math.asin(sinLat * cosL + cosLat * sinL * cosAz);
    const lon2 =
      lon +
      Math.atan2(sinAz * sinL * cosLat, cosL - sinLat * Math.sin(lat2));

    // ECEF → scene (same mapping as propagateSatellite)
    const clat = Math.cos(lat2);
    const ecfX = EARTH_RADIUS_KM * clat * Math.cos(lon2);
    const ecfY = EARTH_RADIUS_KM * clat * Math.sin(lon2);
    const ecfZ = EARTH_RADIUS_KM * Math.sin(lat2);

    const o = i * 3;
    pts[o] = ecfX * (1 / EARTH_RADIUS_KM);
    pts[o + 1] = ecfZ * (1 / EARTH_RADIUS_KM);
    pts[o + 2] = -ecfY * (1 / EARTH_RADIUS_KM);
  }

  return pts;
}
