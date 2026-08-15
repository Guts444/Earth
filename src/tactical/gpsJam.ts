import { EARTH_RADIUS } from '../config';

export interface GpsJamZone {
  id: string;
  name: string;
  region: string;
  severity: 'HIGH SEVERITY (DENIAL)' | 'MODERATE JAMMING' | 'SPOOFING DETECTED';
  interferencePct: number;
  affectedBands: string[];
  lat: number;
  lon: number;
  radiusKm: number;
  x: number;
  y: number;
  z: number;
}

function geoToSceneSurface(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const r = EARTH_RADIUS * 1.002;

  const clat = Math.cos(lat);
  const ecfX = r * clat * Math.cos(lon);
  const ecfY = r * clat * Math.sin(lon);
  const ecfZ = r * Math.sin(lat);

  return [ecfX, ecfZ, -ecfY];
}

export const GPS_JAM_ZONES: GpsJamZone[] = [
  {
    id: 'baltic-jam',
    name: 'Baltic Sea / Suwalki EW Corridor',
    region: 'Baltic Sea / Kaliningrad / Poland',
    severity: 'HIGH SEVERITY (DENIAL)',
    interferencePct: 92,
    affectedBands: ['GPS L1 (1575.42 MHz)', 'GLONASS G1', 'Galileo E1'],
    lat: 55.0,
    lon: 19.5,
    radiusKm: 420,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'blacksea-jam',
    name: 'Black Sea Maritime GNSS Denial Zone',
    region: 'Black Sea / Crimea / Sea of Azov',
    severity: 'HIGH SEVERITY (DENIAL)',
    interferencePct: 96,
    affectedBands: ['GPS L1/L2', 'GLONASS G1/G2', 'BeiDou B1'],
    lat: 44.5,
    lon: 34.0,
    radiusKm: 500,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'eastmed-jam',
    name: 'Eastern Mediterranean Aviation Jamming',
    region: 'Cyprus / Lebanon / Israel / Syria',
    severity: 'SPOOFING DETECTED',
    interferencePct: 84,
    affectedBands: ['GPS L1', 'GPS L5 (1176.45 MHz)', 'Galileo E5a'],
    lat: 34.5,
    lon: 34.0,
    radiusKm: 380,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'redsea-jam',
    name: 'Red Sea / Bab el-Mandeb Chokepoint EW',
    region: 'Southern Red Sea / Gulf of Aden',
    severity: 'MODERATE JAMMING',
    interferencePct: 68,
    affectedBands: ['GPS L1', 'AIS Marine Telemetry 162 MHz'],
    lat: 13.5,
    lon: 43.0,
    radiusKm: 320,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'hormuz-jam',
    name: 'Strait of Hormuz AIS/GNSS Spoofing',
    region: 'Persian Gulf / UAE / Iran',
    severity: 'SPOOFING DETECTED',
    interferencePct: 62,
    affectedBands: ['GPS L1', 'Differential GNSS Corrections'],
    lat: 26.2,
    lon: 56.2,
    radiusKm: 280,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'korea-jam',
    name: 'Korean DMZ / Yellow Sea EW Corridor',
    region: 'Incheon / Yellow Sea / DMZ',
    severity: 'MODERATE JAMMING',
    interferencePct: 74,
    affectedBands: ['GPS L1/L2', 'Civil Aviation Nav frequencies'],
    lat: 37.8,
    lon: 125.8,
    radiusKm: 260,
    x: 0,
    y: 0,
    z: 0,
  },
];

for (const z of GPS_JAM_ZONES) {
  const [x, y, zPos] = geoToSceneSurface(z.lat, z.lon);
  z.x = x;
  z.y = y;
  z.z = zPos;
}
