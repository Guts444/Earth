import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const CACHE_DIR = path.resolve(__dirname, '.cache/celestrak');

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

function celestrakDataPlugin(): Plugin {
  const middleware = async (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
    next: () => void,
  ): Promise<void> => {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    if (requestUrl.pathname !== '/api/celestrak/NORAD/elements/gp.php') {
      next();
      return;
    }

    const group = requestUrl.searchParams.get('GROUP');
    const format = requestUrl.searchParams.get('FORMAT')?.toLowerCase();
    if (!group || format !== 'tle') {
      res.statusCode = 400;
      res.end('GROUP is required and FORMAT must be tle.');
      return;
    }

    const cached = await readCached(group);
    if (cached?.fresh) {
      res.setHeader('X-Earth-Orbit-Data-Source', 'cache');
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
        res.setHeader('X-Earth-Orbit-Data-Source', 'celestrak');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(body);
        return;
      }

      // CelesTrak deliberately returns 403 for repeat requests inside its
      // two-hour update interval. Prefer a stale local copy when available.
      if (cached) {
        res.setHeader('X-Earth-Orbit-Data-Source', 'stale-cache');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(cached.text);
        return;
      }

      const mirror = await fetchMirror(group);
      if (mirror) {
        await cacheTle(group, mirror);
        res.setHeader('X-Earth-Orbit-Data-Source', 'github-mirror');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(mirror);
        return;
      }

      res.statusCode = upstream.status;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(body);
    } catch (error) {
      if (cached) {
        res.setHeader('X-Earth-Orbit-Data-Source', 'stale-cache');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(cached.text);
        return;
      }
      res.statusCode = 502;
      res.end(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    name: 'earth-orbit-celestrak-data',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [celestrakDataPlugin()],
  resolve: {
    // Avoid satellite.js WASM/pthread entry (breaks browser builds).
    alias: {
      'satellite.js': path.resolve(__dirname, 'src/shims/satellite-js.ts'),
    },
  },
});
