import { EARTH_RADIUS } from '../config';

export interface DsnComplex {
  id: string;
  name: string;
  location: string;
  country: string;
  lat: number;
  lon: number;
  antennas: string[];
  activeProbe: string;
  frequencyBand: string;
  dataRate: string;
  x: number;
  y: number;
  z: number;
}

export interface DeepSpaceProbe {
  id: string;
  name: string;
  destination: string;
  distanceAu: number;
  distanceKm: number;
  rtltFormatted: string; // Round-trip light time
  speedKms: number;
  launchYear: number;
  status: string;
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

export const DSN_COMPLEXES: DsnComplex[] = [
  {
    id: 'goldstone',
    name: 'Goldstone Deep Space Communications Complex',
    location: 'Mojave Desert, California',
    country: 'United States',
    lat: 35.4267,
    lon: -116.89,
    antennas: ['DSS-14 (70m)', 'DSS-24 (34m)', 'DSS-25 (34m)', 'DSS-26 (34m)'],
    activeProbe: 'Voyager 1 / JWST',
    frequencyBand: 'X-Band / Ka-Band (8.4 GHz / 32 GHz)',
    dataRate: '160 bps (Voyager 1) / 28 Mbps (JWST)',
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'madrid',
    name: 'Madrid Deep Space Communications Complex',
    location: 'Robledo de Chavela, Madrid',
    country: 'Spain',
    lat: 40.4272,
    lon: -4.2494,
    antennas: ['DSS-63 (70m)', 'DSS-65 (34m)', 'DSS-54 (34m)', 'DSS-55 (34m)'],
    activeProbe: 'Mars Perseverance / Parker Solar Probe',
    frequencyBand: 'X-Band / Ka-Band (7.1 GHz / 34.5 GHz)',
    dataRate: '2.0 Mbps (Mars Rover) / 500 kbps (Parker)',
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'canberra',
    name: 'Canberra Deep Space Communication Complex',
    location: 'Tidbinbilla, ACT',
    country: 'Australia',
    lat: -35.4014,
    lon: 148.9817,
    antennas: ['DSS-43 (70m)', 'DSS-34 (34m)', 'DSS-35 (34m)', 'DSS-36 (34m)'],
    activeProbe: 'Voyager 2 / New Horizons',
    frequencyBand: 'S-Band / X-Band (2.1 GHz / 8.4 GHz)',
    dataRate: '160 bps (Voyager 2) / 1.0 kbps (New Horizons)',
    x: 0,
    y: 0,
    z: 0,
  },
];

export const DEEP_SPACE_PROBES: DeepSpaceProbe[] = [
  { id: 'voyager1', name: 'Voyager 1 (Interstellar Mission)', destination: 'Interstellar Space (Ophiuchus)', distanceAu: 163.5, distanceKm: 24450000000, rtltFormatted: '45h 17m 32s', speedKms: 17.0, launchYear: 1977, status: 'Active Telemetry' },
  { id: 'voyager2', name: 'Voyager 2 (Interstellar Mission)', destination: 'Interstellar Space (Pavo)', distanceAu: 136.2, distanceKm: 20370000000, rtltFormatted: '37h 44m 10s', speedKms: 15.4, launchYear: 1977, status: 'Active Telemetry' },
  { id: 'jwst', name: 'James Webb Space Telescope', destination: 'Sun-Earth L2 Lagrange Point', distanceAu: 0.010, distanceKm: 1500000, rtltFormatted: '10.0 sec', speedKms: 0.2, launchYear: 2021, status: 'Active Science Ops' },
  { id: 'perseverance', name: 'Mars 2020 Perseverance & Ingenuity', destination: 'Mars (Jezero Crater)', distanceAu: 1.85, distanceKm: 276800000, rtltFormatted: '30m 48s', speedKms: 24.1, launchYear: 2020, status: 'Surface Science Ops' },
  { id: 'parker', name: 'Parker Solar Probe', destination: 'Inner Corona Solar Orbit', distanceAu: 0.72, distanceKm: 107700000, rtltFormatted: '11m 58s', speedKms: 163.0, launchYear: 2018, status: 'Solar Encounter Phase' },
  { id: 'newhorizons', name: 'New Horizons', destination: 'Outer Kuiper Belt', distanceAu: 58.4, distanceKm: 8736000000, rtltFormatted: '16h 11m 40s', speedKms: 13.8, launchYear: 2006, status: 'Interstellar Cruise' },
];

for (const c of DSN_COMPLEXES) {
  const [x, y, z] = geoToSceneSurface(c.lat, c.lon);
  c.x = x;
  c.y = y;
  c.z = z;
}
