import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const CACHE_DIR = path.resolve(__dirname, '.cache/celestrak');
const OPENSKY_CACHE_FILE = path.resolve(__dirname, '.cache/opensky.json');
const USGS_CACHE_FILE = path.resolve(__dirname, '.cache/usgs.json');

const MIRROR_GROUPS: Record<string, string> = {
  starlink: 'starlink',
  oneweb: 'oneweb',
  stations: 'stations',
  'gps-ops': 'gps',
  galileo: 'galileo',
  'glo-ops': 'glonass',
  beidou: 'beidou',
  'iridium-NEXT': 'iridium',
};

interface MirrorRecord {
  OBJECT_NAME?: string;
  TLE_LINE1?: string;
  TLE_LINE2?: string;
}

async function readCached(group: string): Promise<{ text: string; fresh: boolean } | null> {
  const file = path.join(CACHE_DIR, `${group}.tle`);
  try {
    const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    return { text, fresh: Date.now() - info.mtimeMs < CACHE_TTL_MS };
  } catch {
    return null;
  }
}

async function cacheTle(group: string, text: string): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `${group}.tle`), text, 'utf8');
}

function isTle(text: string): boolean {
  return /(^|\n)1 .+\n2 /m.test(text) && !/<html/i.test(text);
}

async function fetchMirror(group: string): Promise<string | null> {
  const mirrorGroup = MIRROR_GROUPS[group];
  if (!mirrorGroup) return null;

  const url =
    `https://github.com/Singingkettle/changshuospace-tle-mirror/` +
    `releases/download/latest/${mirrorGroup}.json`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Earth-Orbit-local/1.0' },
    redirect: 'follow',
  });
  if (!response.ok) return null;

  const records = (await response.json()) as MirrorRecord[];
  const text = records
    .filter((record) => record.TLE_LINE1 && record.TLE_LINE2)
    .map((record) => `${record.OBJECT_NAME ?? 'UNKNOWN'}\n${record.TLE_LINE1}\n${record.TLE_LINE2}`)
    .join('\n');
  return isTle(text) ? `${text}\n` : null;
}

