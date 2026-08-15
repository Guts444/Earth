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
