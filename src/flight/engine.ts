import {
  EARTH_RADIUS_KM,
  OPENSKY_BASE,
  OPENSKY_SNAPSHOT_CACHE_TTL_MS,
  OPENSKY_SNAPSHOT_URL,
  type FlightCategory,
} from '../config';
import { geoToScene } from '../geo/projection';

export { geoToScene };

export interface AircraftState {
  icao24: string;
  callsign: string;
  country: string;
  lat: number;
  lon: number;
  altM: number;
  altKm: number;
  speedKms: number;
  speedKmh: number;
  headingDeg: number;
  climbRateMs: number;
  onGround: boolean;
  category: FlightCategory;
  lastUpdatedMs: number;
  origin?: string;
  destination?: string;
  // Scene coordinates (Earth radius = 1)
  x: number;
  y: number;
  z: number;
}

// OpenSky state vector array index mapping
// 0: icao24, 1: callsign, 2: origin_country, 3: time_position, 4: last_contact,
// 5: longitude, 6: latitude, 7: baro_altitude, 8: on_ground, 9: velocity,
// 10: true_track, 11: vertical_rate, 12: sensors, 13: geo_altitude, 14: squawk
type OpenSkyRawState = [
  string, // 0: icao
  string | null, // 1: callsign
  string, // 2: origin_country
  number | null, // 3: time_position
  number, // 4: last_contact
  number | null, // 5: longitude
  number | null, // 6: latitude
  number | null, // 7: baro_altitude
  boolean, // 8: on_ground
  number | null, // 9: velocity (m/s)
  number | null, // 10: true_track
  number | null, // 11: vertical_rate
  number[] | null, // 12: sensors
  number | null, // 13: geo_altitude
  string | null, // 14: squawk
];

interface OpenSkyResponse {
  time: number;
  states: OpenSkyRawState[] | null;
}

// --- Snapshot cache (localStorage) — survives transient branch-fetch failures

const SNAPSHOT_CACHE_KEY = 'earth:opensky:snapshot';

function readSnapshotCache(): { states: unknown[][]; ts: number } | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { states?: unknown[][]; ts?: number };
    if (!parsed || !Array.isArray(parsed.states)) return null;
    return { states: parsed.states, ts: parsed.ts ?? 0 };
  } catch {
    return null;
  }
}

function writeSnapshotCache(states: unknown[][]): void {
  try {
    localStorage.setItem(
      SNAPSHOT_CACHE_KEY,
      JSON.stringify({ states, ts: Date.now() }),
    );
  } catch {
    // storage full/unavailable — non-fatal
  }
}

function categorizeCallsign(callsign: string, altM: number, speedKmh: number): FlightCategory {
  const cs = callsign.toUpperCase();
  if (cs.startsWith('FDX') || cs.startsWith('UPS') || cs.startsWith('GTI') || cs.startsWith('CLX')) {
    return 'cargo';
  }
  if (cs.startsWith('RCH') || cs.startsWith('SAM') || cs.startsWith('ASCOT') || cs.startsWith('NATO') || cs.startsWith('VIP')) {
    return 'military';
  }
  if (altM > 12000 || speedKmh > 950) {
    return 'high-altitude';
  }
  if (altM < 3000 || cs.length <= 4) {
    return 'general';
  }
  return 'commercial';
}

// ---------------------------------------------------------------------------
// Global Major Airport Network for Route Simulation Fallback
// ---------------------------------------------------------------------------

