# Earth Command — Planetary Live Operations Center

A high-performance, real-time 3D planetary intelligence platform and tactical operations center built with **Three.js**, **TypeScript**, and **Vite**.

![Earth Command Center](/screenshot.png)

---

## 🌐 Overview

**Earth Command** turns the browser into a multi-domain situational awareness dashboard, aggregating and visualizing live signals across space operations, civil aviation, maritime logistics, critical infrastructure, geosphere hazards, and electronic warfare environments.

---

## 🛰️ Monitored Signal Domains

> **Live vs. curated:** satellites (CelesTrak), aviation (OpenSky), earthquakes (USGS), tropical cyclones (NOAA NHC), aurora/space weather (NOAA SWPC), and launch schedules (Launch Library 2) ingest live feeds. Wildfires, volcanoes, DSN, asteroids, marine traffic, infrastructure, and EW zones are curated datasets with real-data provenance rendered with animated shaders.

### 1. Orbital Mechanics & Satellite Constellations
- **Live CelesTrak Integration**: Propagates 11,000+ active satellites across Starlink, OneWeb, GPS/GLONASS/Galileo/BeiDou constellations, ISS, and scientific payloads.
- **Client-Side SGP4 Engine**: Continuous local orbit propagation using [`satellite.js`](https://github.com/shashwatak/satellite-js) with sub-frame velocity extrapolation.
- **Overlays**: Interactive orbital path projections, ground footprints, and NORAD telemetry.

### 2. Global Aviation (ADS-B)
- **OpenSky Network Feeds**: Live transponder ingestion mapped to high-altitude scene coordinates.
- **Great-Circle Routing Engine**: Autonomous simulation spanning international flight corridors across commercial, cargo, military, and general aviation.

### 3. Maritime Logistics (AIS)
- **Nautical Corridors**: Over 950 container ships, bulk carriers, oil tankers, and naval vessels navigating 7 global oceanic routes (Suez, Panama, Malacca, Dover, Cape of Good Hope, Trans-Pacific, South Atlantic) with zero land crossings.

### 4. Critical Infrastructure
- **Submarine Fiber Cables**: 9 transoceanic internet trunks (MAREA, Dunant, Grace Hopper, 2Africa, SEA-ME-WE 5, Southern Cross, etc.) with animated data pulses along the ocean floor and 10 global landing station hubs.
- **Nuclear Power Facilities**: Global nuclear generating stations (Zaporizhzhia, Bruce, Kashiwazaki-Kariwa, Gravelines, Hanul, Palo Verde, Barakah, Taishan, etc.) detailing reactor models, unit counts, and net MWe capacity.

### 5. Deep Space & Heliophysics
- **NASA Deep Space Network (DSN)**: Antenna complexes at Goldstone, Madrid, and Canberra with 3D carrier beams tracking probes across the solar system (Voyager 1 at 163.5 AU, Voyager 2, JWST, Mars Perseverance, Parker Solar Probe, New Horizons).
- **NOAA Auroral Oval & Space Weather**: Dynamic 3D undulating polar curtains over geomagnetic poles with 557.7nm (oxygen green) and 391.4nm (nitrogen violet) atmospheric emission shaders, $K_p$ index, and solar wind metrics.
- **NASA JPL Near-Earth Asteroids (NEOs)**: Approaching celestial bodies (Apophis, Bennu, Toutatis, Florence, 2024 YR4, 1950 DA) with danger vectors, close-approach miss distances (in Lunar Distances / km), and velocity.
- **Orbital Spaceports**: Launch complexes (Cape Canaveral, Starbase Boca Chica, Vandenberg, Kourou, Tanegashima, Sriharikota, Mahia, Baikonur) with launch azimuth trajectories and live countdowns.

### 6. Geosphere Hazards & Climate
- **USGS Earthquakes**: Real-time global seismic feeds with focal depth markers and magnitude-scaled epicenter rings.
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

The app deploys to **GitHub Pages** automatically via `.github/workflows/deploy.yml` (push to `main`). Live feeds with CORS-open upstreams (CelesTrak, USGS, SWPC, Launch Library 2) fall back to direct fetches on static hosting; OpenSky (rate-limited, no CORS) and NHC (no CORS) degrade to their simulated/curated fallbacks.

Satellite TLEs are refreshed **every 6 hours** by `.github/workflows/update-tles.yml` — a cron job that runs on GitHub's servers (no local machine needed) and force-pushes all 12 catalog groups to the orphan `tle-data` branch, which the site fetches from `raw.githubusercontent.com`. CelesTrak is the primary source, with the GitHub-hosted changshuospace mirror as fallback for throttled groups.

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
