export interface AsteroidRecord {
  id: string;
  name: string;
  diameterM: number;
  missDistanceLd: number; // Lunar Distances (1 LD = 384,400 km)
  missDistanceKm: number;
  velocityKms: number;
  hazardLevel: 'CRITICAL' | 'MONITORED' | 'ROUTINE';
  closeApproachDate: string;
  orbitClass: string;
  sceneX: number;
  sceneY: number;
  sceneZ: number;
}

export const NEAR_EARTH_ASTEROIDS: AsteroidRecord[] = [
  {
    id: '99942',
    name: '99942 Apophis',
    diameterM: 370,
    missDistanceLd: 0.08,
    missDistanceKm: 31860,
    velocityKms: 30.73,
    hazardLevel: 'CRITICAL',
    closeApproachDate: '2029-04-13',
    orbitClass: 'Aten (Potentially Hazardous)',
    sceneX: 1.4,
    sceneY: 0.6,
    sceneZ: 0.8,
  },
  {
    id: '101955',
    name: '101955 Bennu',
    diameterM: 490,
    missDistanceLd: 1.95,
    missDistanceKm: 749500,
    velocityKms: 27.91,
    hazardLevel: 'MONITORED',
    closeApproachDate: '2135-09-24',
    orbitClass: 'Apollo (B-type Carbonaceous)',
    sceneX: -2.1,
    sceneY: 1.1,
    sceneZ: 1.5,
  },
  {
    id: '4179',
    name: '4179 Toutatis',
    diameterM: 5400,
    missDistanceLd: 18.0,
    missDistanceKm: 6919200,
    velocityKms: 39.5,
    hazardLevel: 'MONITORED',
    closeApproachDate: '2069-11-05',
    orbitClass: 'Apollo (Contact Binary)',
    sceneX: 3.5,
    sceneY: -1.2,
    sceneZ: -2.2,
  },
  {
    id: '3122',
    name: '3122 Florence',
    diameterM: 4900,
    missDistanceLd: 18.2,
    missDistanceKm: 6996000,
    velocityKms: 13.53,
    hazardLevel: 'ROUTINE',
    closeApproachDate: '2057-09-02',
    orbitClass: 'Amor (Triple Asteroid System)',
    sceneX: -3.8,
    sceneY: -2.0,
    sceneZ: 1.8,
  },
  {
    id: '2024yr4',
    name: '2024 YR4',
    diameterM: 55,
    missDistanceLd: 2.15,
    missDistanceKm: 826460,
    velocityKms: 14.8,
    hazardLevel: 'MONITORED',
    closeApproachDate: '2032-12-22',
    orbitClass: 'Aten (Near-Earth Asteroid)',
    sceneX: 1.8,
    sceneY: 1.9,
    sceneZ: -0.9,
  },
  {
    id: '1950da',
    name: '(29075) 1950 DA',
    diameterM: 1100,
    missDistanceLd: 15.2,
    missDistanceKm: 5842880,
    velocityKms: 17.8,
    hazardLevel: 'MONITORED',
    closeApproachDate: '2880-03-16',
    orbitClass: 'Apollo (Potentially Hazardous)',
    sceneX: -2.9,
    sceneY: 0.8,
    sceneZ: -3.1,
  },
];
