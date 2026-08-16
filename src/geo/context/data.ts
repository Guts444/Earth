/**
 * Geographic context data model + loader.
 *
 * The runtime model for `public/data/geo-context.json` (built by
 * scripts/build-geo-data.mjs from Natural Earth — see that script for the
 * exact field mapping and provenance). Separated from rendering so the data
 * can later feed search, geocoding, or a MapLibre-style detail renderer
 * without touching the scene code.
 *
 * Line coordinates are flat integer arrays scaled ×1000 (degrees × 1e-3);
 * label/city coordinates are float degrees.
 */

export interface GeoMeta {
  /** Dataset source name. */
  s: string;
  /** Source version (Natural Earth tag). */
  v: string;
  /** License. */
  l: string;
  /** Source URL base. */
  u: string;
  /** Build date (YYYY-MM-DD). */
  b: string;
  /** Upstream source files. */
  f: string[];
}

export interface CountryLabel {
  /** ISO 3166-1 alpha-2. */
  cc: string;
  name: string;
  /** Natural Earth LABELRANK (2 = most prominent … 7). */
  rank: number;
  /** Natural Earth cartographic label point. */
  lon: number;
  lat: number;
  pop: number;
  /** Area in deg² (tie-break only). */
  area: number;
  /** Stable build order (deterministic ties). */
  o: number;
}

export interface CountryLine {
  /** 0 = international boundary, 1 = disputed / line of control / indefinite. */
  k: number;
  /** Flat [lon*1000, lat*1000, …] polyline. */
  q: number[];
}

export interface Admin1Label {
  cc: string;
  /** Admin-1 code (ISO 3166-2 when available, else the region name). */
  c: string;
  /** Display name. */
  n: string;
  /** Label rank (lower = more prominent). */
  r: number;
  /** Longitude (degrees). */
  x: number;
  /** Latitude (degrees). */
  y: number;
  /** Short code for the country-scale band (postal/ISO-derived), or null. */
  s: string | null;
}

export interface Admin1Line {
  cc: string;
  /** Flat polylines: array of flat [lon*1000, lat*1000, …] arrays. */
  q: number[][];
}

export interface CityLabel {
  /** Display name. */
  n: string;
  cc: string;
  /** Country display name. */
  co: string;
  /** Admin-1 display name (from the populated-places dataset). */
  ad: string;
  /** Longitude (degrees). */
  x: number;
  /** Latitude (degrees). */
  y: number;
  pop: number;
  /** LOD tier 0 (capitals/world cities) … 4 (small towns, local zoom only). */
  t: number;
  /** Collision priority (higher = more important). */
  pr: number;
  c0: number;
  c1: number;
}

export interface GeoContextData {
  meta: GeoMeta;
  countries: CountryLabel[];
  countryLines: CountryLine[];
  admin1: Admin1Label[];
  admin1Lines: Admin1Line[];
  cities: CityLabel[];
}

/** Same-origin bundled dataset — no runtime polling, no fallback chain. */
const GEO_DATA_URL = 'data/geo-context.json';

export async function loadGeoContextData(): Promise<GeoContextData> {
  const res = await fetch(GEO_DATA_URL);
  if (!res.ok) {
    throw new Error(`geo-context dataset unavailable (HTTP ${res.status})`);
  }
  return (await res.json()) as GeoContextData;
}

/** Cheap structural sanity check before handing data to the scene builder. */
export function validateGeoData(data: GeoContextData): string[] {
  const errors: string[] = [];
  if (!Array.isArray(data.countries) || data.countries.length < 150) {
    errors.push(`countries: expected ≥150, got ${data.countries?.length}`);
  }
  if (!Array.isArray(data.countryLines) || data.countryLines.length < 100) {
    errors.push(`countryLines: expected ≥100, got ${data.countryLines?.length}`);
  }
  if (!Array.isArray(data.cities) || data.cities.length < 5000) {
    errors.push(`cities: expected ≥5000, got ${data.cities?.length}`);
  }
  if (!Array.isArray(data.admin1) || data.admin1.length < 200) {
    errors.push(`admin1 labels: expected ≥200, got ${data.admin1?.length}`);
  }
  for (const c of data.countries.slice(0, 50)) {
    if (Math.abs(c.lat) > 90 || Math.abs(c.lon) > 180) errors.push(`bad country label: ${c.name}`);
  }
  return errors;
}
