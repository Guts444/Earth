import { EARTH_RADIUS } from '../config';

export interface SpaceportRecord {
  id: string;
  name: string;
  country: string;
  operator: string;
  lat: number;
  lon: number;
  nextMission: string;
  nextRocket: string;
  targetOrbit: string;
  launchAzimuthDeg: number;
  countdownSec: number;
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

export const SPACEPORTS: SpaceportRecord[] = [
  {
    id: 'ksc',
    name: 'Kennedy Space Center / Cape Canaveral (LC-39A / SLC-40)',
    country: 'United States',
    operator: 'NASA / SpaceX / USSF',
    lat: 28.5729,
    lon: -80.649,
    nextMission: 'Starlink Group 10-14',
    nextRocket: 'Falcon 9 Block 5',
    targetOrbit: 'LEO (53.2° Inclination)',
    launchAzimuthDeg: 53.0,
    countdownSec: 14200,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'starbase',
    name: 'Starbase Boca Chica (Orbital Pad A)',
    country: 'United States',
    operator: 'SpaceX',
    lat: 25.9972,
    lon: -97.1567,
    nextMission: 'Starship Integrated Flight Test',
    nextRocket: 'Starship & Super Heavy Booster',
    targetOrbit: 'Transatmospheric / Suborbital Orbital Insertion',
    launchAzimuthDeg: 95.0,
    countdownSec: 86400 * 3,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'vandenberg',
    name: 'Vandenberg Space Force Base (SLC-4E)',
    country: 'United States',
    operator: 'SpaceX / USSF',
    lat: 34.632,
    lon: -120.61,
    nextMission: 'NRO Reconnaissance Sat (NROL)',
    nextRocket: 'Falcon 9',
    targetOrbit: 'Sun-Synchronous Polar (SSO 97.4°)',
    launchAzimuthDeg: 190.0,
    countdownSec: 28900,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'kourou',
    name: 'Guiana Space Centre (CSG ELA-4)',
    country: 'French Guiana (France)',
    operator: 'ESA / Arianespace / CNES',
    lat: 5.239,
    lon: -52.768,
    nextMission: 'Galileo Navigation Satellite Pair',
    nextRocket: 'Ariane 6 (A62)',
    targetOrbit: 'MEO (Medium Earth Orbit 23,222 km)',
    launchAzimuthDeg: 62.0,
    countdownSec: 86400 * 5,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'tanegashima',
    name: 'Tanegashima Space Center (Yoshinobu Pad)',
    country: 'Japan',
    operator: 'JAXA / MHI',
    lat: 30.4,
    lon: 130.97,
    nextMission: 'HTV-X ISS Cargo Resupply',
    nextRocket: 'H3-24L',
    targetOrbit: 'LEO (51.6° ISS Rendezvous)',
    launchAzimuthDeg: 98.0,
    countdownSec: 86400 * 2,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'sriharikota',
    name: 'Satish Dhawan Space Centre (SDSC SHAR)',
    country: 'India',
    operator: 'ISRO',
    lat: 13.72,
    lon: 80.23,
    nextMission: 'EOS Earth Observation / Gaganyaan Precursor',
    nextRocket: 'LVM3 / GSLV Mk III',
    targetOrbit: 'GTO / Low Earth Orbit',
    launchAzimuthDeg: 105.0,
    countdownSec: 86400 * 4,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'mahia',
    name: 'Rocket Lab Launch Complex 1 (LC-1A)',
    country: 'New Zealand',
    operator: 'Rocket Lab',
    lat: -39.26,
    lon: 177.86,
    nextMission: 'Dedicated Commercial Rideshare',
    nextRocket: 'Electron',
    targetOrbit: 'Mid-Inclination LEO (45.0°)',
    launchAzimuthDeg: 80.0,
    countdownSec: 18500,
    x: 0,
    y: 0,
    z: 0,
  },
  {
    id: 'baikonur',
    name: 'Baikonur Cosmodrome (Site 31/6)',
    country: 'Kazakhstan',
    operator: 'Roscosmos',
    lat: 45.96,
    lon: 63.3,
    nextMission: 'Progress MS-28 Cargo Resupply',
    nextRocket: 'Soyuz-2.1a',
    targetOrbit: 'LEO (51.6° ISS Orbit)',
    launchAzimuthDeg: 65.0,
    countdownSec: 86400 * 6,
    x: 0,
    y: 0,
    z: 0,
  },
];

for (const sp of SPACEPORTS) {
  const [x, y, z] = geoToSceneSurface(sp.lat, sp.lon);
  sp.x = x;
  sp.y = y;
  sp.z = z;
}
