export const EARTH_RADIUS_KM = 6371.0;
/** Scene units per kilometer — Earth radius becomes 1.0 in the scene. */
export const KM_TO_UNITS = 1 / EARTH_RADIUS_KM;
export const EARTH_RADIUS = 1;
export const ATMOSPHERE_SCALE = 1.018;
export const CLOUDS_SCALE = 1.004;

/**
 * Camera-distance thresholds (in earth radii) for the automatic global →
 * detail blend: `detail = 1 - smoothstep(DETAIL_BLEND_NEAR, DETAIL_BLEND_FAR, d)`.
 * - d >= DETAIL_BLEND_FAR (global view): real day/night, clouds fully visible
 * - d <= DETAIL_BLEND_NEAR (regional/local view): full daylight, clouds gone
 * - in between: a NARROW smooth continuous transition (no hard pop)
 * Camera minDistance is 1.2, maxDistance 4.2, default view ~4.05 (≈ maximum
 * zoom-out), hotspots fly to 1.4–2.8 (all below NEAR → full detail).
 */
export const DETAIL_BLEND_NEAR = 3.0;
export const DETAIL_BLEND_FAR = 3.8;
export const CAMERA_NEAR = 0.01;
export const CAMERA_FAR = 350;

/** How often to run full SGP4 (ms). Between updates, positions are extrapolated with velocity. */
export const PROPAGATE_INTERVAL_MS = 500;

/** LocalStorage cache lifetime for TLE text. */
export const TLE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/** Proxied endpoints */
export const CELESTRAK_BASE = '/api/celestrak/NORAD/elements/gp.php';
export const OPENSKY_BASE = '/api/opensky/states/all';
export const USGS_BASE = '/api/usgs/earthquakes';

/**
 * CI-fed snapshot branch (live-data) — the production path for feeds whose
 * upstreams block browser CORS (OpenSky, NOAA NHC). Refreshed by
 * .github/workflows/update-live-feeds.yml.
 */
export const LIVE_DATA_BRANCH = 'live-data';
export const LIVE_DATA_BASE =
  'https://raw.githubusercontent.com/Guts444/Earth/live-data';
export const OPENSKY_SNAPSHOT_URL = `${LIVE_DATA_BASE}/states.json`;
export const NHC_SNAPSHOT_URL = `${LIVE_DATA_BASE}/nhc.json`;
export const OPENSKY_SNAPSHOT_CACHE_TTL_MS = 20 * 60 * 1000;

// ---------------------------------------------------------------------------
// Domains & Selection
// ---------------------------------------------------------------------------

export type DomainType =
  | 'satellite'
  | 'flight'
  | 'marine'
  | 'earthquake'
  | 'cable'
  | 'dsn'
  | 'asteroid'
  | 'wildfire'
  | 'volcano'
  | 'cyclone'
  | 'gpsjam'
  | 'launch'
  | 'nuclear';

export interface SelectedTarget {
  domain: DomainType;
  id: string;
  name: string;
  subType: string;
  lat: number;
  lon: number;
  altKm: number;
  speedKmh: number;
  heading?: number;
  origin?: string;
  destination?: string;
  country?: string;
  operator?: string;
  extra?: Record<string, string | number>;
  scenePos: [number, number, number];
}

// ---------------------------------------------------------------------------
// Satellite Groups
// ---------------------------------------------------------------------------

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
  rgb: [number, number, number];
  defaultOn: boolean;
  emphasize?: boolean;
}

