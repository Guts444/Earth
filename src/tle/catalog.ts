import {
  twoline2satrec,
  type SatRec,
} from 'satellite.js';
import {
  CELESTRAK_BASE,
  TLE_CACHE_TTL_MS,
  type SatGroupId,
} from '../config';

export interface CatalogSatellite {
  name: string;
  noradId: string;
  groupId: SatGroupId;
  line1: string;
  line2: string;
  satrec: SatRec;
}

interface CacheEntry {
  fetchedAt: number;
  text: string;
}

function cacheKey(groupId: string): string {
  return `earth-orbit-tle:${groupId}`;
}

function readCache(groupId: string): string | null {
  try {
    const raw = localStorage.getItem(cacheKey(groupId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.fetchedAt > TLE_CACHE_TTL_MS) return null;
    return entry.text;
  } catch {
    return null;
  }
}

function writeCache(groupId: string, text: string): void {
  try {
    const entry: CacheEntry = { fetchedAt: Date.now(), text };
    localStorage.setItem(cacheKey(groupId), JSON.stringify(entry));
  } catch {
    // quota / private mode — ignore
  }
}

async function fetchGroupTle(groupId: SatGroupId): Promise<string> {
  const cached = readCache(groupId);
  if (cached) return cached;

  const url = `${CELESTRAK_BASE}?GROUP=${encodeURIComponent(groupId)}&FORMAT=tle`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CelesTrak ${groupId}: HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text.trim() || text.includes('<html')) {
    throw new Error(`CelesTrak ${groupId}: unexpected response`);
  }
  writeCache(groupId, text);
  return text;
}

/** Parse 3-line TLE blocks (name + line1 + line2). */
export function parseTleText(text: string, groupId: SatGroupId): CatalogSatellite[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const out: CatalogSatellite[] = [];
  let i = 0;
  while (i < lines.length) {
    let name: string;
    let line1: string;
    let line2: string;

    if (lines[i].startsWith('1 ') && i + 1 < lines.length && lines[i + 1].startsWith('2 ')) {
      name = 'UNKNOWN';
      line1 = lines[i];
      line2 = lines[i + 1];
      i += 2;
    } else if (
      i + 2 < lines.length &&
      lines[i + 1].startsWith('1 ') &&
      lines[i + 2].startsWith('2 ')
    ) {
      name = lines[i].replace(/^0\s+/, '').trim();
      line1 = lines[i + 1];
      line2 = lines[i + 2];
      i += 3;
    } else {
      i += 1;
      continue;
    }

    try {
      const satrec = twoline2satrec(line1, line2);
      const noradId = line1.substring(2, 7).trim();
      out.push({ name, noradId, groupId, line1, line2, satrec });
    } catch {
      // skip malformed
    }
  }
  return out;
}

/**
 * Load one or more CelesTrak groups. When "active" is selected alone or with
 * others, we de-duplicate by NORAD ID (first group wins for coloring).
 */
export async function loadCatalog(
  groupIds: SatGroupId[],
  onProgress?: (msg: string) => void,
): Promise<CatalogSatellite[]> {
  if (groupIds.length === 0) return [];

  onProgress?.(`Fetching ${groupIds.length} orbital groups…`);

  // Fetch + parse all groups in parallel — cold loads were serial (60-100s),
  // and the NORAD de-dup below makes ordering irrelevant.
  const results = await Promise.all(
    groupIds.map(async (groupId) => {
      const text = await fetchGroupTle(groupId);
      return parseTleText(text, groupId);
    }),
  );

  const byNorad = new Map<string, CatalogSatellite>();
  for (const sats of results) {
    for (const sat of sats) {
      if (!byNorad.has(sat.noradId)) {
        byNorad.set(sat.noradId, sat);
      }
    }
  }

  return Array.from(byNorad.values());
}

export function clearTleCache(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('earth-orbit-tle:')) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}