interface AirportNode {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

const GLOBAL_HUBS: AirportNode[] = [
  { code: 'JFK', name: 'New York JFK', lat: 40.6413, lon: -73.7781 },
  { code: 'LAX', name: 'Los Angeles', lat: 33.9416, lon: -118.4085 },
  { code: 'LHR', name: 'London Heathrow', lat: 51.4700, lon: -0.4543 },
  { code: 'CDG', name: 'Paris Charles de Gaulle', lat: 49.0097, lon: 2.5479 },
  { code: 'FRA', name: 'Frankfurt', lat: 50.0379, lon: 8.5622 },
  { code: 'DXB', name: 'Dubai International', lat: 25.2532, lon: 55.3657 },
  { code: 'HND', name: 'Tokyo Haneda', lat: 35.5494, lon: 139.7798 },
  { code: 'SIN', name: 'Singapore Changi', lat: 1.3644, lon: 103.9915 },
  { code: 'SYD', name: 'Sydney Kingsford Smith', lat: -33.9399, lon: 151.1753 },
  { code: 'GRU', name: 'São Paulo Guarulhos', lat: -23.4356, lon: -46.4731 },
  { code: 'ORD', name: 'Chicago OHare', lat: 41.9742, lon: -87.9073 },
  { code: 'ATL', name: 'Atlanta Hartsfield', lat: 33.6407, lon: -84.4277 },
  { code: 'HKG', name: 'Hong Kong', lat: 22.3080, lon: 113.9185 },
  { code: 'ICN', name: 'Seoul Incheon', lat: 37.4602, lon: 126.4407 },
  { code: 'DOH', name: 'Doha Hamad', lat: 25.2731, lon: 51.6081 },
  { code: 'AMS', name: 'Amsterdam Schiphol', lat: 52.3105, lon: 4.7683 },
  { code: 'BKK', name: 'Bangkok Suvarnabhumi', lat: 13.6900, lon: 100.7501 },
  { code: 'JNB', name: 'Johannesburg', lat: -26.1367, lon: 28.2411 },
  { code: 'SFO', name: 'San Francisco', lat: 37.6213, lon: -122.3790 },
  { code: 'YYZ', name: 'Toronto Pearson', lat: 43.6777, lon: -79.6248 },
  { code: 'MEX', name: 'Mexico City', lat: 19.4361, lon: -99.0719 },
  { code: 'EZE', name: 'Buenos Aires Ezeiza', lat: -34.8222, lon: -58.5358 },
  { code: 'DEL', name: 'Delhi Indira Gandhi', lat: 28.5562, lon: 77.1000 },
  { code: 'PEK', name: 'Beijing Capital', lat: 40.0799, lon: 116.6031 },
  { code: 'CPT', name: 'Cape Town', lat: -33.9715, lon: 18.6021 },
  { code: 'ANC', name: 'Anchorage', lat: 61.1743, lon: -149.9963 },
  { code: 'HNL', name: 'Honolulu', lat: 21.3187, lon: -157.9225 },
];

const AIRLINES = [
  { prefix: 'UAL', name: 'United Airlines', country: 'United States' },
  { prefix: 'DAL', name: 'Delta Air Lines', country: 'United States' },
  { prefix: 'AAL', name: 'American Airlines', country: 'United States' },
  { prefix: 'BAW', name: 'British Airways', country: 'United Kingdom' },
  { prefix: 'DLH', name: 'Lufthansa', country: 'Germany' },
  { prefix: 'AFR', name: 'Air France', country: 'France' },
  { prefix: 'UAE', name: 'Emirates', country: 'United Arab Emirates' },
  { prefix: 'QFA', name: 'Qantas', country: 'Australia' },
  { prefix: 'SIA', name: 'Singapore Airlines', country: 'Singapore' },
  { prefix: 'ANA', name: 'All Nippon Airways', country: 'Japan' },
  { prefix: 'CPA', name: 'Cathay Pacific', country: 'Hong Kong' },
  { prefix: 'KLM', name: 'KLM Royal Dutch', country: 'Netherlands' },
  { prefix: 'TAM', name: 'LATAM Airlines', country: 'Brazil' },
  { prefix: 'QTR', name: 'Qatar Airways', country: 'Qatar' },
  { prefix: 'FDX', name: 'FedEx Express', country: 'United States' },
  { prefix: 'UPS', name: 'UPS Airlines', country: 'United States' },
];

interface ScheduledRoute {
  aircraft: AircraftState;
  originHub: AirportNode;
  destHub: AirportNode;
  progress: number; // 0 to 1
  flightDurationSec: number;
}

export class FlightEngine {
  private aircraftList: AircraftState[] = [];
  private scheduledSimRoutes: ScheduledRoute[] = [];
  private lastFetchMs = 0;
  private isLiveFeedActive = false;
  /** Where the current fleet came from — shown in the HUD feed status. */
  feedSource: 'proxy' | 'branch' | 'branch-cache' | 'simulated' = 'simulated';

  constructor() {
    this.initSimulatedFleet(1800);
  }

  get count(): number {
    return this.aircraftList.length;
  }

  get list(): AircraftState[] {
    return this.aircraftList;
  }

  get isLive(): boolean {
    return this.isLiveFeedActive;
  }

  get lastUpdated(): number {
    return this.lastFetchMs;
  }

