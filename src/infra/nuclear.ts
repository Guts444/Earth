import { EARTH_RADIUS } from '../config';

export interface NuclearPlantRecord {
  id: string;
  name: string;
  country: string;
  operator: string;
  reactorType: string;
  activeUnits: number;
  capacityMwe: number;
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

export const NUCLEAR_PLANTS: NuclearPlantRecord[] = [
  { id: 'bruce', name: 'Bruce Nuclear Generating Station', country: 'Canada', operator: 'Bruce Power', reactorType: 'CANDU-791', activeUnits: 8, capacityMwe: 6550, lat: 44.32, lon: -81.6, x: 0, y: 0, z: 0 },
  { id: 'zaporizhzhia', name: 'Zaporizhzhia Nuclear Power Plant', country: 'Ukraine', operator: 'Energoatom', reactorType: 'VVER-1000', activeUnits: 6, capacityMwe: 5700, lat: 47.51, lon: 34.58, x: 0, y: 0, z: 0 },
  { id: 'kashiwazaki', name: 'Kashiwazaki-Kariwa Nuclear Station', country: 'Japan', operator: 'TEPCO', reactorType: 'ABWR / BWR', activeUnits: 7, capacityMwe: 7965, lat: 37.43, lon: 138.6, x: 0, y: 0, z: 0 },
  { id: 'gravelines', name: 'Centrale Nucléaire de Gravelines', country: 'France', operator: 'Électricité de France (EDF)', reactorType: 'PWR (CP1)', activeUnits: 6, capacityMwe: 5460, lat: 51.01, lon: 2.14, x: 0, y: 0, z: 0 },
  { id: 'hanul', name: 'Hanul Nuclear Power Plant', country: 'South Korea', operator: 'KHNP', reactorType: 'PWR / APR-1400', activeUnits: 7, capacityMwe: 6189, lat: 37.09, lon: 129.38, x: 0, y: 0, z: 0 },
  { id: 'paloverde', name: 'Palo Verde Generating Station', country: 'United States', operator: 'Arizona Public Service', reactorType: 'System 80 PWR', activeUnits: 3, capacityMwe: 3937, lat: 33.39, lon: -112.87, x: 0, y: 0, z: 0 },
  { id: 'barakah', name: 'Barakah Nuclear Energy Plant', country: 'United Arab Emirates', operator: 'Nawah Energy', reactorType: 'APR-1400', activeUnits: 4, capacityMwe: 5380, lat: 23.97, lon: 52.26, x: 0, y: 0, z: 0 },
  { id: 'taishan', name: 'Taishan Nuclear Power Plant', country: 'China', operator: 'CGN / EDF', reactorType: 'EPR-1750', activeUnits: 2, capacityMwe: 3320, lat: 21.91, lon: 112.98, x: 0, y: 0, z: 0 },
  { id: 'angra', name: 'Central Nuclear Almirante Álvaro Alberto', country: 'Brazil', operator: 'Eletronuclear', reactorType: 'PWR (Siemens/KWU)', activeUnits: 2, capacityMwe: 1990, lat: -23.01, lon: -44.46, x: 0, y: 0, z: 0 },
  { id: 'olkiluoto', name: 'Olkiluoto Nuclear Power Plant', country: 'Finland', operator: 'Teollisuuden Voima (TVO)', reactorType: 'BWR / EPR', activeUnits: 3, capacityMwe: 3380, lat: 61.24, lon: 21.44, x: 0, y: 0, z: 0 },
  { id: 'koeberg', name: 'Koeberg Nuclear Power Station', country: 'South Africa', operator: 'Eskom', reactorType: 'Framatome PWR', activeUnits: 2, capacityMwe: 1860, lat: -33.68, lon: 18.43, x: 0, y: 0, z: 0 },
  { id: 'kudankulam', name: 'Kudankulam Nuclear Power Plant', country: 'India', operator: 'NPCIL / Rosatom', reactorType: 'VVER-1000', activeUnits: 2, capacityMwe: 2000, lat: 8.17, lon: 77.71, x: 0, y: 0, z: 0 },
];

for (const p of NUCLEAR_PLANTS) {
  const [x, y, z] = geoToSceneSurface(p.lat, p.lon);
  p.x = x;
  p.y = y;
  p.z = z;
}
