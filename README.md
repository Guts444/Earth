# Earth Command — Planetary Live Operations Center

A high-performance, real-time 3D planetary intelligence platform and tactical operations center built with **Three.js**, **TypeScript**, and **Vite**.

![Earth Command Center](/screenshot.png)

---

## 🌐 Overview

**Earth Command** turns the browser into a multi-domain situational awareness dashboard, aggregating and visualizing live signals across space operations, civil aviation, maritime logistics, critical infrastructure, geosphere hazards, and electronic warfare environments.

---

## 📚 Project Docs

- **[`docs/architecture.md`](docs/architecture.md)** — how the app is built: module map, the domain-registry pattern, screen-space picking, data flow, CI/CD, and the test/deploy checklist. **Start here** when picking the project up (contributor or new session).
- **[`docs/data-sources.md`](docs/data-sources.md)** — every data feed: source, freshness, live-vs-static status, and the fallback chains that keep the app honest when an upstream is down.

---

## 🛰️ Monitored Signal Domains

> **Live vs. curated:** satellites (CelesTrak), aviation (OpenSky ADS-B), earthquakes (USGS), tropical cyclones (NOAA NHC), cloud cover (NASA GIBS VIIRS cloud mask), aurora/space weather (NOAA SWPC), and launch schedules (Launch Library 2) ingest live feeds. Wildfires, volcanoes, DSN, asteroids, marine traffic, infrastructure, and EW zones are curated datasets with real-data provenance rendered with animated shaders. The bottom **DATA FEEDS** strip shows every feed's honest status (green = live, amber = simulated, blue = static snapshot, red = unreachable) — hover a chip for the source and freshness. The event ticker only carries sourced events (`[USGS]`, `[NHC]`, `[CelesTrak]`, …).

