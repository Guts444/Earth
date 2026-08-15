import { EARTH_RADIUS } from '../config';

export interface CycloneRecord {
  id: string;
  name: string;
  basin: string;
  category: number; // 1 to 5
  categoryLabel: string;
  maxWindsKts: number;
  maxWindsKmh: number;
  pressureHpa: number;
  movementDirDeg: number;
  movementSpeedKmh: number;
  lat: number;
  lon: number;
  x: number;
  y: number;
  z: number;
}

function geoToSceneSurface(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const r = EARTH_RADIUS * 1.004;

  const clat = Math.cos(lat);
  const ecfX = r * clat * Math.cos(lon);
  const ecfY = r * clat * Math.sin(lon);
  const ecfZ = r * Math.sin(lat);

  return [ecfX, ecfZ, -ecfY];
}

export const CYCLONES: CycloneRecord[] = [
  {
    id: 'milt',
    name: 'Hurricane MILTON',
    basin: 'North Atlantic / Gulf of Mexico',
    category: 5,
    categoryLabel: 'Category 5 Super Hurricane',
    maxWindsKts: 155,
    maxWindsKmh: 285,
    pressureHpa: 897,
    movementDirDeg: 65,
    movementSpeedKmh: 24,
    lat: 23.5,
    lon: -88.0,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'pepito',
    name: 'Super Typhoon MAN-YI (Pepito)',
    basin: 'Western Pacific Ocean',
    category: 5,
    categoryLabel: 'Category 5 Super Typhoon',
    maxWindsKts: 145,
    maxWindsKmh: 270,
    pressureHpa: 920,
    movementDirDeg: 300,
    movementSpeedKmh: 20,
    lat: 14.5,
    lon: 126.8,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'helene',
    name: 'Hurricane HELENE',
    basin: 'Gulf of Mexico / Caribbean',
    category: 4,
    categoryLabel: 'Category 4 Major Hurricane',
    maxWindsKts: 120,
    maxWindsKmh: 225,
    pressureHpa: 938,
    movementDirDeg: 15,
    movementSpeedKmh: 35,
    lat: 27.0,
    lon: -84.8,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'gaemi',
    name: 'Typhoon GAEMI',
    basin: 'East China Sea / Taiwan',
    category: 4,
    categoryLabel: 'Category 4 Very Strong Typhoon',
    maxWindsKts: 125,
    maxWindsKmh: 230,
    pressureHpa: 935,
    movementDirDeg: 315,
    movementSpeedKmh: 18,
    lat: 24.2,
    lon: 122.5,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'ilsa',
    name: 'Severe Tropical Cyclone ILSA',
    basin: 'South-East Indian Ocean',
    category: 4,
    categoryLabel: 'Category 4 Severe Tropical Cyclone',
    maxWindsKts: 115,
    maxWindsKmh: 215,
    pressureHpa: 942,
    movementDirDeg: 135,
    movementSpeedKmh: 16,
    lat: -17.5,
    lon: 119.5,
    x: 0,
    y: 0,
    z: 0,
  },
];

for (const c of CYCLONES) {
  const [x, y, z] = geoToSceneSurface(c.lat, c.lon);
  c.x = x;
  c.y = y;
  c.z = z;
}
