"use client";

import { Fragment, useEffect, useState } from "react";
import { AshkolSearch } from "@/components/AshkolSearch";
import { LinkGroup } from "@/components/LinkGroup";
import { NameSearch } from "@/components/NameSearch";
import { ShowMore } from "@/components/ShowMore";
import { formatAshkolLabel } from "@/lib/ashkol-label";
import { SortTh, sortRows, useSortState, type SortGetters } from "@/components/SortTh";

type Contact = {
  id: number;
  full_name: string;
  role_title: string;
  phone: string;
};

type LinkedCluster = {
  ashkol: string;
  settlement_name: string;
  right_pct: number;
  turnout_pct: number;
  bzb: number;
  done?: boolean;
};

type Coord = {
  id: number;
  full_name: string;
  email: string;
  institution_id?: number | null;
};

type Institution = {
  id: number;
  name: string;
  kind: string | null;
  settlement_name: string | null;
  district: string | null;
  lat: number | null;
  lng: number | null;
  key_people_raw: string | null;
  created_at: string;
  contacts?: Contact[] | string;
  linked_clusters?: LinkedCluster[] | string;
  coordinators?: Coord[] | string;
};

function parseJsonField<T>(value: T[] | string | undefined): T[] {
  if (!value) return [];
  if (typeof value === "string") return JSON.parse(value) as T[];
  return value;
}

const APP_INSTITUTIONS_SORT: SortGetters<Institution, "name" | "kind" | "city" | "district" | "people" | "clusters" | "coords"> = {
  name: (r) => r.name,
  kind: (r) => r.kind,
  city: (r) => r.settlement_name,
  district: (r) => r.district,
  people: (r) => ((r.contacts as Contact[]) ?? []).map((c) => c.full_name).join(" · ") || r.key_people_raw,
  clusters: (r) => ((r.linked_clusters as LinkedCluster[]) ?? []).length,
  coords: (r) => ((r.coordinators as Coord[]) ?? []).map((c) => c.full_name).join(" · "),
};