export const SAT_GROUPS: SatGroupDef[] = [
  { id: 'starlink', label: 'Starlink', color: '#4cc9f0', rgb: [0.3, 0.79, 0.94], defaultOn: true },
  { id: 'oneweb', label: 'OneWeb', color: '#c77dff', rgb: [0.78, 0.49, 1.0], defaultOn: true },
  { id: 'stations', label: 'Space stations (ISS…)', color: '#ffd166', rgb: [1.0, 0.82, 0.4], defaultOn: true, emphasize: true },
  { id: 'gps-ops', label: 'GPS', color: '#5ef0a0', rgb: [0.37, 0.94, 0.63], defaultOn: true },
  { id: 'galileo', label: 'Galileo', color: '#80ed99', rgb: [0.5, 0.93, 0.6], defaultOn: false },
  { id: 'glo-ops', label: 'GLONASS', color: '#95d5b2', rgb: [0.58, 0.84, 0.7], defaultOn: false },
  { id: 'beidou', label: 'BeiDou', color: '#b7e4c7', rgb: [0.72, 0.89, 0.78], defaultOn: false },
  { id: 'iridium-NEXT', label: 'Iridium NEXT', color: '#ff8fab', rgb: [1.0, 0.56, 0.67], defaultOn: false },
  { id: 'weather', label: 'Weather', color: '#ff9f1c', rgb: [1.0, 0.62, 0.11], defaultOn: false },
  { id: 'science', label: 'Science', color: '#a0c4ff', rgb: [0.63, 0.77, 1.0], defaultOn: false },
  { id: 'visual', label: '100 brightest', color: '#f8f9fa', rgb: [0.97, 0.97, 0.98], defaultOn: false, emphasize: true },
  { id: 'active', label: 'All active (~12k)', color: '#adb5bd', rgb: [0.68, 0.71, 0.74], defaultOn: false },
];

export const GROUP_BY_ID = Object.fromEntries(
  SAT_GROUPS.map((g) => [g.id, g]),
) as Record<SatGroupId, SatGroupDef>;

// ---------------------------------------------------------------------------
// Aviation Domain Configurations
// ---------------------------------------------------------------------------

export type FlightCategory = 'commercial' | 'cargo' | 'high-altitude' | 'military' | 'general';

export interface FlightCategoryDef {
  id: FlightCategory;
  label: string;
  color: string;
  rgb: [number, number, number];
  defaultOn: boolean;
}

export const FLIGHT_CATEGORIES: FlightCategoryDef[] = [
  { id: 'commercial', label: 'Commercial Airliners', color: '#00f0ff', rgb: [0.0, 0.94, 1.0], defaultOn: true },
  { id: 'cargo', label: 'Air Freight / Cargo', color: '#ffb703', rgb: [1.0, 0.72, 0.01], defaultOn: true },
  { id: 'high-altitude', label: 'High-Altitude / Long-Haul', color: '#b5179e', rgb: [0.71, 0.09, 0.62], defaultOn: true },
  { id: 'military', label: 'Government / Special', color: '#ef233c', rgb: [0.94, 0.14, 0.24], defaultOn: true },
  { id: 'general', label: 'Regional / General Aviation', color: '#70e000', rgb: [0.44, 0.88, 0.0], defaultOn: true },
];

// ---------------------------------------------------------------------------
// Maritime Domain Configurations
// ---------------------------------------------------------------------------

export type MarineCategory = 'cargo' | 'tanker' | 'container' | 'passenger' | 'naval' | 'fishing';

export interface MarineCategoryDef {
  id: MarineCategory;
  label: string;
  color: string;
  rgb: [number, number, number];
  defaultOn: boolean;
}

export const MARINE_CATEGORIES: MarineCategoryDef[] = [
  { id: 'container', label: 'Container Megaships', color: '#38b000', rgb: [0.22, 0.69, 0.0], defaultOn: true },
  { id: 'tanker', label: 'Oil / LNG Tankers', color: '#fb8500', rgb: [0.98, 0.52, 0.0], defaultOn: true },
  { id: 'cargo', label: 'Bulk / General Cargo', color: '#48cae4', rgb: [0.28, 0.79, 0.89], defaultOn: true },
  { id: 'passenger', label: 'Cruise & Ferries', color: '#ff70a6', rgb: [1.0, 0.44, 0.65], defaultOn: true },
  { id: 'naval', label: 'Naval / Defense Vessels', color: '#e63946', rgb: [0.9, 0.22, 0.27], defaultOn: true },
  { id: 'fishing', label: 'Commercial Fleets', color: '#a370f7', rgb: [0.64, 0.44, 0.97], defaultOn: false },
];

// ---------------------------------------------------------------------------
// Tactical Hotspots / Presets
// ---------------------------------------------------------------------------

export interface HotspotPreset {
  id: string;
  name: string;
  category: 'Spaceport' | 'Chokepoint' | 'Metro' | 'Aviation Hub' | 'Geology' | 'Deep Space';
  lat: number;
  lon: number;
  altitudeUnits: number;
  description: string;
}

