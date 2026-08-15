import type { MarineCategory } from '../config';

export interface VesselState {
  mmsi: string;
  name: string;
  category: MarineCategory;
  flag: string;
  originPort: string;
  destPort: string;
  speedKnots: number;
  speedKmh: number;
  headingDeg: number;
  draftM: number;
  lengthM: number;
  lat: number;
  lon: number;
  x: number;
  y: number;
  z: number;
}

interface MarineWaypoint {
  lat: number;
  lon: number;
  /** If true, this is a narrow canal / strait where lateral drift is strictly zero */
  canal?: boolean;
}

interface ShippingLane {
  id: string;
  name: string;
  originName: string;
  destName: string;
  waypoints: MarineWaypoint[];
}

const SHIPPING_LANES: ShippingLane[] = [
  // 1. Asia - Europe via Malacca, Suez, Gibraltar & English Channel
  {
    id: 'asia-europe-suez',
    name: 'Asia-Europe Container Trunk',
    originName: 'Shanghai (East China Sea)',
    destName: 'Rotterdam (North Sea)',
    waypoints: [
      { lat: 31.0, lon: 122.8 }, // Shanghai pilot station
      { lat: 26.0, lon: 122.5 },
      { lat: 21.0, lon: 121.5 }, // Luzon / Taiwan Strait
      { lat: 16.0, lon: 114.5 },
      { lat: 10.0, lon: 110.0 },
      { lat: 5.0, lon: 106.0 },
      { lat: 1.35, lon: 104.4, canal: true }, // Singapore East Approach
      { lat: 1.25, lon: 103.85, canal: true }, // Singapore Strait
      { lat: 2.5, lon: 101.5, canal: true },  // Malacca Central
      { lat: 4.5, lon: 98.5, canal: true },   // Malacca North
      { lat: 5.8, lon: 95.0 },   // North Sumatra
      { lat: 6.0, lon: 90.0 },   // Andaman Sea
      { lat: 5.5, lon: 80.5 },   // South Sri Lanka (Dondra Head)
      { lat: 11.0, lon: 62.0 },  // Arabian Sea
      { lat: 12.8, lon: 51.0 },  // Gulf of Aden East
      { lat: 12.5, lon: 47.0 },  // Gulf of Aden Central
      { lat: 12.6, lon: 43.3, canal: true },  // Bab el Mandeb
      { lat: 16.0, lon: 41.2 },  // Red Sea South
      { lat: 21.5, lon: 38.0 },  // Red Sea Central
      { lat: 27.2, lon: 34.5 },  // Red Sea North
      { lat: 28.5, lon: 33.0 },  // Gulf of Suez South
      { lat: 29.8, lon: 32.55, canal: true }, // Gulf of Suez North
      { lat: 29.95, lon: 32.55, canal: true },// Suez Canal South Entrance
      { lat: 30.6, lon: 32.35, canal: true }, // Great Bitter Lake
      { lat: 31.35, lon: 32.35, canal: true },// Port Said North Exit
      { lat: 33.0, lon: 30.0 },  // Med East
      { lat: 34.5, lon: 25.0 },  // South Crete
      { lat: 36.0, lon: 21.0 },  // Ionian Sea
      { lat: 36.2, lon: 14.5 },  // Malta Channel
      { lat: 37.8, lon: 9.0 },   // South of Sardinia
      { lat: 37.2, lon: 4.0 },   // Western Med
      { lat: 36.4, lon: -1.5 },  // Alboran Sea East
      { lat: 35.95, lon: -5.6, canal: true }, // Strait of Gibraltar
      { lat: 36.8, lon: -9.5 },  // Cape St. Vincent
      { lat: 39.5, lon: -10.0 }, // Off Lisbon
      { lat: 43.2, lon: -10.0 }, // Cape Finisterre
      { lat: 46.5, lon: -7.0 },  // Bay of Biscay West
      { lat: 49.2, lon: -5.5 },  // English Channel West
      { lat: 50.0, lon: -1.0 },  // Central English Channel
      { lat: 51.1, lon: 1.6, canal: true },   // Strait of Dover
      { lat: 52.0, lon: 3.8 }    // Port of Rotterdam
    ],
  },
  // 2. North Atlantic Sea Lane (New York <-> Europe)
  {
    id: 'transatlantic',
    name: 'North Atlantic Container Route',
    originName: 'New York Harbor Pilot',
    destName: 'Port of Rotterdam',
    waypoints: [
      { lat: 40.45, lon: -73.8 }, // New York Ambrose Pilot
      { lat: 40.0, lon: -71.0 },
      { lat: 39.5, lon: -67.0 },
      { lat: 41.5, lon: -58.0 },
      { lat: 42.0, lon: -48.0 },  // South of Grand Banks
      { lat: 46.0, lon: -35.0 },  // Mid North Atlantic
      { lat: 48.0, lon: -20.0 },
      { lat: 49.0, lon: -10.0 },
      { lat: 49.5, lon: -5.5 },   // English Channel West
      { lat: 51.1, lon: 1.6, canal: true },   // Dover
      { lat: 52.0, lon: 3.8 }    // Rotterdam
    ],
  },
  // 3. Transpacific Container Trunk (Tokyo <-> Los Angeles)
  {
    id: 'transpacific',
    name: 'Transpacific Megaship Route',
    originName: 'Yokohama / Tokyo Bay',
    destName: 'Port of Los Angeles / Long Beach',
    waypoints: [
      { lat: 35.2, lon: 139.9 },  // Tokyo Bay
      { lat: 35.5, lon: 145.0 },
      { lat: 38.0, lon: 160.0 },
      { lat: 41.0, lon: 180.0 },
      { lat: 41.0, lon: -160.0 },
      { lat: 38.0, lon: -140.0 },
      { lat: 34.2, lon: -121.5 }, // Offshore Point Conception
      { lat: 33.7, lon: -118.25 } // Port of LA / Long Beach
    ],
  },
  // 4. Panama Interoceanic Corridor (LA <-> Panama <-> New York)
  {
    id: 'panama-transit',
    name: 'Panama Interoceanic Corridor',
    originName: 'Port of Los Angeles',
    destName: 'Port of New York / East Coast',
    waypoints: [
      { lat: 33.7, lon: -118.25 }, // LA
      { lat: 28.0, lon: -116.0 },  // Baja California
      { lat: 22.0, lon: -111.0 },
      { lat: 18.0, lon: -105.0 },
      { lat: 14.0, lon: -95.0 },   // Gulf of Tehuantepec
      { lat: 10.0, lon: -87.0 },   // Central America Pacific
      { lat: 7.5, lon: -82.0 },
      { lat: 7.5, lon: -79.8 },    // Gulf of Panama
      { lat: 8.85, lon: -79.52, canal: true },  // Balboa (Pacific entrance)
      { lat: 9.38, lon: -79.92, canal: true },  // Cristobal (Atlantic exit)
      { lat: 12.0, lon: -78.0 },   // Caribbean Sea
      { lat: 16.5, lon: -76.0 },   // South of Jamaica
      { lat: 19.8, lon: -73.8, canal: true },   // Windward Passage
      { lat: 23.5, lon: -73.5 },   // Bahamas Ocean Channel
      { lat: 28.0, lon: -75.5 },
      { lat: 33.0, lon: -77.0 },   // US Southeast Coast Offshore
      { lat: 37.0, lon: -74.5 },
      { lat: 40.45, lon: -73.8 }   // New York Ambrose
    ],
  },
  // 5. Persian Gulf Hormuz Energy Trunk (Ras Tanura <-> Hormuz <-> East Asia)
  {
    id: 'hormuz-energy',
    name: 'Hormuz Crude Energy Trunk',
    originName: 'Ras Tanura (Persian Gulf)',
    destName: 'Tokyo Bay (Pacific)',
    waypoints: [
      { lat: 27.2, lon: 50.8 },   // Ras Tanura
      { lat: 26.5, lon: 53.0 },   // Central Gulf
      { lat: 26.3, lon: 56.5, canal: true },   // Strait of Hormuz
      { lat: 24.5, lon: 58.5 },   // Gulf of Oman
      { lat: 20.0, lon: 63.0 },   // Arabian Sea
      { lat: 12.0, lon: 72.0 },
      { lat: 5.5, lon: 80.5 },    // South Sri Lanka
      { lat: 6.0, lon: 93.0 },    // Andaman Sea
      { lat: 4.5, lon: 98.5, canal: true },    // Malacca
      { lat: 2.5, lon: 101.5, canal: true },
      { lat: 1.25, lon: 103.85, canal: true }, // Singapore
      { lat: 7.0, lon: 109.0 },   // South China Sea
      { lat: 15.0, lon: 114.0 },
      { lat: 23.0, lon: 119.5, canal: true },  // Taiwan Strait
      { lat: 28.0, lon: 124.0 },  // East China Sea
      { lat: 35.0, lon: 140.0 }   // Tokyo Bay
    ],
  },
  // 6. South America to Europe Corridor (Santos / Brazil <-> Rotterdam)
  {
    id: 'south-atlantic',
    name: 'South America to Europe Trunk',
    originName: 'Port of Santos (Brazil)',
    destName: 'Port of Rotterdam',
    waypoints: [
      { lat: -24.1, lon: -46.2 }, // Santos Pilot Station
      { lat: -23.5, lon: -42.0 }, // Rio Offshore
      { lat: -18.0, lon: -38.0 }, // Bahia Offshore
      { lat: -10.0, lon: -35.0 }, // Recife Offshore
      { lat: -5.0, lon: -34.0 },  // Cape São Roque Offing
      { lat: 2.0, lon: -30.0 },   // Equatorial Mid-Atlantic
      { lat: 12.0, lon: -25.0 },
      { lat: 24.0, lon: -20.0 },
      { lat: 28.5, lon: -15.5 },  // Canary Islands Passage
      { lat: 34.0, lon: -10.0 },  // Off Morocco
      { lat: 36.8, lon: -9.5 },   // Cape St. Vincent
      { lat: 42.0, lon: -10.0 },  // Portugal North
      { lat: 46.5, lon: -7.0 },   // Bay of Biscay
      { lat: 49.5, lon: -5.5 },   // English Channel
      { lat: 51.1, lon: 1.6, canal: true },   // Dover
      { lat: 52.0, lon: 3.8 }    // Rotterdam
    ],
  },
  // 7. Cape of Good Hope Mega Route (Singapore <-> South Africa <-> Europe)
  {
    id: 'cape-good-hope',
    name: 'Cape of Good Hope Mega Route',
    originName: 'Singapore Strait',
    destName: 'Port of Rotterdam',
    waypoints: [
      { lat: 1.25, lon: 103.85, canal: true }, // Singapore
      { lat: -6.5, lon: 104.5, canal: true },  // Sunda Strait
      { lat: -15.0, lon: 90.0 },  // South Indian Ocean
      { lat: -25.0, lon: 70.0 },
      { lat: -32.0, lon: 45.0 },
      { lat: -34.5, lon: 27.0 },  // South Africa Offshore
      { lat: -35.5, lon: 19.5 },  // Cape of Good Hope South
      { lat: -34.0, lon: 17.5 },  // Cape Town Offshore
      { lat: -25.0, lon: 12.0 },  // Namibia Offshore
      { lat: -12.0, lon: 3.0 },   // South Atlantic
      { lat: 0.0, lon: -10.0 },   // Equatorial Gulf of Guinea
      { lat: 15.0, lon: -22.0 },  // Mid Atlantic North
      { lat: 30.0, lon: -18.0 },
      { lat: 40.0, lon: -12.0 },
      { lat: 49.5, lon: -5.5 },   // English Channel
      { lat: 52.0, lon: 3.8 }    // Rotterdam
    ],
  },
];

