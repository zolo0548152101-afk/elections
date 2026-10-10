"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { ClusterView } from "@/components/ClusterTable";

const StreetMap = dynamic(
  () => import("@/components/StreetMap").then((m) => m.StreetMap),
  { ssr: false, loading: () => <div className="map-shell map-loading">טוען מפה…</div> },
);

export default function MapPage() {
  const [clusters, setClusters] = useState<ClusterView[]>([]);

  useEffect(() => {
    fetch("/api/clusters?minRight=0&maxTurnout=100&minBzb=0")
      .then((r) => r.json())
      .then((d) => setClusters(d.clusters ?? []))
      .catch(() => setClusters([]));
  }, []);

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">מפת רחובות</p>
            <h1>חיפוש וסימון רחובות</h1>
            <p className="lede">
              רחובות עבריים מ־OpenStreetMap. לחצו על קו לסימון בוצע (ירוק). קישור לאשכולות
              יתמלא כשתעלו את טבלת הרחובות־אשכול.
            </p>
          </div>
        </header>
        <StreetMap clusters={clusters} />
      </div>
    </main>
  );
}
