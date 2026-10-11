"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatAshkolLabels } from "@/lib/ashkol-label";
import { matchesSearch } from "@/lib/text-search";

export type PickerInstitution = {
  id: number;
  name: string;
  settlement_name?: string | null;
  linked_clusters?: { ashkol: string; settlement_name?: string }[] | string;
};

function parseClusters(
  value: PickerInstitution["linked_clusters"],
): { ashkol: string; settlement_name?: string }[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value) as {
      ashkol: string;
      settlement_name?: string;
    }[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function labelFor(inst: PickerInstitution): string {
  const clusters = parseClusters(inst.linked_clusters).filter((c) =>
    String(c.ashkol ?? "").trim(),
  );
  const labels = formatAshkolLabels(clusters);
  return labels ? `${inst.name} · ${labels}` : inst.name;
}

/**
 * One field: search + pick + multi-select chips for institutions.
 */
export function InstitutionMultiPicker({
  institutions,
  value,
  onChange,
  placeholder = "חיפוש מוסד או אשכול…",
}: {
  institutions: PickerInstitution[];
  value: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const byId = useMemo(() => {
    const map = new Map<number, PickerInstitution>();
    for (const inst of institutions) map.set(inst.id, inst);
    return map;
  }, [institutions]);

  const selected = value
    .map((id) => byId.get(id))
    .filter((x): x is PickerInstitution => Boolean(x));

  const hits = useMemo(() => {
    const available = institutions.filter((i) => !value.includes(i.id));
    const needle = q.trim();
    const filtered = !needle
      ? available
      : available.filter((i) => {
          const clusters = parseClusters(i.linked_clusters);
          const hay = [
            i.name,
            i.settlement_name,
            ...clusters.map((c) => c.ashkol),
            ...clusters.map((c) => c.settlement_name),
            labelFor(i),
          ]
            .filter(Boolean)
            .join(" ");
          return matchesSearch(hay, needle);
        });
    return filtered.slice(0, 12);
  }, [institutions, value, q]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [q, open, hits.length]);

  function add(id: number) {
    if (!Number.isInteger(id) || id <= 0 || value.includes(id)) return;
    onChange([...value, id]);
    setQ("");
    setOpen(true);
    inputRef.current?.focus();
  }

  function remove(id: number) {
    onChange(value.filter((x) => x !== id));
    inputRef.current?.focus();
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
      if (hit) add(hit.id);
      return;
    }
    if (e.key === "Backspace" && !q && value.length > 0) {
      remove(value[value.length - 1]!);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="field-wide institution-multi" ref={wrapRef}>
      <span className="field-label" id="inst-multi-label">
        מוסדות
      </span>
      <div
        className={`inst-multi-box${open ? " is-open" : ""}`}
        onClick={() => inputRef.current?.focus()}
      >
        {selected.map((inst) => (
          <span key={inst.id} className="inst-chip">
            <span className="inst-chip-text">{labelFor(inst)}</span>
            <button
              type="button"
              className="inst-chip-remove"
              aria-label={`הסר ${inst.name}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(inst.id);
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
          value={q}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="inst-multi-listbox"
          aria-labelledby="inst-multi-label"
          placeholder={
            selected.length === 0 ? placeholder : "הוספת מוסד נוסף…"
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
          id="inst-multi-listbox"
          className="picker-hits inst-multi-hits"
          role="listbox"
        >
          {hits.length === 0 ? (
            <li className="picker-empty">
              {institutions.length === 0
                ? "אין מוסדות במערכת"
                : q.trim()
                  ? "אין התאמות"
                  : "כל המוסדות כבר נבחרו"}
            </li>
          ) : (
            hits.map((inst, i) => (
              <li key={inst.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "active" : undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => add(inst.id)}
                >
                  {labelFor(inst)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
