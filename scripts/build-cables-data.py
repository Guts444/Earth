#!/usr/bin/env python3
"""Build public/data/cables.json from TeleGeography's Submarine Cable Map API.

Downloads the three public JSON snapshots (cable list, cable geometry,
landing-point geometry) and merges them into one trimmed file the client
fetches at runtime. Station <-> cable links are derived from geometry: a
station is linked to every cable whose route passes within ~0.35 deg of it
(the polylines terminate at their landing stations).

Coordinate precision is rounded to 3 decimals (~100 m) — plenty for a globe.
Run manually or via .github/workflows/update-cables.yml (weekly cron).
"""
import json
import math
import os
import time
import urllib.request

BASE = "https://www.submarinecablemap.com/api/v3"
OUT = "public/data/cables.json"

# ~0.35 deg = ~39 km max at the equator; generous enough for coordinate
# rounding and route approximations, tight enough to avoid cross-hub links.
LINK_RADIUS_DEG = 0.35
GRID_CELL_DEG = 0.5
KM_PER_DEG = 111.32


def get(path: str, retries: int = 2) -> object:
    url = BASE + path
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "earth-command-data-builder/1.0"}
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed: {last_err}")


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = (
        math.sin(dp / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    )
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def main() -> None:
    print("downloading cable list / geometries / landing points ...")
    cables_meta = {c["id"]: c.get("name", c["id"]) for c in get("/cable/all.json")}
    geo = get("/cable/cable-geo.json")
    stations_geo = get("/landing-point/landing-point-geo.json")

    segs_by_cable: dict[str, list] = {}
    for f in geo["features"]:
        cid = f["properties"]["id"]
        geom = f.get("geometry")
        if not geom:
            continue
        coords = (
            geom["coordinates"]
            if geom["type"] == "MultiLineString"
            else [geom["coordinates"]]
        )
        segs_by_cable.setdefault(cid, []).extend(coords)

    stations = []
    for f in stations_geo["features"]:
        p = f["properties"]
        g = f["geometry"]
        stations.append(
            {
                "id": p["id"],
                "name": p["name"],
                "lat": round(g["coordinates"][1], 3),
                "lon": round(g["coordinates"][0], 3),
                "tbd": bool(p.get("is_tbd")),
            }
        )

    # Spatial hash: lat/lon cell -> station indices
    grid: dict[tuple[int, int], list[int]] = {}
    for si, s in enumerate(stations):
        key = (math.floor(s["lat"] / GRID_CELL_DEG), math.floor(s["lon"] / GRID_CELL_DEG))
        grid.setdefault(key, []).append(si)

    def stations_near(lat: float, lon: float) -> list[int]:
        """Station indices within LINK_RADIUS_DEG of a point."""
        cx = math.floor(lat / GRID_CELL_DEG)
        cy = math.floor(lon / GRID_CELL_DEG)
        hits: list[int] = []
        r_km = LINK_RADIUS_DEG * KM_PER_DEG
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for si in grid.get((cx + dx, cy + dy), ()):
                    s = stations[si]
                    if haversine_km(lat, lon, s["lat"], s["lon"]) <= r_km:
                        hits.append(si)
        return hits

    print("linking stations to cables by route proximity ...")
    cables = []
    for cid, name in cables_meta.items():
        segs = segs_by_cable.get(cid)
        if not segs:
            continue
        served: set[int] = set()
        for seg in segs:
            for pt in seg:
                served.update(stations_near(pt[1], pt[0]))  # coords are [lon, lat]
        cables.append(
            {
                "id": cid,
                "name": name,
                "segments": [
                    [[round(pt[0], 3), round(pt[1], 3)] for pt in seg] for seg in segs
                ],
                "stations": sorted(stations[si]["id"] for si in served),
            }
        )

    cables.sort(key=lambda c: c["name"].lower())
    stations.sort(key=lambda s: s["name"].lower())

    data = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cables": cables,
        "stations": stations,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    linked = sum(1 for s in stations if any(s["id"] in c["stations"] for c in cables))
    print(f"wrote {OUT}: {len(cables)} cables, {len(stations)} stations")
    print(f"stations linked to >=1 cable: {linked} ({linked / len(stations) * 100:.0f}%)")
    raw_size = len(json.dumps(data, separators=(",", ":")))
    print(f"size: {round(raw_size / 1024)} KB (raw json)")


if __name__ == "__main__":
    main()
