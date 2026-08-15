import { EARTH_RADIUS } from '../config';

export type VolcanoAlertLevel = 'WARNING' | 'WATCH' | 'ADVISORY' | 'NORMAL';

export interface VolcanoRecord {
  id: string;
  name: string;
  country: string;
  elevationM: number;
  type: string;
  alertLevel: VolcanoAlertLevel;
  recentActivity: string;
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

export const VOLCANOES: VolcanoRecord[] = [
  { id: 'etna', name: 'Mount Etna', country: 'Italy (Sicily)', elevationM: 3357, type: 'Stratovolcano', alertLevel: 'WARNING', recentActivity: 'Strombolian explosions & lava fountain from SE Crater', lat: 37.75, lon: 14.99, x: 0, y: 0, z: 0 },
  { id: 'kilauea', name: 'Kīlauea Caldera', country: 'United States (Hawaii)', elevationM: 1247, type: 'Shield Volcano', alertLevel: 'WARNING', recentActivity: 'Active lava effusion within Halemaʻumaʻu crater', lat: 19.42, lon: -155.29, x: 0, y: 0, z: 0 },
  { id: 'merapi', name: 'Mount Merapi', country: 'Indonesia (Java)', elevationM: 2910, type: 'Stratovolcano', alertLevel: 'WATCH', recentActivity: 'Lava dome growth & incandescent block avalanches', lat: -7.54, lon: 110.44, x: 0, y: 0, z: 0 },
  { id: 'popocatepetl', name: 'Popocatépetl', country: 'Mexico (Puebla)', elevationM: 5426, type: 'Stratovolcano', alertLevel: 'ADVISORY', recentActivity: 'Continuous gas-and-ash exhalations up to 2.5 km altitude', lat: 19.02, lon: -98.62, x: 0, y: 0, z: 0 },
  { id: 'reykjanes', name: 'Reykjanes / Sundhnúkur', country: 'Iceland', elevationM: 385, type: 'Fissure Vent System', alertLevel: 'WATCH', recentActivity: 'Magma dike accumulation & periodic basaltic fissure eruptions', lat: 63.88, lon: -22.43, x: 0, y: 0, z: 0 },
  { id: 'sakurajima', name: 'Sakurajima', country: 'Japan (Kyushu)', elevationM: 1117, type: 'Stratovolcano', alertLevel: 'WARNING', recentActivity: 'Explosive vulcanian eruptive pulses with volcanic lightning', lat: 31.59, lon: 130.65, x: 0, y: 0, z: 0 },
  { id: 'fuego', name: 'Volcán de Fuego', country: 'Guatemala', elevationM: 3763, type: 'Stratovolcano', alertLevel: 'WARNING', recentActivity: 'Ash plumes reaching 4,800m with incandescent ballistic ejecta', lat: 14.47, lon: -90.88, x: 0, y: 0, z: 0 },
  { id: 'stromboli', name: 'Stromboli', country: 'Italy (Aeolian Islands)', elevationM: 924, type: 'Stratovolcano', alertLevel: 'WATCH', recentActivity: 'Rhythmic ejecta and spatter from Sciara del Fuoco vents', lat: 38.79, lon: 15.21, x: 0, y: 0, z: 0 },
  { id: 'villarrica', name: 'Villarrica', country: 'Chile (Araucanía)', elevationM: 2847, type: 'Stratovolcano', alertLevel: 'ADVISORY', recentActivity: 'Tremor pulses and nocturnal glow over open magma lake', lat: -39.42, lon: -71.93, x: 0, y: 0, z: 0 },
  { id: 'maunaloa', name: 'Mauna Loa', country: 'United States (Hawaii)', elevationM: 4169, type: 'Shield Volcano', alertLevel: 'NORMAL', recentActivity: 'Inflation monitoring & baseline volcanic gas background', lat: 19.47, lon: -155.6, x: 0, y: 0, z: 0 },
];

for (const v of VOLCANOES) {
  const [x, y, z] = geoToSceneSurface(v.lat, v.lon);
  v.x = x;
  v.y = y;
  v.z = z;
}