  private initSimulatedFleet(count: number): void {
    this.scheduledSimRoutes = [];
    const simulatedAircraft: AircraftState[] = [];

    for (let i = 0; i < count; i++) {
      const origIdx = Math.floor(Math.random() * GLOBAL_HUBS.length);
      let destIdx = Math.floor(Math.random() * GLOBAL_HUBS.length);
      while (destIdx === origIdx) {
        destIdx = Math.floor(Math.random() * GLOBAL_HUBS.length);
      }

      const orig = GLOBAL_HUBS[origIdx];
      const dest = GLOBAL_HUBS[destIdx];
      const airline = AIRLINES[i % AIRLINES.length];
      const flightNum = Math.floor(10 + Math.random() * 980);
      const callsign = `${airline.prefix}${flightNum}`;
      const icao24 = (0xa00000 + i * 17).toString(16).padStart(6, '0');

      const progress = Math.random();
      const altM = 9500 + Math.random() * 3200;
      const speedKmh = 820 + Math.random() * 120;
      const speedKms = speedKmh / 3600;

      // Great circle interpolation
      const currentPos = this.interpolateGreatCircle(orig.lat, orig.lon, dest.lat, dest.lon, progress);
      const heading = this.calculateBearing(currentPos.lat, currentPos.lon, dest.lat, dest.lon);
      const altKm = altM / 1000;
      const [x, y, z] = geoToScene(currentPos.lat, currentPos.lon, altKm);

      const ac: AircraftState = {
        icao24,
        callsign,
        country: airline.country,
        lat: currentPos.lat,
        lon: currentPos.lon,
        altM,
        altKm,
        speedKms,
        speedKmh,
        headingDeg: heading,
        climbRateMs: (Math.random() - 0.5) * 2,
        onGround: false,
        category: categorizeCallsign(callsign, altM, speedKmh),
        lastUpdatedMs: Date.now(),
        origin: orig.code,
        destination: dest.code,
        x,
        y,
        z,
      };

      const durationSec = 3600 + Math.random() * 28000;
      this.scheduledSimRoutes.push({
        aircraft: ac,
        originHub: orig,
        destHub: dest,
        progress,
        flightDurationSec: durationSec,
      });

      simulatedAircraft.push(ac);
    }

    this.aircraftList = simulatedAircraft;
  }

