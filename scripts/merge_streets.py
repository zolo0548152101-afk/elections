#!/usr/bin/env python3
"""Merge named OSM road segments into streets.ndjson + street_batches/."""
import hashlib
import json
import math
import os
import re
from collections import defaultdict
from pathlib import Path

import duckdb

PARQUET = os.environ.get("ROADS_PARQUET", "/tmp/isr_roads.parquet")
ROOT = Path(__file__).resolve().parents[1]


def norm(s: str) -> str:
    if not s:
        return ""
    s = s.strip().translate(
        str.maketrans(
            {
                "'": "",
                '"': "",
                "׳": "",
                "״": "",
                "`": "",
                "־": " ",
                "-": " ",
                "–": " ",
                "—": " ",
            }
        )
    )
    s = s.replace("(", " ").replace(")", " ")
    s = re.sub(r"\s+", " ", s).strip()
    if s.startswith("רחוב "):
        s = s[5:].strip()
    return s.translate(str.maketrans("ךםןףץ", "כמנפצ"))


def hav(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def main():
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    hw = (
        "('residential','living_street','unclassified','tertiary','secondary',"
        "'primary','service','pedestrian','trunk','tertiary_link',"
        "'secondary_link','primary_link')"
    )
    rows = con.execute(
        f"""
        SELECT id, name_he, ST_AsGeoJSON(geom) AS gj,
               bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax,
               (bbox.xmin+bbox.xmax)/2 AS lng,
               (bbox.ymin+bbox.ymax)/2 AS lat
        FROM read_parquet('{PARQUET}')
        WHERE name_he IS NOT NULL AND name_he <> ''
          AND highway IN {hw}
          AND geom IS NOT NULL
          AND ST_GeometryType(geom) IN ('LINESTRING','MULTILINESTRING')
        """
    ).fetchall()

    by_name = defaultdict(list)
    for osm_id, name_he, gj, xmin, ymin, xmax, ymax, lng, lat in rows:
        n = norm(name_he)
        if not n:
            continue
        by_name[n].append(
            {
                "name_he": name_he.strip(),
                "gj": json.loads(gj),
                "xmin": xmin,
                "ymin": ymin,
                "xmax": xmax,
                "ymax": ymax,
                "lng": lng,
                "lat": lat,
            }
        )

    streets = []
    for n, segs in by_name.items():
        used = [False] * len(segs)
        for i, s in enumerate(segs):
            if used[i]:
                continue
            cluster = [s]
            used[i] = True
            changed = True
            while changed:
                changed = False
                for j, t in enumerate(segs):
                    if used[j]:
                        continue
                    if any(hav(a["lat"], a["lng"], t["lat"], t["lng"]) <= 4.0 for a in cluster):
                        used[j] = True
                        cluster.append(t)
                        changed = True
            lines = []
            for c in cluster:
                g = c["gj"]
                if g["type"] == "LineString":
                    lines.append(g["coordinates"])
                elif g["type"] == "MultiLineString":
                    lines.extend(g["coordinates"])
            if not lines:
                continue
            geom = (
                {"type": "MultiLineString", "coordinates": lines}
                if len(lines) > 1
                else {"type": "LineString", "coordinates": lines[0]}
            )
            lat = sum(c["lat"] for c in cluster) / len(cluster)
            lng = sum(c["lng"] for c in cluster) / len(cluster)
            sid = hashlib.sha1(f"{n}|{round(lat,4)}|{round(lng,4)}".encode()).hexdigest()[:16]
            streets.append(
                {
                    "id": sid,
                    "name_he": cluster[0]["name_he"],
                    "lat": lat,
                    "lng": lng,
                    "bbox_xmin": min(c["xmin"] for c in cluster),
                    "bbox_ymin": min(c["ymin"] for c in cluster),
                    "bbox_xmax": max(c["xmax"] for c in cluster),
                    "bbox_ymax": max(c["ymax"] for c in cluster),
                    "geom_geojson": json.dumps(geom, separators=(",", ":")),
                    "ashkol": None,
                }
            )

    out = ROOT / "data" / "streets.ndjson"
    with out.open("w", encoding="utf8") as f:
        for s in streets:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")

    batch_dir = ROOT / "data" / "street_batches"
    batch_dir.mkdir(exist_ok=True)
    for old in batch_dir.glob("*.json"):
        old.unlink()
    bs = 200
    for i in range(0, len(streets), bs):
        chunk = streets[i : i + bs]
        (batch_dir / f"{i // bs:05d}.json").write_text(
            json.dumps(chunk, ensure_ascii=False, separators=(",", ":")),
            encoding="utf8",
        )
    print({"segments": len(rows), "streets": len(streets), "batches": (len(streets) + bs - 1) // bs})


if __name__ == "__main__":
    main()
