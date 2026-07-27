export const EARTH_RADIUS_KM = 6371.0;
/** Scene units per kilometer — Earth radius becomes 1.0 in the scene. */
export const KM_TO_UNITS = 1 / EARTH_RADIUS_KM;
export const EARTH_RADIUS = 1;
export const ATMOSPHERE_SCALE = 1.018;
export const CAMERA_NEAR = 0.01;
export const CAMERA_FAR = 200;

/** How often to run full SGP4 (ms). Between updates, positions are extrapolated with velocity. */
export const PROPAGATE_INTERVAL_MS = 500;

/** LocalStorage cache lifetime for TLE text. */
export const TLE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/** Proxied CelesTrak base (avoids browser CORS). */
export const CELESTRAK_BASE = '/api/celestrak/NORAD/elements/gp.php';

export type SatGroupId =
  | 'starlink'
  | 'oneweb'
  | 'stations'
  | 'gps-ops'
  | 'galileo'
  | 'glo-ops'
  | 'beidou'
  | 'iridium-NEXT'
  | 'weather'
  | 'science'
  | 'visual'
  | 'active';

export interface SatGroupDef {
  id: SatGroupId;
  label: string;
  color: string;
  /** RGB 0–1 for point cloud */
  rgb: [number, number, number];
  defaultOn: boolean;
  /** Larger on-screen points (ISS, stations, etc.) */
  emphasize?: boolean;
}

export const SAT_GROUPS: SatGroupDef[] = [
  {
    id: 'starlink',
    label: 'Starlink',
    color: '#4cc9f0',
    rgb: [0.3, 0.79, 0.94],
    defaultOn: true,
  },
  {
    id: 'oneweb',
    label: 'OneWeb',
    color: '#c77dff',
    rgb: [0.78, 0.49, 1.0],
    defaultOn: true,
  },
  {
    id: 'stations',
    label: 'Space stations (ISS…)',
    color: '#ffd166',
    rgb: [1.0, 0.82, 0.4],
    defaultOn: true,
    emphasize: true,
  },
  {
    id: 'gps-ops',
    label: 'GPS',
    color: '#5ef0a0',
    rgb: [0.37, 0.94, 0.63],
    defaultOn: true,
  },
  {
    id: 'galileo',
    label: 'Galileo',
    color: '#80ed99',
    rgb: [0.5, 0.93, 0.6],
    defaultOn: false,
  },
  {
    id: 'glo-ops',
    label: 'GLONASS',
    color: '#95d5b2',
    rgb: [0.58, 0.84, 0.7],
    defaultOn: false,
  },
  {
    id: 'beidou',
    label: 'BeiDou',
    color: '#b7e4c7',
    rgb: [0.72, 0.89, 0.78],
    defaultOn: false,
  },
  {
    id: 'iridium-NEXT',
    label: 'Iridium NEXT',
    color: '#ff8fab',
    rgb: [1.0, 0.56, 0.67],
    defaultOn: false,
  },
  {
    id: 'weather',
    label: 'Weather',
    color: '#ff9f1c',
    rgb: [1.0, 0.62, 0.11],
    defaultOn: false,
  },
  {
    id: 'science',
    label: 'Science',
    color: '#a0c4ff',
    rgb: [0.63, 0.77, 1.0],
    defaultOn: false,
  },
  {
    id: 'visual',
    label: '100 brightest',
    color: '#f8f9fa',
    rgb: [0.97, 0.97, 0.98],
    defaultOn: false,
    emphasize: true,
  },
  {
    id: 'active',
    label: 'All active (~12k)',
    color: '#adb5bd',
    rgb: [0.68, 0.71, 0.74],
    defaultOn: false,
  },
];

export const GROUP_BY_ID = Object.fromEntries(
  SAT_GROUPS.map((g) => [g.id, g]),
) as Record<SatGroupId, SatGroupDef>;
