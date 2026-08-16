import { EARTH_RADIUS } from '../config';

export interface CableSystemDef {
  id: string;
  name: string;
  /** Route polylines (lon/lat). One cable can have several segments. */
  segments: Array<Array<{ lat: number; lon: number }>>;
  lengthKm?: number | null;
  rfsYear?: number | null;
  owners?: string | null;
}

export interface LandingStationNode {
  id: string;
  name: string;
  country: string;
  /** Cable names landing at this station (from the dataset). */
  cables: string[];
  lat: number;
  lon: number;
  x: number;
  y: number;
  z: number;
}

export function geoToOceanFloor(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  // Sits directly on water surface / ocean floor level (1.001)
  const r = EARTH_RADIUS * 1.001;

  const clat = Math.cos(lat);
  const ecfX = r * clat * Math.cos(lon);
  const ecfY = r * clat * Math.sin(lon);
  const ecfZ = r * Math.sin(lat);

  return [ecfX, ecfZ, -ecfY];
}

// ---------------------------------------------------------------------------
// Curated fallback — only used when public/data/cables.json cannot load
// (e.g. offline file:// use). The real dataset is TeleGeography's full
// submarine cable map, refreshed weekly by .github/workflows/update-cables.yml.
// ---------------------------------------------------------------------------

export const FALLBACK_CABLES: CableSystemDef[] = [
  { id: 'marea', name: 'MAREA Submarine Cable', segments: [[
    { lat: 36.85, lon: -75.97 }, { lat: 37.5, lon: -70.0 }, { lat: 39.0, lon: -55.0 },
    { lat: 41.5, lon: -40.0 }, { lat: 43.0, lon: -25.0 }, { lat: 43.8, lon: -12.0 },
    { lat: 43.5, lon: -6.0 }, { lat: 43.35, lon: -3.0 },
  ]] },
  { id: 'dunant', name: 'Dunant Transatlantic Cable', segments: [[
    { lat: 36.85, lon: -75.97 }, { lat: 38.2, lon: -68.0 }, { lat: 41.0, lon: -50.0 },
    { lat: 44.0, lon: -35.0 }, { lat: 46.5, lon: -20.0 }, { lat: 47.0, lon: -10.0 },
    { lat: 46.7, lon: -1.95 },
  ]] },
  { id: 'grace-hopper', name: 'Grace Hopper Cable', segments: [[
    { lat: 40.75, lon: -72.93 }, { lat: 41.5, lon: -60.0 }, { lat: 44.5, lon: -45.0 },
    { lat: 47.5, lon: -30.0 }, { lat: 49.5, lon: -18.0 }, { lat: 50.8, lon: -4.55 },
    { lat: 48.0, lon: -7.0 }, { lat: 43.35, lon: -3.0 },
  ]] },
  { id: 'ellalink', name: 'EllaLink South America-Europe', segments: [[
    { lat: -3.72, lon: -38.5 }, { lat: 2.0, lon: -32.0 }, { lat: 8.5, lon: -28.0 },
    { lat: 14.9, lon: -23.5 }, { lat: 22.0, lon: -20.0 }, { lat: 32.6, lon: -16.9 },
    { lat: 37.0, lon: -12.0 }, { lat: 37.95, lon: -8.86 },
  ]] },
  { id: '2africa', name: '2Africa Megacable', segments: [[
    { lat: 43.3, lon: 5.37 }, { lat: 37.0, lon: 11.5 }, { lat: 34.0, lon: 24.0 },
    { lat: 31.25, lon: 32.3 }, { lat: 27.5, lon: 34.5 }, { lat: 21.0, lon: 38.0 },
    { lat: 12.6, lon: 43.3 }, { lat: 11.6, lon: 43.15 }, { lat: 5.0, lon: 48.0 },
    { lat: -4.05, lon: 39.66 }, { lat: -15.0, lon: 42.0 }, { lat: -26.0, lon: 34.0 },
    { lat: -33.9, lon: 18.4 }, { lat: -22.0, lon: 12.0 }, { lat: -8.83, lon: 13.23 },
    { lat: 4.0, lon: 6.0 }, { lat: 6.45, lon: 3.4 }, { lat: 4.5, lon: -4.0 },
    { lat: 14.7, lon: -17.4 }, { lat: 28.0, lon: -16.0 }, { lat: 38.7, lon: -9.14 },
  ]] },
  { id: 'seamewe-5', name: 'SEA-ME-WE 5 Intercontinental', segments: [[
    { lat: 1.3, lon: 103.65 }, { lat: 2.5, lon: 101.5 }, { lat: 5.8, lon: 95.0 },
    { lat: 6.9, lon: 79.85 }, { lat: 18.9, lon: 72.8 }, { lat: 15.0, lon: 62.0 },
    { lat: 11.6, lon: 43.15 }, { lat: 21.0, lon: 38.0 }, { lat: 29.0, lon: 32.6 },
    { lat: 31.5, lon: 32.3 }, { lat: 35.0, lon: 20.0 }, { lat: 37.5, lon: 15.1 },
    { lat: 40.0, lon: 9.0 }, { lat: 43.3, lon: 5.37 },
  ]] },
  { id: 'southern-cross', name: 'Southern Cross Transpacific', segments: [[
    { lat: -33.86, lon: 151.2 }, { lat: -35.0, lon: 162.0 }, { lat: -36.85, lon: 174.75 },
    { lat: -28.0, lon: 178.0 }, { lat: -18.14, lon: 178.4 }, { lat: -5.0, lon: -175.0 },
    { lat: 10.0, lon: -165.0 }, { lat: 21.3, lon: -157.85 }, { lat: 32.0, lon: -140.0 },
    { lat: 42.0, lon: -128.0 }, { lat: 45.5, lon: -122.9 },
  ]] },
  { id: 'tpe', name: 'Trans-Pacific Express (TPE)', segments: [[
    { lat: 45.7, lon: -123.95 }, { lat: 45.0, lon: -140.0 }, { lat: 44.0, lon: -170.0 },
    { lat: 42.0, lon: 170.0 }, { lat: 38.0, lon: 150.0 }, { lat: 34.95, lon: 139.95 },
    { lat: 33.0, lon: 130.0 }, { lat: 34.8, lon: 128.7 }, { lat: 36.0, lon: 121.5 },
    { lat: 31.5, lon: 121.8 },
  ]] },
  { id: 'sacs', name: 'South Atlantic Cable System (SACS)', segments: [[
    { lat: -3.72, lon: -38.5 }, { lat: -4.5, lon: -28.0 }, { lat: -6.0, lon: -15.0 },
    { lat: -7.5, lon: -2.0 }, { lat: -8.83, lon: 13.23 },
  ]] },
];

