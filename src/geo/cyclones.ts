import { EARTH_RADIUS, NHC_SNAPSHOT_URL } from '../config';

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

// ---------------------------------------------------------------------------
// Live ingestion — NOAA NHC active storms (Atlantic / E. & C. Pacific).
// Replaces the curated snapshot when the feed has storms; callers keep the
// static list as fallback when the feed is unreachable or empty.
// ---------------------------------------------------------------------------

const NHC_BASE = '/api/nhc/current-storms';

interface NhcStorm {
  id?: string;
  name?: string;
  classification?: string;
  intensity?: string; // kts
  pressure?: string; // mb
  latitudeNumeric?: number;
  longitudeNumeric?: number;
  movementDir?: number; // degrees
  movementSpeed?: number; // kts
}

function saffirSimpson(kts: number): { category: number; categoryLabel: string } {
  if (kts < 34) return { category: 0, categoryLabel: 'Tropical Depression' };
  if (kts < 64) return { category: 0, categoryLabel: 'Tropical Storm' };
  if (kts < 83) return { category: 1, categoryLabel: 'Category 1 Hurricane' };
  if (kts < 96) return { category: 2, categoryLabel: 'Category 2 Hurricane' };
  if (kts < 113) return { category: 3, categoryLabel: 'Category 3 Major Hurricane' };
  if (kts < 137) return { category: 4, categoryLabel: 'Category 4 Major Hurricane' };
  return { category: 5, categoryLabel: 'Category 5 Hurricane' };
}

function basinForId(id: string): string {
  const code = (id || '').slice(0, 2).toLowerCase();
  if (code === 'al') return 'North Atlantic Ocean';
  if (code === 'ep') return 'Eastern North Pacific';
  if (code === 'cp') return 'Central North Pacific';
  return 'Tropical Basin';
}

/** Build scene-ready records from NHC CurrentStorms.json. */
export function mapNhcStorms(raw: { activeStorms?: NhcStorm[] } | null): CycloneRecord[] {
  const storms = raw?.activeStorms;
  if (!Array.isArray(storms) || storms.length === 0) return [];

  return storms
    .filter((s) => {
      const lat = Number(s.latitudeNumeric);
      const lon = Number(s.longitudeNumeric);
      return Number.isFinite(lat) && Number.isFinite(lon);
    })
    .map((s) => {
      const kts = Number(s.intensity);
      const winds = Number.isFinite(kts) && kts > 0 ? kts : 30;
      const { category, categoryLabel } = saffirSimpson(winds);
      const moveKts = Number(s.movementSpeed);
      const movementSpeedKmh = Number.isFinite(moveKts) ? moveKts * 1.852 : 0;
      const moveDeg = Number(s.movementDir);
      const name = s.name || 'UNNAMED';
      const id = (s.id || name).toLowerCase().replace(/[^a-z0-9]/g, '');
      const rec: CycloneRecord = {
        id,
        name: `${s.classification === 'HU' ? 'Hurricane' : s.classification === 'TS' ? 'Tropical Storm' : 'Tropical Depression'} ${name.toUpperCase()}`,
        basin: basinForId(s.id || ''),
        category,
        categoryLabel,
        maxWindsKts: winds,
        maxWindsKmh: Math.round(winds * 1.852),
        pressureHpa: Number(s.pressure) || 0,
        movementDirDeg: Number.isFinite(moveDeg) ? moveDeg : 0,
        movementSpeedKmh,
        lat: Number(s.latitudeNumeric),
        lon: Number(s.longitudeNumeric),
        x: 0,
        y: 0,
        z: 0,
      };
      const [x, y, z] = geoToSceneSurface(rec.lat, rec.lon);
      rec.x = x;
      rec.y = y;
      rec.z = z;
      return rec;
    });
}

/** Replace the displayed cyclone list (scene rebuilds via setStorms). */
export function setLiveCyclones(records: CycloneRecord[]): void {
  CYCLONES.length = 0;
  CYCLONES.push(...records);
}

export async function fetchLiveCyclones(): Promise<CycloneRecord[]> {
  // 1) Dev/preview proxy → 2) CI snapshot branch (production path, since
  // NHC sends no CORS headers) — the snapshot keeps CurrentStorms.json shape.
  let res: Response | null = null;
  try {
    res = await fetch(NHC_BASE, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) res = null;
  } catch {
    res = null;
  }
  if (!res) {
    try {
      res = await fetch(NHC_SNAPSHOT_URL, { signal: AbortSignal.timeout(20000) });
    } catch {
      res = null;
    }
  }
  if (!res || !res.ok) throw new Error(`NHC: HTTP ${res?.status ?? 'unreachable'}`);
  const records = mapNhcStorms(await res.json());
  if (records.length === 0) throw new Error('NHC: no active storms');
  return records;
}