const FAMOUS_VESSELS = [
  { name: 'EVER GIVEN', cat: 'container' as MarineCategory, flag: 'Panama', length: 400, draft: 14.5 },
  { name: 'MSC IRINA', cat: 'container' as MarineCategory, flag: 'Liberia', length: 399, draft: 16.0 },
  { name: 'CMA CGM JACQUES SAADE', cat: 'container' as MarineCategory, flag: 'France', length: 400, draft: 15.8 },
  { name: 'MAERSK MC-KINNEY MOLLER', cat: 'container' as MarineCategory, flag: 'Denmark', length: 399, draft: 16.0 },
  { name: 'OOCL SPAIN', cat: 'container' as MarineCategory, flag: 'Hong Kong', length: 399, draft: 15.5 },
  { name: 'TI OCEANIA', cat: 'tanker' as MarineCategory, flag: 'Marshall Islands', length: 380, draft: 24.5 },
  { name: 'FRONT ALTAIR', cat: 'tanker' as MarineCategory, flag: 'Norway', length: 333, draft: 21.0 },
  { name: 'BW PAVILION LEEARA', cat: 'tanker' as MarineCategory, flag: 'Singapore', length: 295, draft: 12.0 },
  { name: 'BERGE STAHL', cat: 'cargo' as MarineCategory, flag: 'Isle of Man', length: 342, draft: 23.0 },
  { name: 'VALE BRASIL', cat: 'cargo' as MarineCategory, flag: 'Singapore', length: 362, draft: 23.0 },
  { name: 'PACIFIC RUBY', cat: 'cargo' as MarineCategory, flag: 'Panama', length: 225, draft: 14.2 },
  { name: 'ICON OF THE SEAS', cat: 'passenger' as MarineCategory, flag: 'Bahamas', length: 365, draft: 9.1 },
  { name: 'WONDER OF THE SEAS', cat: 'passenger' as MarineCategory, flag: 'Bahamas', length: 362, draft: 9.3 },
  { name: 'QUEEN MARY 2', cat: 'passenger' as MarineCategory, flag: 'Bermuda', length: 345, draft: 10.3 },
  { name: 'USS GERALD R. FORD', cat: 'naval' as MarineCategory, flag: 'United States', length: 337, draft: 12.0 },
  { name: 'HMS QUEEN ELIZABETH', cat: 'naval' as MarineCategory, flag: 'United Kingdom', length: 284, draft: 11.0 },
  { name: 'JS IZUMO', cat: 'naval' as MarineCategory, flag: 'Japan', length: 248, draft: 7.5 },
];

