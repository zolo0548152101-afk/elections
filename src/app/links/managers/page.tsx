"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LinksNav } from "@/components/LinksNav";

type UserRow = {
  id: number;
  full_name: string;
  email: string;
  mobile?: string | null;
  role: string;
  manager_id?: number | null;
  manager_name?: string;
  settlement_name: string | null;
  institution_name?: string;
  institution_id?: number | null;
};

export default function ManagersLinksPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [meRole, setMeRole] = useState("");
  const [meId, setMeId] = useState<number | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [meRes, usersRes] = await Promise.all([
      fetch("/api/auth/me"),
      fetch("/api/users"),
    ]);
    const me = await meRes.json();
    const role = me.user?.role ?? "";
    setMeRole(role);
    setMeId(me.user?.id ?? null);
    if (role !== "super_admin" && role !== "area_manager") {
      router.replace("/");
      return;
    }
    const data = await usersRes.json();
    setUsers(data.users ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const managers = useMemo(
    () =>
      meRole === "super_admin"
        ? users.filter((u) => u.role === "area_manager")
        : users.filter((u) => u.id === meId && u.role === "area_manager").length
          ? users.filter((u) => u.id === meId)
          : meId
            ? [{ id: meId, full_name: "אני", email: "", role: "area_manager", settlement_name: null }]
            : [],
    [users, meRole, meId],
  );

  const coordinators = useMemo(
    () => users.filter((u) => u.role === "coordinator"),
    [users],
  );

  function coordsUnder(managerId: number) {
    return coordinators.filter((c) => c.manager_id === managerId);
  }

  function unassignedCoords() {
    return coordinators.filter((c) => !c.manager_id);
  }

  async function assignCoordinator(managerId: number) {
    if (meRole !== "super_admin") {
      setMsg("רק מנהל יכול לשנות שיוך לרכז על");
      return;
    }
    const coordId = Number(pick[managerId]);
    if (!Number.isInteger(coordId)) {
      setMsg("בחרו רכז");
      return;
    }
    const coord = coordinators.find((c) => c.id === coordId);
    if (!coord) return;
    setBusyId(managerId);
    setMsg(null);
    try {
      const res = await fetch(`/api/users/${coordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: coord.full_name,
          email: coord.email,
          mobile: coord.mobile ?? "",
          role: "coordinator",
          manager_id: managerId,
          institution_id: coord.institution_id ?? null,
          settlement_name: coord.settlement_name,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה בקישור");
        return;
      }
      setPick((p) => ({ ...p, [managerId]: "" }));
      setMsg(`${coord.full_name} שויך לרכז על`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function unassignCoordinator(managerId: number, coord: UserRow) {
    if (meRole !== "super_admin") {
      setMsg("רק מנהל יכול לשנות שיוך לרכז על");
      return;
    }
    setBusyId(managerId);
    setMsg(null);
    try {
      const res = await fetch(`/api/users/${coord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: coord.full_name,
          email: coord.email,
          mobile: coord.mobile ?? "",
          role: "coordinator",
          manager_id: null,
          institution_id: coord.institution_id ?? null,
          settlement_name: coord.settlement_name,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה בהסרה");
        return;
      }
      setMsg(`${coord.full_name} הוסר משיוך`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const displayManagers =
    meRole === "area_manager" && managers.length === 0 && meId
      ? [
          {
            id: meId,
            full_name: "הרכזים שלי",
            email: "",
            role: "area_manager",
            settlement_name: null as string | null,
          },
        ]
      : managers;

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">קישורים</p>
            <h1>רכז על ↔ רכזים</h1>
            <p className="lede">
              שיוך רכזים תחת רכז על. היררכיה: רכז → רכז על → מנהל.
              {meRole === "area_manager" ? " (צפייה ברכזים שלכם)" : ""}
            </p>
          </div>
        </header>
        <LinksNav />
        {loading && <p className="lede">טוען…</p>}
        {!loading && msg && <p className="form-msg">{msg}</p>}
        {!loading &&
          displayManagers.map((mgr) => {
            const under = coordsUnder(mgr.id);
            const options =
              meRole === "super_admin"
                ? [...unassignedCoords(), ...coordinators.filter((c) => c.manager_id && c.manager_id !== mgr.id)]
                : [];
            const uniqueOptions = Array.from(
              new Map(options.map((c) => [c.id, c])).values(),
            );
            return (
              <section key={mgr.id} className="panel-form links-panel">
                <div className="links-panel-head">
                  <h2>{mgr.full_name}</h2>
                  <p className="lede">{mgr.email || "רכז על"}</p>
                </div>
                {under.length === 0 ? (
                  <p className="lede">אין רכזים משויכים</p>
                ) : (
                  <ul className="coord-link-list">
                    {under.map((c) => (
                      <li key={c.id}>
                        <span>
                          {c.full_name}
                          {c.settlement_name ? ` · ${c.settlement_name}` : ""}
                          {c.institution_name ? ` · ${c.institution_name}` : ""}
                        </span>
                        {meRole === "super_admin" && (
                          <button
                            type="button"
                            className="linkish"
                            disabled={busyId === mgr.id}
                            onClick={() => void unassignCoordinator(mgr.id, c)}
                          >
                            הסר
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {meRole === "super_admin" && (
                  <div className="coord-link-add" style={{ marginTop: "0.75rem" }}>
                    <select
                      value={pick[mgr.id] ?? ""}
                      onChange={(e) =>
                        setPick((p) => ({ ...p, [mgr.id]: e.target.value }))
                      }
                      disabled={busyId === mgr.id || uniqueOptions.length === 0}
                    >
                      <option value="">
                        {uniqueOptions.length === 0 ? "אין רכזים פנויים" : "בחרו רכז…"}
                      </option>
                      {uniqueOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                          {c.manager_id ? " (משויך לרכז על אחר)" : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="export"
                      disabled={busyId === mgr.id || !pick[mgr.id]}
                      onClick={() => void assignCoordinator(mgr.id)}
                    >
                      קשר
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        {!loading && displayManagers.length === 0 && (
          <p className="lede">אין רכזי על במערכת</p>
        )}
      </div>
    </main>
  );
}