export default function InstitutionsPage() {
  const tsort = useSortState<"name" | "kind" | "city" | "district" | "people" | "clusters" | "coords">();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [availableCoords, setAvailableCoords] = useState<Coord[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [createCoordId, setCreateCoordId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"ok" | "err">("err");
  const [info, setInfo] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [q, setQ] = useState("");
  /** "" = all, linked = has coordinator, unlinked = אין רכז */
  const [linkFilter, setLinkFilter] = useState<"" | "linked" | "unlinked">("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const canEdit = role === "super_admin" || role === "area_manager";
  const isCoordinator = role === "coordinator";

  async function load(opts?: { quiet?: boolean }) {
    if (!opts?.quiet) setLoading(true);
    const [instRes, meRes] = await Promise.all([
      fetch("/api/institutions"),
      fetch("/api/auth/me"),
    ]);
    const data = await instRes.json();
    const me = await meRes.json();
    setRole(me.user?.role ?? null);

    if (!instRes.ok) {
      setInfo(data.error || "אין הרשאה");
      setInstitutions([]);
      setLoading(false);
      return;
    }

    setInfo(data.message ?? null);
    setKinds(data.kinds ?? []);
    setAvailableCoords(data.available_coordinators ?? []);
    setInstitutions(
      (data.institutions ?? []).map((i: Institution) => ({
        ...i,
        contacts: parseJsonField<Contact>(i.contacts),
        linked_clusters: parseJsonField<LinkedCluster>(i.linked_clusters),
        coordinators: parseJsonField<Coord>(i.coordinators),
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/institutions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        kind: kind || null,
        contact_name: contactName.trim() || null,
        contact_phone: contactPhone.trim() || null,
        coordinator_user_id: createCoordId ? Number(createCoordId) : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsgKind("err");
      setMsg(data.error || "שגיאה");
      return;
    }
    setName("");
    setKind("");
    setContactName("");
    setContactPhone("");
    setCreateCoordId("");
    setMsgKind("ok");
    setMsg("✓ נוסף");
    void load();
  }

  async function linkCoordinator(institutionId: number, rawUserId: string) {
    const userId = Number(rawUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      setMsgKind("err");
      setMsg("בחרו רכז לקישור");
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
        setMsgKind("err");
        setMsg(data.error || "שגיאה בקישור");
        return;
      }
      setPickerKey((k) => k + 1);
      setMsgKind("ok");
      setMsg("✓ הרכז קושר למוסד");
      await load({ quiet: true });
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
        setMsgKind("err");
        setMsg(data.error || "שגיאה בהסרה");
        return;
      }
      setMsgKind("ok");
      setMsg("השיוך הוסר");
      await load({ quiet: true });
    } finally {
      setBusyId(null);
    }
  }

  async function linkCluster(institutionId: number, ashkol: string) {
    if (!ashkol) return;
    setBusyId(institutionId);
    setMsg(null);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/clusters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ashkol }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsgKind("err");
        setMsg(data.error || "שגיאה בקישור אשכול");
        return;
      }
      setPickerKey((k) => k + 1);
      setMsgKind("ok");
      setMsg(`✓ אשכול ${ashkol} קושר`);
      await load({ quiet: true });
    } finally {
      setBusyId(null);
    }
  }

  async function unlinkCluster(institutionId: number, ashkol: string) {
    setBusyId(institutionId);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/institutions/${institutionId}/clusters?ashkol=${encodeURIComponent(ashkol)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        setMsgKind("err");
        setMsg(data.error || "שגיאה בהסרת אשכול");
        return;
      }
      setMsgKind("ok");
      setMsg("האשכול הוסר");
      await load({ quiet: true });
    } finally {
      setBusyId(null);
    }
  }

  const filtered = institutions.filter((i) => {
    const coords = (i.coordinators as Coord[]) ?? [];
    const hasCoord = coords.length > 0;
    if (linkFilter === "linked" && !hasCoord) return false;
    if (linkFilter === "unlinked" && hasCoord) return false;
    const needle = q.trim();
    if (!needle) return true;
    const hay = [
      i.name,
      i.kind,
      i.settlement_name,
      i.district,
      i.key_people_raw,
      ...coords.map((c) => c.full_name),
    ]
      .filter(Boolean)
      .join(" ");
    return hay.includes(needle);
  });

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <h1>מוסדות</h1>
          </div>
        </header>

        {loading && <p className="lede">טוען…</p>}

        {!loading && info && (
          <p className="lede" style={{ color: "var(--sand)" }}>
            {info}
          </p>
        )}

        {!loading && msg && (
          <p
            className={`form-msg ${msgKind === "ok" ? "form-msg-ok" : "form-msg-err"}`}
            role="alert"
            aria-live="assertive"
          >
            {msg}
          </p>
        )}

        {!loading && (canEdit || isCoordinator) && (
          <>
            {canEdit && (
            <form className="panel-form" onSubmit={onSubmit}>
              <div className="form-grid">
                <label>
                  שם מוסד
                  <input value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label>
                  סוג
                  <select value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="">—</option>
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  איש קשר
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="שם"
                  />
                </label>
                <label>
                  נייד
                  <input
                    dir="ltr"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="05…"
                    inputMode="tel"
                  />
                </label>
                <label className="field-wide">
                  קישור רכז
                  <select
                    value={createCoordId}
                    onChange={(e) => setCreateCoordId(e.target.value)}
                  >
                    <option value="">ללא — ניתן לשייך אחר כך</option>
                    {availableCoords.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name}
                        {c.institution_id ? " (+ מוסדות אחרים)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="submit" className="export">
                הוספה
              </button>
            </form>
            )}
            <div className="panel-form users-filters">
              <label>
                סינון
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="שם, יישוב, מחוז, רכז…"
                />
              </label>
              <label>
                קישור רכז
                <select
                  value={linkFilter}
                  onChange={(e) =>
                    setLinkFilter(e.target.value as "" | "linked" | "unlinked")
                  }
                >
                  <option value="">הכל</option>
                  <option value="linked">קושר</option>
                  <option value="unlinked">לא קושר</option>
                </select>
              </label>
            </div>
          </>
        )}

        {!loading && isCoordinator && institutions.length === 0 && !info && (
          <p className="lede" style={{ color: "var(--sand)" }}>
            לא שויך מוסד למשתמש זה — פנו למנהל.
          </p>
        )}

        {!loading && (canEdit || isCoordinator) && (
          <div className={`table-wrap${editId != null ? " is-editing" : ""}`}>
            <table>
              <thead>
                <tr>
                  <SortTh k="name" sort={tsort.sort} onSort={tsort.toggle}>שם</SortTh>
                  <SortTh k="kind" sort={tsort.sort} onSort={tsort.toggle}>סוג</SortTh>
                  <SortTh k="city" sort={tsort.sort} onSort={tsort.toggle}>יישוב</SortTh>
                  <SortTh k="district" sort={tsort.sort} onSort={tsort.toggle}>מחוז</SortTh>
                  <SortTh k="people" sort={tsort.sort} onSort={tsort.toggle}>אנשי מפתח</SortTh>
                  <SortTh k="clusters" sort={tsort.sort} onSort={tsort.toggle}>אשכולות</SortTh>
                  <SortTh k="coords" sort={tsort.sort} onSort={tsort.toggle}>רכזים</SortTh>
                  {canEdit && <th>פעולות</th>}
                </tr>
              </thead>
              <tbody>
                {sortRows(filtered, APP_INSTITUTIONS_SORT, tsort.sort).map((i) => {
                  const contacts = (i.contacts as Contact[]) ?? [];
                  const clusters = (i.linked_clusters as LinkedCluster[]) ?? [];
                  const coords = (i.coordinators as Coord[]) ?? [];
                  const open = editId === i.id;
                  return (
                    <Fragment key={i.id}>
                    <tr className={open ? "row-editing" : undefined}>
                      <td>
                        <ShowMore text={i.name} />
                      </td>
                      <td>
                        <ShowMore text={i.kind} />
                      </td>
                      <td>
                        <ShowMore text={i.settlement_name} />
                      </td>
                      <td>
                        <ShowMore text={i.district} />
                      </td>
                      <td className="contacts-cell">
                        <ShowMore
                          text={
                            contacts.length > 0
                              ? contacts
                                  .map(
                                    (c) =>
                                      `${c.full_name}${c.role_title ? ` (${c.role_title})` : ""}${
                                        c.phone ? ` ${c.phone}` : ""
                                      }`,
                                  )
                                  .join(" · ")
                              : i.key_people_raw || ""
                          }
                        />
                      </td>
                      <td
                        title={
                          open
                            ? undefined
                            : "אשכולות שסומנו בוצע מתוך האשכולות המקושרים"
                        }
                      >
                        {open ? (
                          <span className="muted-cell">נערך בשורה למטה</span>
                        ) : clusters.length ? (
                          `${clusters.filter((c) => c.done).length}/${clusters.length}`
                        ) : (
                          "0"
                        )}
                      </td>
                      <td>
                        {open ? (
                          <span className="muted-cell">נערך בשורה למטה</span>
                        ) : (
                          <ShowMore
                            text={coords.map((c) => c.full_name).join(" · ")}
                          />
                        )}
                      </td>
                      {canEdit && (
                      <td className="actions-cell">
                        <button
                          type="button"
                          className="export"
                          onClick={() =>
                            setEditId((id) => (id === i.id ? null : i.id))
                          }
                        >
                          {open ? "סגור" : "קשרים"}
                        </button>
                      </td>
                      )}
                    </tr>
                    {open && canEdit && (
                      <tr className="edit-detail-row">
                        <td colSpan={8}>
                          <InstitutionLinks
                            inst={i}
                            clusters={clusters}
                            coords={coords}
                            busy={busyId === i.id}
                            pickerKey={pickerKey}
                            onLinkCoordinator={(userId) =>
                              void linkCoordinator(i.id, userId)
                            }
                            onUnlinkCoordinator={(userId) =>
                              void unlinkCoordinator(i.id, userId)
                            }
                            onLinkCluster={(ashkol) =>
                              void linkCluster(i.id, ashkol)
                            }
                            onUnlinkCluster={(ashkol) =>
                              void unlinkCluster(i.id, ashkol)
                            }
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <p className="map-credit" style={{ marginTop: "0.75rem" }}>
              {filtered.length} / {institutions.length} מוסדות
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function InstitutionLinks({
  inst,
  clusters,
  coords,
  busy,
  pickerKey,
  onLinkCoordinator,
  onUnlinkCoordinator,
  onLinkCluster,
  onUnlinkCluster,
}: {
  inst: Institution;
  clusters: LinkedCluster[];
  coords: Coord[];
  busy: boolean;
  pickerKey: number;
  onLinkCoordinator: (userId: string) => void;
  onUnlinkCoordinator: (userId: number) => void;
  onLinkCluster: (ashkol: string) => void;
  onUnlinkCluster: (ashkol: string) => void;
}) {
  const [coordId, setCoordId] = useState("");
  const [ashkol, setAshkol] = useState("");

  useEffect(() => {
    setCoordId("");
    setAshkol("");
  }, [pickerKey]);

  return (
    <div className="link-groups">
      <LinkGroup
        title="רכזים"
        chips={coords.map((c) => ({ id: String(c.id), label: c.full_name }))}
        busy={busy}
        onRemove={(id) => onUnlinkCoordinator(Number(id))}
        empty="אין רכז"
        search={
          <>
            <NameSearch
              key={`coord-${inst.id}-${pickerKey}`}
              endpoint="/api/coordinators/search"
              placeholder="שם רכז"
              disabled={busy}
              onPick={setCoordId}
            />
            <button
              type="button"
              className="export"
              disabled={busy || !coordId}
              onClick={() => onLinkCoordinator(coordId)}
            >
              קשר
            </button>
          </>
        }
      />
      <LinkGroup
        title="אשכולות"
        chips={clusters.map((c) => ({
          id: c.ashkol,
          label: `${formatAshkolLabel(c.ashkol, c.settlement_name)}${
            c.done ? " · בוצע" : ""
          }`,
        }))}
        busy={busy}
        onRemove={(id) => onUnlinkCluster(id)}
        empty="אין אשכול"
        search={
          <>
            <AshkolSearch
              key={`ash-${inst.id}-${pickerKey}`}
              disabled={busy}
              onPick={setAshkol}
            />
            <button
              type="button"
              className="export"
              disabled={busy || !ashkol}
              onClick={() => onLinkCluster(ashkol)}
            >
              קשר
            </button>
          </>
        }
      />
    </div>
  );
}