function geoToSceneSurface(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  // Lift slightly above water (1.0008) to prevent surface clipping
  const r = 1.0008;

  const clat = Math.cos(lat);
  const ecfX = r * clat * Math.cos(lon);
  const ecfY = r * clat * Math.sin(lon);
  const ecfZ = r * Math.sin(lat);

  return [ecfX, ecfZ, -ecfY];
}

interface ActiveVesselVoyage {
  vessel: VesselState;
  lane: ShippingLane;
  waypointIndex: number;
  segmentProgress: number; // 0 to 1
  speedKms: number;
}

export class MarineEngine {
  private vessels: VesselState[] = [];
  private voyages: ActiveVesselVoyage[] = [];

  constructor() {
    this.initFleet(950);
  }

  get count(): number {
    return this.vessels.length;
  }

  get list(): VesselState[] {
    return this.vessels;
  }

  private initFleet(count: number): void {
    this.vessels = [];
    this.voyages = [];

    for (let i = 0; i < count; i++) {
      const lane = SHIPPING_LANES[i % SHIPPING_LANES.length];
      const wpCount = lane.waypoints.length;
      const wpIdx = Math.floor(Math.random() * (wpCount - 1));
      const progress = Math.random();

      const wp1 = lane.waypoints[wpIdx];
      const wp2 = lane.waypoints[wpIdx + 1];

      // Exact linear segment interpolation along nautical route without random jitter
      const lat = wp1.lat + (wp2.lat - wp1.lat) * progress;
      const lon = wp1.lon + (wp2.lon - wp1.lon) * progress;

      const heading = this.calculateBearing(wp1.lat, wp1.lon, wp2.lat, wp2.lon);
      const [x, y, z] = geoToSceneSurface(lat, lon);

      const template = FAMOUS_VESSELS[i % FAMOUS_VESSELS.length];
      const mmsi = (200000000 + i * 317 + 1000).toString();
      const speedKnots = 14 + Math.random() * 9;
      const speedKmh = speedKnots * 1.852;
      const speedKms = speedKmh / 3600;

      const v: VesselState = {
        mmsi,
        name: i < FAMOUS_VESSELS.length ? template.name : `${template.name} ${Math.floor(i / FAMOUS_VESSELS.length) + 1}`,
        category: template.cat,
        flag: template.flag,
        originPort: lane.originName,
        destPort: lane.destName,
        speedKnots,
        speedKmh,
        headingDeg: heading,
        draftM: template.draft,
        lengthM: template.length,
        lat,
        lon,
        x,
        y,
        z,
      };

      this.vessels.push(v);
      this.voyages.push({
        vessel: v,
        lane,
        waypointIndex: wpIdx,
        segmentProgress: progress,
        speedKms,
      });
    }
  }

