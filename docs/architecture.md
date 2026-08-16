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
| `src/tle/catalog.ts` | TLE fetch chain: localStorage → dev proxy → `tle-data` branch → direct CelesTrak |
| `src/orbit/propagator.ts` | Batched SGP4 propagation (500ms cadence) |
| `src/space/` | `dsn.ts` + scene, `launches.ts` + scene (Launch Library 2), `asteroids.ts` + scene, `spaceWeather.ts` (SWPC Kp), `auroraScene.ts` |
| `src/geo/` | `earthquakes.ts` (USGS), `cyclones.ts` (NHC), `volcanoes.ts` + scene, `wildfires.ts` + scene |
| `src/infra/` | `cables.ts` (TeleGeography dataset loader + curated fallback), `cablesScene.ts`, `nuclear.ts` + scene |
| `src/flight/` | `engine.ts` (OpenSky chain + simulated fleet), `aircraftScene.ts` |
| `src/marine/` | `engine.ts` (curated fleet + simulated movement), `marineScene.ts` |
| `src/tactical/` | `gpsJam.ts` + scene |
| `src/ui/commandCenter.ts` | HUD: tabs, toggles, search, telemetry panel, **event ticker**, **DATA FEEDS chips** |
| `public/data/cables.json` | Full TeleGeography cable dataset (702 systems / 1,922 stations) |
| `scripts/build-cables-data.py` | Builds the cable dataset from TeleGeography's public JSON endpoints |
| `.github/workflows/` | `deploy.yml`, `update-tles.yml` (6h), `update-live-feeds.yml` (20 min), `update-cables.yml` (weekly) |

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
- **Clouds (real cloud overlay)**: the "Clouds" overlay toggle is a **master enable** for a dedicated transparent sphere at `EARTH_RADIUS × CLOUDS_SCALE` (1.004) carrying **NASA GIBS VIIRS Clear Sky Confidence** (Day + Night; SNPP primary, NOAA-20 fallback). `clouds.ts` fetches a single global equirectangular WMS 1.1.1 raster (`EPSG:4326`, BBOX −180,−90,180,90, 2048×1024, PNG + `TRANSPARENT=TRUE`) per product — no tile-matrix arithmetic — and decodes the colormapped PNG through the documented GIBS colormap (`cloudColormap.json`). The decoded value is the product's **clear-sky confidence** (VNP03/VCM semantics: 1.0 = highest confidence of clear sky), so cloud confidence = 1 − clear confidence, and a **visualization transfer** (`cloudVisualTransfer`) suppresses ambiguous detections (≤0.3 cloud confidence → transparent), emphasizes confident cloud, and caps opacity at 0.7 so continents stay readable. This is a presentation mapping — Clear Sky Confidence is classification confidence, not cloud optical thickness (VIIRS Cloud Optical Thickness is a noted future enhancement). No-data pixels stay transparent — never black. Availability is probed per date with a tiny GetMap (an unpublished date returns a fully transparent PNG); the newest sufficiently-complete date (opaque-fraction gates) is used, backtracking up to 4 days. The day mask covers the sunlit side; the IR-based night mask covers the rest, blended at the live terminator (night clouds dimmed 0.35×). **Zoom-driven global → detail blend**: `detail = 1 − smoothstep(cameraDist, DETAIL_BLEND_NEAR=1.2, DETAIL_BLEND_FAR=3.4)` drives a continuous `fullDaylight` (earth shader) and `cloudVisibility = (1 − detail) × masterToggle` (cloud shader) — global view keeps the real solar day/night with full clouds; at local scale (≤1.2 earth radii) the surface shows full daylight and no clouds. The time simulation and solar vector are untouched. The old "Permanent Full Daylight" checkbox was removed (daylight is now automatic with zoom). The overlay loads in the background so GIBS latency never delays the Earth itself; on failure the cloud layer stays hidden and the chip reports OFF.
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

All crons run on GitHub's servers — Igor's PC can be off. Manual run: `gh workflow run <name>`.

## Test & deploy checklist

1. `npm run build` (tsc + vite clean).
2. `npm run dev` → verify in browser: `#sat-load-status` = "Catalog Loaded: N", feed chips show expected statuses, ticker shows tagged events, search → select → telemetry panel + reticle.
3. Cables: search a station (e.g. "virginia beach") → panel shows real connected cables.
4. Clouds: `Clouds` chip shows `LIVE — NASA GIBS · SNPP · <date> · DAY+NIGHT`; toggle OFF removes only the cloud layer (stylized Earth unchanged); no console warning about fallback. `npm run verify:clouds` passes (semantic chain + transfer tests, live date walk, coverage gates, colormap decode, no opaque black, no-data transparency, dateline seam). Zoom check: at global distance clouds are fully visible over the real day/night terminator; zooming to the surface smoothly fades clouds and lifts the night side to full daylight (thresholds: `DETAIL_BLEND_NEAR=1.2`, `DETAIL_BLEND_FAR=3.4` earth radii).
5. Push to `main` → `gh run watch` the deploy → verify live bundle hash changed + `data/cables.json` serves 200.
6. After changing feed code: `gh workflow run update-live-feeds.yml` and verify the `live-data` branch files + raw 200s.
7. **Keep the docs current** — any change that affects behavior also updates `docs/architecture.md`, `docs/data-sources.md`, and the README's live-vs-curated notes.
