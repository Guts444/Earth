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
| Geographic context (borders + labels) | Natural Earth v5.1.2 (public domain) | STATIC | manual rebuild (`npm run build:geo`) | same-origin `data/geo-context.json` (bundled; no runtime fallback — if absent the layer stays off with an honest chip) | `src/geo/context/` |
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
| `main` | `public/data/geo-context.json` (Natural Earth, committed) | manual — `npm run build:geo` | on demand |

Client URL pattern: `https://raw.githubusercontent.com/Guts444/Earth/<branch>/<file>`
(CORS-open). Trigger a manual refresh with `gh workflow run <name>`.

## Geographic context dataset (Natural Earth, public domain)

Built offline by `scripts/build-geo-data.mjs` (`npm run build:geo`) from pinned
Natural Earth **v5.1.2** GeoJSON (`nvkelso/natural-earth-vector`):

- `ne_50m_admin_0_countries` — country polygons: display names (cartographic
  `NAME`), ISO alpha-2 codes, Natural Earth's own label points (`LABEL_X/Y`),
  `LABELRANK` priorities, population.
- `ne_50m_admin_0_boundary_lines_land` — land boundaries between countries
  (no coastlines — the photo texture already shows coasts; mismatched
  generalized coastlines would double-draw). Disputed/line-of-control/
  indefinite segments are kept and flagged (`kind=1`) for future styling.
- `ne_50m_admin_1_states_provinces` — admin-1 polygons for 9 countries
  (AUS BRA CAN CHN IDN IND RUS USA ZAF). Internal state/province boundaries
  are DERIVED: a ring edge shared by 2+ units of the same country is
  internal; coasts and country borders are dropped.
- `ne_10m_admin_1_states_provinces` — admin-1 for 42 more countries.
  France/Italy/Spain/Philippines are digitized at admin-2 in NE, so units
  are aggregated to the `region` field (régions/regioni/comunidades/regions);
  UK districts are mapped to England/Scotland/Wales/Northern Ireland.
- `ne_50m_populated_places` — 1,251 cities with name, country, admin-1,
  population, and capital flags, tiered 0–3 (capitals/megacities → smaller
  centers) for the LOD system.

Pipeline: download (cached in `.geo-cache/`, git-ignored) → simplify
(Douglas–Peucker) → snap/quantize to integer coordinate grids → verify
(every city checked against its country polygon; dateline-crossing segments
rejected) → emit `public/data/geo-context.json` (~640 KB) plus
`scripts/data/geo-verify-countries.json` (coarse polygons for
`npm run verify:geo`, which re-checks city placement and the projection
convention offline).

License: Natural Earth is public domain — no attribution requirement; the
Geography feed chip credits it anyway.

## Honest-fallback rules

- A feed that falls back must SAY so: the chip turns amber (`SIM`) or blue (`STATIC`) and the detail explains why. The ticker announces mode changes (`[OpenSky] …`, `[SIM] …`).
- Never silently substitute fake data for live data — that was a real bug (the ticker once cycled fabricated events; removed).
- Upstreams that block browsers (no CORS): OpenSky, NOAA NHC. Upstreams that throttle browsers: CelesTrak (per-IP, dev proxy + branch handle it).
- Free AIS (ships) is subscription-gated; marine remains curated until a paid feed is added.

## Config touchpoints

All URLs, branch bases, and TTLs live in `src/config.ts` (`OPENSKY_SNAPSHOT_URL`,
`NHC_SNAPSHOT_URL`, `LIVE_DATA_BASE`, `OPENSKY_SNAPSHOT_CACHE_TTL_MS`, …).
