# Earth Command — Data Sources

Every feed the app shows, its honesty status, freshness, and fallback chain.
The **DATA FEEDS strip** in the bottom bar shows the live state of these at
runtime — hover a chip for source + freshness.

Status legend:
- **LIVE** — real data from the named source, refreshed on the stated cadence.
- **SNAPSHOT** — real data captured by a CI cron and served from the repo (upstream blocks browsers).
- **STATIC** — curated dataset shipped with the app (real provenance, not real-time).
- **SIM** — simulated fallback (only when a live source is unreachable).

| Domain | Source | Status | Freshness | Fallback chain | Wired in |
|---|---|---|---|---|---|
| Satellites | CelesTrak TLEs | LIVE (SNAPSHOT) | 6h | localStorage(2h) → dev proxy → `tle-data` branch → direct w/ 25s abort | `src/tle/catalog.ts` |
| Earthquakes | USGS GeoJSON | LIVE | 60s poll | dev proxy → direct | `src/geo/earthquakes.ts` |
| Flights (ADS-B) | OpenSky Network | LIVE (SNAPSHOT) | 20 min | dev proxy → `live-data/states.json` → localStorage cache → **SIM** fleet | `src/flight/engine.ts` |
| Cyclones | NOAA NHC | LIVE (SNAPSHOT) | 20 min | dev proxy → `live-data/nhc.json` → curated list | `src/geo/cyclones.ts` |
| Space weather (Kp) | NOAA SWPC | LIVE | 15 min | direct (CORS-open) | `src/space/spaceWeather.ts` |
| Launches | Launch Library 2 | LIVE | 30 min | direct (CORS-open) → curated pads | `src/space/launches.ts` |
| Cloud cover | NASA GIBS (VIIRS cloud mask) | LIVE | daily imagery | WMS 1.1.1 global equirectangular PNG (2048×1024, TRANSPARENT) for Clear Sky Confidence Day + Night; SNPP primary — same-date NOAA-20 fills SNPP no-data gaps per pixel (day/night independently) and remains a whole-source fallback; date probe via tiny GetMap (empty = unpublished), newest sufficiently-complete date (opaque-fraction gate), 4-day backtrack; decoded via documented GIBS colormap (clear-sky confidence → cloud confidence → capped visualization transfer) | `src/scene/clouds.ts` |
| Submarine cables | TeleGeography map | STATIC snapshot | weekly (CI) | same-origin `data/cables.json` → curated fallback | `src/infra/cables.ts` |
| Marine traffic | curated fleet | STATIC + SIM movement | — | — | `src/marine/engine.ts` |
| Volcanoes | curated | STATIC | — | — | `src/geo/volcanoes.ts` |
| Wildfires | curated | STATIC | — | — | `src/geo/wildfires.ts` |
| DSN antennas | curated | STATIC | — | — | `src/space/dsn.ts` |
| Near-Earth asteroids | curated | STATIC | — | — | `src/space/asteroids.ts` |
| Nuclear plants | curated | STATIC | — | — | `src/infra/nuclear.ts` |
| GPS jamming zones | curated | STATIC | — | — | `src/tactical/gpsJam.ts` |

## Snapshot pipelines (GitHub Actions, run on GitHub's servers)

| Branch | Contents | Workflow | Cadence |
|---|---|---|---|
| `tle-data` | 12 TLE group files (`<groupId>.tle`) | `update-tles.yml` | every 6h |
| `live-data` | `states.json` (OpenSky, rows trimmed to the parser's schema), `nhc.json` (NHC CurrentStorms.json verbatim) | `update-live-feeds.yml` | every 20 min |
| `main` | `public/data/cables.json` (rebuild from TeleGeography API) | `update-cables.yml` | weekly |

Client URL pattern: `https://raw.githubusercontent.com/Guts444/Earth/<branch>/<file>`
(CORS-open). Trigger a manual refresh with `gh workflow run <name>`.

## Honest-fallback rules

- A feed that falls back must SAY so: the chip turns amber (`SIM`) or blue (`STATIC`) and the detail explains why. The ticker announces mode changes (`[OpenSky] …`, `[SIM] …`).
- Never silently substitute fake data for live data — that was a real bug (the ticker once cycled fabricated events; removed).
- Upstreams that block browsers (no CORS): OpenSky, NOAA NHC. Upstreams that throttle browsers: CelesTrak (per-IP, dev proxy + branch handle it).
- Free AIS (ships) is subscription-gated; marine remains curated until a paid feed is added.

## Config touchpoints

All URLs, branch bases, and TTLs live in `src/config.ts` (`OPENSKY_SNAPSHOT_URL`,
`NHC_SNAPSHOT_URL`, `LIVE_DATA_BASE`, `OPENSKY_SNAPSHOT_CACHE_TTL_MS`, …).
