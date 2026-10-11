"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { formatAshkolLabel } from "@/lib/ashkol-label";
import { matchesSearch } from "@/lib/text-search";

export type CoordInstitution = {
  id: number;
  name: string;
  settlement_name?: string | null;
};

export type CoordCluster = {
  ashkol: string;
  settlement_name?: string | null;
  institution_id: number;
  institution_name?: string;
};

type ClusterHit = {
  ashkol: string;
  settlement_name: string;
};

type Props = {
  institutions: CoordInstitution[];
  clusters: CoordCluster[];
  onChanged: () => Promise<void> | void;
  onMessage?: (kind: "ok" | "err", text: string) => void;
};

function pickInstitution(
  institutions: CoordInstitution[],
  settlementName: string | null | undefined,
): CoordInstitution | null {
  if (institutions.length === 0) return null;
  if (institutions.length === 1) return institutions[0]!;
  const needle = (settlementName ?? "").trim();
  if (needle) {
    const match = institutions.find(
      (i) => (i.settlement_name ?? "").trim() === needle,
    );
    if (match) return match;
  }
  return institutions[0]!;
}

/**
 * Chip + search combobox to add/remove ashkol links for a coordinator.
 */
export function CoordClusterEditor({
  institutions,
  clusters,
  onChanged,
  onMessage,
}: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<ClusterHit[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          "/api/clusters?minRight=0&maxTurnout=100&minBzb=0&minLikud=0",
        );
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const rows = (data.clusters ?? []) as {
          ashkol: string;
          settlement_name: string;
        }[];
        setCatalog(
          rows.map((c) => ({
            ashkol: String(c.ashkol),
            settlement_name: String(c.settlement_name ?? ""),
          })),
        );
      } catch {
        /* suggestions optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const linkedAshkols = useMemo(
    () => new Set(clusters.map((c) => c.ashkol)),
    [clusters],
  );

  const hits = useMemo(() => {
    const available = catalog.filter((c) => !linkedAshkols.has(c.ashkol));
    const needle = q.trim();
    const filtered = !needle
      ? available.slice(0, 12)
      : available
          .filter((c) =>
            matchesSearch(
              [c.ashkol, c.settlement_name, formatAshkolLabel(c.ashkol, c.settlement_name)]
                .filter(Boolean)
                .join(" "),
              needle,
            ),
          )
          .slice(0, 12);
    return filtered;
  }, [catalog, linkedAshkols, q]);

  useEffect(() => {
    setActive(0);
  }, [q, open, hits.length]);

  if (institutions.length === 0) {
    return (
      <p className="lede" style={{ margin: "0.5rem 0 0" }}>
        אין מוסדות משויכים לרכז — קשרו מוסד לפני הוספת אשכולות.
      </p>
    );
  }

  async function linkHit(hit: ClusterHit) {
    const inst = pickInstitution(institutions, hit.settlement_name);
    if (!inst) {
      onMessage?.("err", "אין מוסד לקישור");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/institutions/${inst.id}/clusters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ashkol: hit.ashkol }),
      });
      const data = await res.json();
      if (!res.ok) {
        onMessage?.("err", data.error || "שגיאה בקישור אשכול");
        return;
      }
      setQ("");
      onMessage?.(
        "ok",
        `✓ אשכול ${hit.ashkol} נוסף ל«${inst.name}»`,
      );
      await onChanged();
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function unlink(c: CoordCluster) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/institutions/${c.institution_id}/clusters?ashkol=${encodeURIComponent(c.ashkol)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        onMessage?.("err", data.error || "שגיאה בהסרת אשכול");
        return;
      }
      onMessage?.("ok", `אשכול ${c.ashkol} הוסר`);
      await onChanged();
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit && !busy) void linkHit(hit);
      return;
    }
    if (e.key === "Backspace" && !q && clusters.length > 0 && !busy) {
      void unlink(clusters[clusters.length - 1]!);
      return;
    }
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="coord-cluster-editor" ref={wrapRef}>
      <span className="field-label" id="coord-ashkol-label">
        אשכולות מקושרים
      </span>
      <div
        className={`inst-multi-box${open ? " is-open" : ""}`}
        onClick={() => inputRef.current?.focus()}
      >
        {clusters.map((c) => (
          <span key={`${c.institution_id}:${c.ashkol}`} className="inst-chip">
            <span className="inst-chip-text">
              {formatAshkolLabel(c.ashkol, c.settlement_name)}
              {c.institution_name ? ` · ${c.institution_name}` : ""}
            </span>
            <button
              type="button"
              className="inst-chip-remove"
              disabled={busy}
              aria-label={`הסר אשכול ${c.ashkol}`}
              onClick={(e) => {
                e.stopPropagation();
                void unlink(c);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="search"
          className="inst-multi-input"
          dir="ltr"
          value={q}
          disabled={busy}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="coord-ashkol-listbox"
          aria-labelledby="coord-ashkol-label"
          placeholder={
            clusters.length === 0
              ? "חיפוש אשכול להוספה…"
              : "הוספת אשכול נוסף…"
          }
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <ul
          id="coord-ashkol-listbox"
          className="picker-hits inst-multi-hits"
          role="listbox"
        >
          {hits.length === 0 ? (
            <li className="picker-empty">
              {catalog.length === 0
                ? "טוען אשכולות…"
                : q.trim()
                  ? "אין התאמות"
                  : "כל האשכולות הזמינים כבר מקושרים"}
            </li>
          ) : (
            hits.map((hit, i) => {
              const inst = pickInstitution(institutions, hit.settlement_name);
              return (
                <li key={hit.ashkol}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "active" : undefined}
                    disabled={busy}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void linkHit(hit)}
                  >
                    <span className="mono">
                      {formatAshkolLabel(hit.ashkol, hit.settlement_name)}
                    </span>
                    {institutions.length > 1 && inst ? (
                      <span className="hit-meta"> → {inst.name}</span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
      {institutions.length > 1 ? (
        <p className="map-credit" style={{ marginTop: "0.4rem" }}>
          קישור חדש ישויך למוסד לפי יישוב האשכול (או למוסד הראשון).
        </p>
      ) : null}
    </div>
  );
}