const FALLBACK_STATIONS_RAW: Array<{
  name: string;
  country: string;
  cables: string[];
  lat: number;
  lon: number;
}> = [
  { name: 'Virginia Beach Landing Hub', country: 'United States', cables: ['MAREA', 'Dunant', 'Grace Hopper', 'Confluence'], lat: 36.85, lon: -75.97 },
  { name: 'Bude Cable Hub', country: 'United Kingdom', cables: ['Grace Hopper', 'Apollo', 'TAT-14', 'Yellow'], lat: 50.83, lon: -4.54 },
  { name: 'Marseille Telecom Gateway', country: 'France', cables: ['2Africa', 'SEA-ME-WE 5', 'PEACE', 'AAE-1'], lat: 43.3, lon: 5.37 },
  { name: 'Fortaleza International Hub', country: 'Brazil', cables: ['EllaLink', 'SACS', 'Monet', 'Junior', 'Seabras-1'], lat: -3.72, lon: -38.5 },
  { name: 'Sines Deep Sea Terminal', country: 'Portugal', cables: ['EllaLink', '2Africa', 'Nuvem'], lat: 37.95, lon: -8.86 },
  { name: 'Singapore Tuas Landing Hub', country: 'Singapore', cables: ['SEA-ME-WE 5', 'SJC2', 'APG', 'Echo', 'Bifrost'], lat: 1.3, lon: 103.65 },
  { name: 'Cape Town Melkbosstrand', country: 'South Africa', cables: ['2Africa', 'Equiano', 'WACS', 'SAT-3'], lat: -33.72, lon: 18.44 },
  { name: 'Tokyo Chikura Gateway', country: 'Japan', cables: ['TPE', 'FASTER', 'JUPITER', 'Unity'], lat: 34.95, lon: 139.95 },
  { name: 'Sydney Paddington Terminal', country: 'Australia', cables: ['Southern Cross', 'Hawaiki', 'Indigo-Central', 'JGA-South'], lat: -33.88, lon: 151.22 },
  { name: 'Honolulu Makaha Hub', country: 'United States', cables: ['Southern Cross', 'Hawaiki', 'JUPITER', 'Honotua'], lat: 21.47, lon: -158.22 },
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function countryFromName(name: string): string {
  const i = name.lastIndexOf(',');
  return i >= 0 ? name.slice(i + 1).trim() : 'Unknown';
}

function makeStation(
  s: { id?: string; name: string; country?: string; cables?: string[]; lat: number; lon: number },
): LandingStationNode {
  const st: LandingStationNode = {
    id: s.id ?? slugify(s.name),
    name: s.name,
    country: s.country ?? countryFromName(s.name),
    cables: s.cables ?? [],
    lat: s.lat,
    lon: s.lon,
    x: 0,
    y: 0,
    z: 0,
  };
  const [x, y, z] = geoToOceanFloor(st.lat, st.lon);
  st.x = x;
  st.y = y;
  st.z = z;
  return st;
}

export const FALLBACK_STATIONS: LandingStationNode[] =
  FALLBACK_STATIONS_RAW.map((s) => makeStation(s));

// ---------------------------------------------------------------------------
// Runtime loader — TeleGeography full dataset snapshot (public/data/cables.json)
// ---------------------------------------------------------------------------

const CABLE_DATA_URL = 'data/cables.json';

export interface CableDataset {
  cables: CableSystemDef[];
  stations: LandingStationNode[];
  generated: string;
}

let cached: CableDataset | null = null;

/**
 * Load the full submarine cable dataset. The snapshot file ships with the
 * site (built by scripts/build-cables-data.py, refreshed weekly by CI), so
 * this fetch is same-origin and always available. Falls back to the curated
 * list only if the file itself is missing.
 */
export async function loadCableData(): Promise<CableDataset> {
  if (cached) return cached;
  try {
    const res = await fetch(CABLE_DATA_URL);
    if (!res.ok) throw new Error(`cables.json HTTP ${res.status}`);
    const raw = (await res.json()) as {
      generated?: string;
      cables?: Array<Record<string, unknown>>;
      stations?: Array<Record<string, unknown>>;
    };

    const cables: CableSystemDef[] = (raw.cables ?? [])
      .map((c: Record<string, unknown>) => ({
        id: String(c.id),
        name: String(c.name ?? c.id),
        lengthKm: (c.lengthKm as number | null) ?? null,
        rfsYear: (c.rfsYear as number | null) ?? null,
        owners: (c.owners as string | null) ?? null,
        segments: ((c.segments as unknown[]) ?? []).map((seg) =>
          (seg as Array<[number, number]>).map(([lon, lat]) => ({ lat, lon })),
        ),
      }))
      .filter((c) => c.segments.length > 0);

    const stationIdsByCable = new Map<string, string[]>(
      (raw.cables ?? [])
        .map((c: Record<string, unknown>) => [
          String(c.id),
          (c.stations as string[]) ?? [],
        ])
        .filter(([, s]) => (s as string[]).length > 0) as Array<[string, string[]]>,
    );
    const cableNameById = new Map(cables.map((c) => [c.id, c.name]));

    const stations: LandingStationNode[] = ((raw.stations ?? []) as Array<{
      id: string;
      name: string;
      lat: number;
      lon: number;
    }>).map((s) =>
      makeStation({
        id: s.id,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
      }),
    );

    // Invert cable -> stations into station -> cable names
    const cableNamesByStation = new Map<string, Set<string>>();
    for (const [cid, sids] of stationIdsByCable) {
      const name = cableNameById.get(cid);
      if (!name) continue;
      for (const sid of sids) {
        if (!cableNamesByStation.has(sid)) cableNamesByStation.set(sid, new Set());
        cableNamesByStation.get(sid)!.add(name);
      }
    }
    for (const st of stations) {
      const names = cableNamesByStation.get(st.id);
      if (names) st.cables = [...names].sort((a, b) => a.localeCompare(b));
    }

    if (cables.length === 0 || stations.length === 0) {
      throw new Error('cables.json: empty dataset');
    }
    cached = { cables, stations, generated: String(raw.generated ?? '') };
  } catch (err) {
    console.warn('cables.json unavailable — curated fallback:', err);
    cached = { cables: FALLBACK_CABLES, stations: FALLBACK_STATIONS, generated: '' };
  }
  return cached;
}
