# Earth Command — Architecture

> **Start here** when picking up this project (new session, contributor, or debugging).
> Companion: [`data-sources.md`](data-sources.md) — every feed, its freshness, and its fallback chain.

- Repo: `Guts444/Earth` (public) · Live: https://guts444.github.io/Earth/
- Stack: Vite + TypeScript + Three.js, vanilla CSS, no UI framework. ~8k LOC, 15 visual domains.
- Dev: `npm run dev` (port 5173, proxies live feeds) · Build: `npm run build` (tsc + vite) · Deploy: push to `main` → `.github/workflows/deploy.yml` → GitHub Pages (~2 min).

## Module map

| Path | Responsibility |
|---|---|
| `src/main.ts` | Orchestrator: scene/camera/controls, domain wiring, pointer picking, data loaders + pollers, **feed status registry**, ticker events, `animate()` loop |
| `src/config.ts` | Constants: scene radii, feed URLs + branch bases, satellite groups, domain types, cache TTLs |
| `src/domains/registry.ts` | `DomainAdapter` interface + `createDomainLayers()` factory — one adapter per domain; main.ts drives everything generically |
| `src/domains/pick.ts` | Shared **screen-space picking** helper (`pickPointsNearestCursor`) |
| `src/scene/` | `earth.ts` (planet + atmosphere + cloud overlay wiring), `clouds.ts` (NASA GIBS VIIRS cloud mask → dedicated cloud sphere), `cloudColormap.json` (official GIBS colormap for decoding), `satellites.ts` (11k-point cloud + SGP4 buffers), `overlays.ts` (orbits/footprints/markers), `grids.ts` (terminator/grids), `targetLock.ts` (fly-to/chase/reticle) |
| `src/geo/` | `projection.ts` (**the single lat/lon → scene convention**, ECEF → X→X/Z→Y/Y→−Z), `earthquakes.ts` (USGS), `cyclones.ts` (NHC), `volcanoes.ts` + scene, `wildfires.ts` + scene, `context/` (geographic base layer — see below) |
| `src/tle/catalog.ts` | TLE fetch chain: localStorage → dev proxy → `tle-data` branch → direct CelesTrak |
| `src/orbit/propagator.ts` | Batched SGP4 propagation (500ms cadence) |
| `src/space/` | `dsn.ts` + scene, `launches.ts` + scene (Launch Library 2), `asteroids.ts` + scene, `spaceWeather.ts` (SWPC Kp), `auroraScene.ts` |
| `src/geo/context/` | **Geographic context subsystem**: `data.ts` (bundled Natural Earth dataset model + loader), `boundaries.ts` (batched country/admin-1 lines), `labels.ts` (2D-canvas label renderer with priority + collision + horizon clipping), `lod.ts` (distance policy), `geographicScene.ts` (facade — `update(camera)`, `setVisible`) |
| `src/geo/` | `earthquakes.ts` (USGS), `cyclones.ts` (NHC), `volcanoes.ts` + scene, `wildfires.ts` + scene |
| `src/infra/` | `cables.ts` (TeleGeography dataset loader + curated fallback), `cablesScene.ts`, `nuclear.ts` + scene |
| `src/flight/` | `engine.ts` (OpenSky chain + simulated fleet), `aircraftScene.ts` |
| `src/marine/` | `engine.ts` (curated fleet + simulated movement), `marineScene.ts` |
| `src/tactical/` | `gpsJam.ts` + scene |
| `src/ui/commandCenter.ts` | HUD: tabs, toggles, search, telemetry panel, **event ticker**, **DATA FEEDS chips** |
| `public/data/cables.json` | Full TeleGeography cable dataset (702 systems / 1,922 stations) |
| `scripts/build-cables-data.py` | Builds the cable dataset from TeleGeography's public JSON endpoints |
| `.github/workflows/` | `deploy.yml`, `update-tles.yml` (6h), `update-live-feeds.yml` (20 min), `update-cables.yml` (weekly) |