  async fetchLiveStates(): Promise<void> {
    // 1) Dev/preview proxy (vite.config.ts caches with 15s TTL)
    try {
      const res = await fetch(OPENSKY_BASE, { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        const data = (await res.json()) as OpenSkyResponse;
        if (data && Array.isArray(data.states) && data.states.length > 0) {
          this.applyStates(data.states, 'proxy');
          return;
        }
      }
    } catch {
      // fall through to snapshot
    }

    // 2) CI-fed snapshot branch — the production path (CORS-closed upstream)
    try {
      const res = await fetch(OPENSKY_SNAPSHOT_URL, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const data = (await res.json()) as { states?: unknown[][] };
        if (data && Array.isArray(data.states) && data.states.length > 0) {
          writeSnapshotCache(data.states);
          this.applyStates(data.states, 'branch');
          return;
        }
      }
    } catch {
      // fall through to cache
    }

    // 3) Last known-good snapshot from localStorage (survives transient failures)
    const cached = readSnapshotCache();
    if (
      cached &&
      Date.now() - cached.ts < OPENSKY_SNAPSHOT_CACHE_TTL_MS &&
      cached.states.length > 0
    ) {
      this.applyStates(cached.states, 'branch-cache');
      return;
    }

    // 4) Honest simulated fallback — reported as such in the HUD
    this.isLiveFeedActive = false;
    this.feedSource = 'simulated';
    console.warn('OpenSky: proxy + snapshot + cache unavailable — simulated fleet active');
  }

  /** Parse a states/all snapshot (proxy or CI branch share the same schema). */
  private applyStates(
    rows: unknown[][],
    source: 'proxy' | 'branch' | 'branch-cache',
  ): void {
    const parsed: AircraftState[] = [];
    const now = Date.now();

    for (const row of rows) {
      const icao24 = String(row[0] ?? '');
      const callsign = (row[1] ?? 'FLT').toString().trim() || `ICAO-${icao24}`;
      const country = row[2] != null ? String(row[2]) : 'International';
      const lon = row[5] as number | null;
      const lat = row[6] as number | null;
      const baroAlt = row[7] as number | null;
      const onGround = Boolean(row[8]);
      const velocityMs = (row[9] as number | null) ?? 230;
      const heading = (row[10] as number | null) ?? 0;
      const verticalRate = (row[11] as number | null) ?? 0;

      if (lat == null || lon == null || onGround) continue;

      const altM = Math.max(baroAlt ?? 10000, 500);
      const altKm = altM / 1000;
      const speedKms = (velocityMs * 3.6) / 3600;
      const speedKmh = velocityMs * 3.6;
      const [x, y, z] = geoToScene(lat, lon, altKm);

      parsed.push({
        icao24,
        callsign,
        country,
        lat,
        lon,
        altM,
        altKm,
        speedKms,
        speedKmh,
        headingDeg: heading,
        climbRateMs: verticalRate,
        onGround: false,
        category: categorizeCallsign(callsign, altM, speedKmh),
        lastUpdatedMs: now,
        x,
        y,
        z,
      });
    }

    if (parsed.length > 50) {
      this.aircraftList = parsed;
      this.isLiveFeedActive = true;
      this.feedSource = source;
      this.lastFetchMs = now;
    }
  }

  /**
   * Extrapolates position smoothly for each aircraft based on dtSec (sim time delta).
   */
  update(dtSec: number): void {
    const n = this.aircraftList.length;

    if (!this.isLiveFeedActive) {
      // Simulate routes progress
      for (const route of this.scheduledSimRoutes) {
        route.progress += dtSec / route.flightDurationSec;
        if (route.progress >= 1.0) {
          route.progress = 0;
          // Swap or pick new destination
          const newDest = GLOBAL_HUBS[Math.floor(Math.random() * GLOBAL_HUBS.length)];
          route.originHub = route.destHub;
          route.destHub = newDest;
          route.aircraft.origin = route.originHub.code;
          route.aircraft.destination = route.destHub.code;
        }

        const pos = this.interpolateGreatCircle(
          route.originHub.lat,
          route.originHub.lon,
          route.destHub.lat,
          route.destHub.lon,
          route.progress,
        );

        route.aircraft.lat = pos.lat;
        route.aircraft.lon = pos.lon;
        route.aircraft.headingDeg = this.calculateBearing(pos.lat, pos.lon, route.destHub.lat, route.destHub.lon);
        const [x, y, z] = geoToScene(pos.lat, pos.lon, route.aircraft.altKm);
        route.aircraft.x = x;
        route.aircraft.y = y;
        route.aircraft.z = z;
      }
      return;
    }

    // Live extrapolation: lat/lon step based on ground velocity & heading
    for (let i = 0; i < n; i++) {
      const ac = this.aircraftList[i];
      const distKm = ac.speedKms * dtSec;
      if (distKm <= 0) continue;

      const headingRad = (ac.headingDeg * Math.PI) / 180;
      const angularDist = distKm / EARTH_RADIUS_KM;

      const lat1 = (ac.lat * Math.PI) / 180;
      const lon1 = (ac.lon * Math.PI) / 180;

      const sinLat1 = Math.sin(lat1);
      const cosLat1 = Math.cos(lat1);
      const sinAd = Math.sin(angularDist);
      const cosAd = Math.cos(angularDist);

      const lat2 = Math.asin(sinLat1 * cosAd + cosLat1 * sinAd * Math.cos(headingRad));
      const lon2 = lon1 + Math.atan2(
        Math.sin(headingRad) * sinAd * cosLat1,
        cosAd - sinLat1 * Math.sin(lat2),
      );

      ac.lat = (lat2 * 180) / Math.PI;
      ac.lon = (((lon2 * 180) / Math.PI + 540) % 360) - 180; // wrap [-180, 180]

      const [x, y, z] = geoToScene(ac.lat, ac.lon, ac.altKm);
      ac.x = x;
      ac.y = y;
      ac.z = z;
    }
  }

  private interpolateGreatCircle(
    lat1Deg: number,
    lon1Deg: number,
    lat2Deg: number,
    lon2Deg: number,
    f: number,
  ): { lat: number; lon: number } {
    const lat1 = (lat1Deg * Math.PI) / 180;
    const lon1 = (lon1Deg * Math.PI) / 180;
    const lat2 = (lat2Deg * Math.PI) / 180;
    const lon2 = (lon2Deg * Math.PI) / 180;

    const dLon = lon2 - lon1;
    const d = Math.acos(
      Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon),
    );

    if (Math.abs(d) < 1e-6) {
      return { lat: lat1Deg, lon: lon1Deg };
    }

    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);

    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);

    const lat = Math.atan2(z, Math.hypot(x, y));
    const lon = Math.atan2(y, x);

    return {
      lat: (lat * 180) / Math.PI,
      lon: (lon * 180) / Math.PI,
    };
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