### 1. Orbital Mechanics & Satellite Constellations
- **Live CelesTrak Integration**: Propagates 11,000+ active satellites across Starlink, OneWeb, GPS/GLONASS/Galileo/BeiDou constellations, ISS, and scientific payloads.
- **Client-Side SGP4 Engine**: Continuous local orbit propagation using [`satellite.js`](https://github.com/shashwatak/satellite-js) with sub-frame velocity extrapolation.
- **Overlays**: Interactive orbital path projections, ground footprints, and NORAD telemetry.

### 2. Global Aviation (ADS-B)
- **OpenSky Network Feeds**: Live transponder ingestion mapped to high-altitude scene coordinates. On static hosting (where OpenSky's CORS-closed API is unreachable) the site consumes a CI-fed 20-minute snapshot from the `live-data` branch, with a localStorage cache and an honest simulated-fleet fallback — the DATA FEEDS chip tells you which mode is active.
- **Great-Circle Routing Engine**: Autonomous simulation spanning international flight corridors across commercial, cargo, military, and general aviation.

### 3. Maritime Logistics (AIS)
- **Nautical Corridors**: Over 950 container ships, bulk carriers, oil tankers, and naval vessels navigating 7 global oceanic routes (Suez, Panama, Malacca, Dover, Cape of Good Hope, Trans-Pacific, South Atlantic) with zero land crossings.

### 4. Critical Infrastructure
- **Submarine Fiber Cables**: Full TeleGeography dataset — **700+ cable systems and ~1,900 landing stations** with real route geometry (weekly-synced snapshot at `data/cables.json`, built by `scripts/build-cables-data.py`). Hover/click a station for its real connected cables.
- **Nuclear Power Facilities**: Global nuclear generating stations (Zaporizhzhia, Bruce, Kashiwazaki-Kariwa, Gravelines, Hanul, Palo Verde, Barakah, Taishan, etc.) detailing reactor models, unit counts, and net MWe capacity.

### 5. Deep Space & Heliophysics
- **NASA Deep Space Network (DSN)**: Antenna complexes at Goldstone, Madrid, and Canberra with 3D carrier beams tracking probes across the solar system (Voyager 1 at 163.5 AU, Voyager 2, JWST, Mars Perseverance, Parker Solar Probe, New Horizons).
- **NOAA Auroral Oval & Space Weather**: Dynamic 3D undulating polar curtains over geomagnetic poles with 557.7nm (oxygen green) and 391.4nm (nitrogen violet) atmospheric emission shaders, $K_p$ index, and solar wind metrics.
- **NASA JPL Near-Earth Asteroids (NEOs)**: Approaching celestial bodies (Apophis, Bennu, Toutatis, Florence, 2024 YR4, 1950 DA) with danger vectors, close-approach miss distances (in Lunar Distances / km), and velocity.
- **Orbital Spaceports**: Launch complexes (Cape Canaveral, Starbase Boca Chica, Vandenberg, Kourou, Tanegashima, Sriharikota, Mahia, Baikonur) with launch azimuth trajectories and live countdowns.

### 6. Geosphere Hazards & Climate
- **USGS Earthquakes**: Real-time global seismic feeds with focal depth markers and magnitude-scaled epicenter rings.
- **Real Satellite Cloud Cover**: The "Clouds" toggle overlays a dedicated cloud sphere with **NASA GIBS VIIRS Clear Sky Confidence** (Suomi NPP, NOAA-20 fallback) — the real VIIRS cloud mask (confidence of *clear* sky, 1.0 = confident clear), converted to cloud confidence and passed through a conservative presentation transfer (ambiguous detections suppressed, max opacity capped so the map stays readable). Day + dimmed night sides, refreshed per load. The stylized day/night Earth stays underneath; no-data is transparent (never black). Clouds and daylight respond to zoom: at global view clouds are fully visible over the real solar day/night; zooming toward the surface smoothly fades the clouds and lifts the night side to full daylight. The Clouds feed chip shows source · imagery date · DAY+NIGHT.
- **Smithsonian GVP Volcanoes**: Active caldera monitoring along the Ring of Fire with standardized alert levels (🔴 Warning / 🟠 Watch / 🟡 Advisory / 🟢 Normal).
- **NASA FIRMS Wildfires**: Thermal anomaly clusters with Fire Radiative Power (MW) and pulsating heat shaders.
- **Tropical Cyclones**: Active hurricanes and typhoons with rotating spiral vortex shaders, central barometric pressure, and sustained wind telemetry.

### 7. Tactical & Electronic Warfare
- **GPS Jamming / GNSS Denial Zones**: Active electronic warfare and navigation spoofing corridors (Baltic Sea, Black Sea, Eastern Mediterranean, Red Sea, Strait of Hormuz, Korean DMZ) with degradation percentage and tactical radar sweep shaders.

---

## 🎮 Command & Control HUD

- **Multi-Domain Domain Tabs**: Quick access to `🛰️ Sats`, `✈️ Air`, `🚢 Sea`, `🌋 Hazards`, `🌌 Space`, `⚡ Infra`, `🌐 Layers`, and `🎯 Hotspots`.
- **Target Lock & Chase Cam**: Seamless Earth-centered tracking camera with automated disengage upon manual user orbit/pan.
- **Global Search**: Instant fuzzy search across any entity across all 10 domains (e.g. `Voyager`, `Apophis`, `Etna`, `Milton`, `Starbase`, `Marea`, `Zaporizhzhia`).
- **Solar Terminator & Daylight Toggle**: Real-time NOAA solar vector calculations with day/night illumination or permanent full-daylight mode.
- **Time Warp Controls**: Real-time UTC simulation playback, pause, and up to 60× acceleration.
- **Distance-Adaptive Rotation**: orbit speed scales with camera distance — precise slow rotation at max zoom, full speed when zoomed out.
- **DATA FEEDS Strip**: live/static/simulated status for every data source, with freshness tooltips.
- **HUD Themes**: `Cyber Blue`, `Tactical Amber`, `Emerald Radar`, and `Stealth`.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm / pnpm / yarn

### Installation & Run

```bash
# Clone the repository
git clone https://github.com/Guts444/Earth.git
cd Earth

# Install dependencies
npm install

# Start development server
npm run dev
```

Open `http://localhost:5173/` in your browser.

---

## 🛠️ Scripts

| Command | Description |
|---|---|
| `npm run dev` | Launch Vite dev server with CelesTrak, OpenSky, USGS, and NHC proxy plugins |
| `npm run build` | Run TypeScript compiler typechecks and generate optimized production bundle |
| `npm run preview` | Serve the production build locally with proxy endpoints enabled |

## 🌍 Live Deployment

The app deploys to **GitHub Pages** automatically via `.github/workflows/deploy.yml` (push to `main`). Live feeds with CORS-open upstreams (CelesTrak, USGS, SWPC, Launch Library 2) fetch directly on static hosting.

**CORS-closed feeds** (OpenSky ADS-B, NOAA NHC) are snapshotted every 20 minutes by `.github/workflows/update-live-feeds.yml` to the orphan `live-data` branch; the client falls back through dev proxy → `raw.githubusercontent.com` snapshot → localStorage cache → simulated/curated fallback.

Satellite TLEs are refreshed **every 6 hours** by `.github/workflows/update-tles.yml` — a cron job that runs on GitHub's servers (no local machine needed) and force-pushes all 12 catalog groups to the orphan `tle-data` branch, which the site fetches from `raw.githubusercontent.com`. CelesTrak is the primary source, with the GitHub-hosted changshuospace mirror as fallback for throttled groups.

The submarine-cable dataset is refreshed **weekly** by `.github/workflows/update-cables.yml` (Monday 03:23 UTC) — it rebuilds `data/cables.json` from TeleGeography's API and pushes it to `main`, which re-deploys the site.

1. Make sure the repository is **public** (GitHub Pages is not available for private repos on the free plan).
2. Repo Settings → Pages → **Source: GitHub Actions**.
3. Push to `main` — the workflow builds and deploys `dist/`.

---

## 🏗️ Architecture & Tech Stack

- **Core**: HTML5, Vanilla CSS Design System, TypeScript
- **3D Graphics & Shaders**: [Three.js](https://threejs.org/) (WebGL2, Custom GLSL shaders for atmospheres, auroras, point clouds, hurricanes, and pulse lines)
- **Astrodynamics & Orbit Propagation**: [satellite.js](https://github.com/shashwatak/satellite-js) (SGP4/SDP4)
- **Data Proxies**: Vite dev middleware with caching for CelesTrak, USGS, and OpenSky APIs

---

## 📄 License

MIT License — Orbital TLEs via CelesTrak, seismic feeds via USGS, aviation vectors via OpenSky Network, space data via NASA/JPL/NOAA.
