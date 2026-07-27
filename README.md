# Earth Orbit — Live Satellite Tracker

Real-time 3D visualization of Earth-orbiting satellites. TLE data comes from [CelesTrak](https://celestrak.org/) (~every 2 hours); positions are propagated continuously in the browser with [satellite.js](https://github.com/shashwatak/satellite-js) (SGP4) so the scene stays live without polling.

Inspired by [Track The Sky](https://trackthesky.app/) and [satellitemap.space](https://satellitemap.space/).

## Features

- **CelesTrak groups**: Starlink, OneWeb, stations (ISS), GPS / GNSS, weather, science, full active catalog (~12k), and more
- **Local SGP4**: full propagation every ~0.5s, velocity extrapolation between steps for smooth motion
- **2-hour TLE cache** in `localStorage` (no API key, no rate-limit churn)
- **Selection**: click a satellite for lat/lon/alt/velocity, optional orbit path and ground footprint
- **Earth**: day/night blue marble, atmosphere glow, starfield, orbit controls

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

> **CORS:** CelesTrak does not send browser CORS headers. Dev and preview use a Vite proxy at `/api/celestrak` → `https://celestrak.org`. Production static hosts need the same reverse-proxy path (or a tiny edge function).

## Scripts

| Command         | Description                |
| --------------- | -------------------------- |
| `npm run dev`   | Dev server + CelesTrak proxy |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Preview build (proxy enabled) |

## How it works

1. **Fetch** TLE text for selected groups from CelesTrak (`gp.php?GROUP=…&FORMAT=tle`).
2. **Parse** into `satrec` objects via `twoline2satrec`.
3. **Propagate** with `propagate()` → ECI, then `eciToEcf` for an Earth-fixed scene (continents stay put).
4. **Render** satellites as a GPU point cloud (additive glow). Starlink forms a visible LEO shell.

## Stack

- [Vite](https://vitejs.dev/) + TypeScript
- [Three.js](https://threejs.org/)
- [satellite.js](https://github.com/shashwatak/satellite-js)
- [CelesTrak GP API](https://celestrak.org/NORAD/documentation/gp-data-formats.php)

## License

MIT — orbital data © respective owners; TLEs via CelesTrak.
