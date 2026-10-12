"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatAshkolLabel } from "@/lib/ashkol-label";

type Hit = { ashkol: string; settlement_name: string | null };

/** Search clusters by number or settlement. The picked value is the ashkol id. */
export function AshkolSearch({
  disabled,
  onPick,
  onSubmit,
}: {
  disabled?: boolean;
  onPick: (ashkol: string) => void;
  onSubmit?: () => void;
}) {
  const [q, setQ] = useState("");
  const [pickedLabel, setPickedLabel] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1 || term === pickedLabel) {
      setHits([]);
      setBusy(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      fetch(`/api/clusters/search?q=${encodeURIComponent(term)}`, {
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          const next = Array.isArray(data.clusters) ? (data.clusters as Hit[]) : [];
          setHits(next);
          setActive(0);
          setOpen(true);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setHits([]);
        })
        .finally(() => setBusy(false));
    }, 180);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [q, pickedLabel]);

  useEffect(() => {
    function onDoc(e: PointerEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  function choose(hit: Hit) {
    const label = formatAshkolLabel(hit.ashkol, hit.settlement_name);
    setPickedLabel(label);
    setQ(label);
    setHits([]);
    setOpen(false);
    onPick(hit.ashkol);
  }

  function onChange(value: string) {
    setQ(value);
    if (pickedLabel) {
      setPickedLabel("");
      onPick("");
    }
    setOpen(true);
  }

  const showList = open && q.trim().length > 0 && q.trim() !== pickedLabel;

  return (
    <div className="ashkol-search" ref={boxRef}>
      <input
        value={q}
        disabled={disabled}
        placeholder="מספר אשכול או יישוב"
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (hits.length > 0) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Escape") {
            setOpen(false);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (showList && hits[active]) choose(hits[active]);
            else if (pickedLabel) onSubmit?.();
          }
        }}
      />
      {showList && (
        <ul className="search-hits" id={listId} role="listbox">
          {busy && hits.length === 0 ? (
            <li className="search-hint">מחפש…</li>
          ) : hits.length === 0 ? (
            <li className="search-hint">אין אשכולות תואמים</li>
          ) : (
            hits.map((h, i) => (
              <li key={h.ashkol} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={i === active ? "active" : undefined}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    choose(h);
                  }}
                >
                  <bdi dir="ltr">{h.ashkol}</bdi>
                  {h.settlement_name ? ` · ${h.settlement_name}` : ""}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
