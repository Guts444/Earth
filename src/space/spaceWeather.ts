export interface SpaceWeatherMetrics {
  kpIndex: number;
  solarWindSpeedKms: number;
  solarWindDensity: number;
  imfBzNt: number;
  geomagneticStormLevel: string;
  sunspotCount: number;
  solarFlareLevel: string;
  radioBlackoutLevel: string;
}

export const SPACE_WEATHER_DATA: SpaceWeatherMetrics = {
  kpIndex: 3.3,
  solarWindSpeedKms: 432,
  solarWindDensity: 7.2,
  imfBzNt: -2.8,
  geomagneticStormLevel: 'G1 (Minor Storm Watch)',
  sunspotCount: 154,
  solarFlareLevel: 'M1.8 Active Region 3664',
  radioBlackoutLevel: 'R0 (Normal)',
};

// ---------------------------------------------------------------------------
// Live ingestion — NOAA SWPC planetary K-index (1-minute cadence, CORS-open).
// Drives the HUD readout and aurora brightness.
// ---------------------------------------------------------------------------

export function gScaleForKp(kp: number): string {
  if (kp < 5) return 'Quiet / Minor';
  if (kp === 5) return 'G1 (Minor Storm)';
  if (kp === 6) return 'G2 (Moderate Storm)';
  if (kp === 7) return 'G3 (Strong Storm)';
  if (kp === 8) return 'G4 (Severe Storm)';
  return 'G5 (Extreme Storm)';
}

/** Aurora curtain brightness 0..1+ for a given Kp. */
export function kpToAuroraBrightness(kp: number): number {
  return Math.min(1.15, 0.15 + kp * 0.13);
}

/** Returns the new Kp index, or null if the feed was unreachable/stale. */
export async function refreshSpaceWeather(): Promise<number | null> {
  try {
    const res = await fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json');
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ kp_index?: number }>;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const kp = Number(rows[rows.length - 1]?.kp_index);
    if (!Number.isFinite(kp) || kp < 0) return null;
    SPACE_WEATHER_DATA.kpIndex = kp;
    SPACE_WEATHER_DATA.geomagneticStormLevel = gScaleForKp(kp);
    return kp;
  } catch {
    return null;
  }
}