export const HOTSPOT_PRESETS: HotspotPreset[] = [
  {
    id: 'canaveral',
    name: 'Cape Canaveral / KSC',
    category: 'Spaceport',
    lat: 28.5729,
    lon: -80.649,
    altitudeUnits: 1.6,
    description: 'Primary launch complex for NASA, SpaceX & US Space Force.',
  },
  {
    id: 'starbase',
    name: 'Starbase Boca Chica',
    category: 'Spaceport',
    lat: 25.9972,
    lon: -97.1567,
    altitudeUnits: 1.6,
    description: 'SpaceX Starship orbital launch complex and manufacturing facility.',
  },
  {
    id: 'goldstone',
    name: 'Goldstone DSN Complex',
    category: 'Deep Space',
    lat: 35.4267,
    lon: -116.89,
    altitudeUnits: 1.6,
    description: 'Mojave Desert station communicating with Voyager 1 and deep space probes.',
  },
  {
    id: 'suez',
    name: 'Suez Canal',
    category: 'Chokepoint',
    lat: 30.5852,
    lon: 32.2654,
    altitudeUnits: 1.5,
    description: 'Vital waterway connecting Mediterranean to Red Sea.',
  },
  {
    id: 'malacca',
    name: 'Strait of Malacca',
    category: 'Chokepoint',
    lat: 2.2,
    lon: 102.25,
    altitudeUnits: 1.6,
    description: 'Main shipping conduit between Indian and Pacific oceans.',
  },
  {
    id: 'panama',
    name: 'Panama Canal',
    category: 'Chokepoint',
    lat: 9.08,
    lon: -79.68,
    altitudeUnits: 1.5,
    description: 'Interoceanic canal linking Atlantic and Pacific oceans.',
  },
  {
    id: 'ring-of-fire',
    name: 'Pacific Ring of Fire',
    category: 'Geology',
    lat: 35.6762,
    lon: 139.6503,
    altitudeUnits: 2.8,
    description: 'Horseshoe basin of intense volcanic and earthquake activity.',
  },
  {
    id: 'north-atlantic',
    name: 'North Atlantic Air Tracks',
    category: 'Aviation Hub',
    lat: 53.35,
    lon: -30.0,
    altitudeUnits: 2.4,
    description: 'Heaviest oceanic jet airspace with thousands of daily flights.',
  },
];

// ---------------------------------------------------------------------------
// Command Center Theme Presets
// ---------------------------------------------------------------------------

export type ThemePreset = 'cyber-blue' | 'tactical-amber' | 'emerald-radar' | 'stealth';

export interface ThemeDef {
  id: ThemePreset;
  name: string;
  accent: string;
  accentRgb: [number, number, number];
  panelBg: string;
  glow: string;
}

export const THEMES: Record<ThemePreset, ThemeDef> = {
  'cyber-blue': {
    id: 'cyber-blue',
    name: 'Cyber Blue',
    accent: '#4cc9f0',
    accentRgb: [0.3, 0.79, 0.94],
    panelBg: 'rgba(6, 14, 28, 0.82)',
    glow: 'rgba(76, 201, 240, 0.35)',
  },
  'tactical-amber': {
    id: 'tactical-amber',
    name: 'Tactical Amber',
    accent: '#ffb703',
    accentRgb: [1.0, 0.72, 0.01],
    panelBg: 'rgba(24, 16, 4, 0.85)',
    glow: 'rgba(255, 183, 3, 0.35)',
  },
  'emerald-radar': {
    id: 'emerald-radar',
    name: 'Emerald Radar',
    accent: '#5ef0a0',
    accentRgb: [0.37, 0.94, 0.63],
    panelBg: 'rgba(4, 24, 14, 0.85)',
    glow: 'rgba(94, 240, 160, 0.35)',
  },
  stealth: {
    id: 'stealth',
    name: 'Deep Stealth',
    accent: '#a0c4ff',
    accentRgb: [0.63, 0.77, 1.0],
    panelBg: 'rgba(10, 12, 16, 0.90)',
    glow: 'rgba(160, 196, 255, 0.25)',
  },
};
