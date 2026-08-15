import { EARTH_RADIUS } from '../config';

export interface WildfireCluster {
  id: string;
  name: string;
  country: string;
  region: string;
  brightnessK: number;
  frpMw: number; // Fire Radiative Power (MW)
  confidence: string;
  satellite: string;
  lat: number;
  lon: number;
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

export const WILDFIRE_CLUSTERS: WildfireCluster[] = [
  { id: 'fire-amazon-1', name: 'Amazon Basin Southern Arc', country: 'Brazil', region: 'Mato Grosso / Pará', brightnessK: 372, frpMw: 540, confidence: 'High (98%)', satellite: 'NOAA-20 VIIRS', lat: -11.5, lon: -54.8, x: 0, y: 0, z: 0 },
  { id: 'fire-amazon-2', name: 'Pantanal Wetland Complex', country: 'Brazil', region: 'Mato Grosso do Sul', brightnessK: 358, frpMw: 260, confidence: 'Nominal (87%)', satellite: 'Suomi NPP VIIRS', lat: -18.2, lon: -56.5, x: 0, y: 0, z: 0 },
  { id: 'fire-cal-1', name: 'Sierra Nevada Wilderness Fire', country: 'United States', region: 'California', brightnessK: 381, frpMw: 680, confidence: 'High (99%)', satellite: 'Aqua MODIS', lat: 37.8, lon: -119.5, x: 0, y: 0, z: 0 },
  { id: 'fire-oregon-1', name: 'Cascade Range Forest Fire', country: 'United States', region: 'Oregon', brightnessK: 352, frpMw: 210, confidence: 'High (94%)', satellite: 'Terra MODIS', lat: 44.1, lon: -121.8, x: 0, y: 0, z: 0 },
  { id: 'fire-alberta-1', name: 'Athabasca Boreal Fire Cluster', country: 'Canada', region: 'Alberta', brightnessK: 366, frpMw: 410, confidence: 'High (96%)', satellite: 'NOAA-20 VIIRS', lat: 56.7, lon: -111.4, x: 0, y: 0, z: 0 },
  { id: 'fire-siberia-1', name: 'Yakutia Taiga Wildfire', country: 'Russia', region: 'Sakha Republic', brightnessK: 364, frpMw: 380, confidence: 'High (95%)', satellite: 'Suomi NPP VIIRS', lat: 62.0, lon: 129.7, x: 0, y: 0, z: 0 },
  { id: 'fire-africa-1', name: 'Congo Basin Savanna Fire', country: 'DR Congo', region: 'Kasai-Occidental', brightnessK: 369, frpMw: 470, confidence: 'High (97%)', satellite: 'Aqua MODIS', lat: -5.8, lon: 22.4, x: 0, y: 0, z: 0 },
  { id: 'fire-australia-1', name: 'Kimberley Savanna Burning', country: 'Australia', region: 'Western Australia', brightnessK: 374, frpMw: 510, confidence: 'High (98%)', satellite: 'NOAA-20 VIIRS', lat: -16.8, lon: 126.5, x: 0, y: 0, z: 0 },
  { id: 'fire-indonesia-1', name: 'Kalimantan Peatland Fire', country: 'Indonesia', region: 'Central Kalimantan', brightnessK: 355, frpMw: 230, confidence: 'Nominal (89%)', satellite: 'Terra MODIS', lat: -2.2, lon: 113.9, x: 0, y: 0, z: 0 },
  { id: 'fire-med-1', name: 'Peloponnese Brush Fire', country: 'Greece', region: 'Peloponnese', brightnessK: 348, frpMw: 180, confidence: 'Nominal (85%)', satellite: 'NOAA-20 VIIRS', lat: 37.5, lon: 22.3, x: 0, y: 0, z: 0 },
];

for (const f of WILDFIRE_CLUSTERS) {
  const [x, y, z] = geoToSceneSurface(f.lat, f.lon);
  f.x = x;
  f.y = y;
  f.z = z;
}