function commandCenterProxyPlugin(): Plugin {
  const middleware = async (req: any, res: any, next: any) => {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');

    // 1. CelesTrak TLE
    if (requestUrl.pathname === '/api/celestrak/NORAD/elements/gp.php') {
      const group = requestUrl.searchParams.get('GROUP');
      const format = requestUrl.searchParams.get('FORMAT')?.toLowerCase();
      if (!group || format !== 'tle') {
        res.statusCode = 400;
        res.end('GROUP is required and FORMAT must be tle.');
        return;
      }

      const cached = await readCached(group);
      if (cached?.fresh) {
        res.setHeader('X-Earth-Data-Source', 'cache');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(cached.text);
        return;
      }

      const upstreamUrl =
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}` +
        '&FORMAT=tle';

      try {
        const upstream = await fetch(upstreamUrl, {
          headers: { 'User-Agent': 'Earth-Orbit-local/1.0' },
        });
        const body = await upstream.text();
        if (upstream.ok && isTle(body)) {
          await cacheTle(group, body);
          res.setHeader('X-Earth-Data-Source', 'celestrak');
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(body);
          return;
        }

        if (cached) {
          res.setHeader('X-Earth-Data-Source', 'stale-cache');
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(cached.text);
          return;
        }

        const mirror = await fetchMirror(group);
        if (mirror) {
          await cacheTle(group, mirror);
          res.setHeader('X-Earth-Data-Source', 'github-mirror');
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(mirror);
          return;
        }

        res.statusCode = upstream.status;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(body);
        return;
      } catch (error) {
        if (cached) {
          res.setHeader('X-Earth-Data-Source', 'stale-cache');
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(cached.text);
          return;
        }
        res.statusCode = 502;
        res.end(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    // 2. OpenSky ADS-B live flights
    if (requestUrl.pathname === '/api/opensky/states/all') {
      try {
        // Check cache (15s TTL)
        try {
          const [raw, info] = await Promise.all([
            readFile(OPENSKY_CACHE_FILE, 'utf8'),
            stat(OPENSKY_CACHE_FILE),
          ]);
          if (Date.now() - info.mtimeMs < 15000) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('X-Data-Source', 'cache');
            res.end(raw);
            return;
          }
        } catch {
          // no fresh cache
        }

        const upstream = await fetch('https://opensky-network.org/api/states/all', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });
        if (upstream.ok) {
          const jsonText = await upstream.text();
          await mkdir(path.dirname(OPENSKY_CACHE_FILE), { recursive: true });
          await writeFile(OPENSKY_CACHE_FILE, jsonText, 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Data-Source', 'opensky-live');
          res.end(jsonText);
          return;
        }

        // Stale fallback
        try {
          const stale = await readFile(OPENSKY_CACHE_FILE, 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Data-Source', 'opensky-stale');
          res.end(stale);
          return;
        } catch {
          res.statusCode = upstream.status;
          res.end(JSON.stringify({ time: Math.floor(Date.now() / 1000), states: [] }));
          return;
        }
      } catch (err) {
        try {
          const stale = await readFile(OPENSKY_CACHE_FILE, 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.end(stale);
          return;
        } catch {
          res.statusCode = 500;
          res.end(JSON.stringify({ time: Math.floor(Date.now() / 1000), states: [] }));
          return;
        }
      }
    }

    // 3. USGS Earthquakes
    if (requestUrl.pathname === '/api/usgs/earthquakes') {
      try {
        // Check cache (60s TTL)
        try {
          const [raw, info] = await Promise.all([
            readFile(USGS_CACHE_FILE, 'utf8'),
            stat(USGS_CACHE_FILE),
          ]);
          if (Date.now() - info.mtimeMs < 60000) {
            res.setHeader('Content-Type', 'application/json');
            res.end(raw);
            return;
          }
        } catch {
          // no fresh cache
        }

        const upstream = await fetch(
          'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
        );
        if (upstream.ok) {
          const jsonText = await upstream.text();
          await mkdir(path.dirname(USGS_CACHE_FILE), { recursive: true });
          await writeFile(USGS_CACHE_FILE, jsonText, 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.end(jsonText);
          return;
        }
      } catch (err) {
        try {
          const stale = await readFile(USGS_CACHE_FILE, 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.end(stale);
          return;
        } catch {
          res.statusCode = 500;
          res.end(JSON.stringify({ type: 'FeatureCollection', features: [] }));
          return;
        }
      }
    }

    // 4. NOAA NHC active storms (no CORS upstream — proxy only)
    if (requestUrl.pathname === '/api/nhc/current-storms') {
      const NHC_CACHE_FILE = path.resolve(__dirname, '.cache/nhc.json');
      try {
        try {
          const [raw, info] = await Promise.all([
            readFile(NHC_CACHE_FILE, 'utf8'),
            stat(NHC_CACHE_FILE),
          ]);
          if (Date.now() - info.mtimeMs < 15 * 60 * 1000) {
            res.setHeader('Content-Type', 'application/json');
            res.end(raw);
            return;
          }
        } catch {
          // no fresh cache
        }

        const upstream = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json', {
          headers: { 'User-Agent': 'Earth-Orbit-local/1.0' },
        });
        if (upstream.ok) {
          const jsonText = await upstream.text();
          await mkdir(path.dirname(NHC_CACHE_FILE), { recursive: true });
          await writeFile(NHC_CACHE_FILE, jsonText, 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.end(jsonText);
          return;
        }

        const stale = await readFile(NHC_CACHE_FILE, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.end(stale);
        return;
      } catch {
        res.statusCode = 502;
        res.end(JSON.stringify({ activeStorms: [] }));
        return;
      }
    }

    next();
    };

  return {
    name: 'command-center-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  // Relative base so the built app works from any subpath (GitHub Pages
  // serves the repo under /Earth/, local file://, or a CDN).
  base: './',
  plugins: [commandCenterProxyPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      ignored: ['**/.temp*', '**/dist/**', '**/*.png', '**/.cache/**'],
    },
  },
  resolve: {
    alias: {
      'satellite.js': path.resolve(__dirname, 'src/shims/satellite-js.ts'),
    },
  },
});
