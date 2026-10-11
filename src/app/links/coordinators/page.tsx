"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LinksNav } from "@/components/LinksNav";

type Coord = {
  id: number;
  full_name: string;
  email: string;
  institution_id?: number | null;
  settlement_name?: string | null;
  manager_name?: string;
};

type Institution = {
  id: number;
  name: string;
  settlement_name: string | null;
  coordinators?: Coord[] | string;
};

function parseCoords(value: Coord[] | string | undefined): Coord[] {
  if (!value) return [];
  if (typeof value === "string") return JSON.parse(value) as Coord[];
  return value;
}

export default function CoordinatorsLinksPage() {
  const router = useRouter();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [available, setAvailable] = useState<Coord[]>([]);
  const [allCoords, setAllCoords] = useState<Coord[]>([]);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [meRes, instRes, usersRes] = await Promise.all([
      fetch("/api/auth/me"),
      fetch("/api/institutions"),
      fetch("/api/users"),
    ]);
    const me = await meRes.json();
    const role = me.user?.role;
    if (role !== "super_admin" && role !== "area_manager") {
      router.replace("/");
      return;
    }
    const data = await instRes.json();
    if (!instRes.ok) {
      setMsg(data.error || "אין הרשאה");
      setLoading(false);
      return;
    }
    setInstitutions(
      (data.institutions ?? []).map((i: Institution) => ({
        ...i,
        coordinators: parseCoords(i.coordinators),
      })),
    );
    setAvailable(data.available_coordinators ?? []);
    const usersData = await usersRes.json();
    setAllCoords(
      (usersData.users ?? []).filter((u: Coord & { role: string }) => u.role === "coordinator"),
    );
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return institutions;
    return institutions.filter((i) => {
      const coords = (i.coordinators as Coord[]) ?? [];
      const hay = [i.name, i.settlement_name, ...coords.map((c) => c.full_name)]
        .filter(Boolean)
        .join(" ");
      return hay.includes(needle);
    });
  }, [institutions, q]);

  const unlinked = useMemo(() => {
    const linkedIds = new Set(
      institutions.flatMap((i) => ((i.coordinators as Coord[]) ?? []).map((c) => c.id)),
    );
    return allCoords.filter((c) => !linkedIds.has(c.id));
  }, [institutions, allCoords]);

  async function linkCoordinator(institutionId: number) {
    const userId = Number(pick[institutionId]);
    if (!Number.isInteger(userId)) {
      setMsg("בחרו רכז");
      return;
    }
    setBusyId(institutionId);
    setMsg(null);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/coordinators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה בקישור");
        return;
      }
      setPick((p) => ({ ...p, [institutionId]: "" }));
      setMsg("הרכז קושר למוסד");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function unlinkCoordinator(institutionId: number, userId: number) {
    setBusyId(institutionId);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/institutions/${institutionId}/coordinators?user_id=${userId}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה בהסרה");
        return;
      }
      setMsg("השיוך הוסר");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function optionsFor(institutionId: number) {
    const linkedIds = new Set(
      (
        (institutions.find((i) => i.id === institutionId)?.coordinators as Coord[] | undefined) ??
        []
      ).map((c) => c.id),
    );
    const pool = available.length > 0 ? available : allCoords;
    return pool.filter((c) => !linkedIds.has(c.id));
  }

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">קישורים</p>
            <h1>רכז ↔ מוסד</h1>
            <p className="lede">
              שייכו רכז למוסד. רק אשכולות המקושרים למוסד יופיעו אצל הרכז במפה — ולחיצה על
              אשכול בטבלה מציגה אותו.
            </p>
          </div>
        </header>
        <LinksNav />
        {loading && <p className="lede">טוען…</p>}
        {!loading && msg && <p className="form-msg">{msg}</p>}
        {!loading && unlinked.length > 0 && (
          <p className="lede">
            רכזים ללא מוסד: {unlinked.map((c) => c.full_name).join(" · ")}
          </p>
        )}
        {!loading && (
          <label className="panel-form" style={{ display: "block" }}>
            סינון
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="מוסד, יישוב, רכז…"
            />
          </label>
        )}
        {!loading &&
          filtered.map((inst) => {
            const coords = (inst.coordinators as Coord[]) ?? [];
            const options = optionsFor(inst.id);
            return (
              <section key={inst.id} className="panel-form links-panel">
                <div className="links-panel-head">
                  <h2>{inst.name}</h2>
                  <p className="lede">{inst.settlement_name || "—"}</p>
                </div>
                {coords.length === 0 ? (
                  <p className="lede">אין רכז משויך</p>
                ) : (
                  <ul className="coord-link-list">
                    {coords.map((c) => (
                      <li key={c.id}>
                        <span>{c.full_name}</span>
                        <button
                          type="button"
                          className="linkish"
                          disabled={busyId === inst.id}
                          onClick={() => void unlinkCoordinator(inst.id, c.id)}
                        >
                          הסר
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="coord-link-add" style={{ marginTop: "0.75rem" }}>
                  <select
                    value={pick[inst.id] ?? ""}
                    onChange={(e) =>
                      setPick((p) => ({ ...p, [inst.id]: e.target.value }))
                    }
                    disabled={busyId === inst.id || options.length === 0}
                  >
                    <option value="">
                      {options.length === 0 ? "אין רכזים פנויים" : "בחרו רכז…"}
                    </option>
                    {options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name}
                        {c.institution_id ? " (משויך למוסד אחר)" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="export"
                    disabled={busyId === inst.id || !pick[inst.id]}
                    onClick={() => void linkCoordinator(inst.id)}
                  >
                    קשר
                  </button>
                </div>
              </section>
            );
          })}
      </div>
    </main>
  );
}
