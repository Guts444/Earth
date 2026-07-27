/**
 * Pure-JS re-exports of satellite.js — skips the WASM bulk API so Vite can
 * bundle for the browser without pthread/worker issues.
 */
export { twoline2satrec, json2satrec } from '../../node_modules/satellite.js/dist/io.js';
export { propagate, sgp4, gstime } from '../../node_modules/satellite.js/dist/propagation.js';
export {
  degreesLat,
  degreesLong,
  degreesToRadians,
  radiansToDegrees,
  eciToEcf,
  eciToGeodetic,
  ecfToEci,
  geodeticToEcf,
  ecfToLookAngles,
} from '../../node_modules/satellite.js/dist/transforms.js';
export { jday, invjday } from '../../node_modules/satellite.js/dist/ext.js';
export type { SatRec } from '../../node_modules/satellite.js/dist/propagation/SatRec.js';
export { SatRecError } from '../../node_modules/satellite.js/dist/propagation/SatRec.js';