## Geographic context — the cartographic base layer

`src/geo/context/` adds country borders, admin-1 (state/province) boundaries,
and country/admin-1/city labels on top of the globe. It is NOT a domain
adapter — it is pure cartographic context (no picking, no search) with a
three-line surface in main.ts:

```ts
const geoContext = new GeographicContextScene(document.body); // group + label canvas
scene.add(geoContext.group);
geoContext.update(camera, scene.rotation.y); // per-frame, dirty-checked
```

- **Data** (`public/data/geo-context.json`, ~1.4 MB, gzipped ~380 KB) is built
  offline from **Natural Earth v5.1.2** (public domain) by
  `scripts/build-geo-data.mjs` (`npm run build:geo`) — 50m countries +
  boundary lines, 50m/10m admin-1 for 51 countries (with postal/ISO-derived
  short codes, e.g. `CA`, `BY`), **10m populated places (7,342 cities,
  tiered 0–4)**. Admin-1 boundaries are DERIVED from polygon adjacencies
  (a ring edge shared by 2+ units of the same country is internal — coasts
  and country borders are dropped), which is what keeps the file small
  (~1.4 MB raw / ~380 KB gzipped). Regenerate only when Natural Earth
  updates; runtime loads the bundled file once (`data.ts`) — no polling.
- **Rendering**: country and admin-1 borders are ONE `LineSegments` batch +
  ONE shared material each (radius offsets 1.0015 / 1.0022 above the surface
  → no z-fighting; depth-tested → far side occluded). Labels render on a
  single 2D canvas between the WebGL canvas and the HUD panels
  (pointer-events none): stable screen-space size, no DOM churn, no framework.
  Label layout is dirty-checked on camera position/rotation/distance and
  costs ~1.5 ms worst case (7.3k city entries, screen-grid-indexed collision);
  idle frames cost nothing.
- **LOD** (`lod.ts`, thresholds in earth radii, tuned against the 3.0–3.8
  global→detail blend) — SEMANTIC zoom, not additive accumulation:
  - d ≥ 3.55 (GLOBAL): major country names (LABELRANK ≤ 2) + faint borders only.
  - 3.55 → 2.8 (COUNTRY): more country names, **admin-1 short codes**
    (postal/ISO-derived: CA, TX, ON, BY …) fade in; country labels begin
    fading; no cities yet.
  - 2.8 → 2.15 (REGIONAL): full admin-1 names + borders, national capitals +
    admin-1 capitals + top-tier cities (tier 0/1); countries subordinate
    (alpha → 0 by ~2.2).
  - 2.15 → 1.65 (DETAILED): admin-1 names + tier-2 cities, density rises.
  - < 1.65 (LOCAL): tiers 3–4 (small towns) join; country labels gone.
  All gates ramp smoothly — nothing pops. Placement priority is PER BAND
  (countries win globally; capitals beat admin-1 regionally; local cities
  win locally) — a giant country label can never block local city names.