  update(dtSec: number): void {
    for (const voy of this.voyages) {
      const { lane, vessel } = voy;
      const wp1 = lane.waypoints[voy.waypointIndex];
      const wp2 = lane.waypoints[voy.waypointIndex + 1];

      if (!wp1 || !wp2) {
        voy.waypointIndex = 0;
        voy.segmentProgress = 0;
        continue;
      }

      // Approximate segment length in km
      const dLat = (wp2.lat - wp1.lat) * 111;
      const dLon = (wp2.lon - wp1.lon) * 111 * Math.cos(((wp1.lat + wp2.lat) * 0.5 * Math.PI) / 180);
      const segDistKm = Math.max(Math.hypot(dLat, dLon), 0.5);

      voy.segmentProgress += (voy.speedKms * dtSec) / segDistKm;

      if (voy.segmentProgress >= 1.0) {
        voy.segmentProgress = 0;
        voy.waypointIndex += 1;
        if (voy.waypointIndex >= lane.waypoints.length - 1) {
          voy.waypointIndex = 0;
        }
      }

      const p = voy.segmentProgress;
      const nextWp1 = lane.waypoints[voy.waypointIndex];
      const nextWp2 = lane.waypoints[voy.waypointIndex + 1];

      vessel.lat = nextWp1.lat + (nextWp2.lat - nextWp1.lat) * p;
      vessel.lon = nextWp1.lon + (nextWp2.lon - nextWp1.lon) * p;
      vessel.headingDeg = this.calculateBearing(nextWp1.lat, nextWp1.lon, nextWp2.lat, nextWp2.lon);

      const [x, y, z] = geoToSceneSurface(vessel.lat, vessel.lon);
      vessel.x = x;
      vessel.y = y;
      vessel.z = z;
    }
  }

  private calculateBearing(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number): number {
    const lat1 = (lat1Deg * Math.PI) / 180;
    const lat2 = (lat2Deg * Math.PI) / 180;
    const dLon = ((lon2Deg - lon1Deg) * Math.PI) / 180;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  }
}
