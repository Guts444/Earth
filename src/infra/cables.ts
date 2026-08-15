import { EARTH_RADIUS } from '../config';

export interface CableSystemDef {
  id: string;
  name: string;
  lengthKm: number;
  capacityTbps: number;
  owners: string;
  rfsYear: number;
  landingStations: string[];
  waypoints: Array<{ lat: number; lon: number }>;
}

export interface LandingStationNode {
  name: string;
  country: string;
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

export const SUBMARINE_CABLES: CableSystemDef[] = [
  // 1. MAREA (Virginia Beach <-> Bilbao)
  {
    id: 'marea',
    name: 'MAREA Submarine Cable',
    lengthKm: 6605,
    capacityTbps: 200,
    owners: 'Telxius / Microsoft / Meta',
    rfsYear: 2018,
    landingStations: ['Virginia Beach (USA)', 'Bilbao (Spain)'],
    waypoints: [
      { lat: 36.85, lon: -75.97 },
      { lat: 37.5, lon: -70.0 },
      { lat: 39.0, lon: -55.0 },
      { lat: 41.5, lon: -40.0 },
      { lat: 43.0, lon: -25.0 },
      { lat: 43.8, lon: -12.0 },
      { lat: 43.5, lon: -6.0 },
      { lat: 43.35, lon: -3.0 },
    ],
  },
  // 2. Dunant (Virginia Beach <-> Saint-Hilaire-de-Riez)
  {
    id: 'dunant',
    name: 'Dunant Transatlantic Cable',
    lengthKm: 6400,
    capacityTbps: 250,
    owners: 'Google',
    rfsYear: 2021,
    landingStations: ['Virginia Beach (USA)', 'Saint-Hilaire-de-Riez (France)'],
    waypoints: [
      { lat: 36.85, lon: -75.97 },
      { lat: 38.2, lon: -68.0 },
      { lat: 41.0, lon: -50.0 },
      { lat: 44.0, lon: -35.0 },
      { lat: 46.5, lon: -20.0 },
      { lat: 47.0, lon: -10.0 },
      { lat: 46.7, lon: -1.95 },
    ],
  },
  // 3. Grace Hopper (New York <-> Bude <-> Bilbao)
  {
    id: 'grace-hopper',
    name: 'Grace Hopper Cable',
    lengthKm: 6250,
    capacityTbps: 340,
    owners: 'Google',
    rfsYear: 2022,
    landingStations: ['Bellport, NY (USA)', 'Bude (UK)', 'Bilbao (Spain)'],
    waypoints: [
      { lat: 40.75, lon: -72.93 },
      { lat: 41.5, lon: -60.0 },
      { lat: 44.5, lon: -45.0 },
      { lat: 47.5, lon: -30.0 },
      { lat: 49.5, lon: -18.0 },
      { lat: 50.8, lon: -4.55 }, // Bude UK
      { lat: 48.0, lon: -7.0 },
      { lat: 43.35, lon: -3.0 }, // Bilbao Spain
    ],
  },
  // 4. EllaLink (Fortaleza <-> Sines)
  {
    id: 'ellalink',
    name: 'EllaLink South America-Europe',
    lengthKm: 9300,
    capacityTbps: 100,
    owners: 'EllaLink / EMACOM',
    rfsYear: 2021,
    landingStations: ['Fortaleza (Brazil)', 'Praia (Cape Verde)', 'Funchal (Madeira)', 'Sines (Portugal)'],
    waypoints: [
      { lat: -3.72, lon: -38.5 }, // Fortaleza
      { lat: 2.0, lon: -32.0 },
      { lat: 8.5, lon: -28.0 },
      { lat: 14.9, lon: -23.5 }, // Cape Verde
      { lat: 22.0, lon: -20.0 },
      { lat: 32.6, lon: -16.9 }, // Madeira
      { lat: 37.0, lon: -12.0 },
      { lat: 37.95, lon: -8.86 }, // Sines
    ],
  },
  // 5. 2Africa (Circumnavigation of Africa)
  {
    id: '2africa',
    name: '2Africa Megacable',
    lengthKm: 45000,
    capacityTbps: 180,
    owners: 'Meta / Vodafone / Orange / China Mobile / Telecom Egypt',
    rfsYear: 2024,
    landingStations: ['Marseille (France)', 'Port Said (Egypt)', 'Djibouti', 'Mombasa (Kenya)', 'Cape Town (South Africa)', 'Luanda (Angola)', 'Lagos (Nigeria)', 'Dakar (Senegal)', 'Lisbon (Portugal)'],
    waypoints: [
      { lat: 43.3, lon: 5.37 }, // Marseille
      { lat: 37.0, lon: 11.5 },
      { lat: 34.0, lon: 24.0 },
      { lat: 31.25, lon: 32.3 }, // Port Said
      { lat: 27.5, lon: 34.5 },
      { lat: 21.0, lon: 38.0 },
      { lat: 12.6, lon: 43.3 }, // Bab el Mandeb
      { lat: 11.6, lon: 43.15 }, // Djibouti
      { lat: 5.0, lon: 48.0 },
      { lat: -4.05, lon: 39.66 }, // Mombasa
      { lat: -15.0, lon: 42.0 },
      { lat: -26.0, lon: 34.0 },
      { lat: -33.9, lon: 18.4 }, // Cape Town
      { lat: -22.0, lon: 12.0 },
      { lat: -8.83, lon: 13.23 }, // Luanda
      { lat: 4.0, lon: 6.0 },
      { lat: 6.45, lon: 3.4 }, // Lagos
      { lat: 4.5, lon: -4.0 },
      { lat: 14.7, lon: -17.4 }, // Dakar
      { lat: 28.0, lon: -16.0 },
      { lat: 38.7, lon: -9.14 }, // Lisbon
    ],
  },
  // 6. SEA-ME-WE 5 (Singapore <-> Marseille)
  {
    id: 'seamewe-5',
    name: 'SEA-ME-WE 5 Intercontinental',
    lengthKm: 20000,
    capacityTbps: 24,
    owners: 'Consortium of 19 Global Telcos',
    rfsYear: 2016,
    landingStations: ['Tuas (Singapore)', 'Colombo (Sri Lanka)', 'Mumbai (India)', 'Djibouti', 'Zafarana (Egypt)', 'Catania (Italy)', 'Marseille (France)'],
    waypoints: [
      { lat: 1.3, lon: 103.65 }, // Singapore
      { lat: 2.5, lon: 101.5 },
      { lat: 5.8, lon: 95.0 },
      { lat: 6.9, lon: 79.85 }, // Colombo
      { lat: 18.9, lon: 72.8 }, // Mumbai
      { lat: 15.0, lon: 62.0 },
      { lat: 11.6, lon: 43.15 }, // Djibouti
      { lat: 21.0, lon: 38.0 },
      { lat: 29.0, lon: 32.6 }, // Zafarana
      { lat: 31.5, lon: 32.3 },
      { lat: 35.0, lon: 20.0 },
      { lat: 37.5, lon: 15.1 }, // Catania
      { lat: 40.0, lon: 9.0 },
      { lat: 43.3, lon: 5.37 }, // Marseille
    ],
  },
  // 7. Southern Cross Cable (Sydney <-> Hawaii <-> Oregon)
  {
    id: 'southern-cross',
    name: 'Southern Cross Transpacific',
    lengthKm: 30500,
    capacityTbps: 72,
    owners: 'Spark / Singtel Optus / Telstra',
    rfsYear: 2000,
    landingStations: ['Sydney (Australia)', 'Auckland (New Zealand)', 'Suva (Fiji)', 'Honolulu (Hawaii)', 'Hillsboro, OR (USA)'],
    waypoints: [
      { lat: -33.86, lon: 151.2 }, // Sydney
      { lat: -35.0, lon: 162.0 },
      { lat: -36.85, lon: 174.75 }, // Auckland
      { lat: -28.0, lon: 178.0 },
      { lat: -18.14, lon: 178.4 }, // Suva Fiji
      { lat: -5.0, lon: -175.0 },
      { lat: 10.0, lon: -165.0 },
      { lat: 21.3, lon: -157.85 }, // Honolulu
      { lat: 32.0, lon: -140.0 },
      { lat: 42.0, lon: -128.0 },
      { lat: 45.5, lon: -122.9 }, // Oregon
    ],
  },
  // 8. Trans-Pacific Express (TPE) (USA <-> China / Japan / Korea)
  {
    id: 'tpe',
    name: 'Trans-Pacific Express (TPE)',
    lengthKm: 18000,
    capacityTbps: 60,
    owners: 'China Telecom / AT&T / Verizon / NTT / KT',
    rfsYear: 2008,
    landingStations: ['Nedonna Beach, OR (USA)', 'Chikura (Japan)', 'Geoje (South Korea)', 'Qingdao (China)', 'Chongming (China)'],
    waypoints: [
      { lat: 45.7, lon: -123.95 }, // Oregon
      { lat: 45.0, lon: -140.0 },
      { lat: 44.0, lon: -170.0 },
      { lat: 42.0, lon: 170.0 },
      { lat: 38.0, lon: 150.0 },
      { lat: 34.95, lon: 139.95 }, // Chikura Japan
      { lat: 33.0, lon: 130.0 },
      { lat: 34.8, lon: 128.7 }, // Geoje Korea
      { lat: 36.0, lon: 121.5 }, // Qingdao China
      { lat: 31.5, lon: 121.8 }, // Shanghai Chongming
    ],
  },
  // 9. SACS (Fortaleza, Brazil <-> Luanda, Angola)
  {
    id: 'sacs',
    name: 'South Atlantic Cable System (SACS)',
    lengthKm: 6165,
    capacityTbps: 40,
    owners: 'Angola Cables',
    rfsYear: 2018,
    landingStations: ['Fortaleza (Brazil)', 'Luanda (Angola)'],
    waypoints: [
      { lat: -3.72, lon: -38.5 }, // Fortaleza
      { lat: -4.5, lon: -28.0 },
      { lat: -6.0, lon: -15.0 },
      { lat: -7.5, lon: -2.0 },
      { lat: -8.83, lon: 13.23 }, // Luanda
    ],
  },
];

export const LANDING_STATIONS: LandingStationNode[] = [
  { name: 'Virginia Beach Landing Hub', country: 'United States', cables: ['MAREA', 'Dunant', 'Grace Hopper', 'Confluence'], lat: 36.85, lon: -75.97, x: 0, y: 0, z: 0 },
  { name: 'Bude Cable Hub', country: 'United Kingdom', cables: ['Grace Hopper', 'Apollo', 'TAT-14', 'Yellow'], lat: 50.83, lon: -4.54, x: 0, y: 0, z: 0 },
  { name: 'Marseille Telecom Gateway', country: 'France', cables: ['2Africa', 'SEA-ME-WE 5', 'PEACE', 'AAE-1'], lat: 43.3, lon: 5.37, x: 0, y: 0, z: 0 },
  { name: 'Fortaleza International Hub', country: 'Brazil', cables: ['EllaLink', 'SACS', 'Monet', 'Junior', 'Seabras-1'], lat: -3.72, lon: -38.5, x: 0, y: 0, z: 0 },
  { name: 'Sines Deep Sea Terminal', country: 'Portugal', cables: ['EllaLink', '2Africa', 'Nuvem'], lat: 37.95, lon: -8.86, x: 0, y: 0, z: 0 },
  { name: 'Singapore Tuas Landing Hub', country: 'Singapore', cables: ['SEA-ME-WE 5', 'SJC2', 'APG', 'Echo', 'Bifrost'], lat: 1.3, lon: 103.65, x: 0, y: 0, z: 0 },
  { name: 'Cape Town Melkbosstrand', country: 'South Africa', cables: ['2Africa', 'Equiano', 'WACS', 'SAT-3'], lat: -33.72, lon: 18.44, x: 0, y: 0, z: 0 },
  { name: 'Tokyo Chikura Gateway', country: 'Japan', cables: ['TPE', 'FASTER', 'JUPITER', 'Unity'], lat: 34.95, lon: 139.95, x: 0, y: 0, z: 0 },
  { name: 'Sydney Paddington Terminal', country: 'Australia', cables: ['Southern Cross', 'Hawaiki', 'Indigo-Central', 'JGA-South'], lat: -33.88, lon: 151.22, x: 0, y: 0, z: 0 },
  { name: 'Honolulu Makaha Hub', country: 'United States', cables: ['Southern Cross', 'Hawaiki', 'JUPITER', 'Honotua'], lat: 21.47, lon: -158.22, x: 0, y: 0, z: 0 },
];

// Initialize station 3D scene coordinates
for (const st of LANDING_STATIONS) {
  const [x, y, z] = geoToOceanFloor(st.lat, st.lon);
  st.x = x;
  st.y = y;
  st.z = z;
}