- **Occlusion**: EXACT visibility math, three layers: (1) horizon test —
  a surface anchor P is visible only if `P · camera > 1` (the exact
  unit-sphere condition: equality holds precisely on the tangent circle, and
  points beyond it are occluded by the globe even though they project inside
  the silhouette); (2) the screen silhouette is the projected tangent circle
  (exact, sampled in 3D — correct at every distance, incl. the old
  distance-approximation's underestimate near the surface); (3) the canvas
  is clipped to that silhouette polygon. Labels fade as they approach the
  horizon. Verified: 0 label pixels outside the analytic silhouette circle
  at d = 4.2 / 3.0 / 2.0 / 1.55 / 1.2.
- **Decluttering**: greedy placement with a screen-grid-indexed exact-AABB
  collision (label-label overlaps ≤ 48 px² are tolerated — padded-corner
  clips don't cull); city labels retry right/left/below/above the dot,
  admin-1 labels retry ±14 px vertically; density caps per kind per band.
- **Tactical obstacle avoidance**: high-salience tactical markers (cable
  landing stations, launch pads, nuclear plants, DSN sites, the selected
  target's reticle) reserve screen rectangles computed in `main.ts`
  (`computeTacticalObstacles`, scaled by the marker's real on-screen size;
  markers < 10 px reserve nothing; the lazy cache key includes the camera,
  the reticle's current rect, and a data revision so selection/reticle/live
  data changes re-reserve even while the camera is stationary). The label
  layer consumes generic rects —
  no tactical-domain knowledge. Severity by size: ≤ 18 px markers block only
  text under their center; > 18 px must cover ≥ 30 % of the label's TEXT
  rect (obstacles test the text rect, not the city dot — a station at a
  city's own anchor must not kill its label).
- **Projection**: `src/geo/projection.ts` (`geoToScene`) is THE lat/lon →
  scene convention (ECEF → X→X, Z→Y, Y→−Z) — now shared by the flight engine
  and the geo context. `scripts/verify-geo.mjs` (`npm run verify:geo`) pins
  the convention and verifies every shipped city against its country polygon
  (representative cities: New York, London, Tokyo, Sydney, São Paulo,
  Cape Town) offline.
- **UI**: Layers tab → "Geographic Context (Borders & Labels)" master toggle
  (default ON; OFF hides borders + labels, ON resumes automatic LOD). The
  DATA FEEDS strip adds a Geography chip (STATIC · Natural Earth).
  `window.__earthDebug` (browser-harness handle) exists ONLY in dev builds
  (`import.meta.env.DEV` gate; the production bundle contains zero
  references).

## The domain registry pattern (add a domain = one adapter)

Every visual domain exposes the same small surface so main.ts never special-cases:

```ts
interface DomainAdapter {
  id: DomainType;
  pick(raycaster, camera, pointerNdc): PickHit | null;   // screen-space picking
  count(): number;
  highlight(index): void;
  setVisible(v): void;
  buildTarget(index, simDate): SelectedTarget | null;    // telemetry panel payload
  afterSelect?(...); refreshSelected?(...);              // per-domain extras
  search(query, push): void;                             // global search
  update?(timeSec): void;                                // per-frame tick
}
```

Register it in `createDomainLayers()` and it automatically gets picking, selection,
search, toggles, and animation ticks. **Pick priority = registry order, used only
as a tie-breaker** — the winner is the entity with the minimum screen-space
distance to the cursor, across all layers (see next section).

## Picking (screen-space, globe-solid)

`src/domains/pick.ts` + `onPointerUp` in main.ts:

1. Pointer → NDC → raycaster.
2. Raycast the Earth mesh once → `tEarth` (the globe is **solid**: nothing behind the near side is selectable; also kills invalid entities collapsed to the origin).
3. Every layer's `pick()` projects its point cloud to screen space and returns the candidate nearest the cursor (`PickHit { index, dist2, rayDist }`).
4. main.ts rejects hits outside `PICK_RADIUS_PX` (10px) or occluded (`rayDist > tEarth + 1e-3`), then selects the **global min-dist2** winner.

Do NOT revert to `hits[0]` ray-distance picking — it selects the wrong dot in dense clusters (ships, planes, LEO shells).

## Data flow & fallback chains

The app distinguishes **live feeds**, **snapshots**, and **static/curated** data — and
says which one is active in the DATA FEEDS strip (bottom bar). Every chain follows
the same shape:

```
dev/preview proxy (vite) → CI snapshot branch (raw.githubusercontent, CORS-open)
→ localStorage cache → honest fallback (simulated / curated / static texture)
```

- **CelesTrak TLEs** (6h): `localStorage(2h)` → `/api/celestrak` proxy → `tle-data` branch → direct w/ 25s abort. `tle-data` is an orphan branch fed by `update-tles.yml` (all 12 groups, mirror fallback).
- **OpenSky flights** (20 min): proxy → `live-data/states.json` → localStorage cache → simulated fleet. OpenSky sends no CORS headers, so the branch is the production path.
- **NHC cyclones** (20 min): proxy → `live-data/nhc.json` → curated list. Same CORS story.
- **USGS quakes** (60s), **SWPC Kp** (15 min), **LL2 launches** (30 min): CORS-open, direct fetch.
- **Cables**: same-origin `data/cables.json` (weekly CI rebuild) → curated fallback.
- **Clouds (real cloud overlay)**: the "Clouds" overlay toggle is a **master enable** for a dedicated transparent sphere at `EARTH_RADIUS × CLOUDS_SCALE` (1.004) carrying **NASA GIBS VIIRS Clear Sky Confidence** (Day + Night; SNPP primary, same-date NOAA-20 per-pixel gap fill + whole-source fallback). `clouds.ts` fetches a single global equirectangular WMS 1.1.1 raster (`EPSG:4326`, BBOX −180,−90,180,90, 2048×1024, PNG + `TRANSPARENT=TRUE`) per product — no tile-matrix arithmetic — and decodes the colormapped PNG through the documented GIBS colormap (`cloudColormap.json`). The decoded value is the product's **clear-sky confidence** (VNP03/VCM semantics: 1.0 = highest confidence of clear sky), so cloud confidence = 1 − clear confidence, and a **visualization transfer** (`cloudVisualTransfer`) suppresses ambiguous detections (≤0.45 cloud confidence → transparent), emphasizes confident cloud, and caps opacity at 0.35 so continents stay readable and clouds read as an overlay, not a replacement surface. This is a presentation mapping — Clear Sky Confidence is classification confidence, not cloud optical thickness (VIIRS Cloud Optical Thickness is a noted future enhancement). No-data pixels stay transparent — never black. **Per-pixel gap fill**: SNPP wins wherever it has valid source data; the same-date NOAA-20 raster fills ONLY SNPP no-data pixels, applied to the day and night masks independently — detections are never unioned across different overpass times, and gaps NOAA-20 can't cover stay transparent (never fabricated). Availability is probed per date with a tiny GetMap (an unpublished date returns a fully transparent PNG); the newest sufficiently-complete date (opaque-fraction gates) is used, backtracking up to 4 days. The day mask covers the sunlit side; the IR-based night mask covers the rest, blended at the live terminator (night clouds dimmed 0.12× — faint context only). **Zoom-driven global → detail blend**: `detail = 1 − smoothstep(cameraDist, DETAIL_BLEND_NEAR=3.0, DETAIL_BLEND_FAR=3.8)` drives a continuous `fullDaylight` (earth shader) and `cloudVisibility = (1 − detail) × masterToggle` (cloud shader) — global view keeps the real solar day/night with full clouds; at regional/local scale (≤3.0 earth radii) the surface shows full daylight and no clouds; the 3.0–3.8 band is deliberately narrow — a clear mode switch, not a long fade. The time simulation and solar vector are untouched. The old "Permanent Full Daylight" checkbox was removed (daylight is now automatic with zoom). The overlay loads in the background so GIBS latency never delays the Earth itself; on failure the cloud layer stays hidden and the chip reports OFF.
- `live-data` branch is fed by `update-live-feeds.yml` — fetch, trim to the row schema the parser reads (`row[:12]`, index positions MUST be preserved), commit to orphan branch, force-push. Raw CDN can cache a 404 for a few minutes after the first push.

Feed status is a `Map` in main.ts (`setFeed(id, label, status, detail)`); chips update
only when status/detail actually change (dirty-check in commandCenter).

## Ticker — real events only

- `commandUI.pushEvent(text)` pushes source-tagged events into a ring of the last 8 (`[USGS]`, `[NHC]`, `[LL2]`, `[SWPC]`, `[CelesTrak]`, `[OpenSky]`, `[TeleGeography]`).
- The ticker rotates the ring every 4s. **No fabricated sample events exist** — if it's shown, it happened.
- Quake alerts: new M≥5.0 events since the last poll (baseline = max `timeMs` of the first fetch).
- Flight mode changes (live ↔ simulated) and catalog loads also push events.

## Rendering & perf rules (learned the hard way)

- `showTarget` runs every frame — keep the dirty-check (`lastValues` / `lastMetaHtml`) in commandCenter. Never write textContent unconditionally.
- Satellite positions are extrapolated between SGP4 passes (`PROPAGATE_INTERVAL_MS` 500ms) — 11k sats at 60fps.
- Cable scene: **one material per color**, not per cable (702 cables ≈ 12 shared materials). Same for any large line/point layer.
- `controls.rotateSpeed` is set every frame in `animate()`: `clamp(camDist * 0.16, 0.16, 0.65)` — slow, precise rotation at max zoom. Don't revert to a static value.
- Texture paths MUST stay relative (`textures/...`) — root-absolute breaks on the `/Earth/` subpath (symptom: transparent Earth).
- The scene auto-rotates via `scene.rotation.y` (not the earth mesh) — picking math uses `matrixWorld`, so it stays correct.

## CI/CD

| Workflow | Cadence | Job |
|---|---|---|
| `deploy.yml` | push to `main` | build + Pages deploy |
| `update-tles.yml` | every 6h | fetch 12 TLE groups → force-push `tle-data` branch |
| `update-live-feeds.yml` | every 20 min | OpenSky states + NHC storms → force-push `live-data` branch |
| `update-cables.yml` | Monday 03:23 UTC | rebuild `data/cables.json` → push to `main` (triggers deploy) |
| (none — manual) | on demand | `npm run build:geo` regenerates `public/data/geo-context.json` from Natural Earth (commit the file; no cron needed — the dataset changes rarely) |

All crons run on GitHub's servers — Igor's PC can be off. Manual run: `gh workflow run <name>`.

## Test & deploy checklist

1. `npm run build` (tsc + vite clean).
2. `npm run verify:geo` (data invariants, city/country placement, projection convention) and `npm run verify:clouds`.
3. `npm run dev` → verify in browser: `#sat-load-status` = "Catalog Loaded: N", feed chips show expected statuses, ticker shows tagged events, search → select → telemetry panel + reticle.
4. Geographic context: `Geography` chip = STATIC Natural Earth; global view = major country names + faint borders only (no cities, no admin-1); zoom in → admin-1 short codes (CA/TX/ON…) → full state names + capitals + borders → rich local city set; labels never leak past the globe silhouette (exact horizon + projected tangent circle); tactical marker rects stay clear of label text; `Geographic Context` toggle OFF clears borders + labels.
5. Cables: search a station (e.g. "virginia beach") → panel shows real connected cables.
6. Clouds: `Clouds` chip shows `LIVE — NASA GIBS · SNPP[+NOAA-20] · <date> · DAY+NIGHT`; toggle OFF removes only the cloud layer (stylized Earth unchanged); no console warning about fallback. Zoom check: at global distance (≥3.8 R, up to maxDistance 4.2) clouds are fully visible over the real day/night terminator; one zoom inward (≤3.0 R) and clouds are gone with the night side lifted to full daylight (thresholds: `DETAIL_BLEND_NEAR=3.0`, `DETAIL_BLEND_FAR=3.8` earth radii — narrow band, no pop).
7. Push to `main` → `gh run watch` the deploy → verify live bundle hash changed + `data/cables.json` serves 200.
8. After changing feed code: `gh workflow run update-live-feeds.yml` and verify the `live-data` branch files + raw 200s.
9. **Keep the docs current** — any change that affects behavior also updates `docs/architecture.md`, `docs/data-sources.md`, and the README's live-vs-curated notes.
