"use client";

import { useEffect, useId, useRef, useState } from "react";

type Hit = { id: number; label: string };

/** Search a named record. The picked value is the numeric id. */
export function NameSearch({
  endpoint,
  placeholder,
  disabled,
  onPick,
  initialLabel = "",
}: {
  endpoint: string;
  placeholder: string;
  disabled?: boolean;
  onPick: (id: string) => void;
  /** Shown as the current choice. The parent already holds the id. */
  initialLabel?: string;
}) {
  const [q, setQ] = useState(initialLabel);
  const [pickedLabel, setPickedLabel] = useState(initialLabel);
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
      const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}q=${encodeURIComponent(term)}`;
      fetch(url, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data) => {
          const next = Array.isArray(data.hits) ? (data.hits as Hit[]) : [];
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
  }, [q, pickedLabel, endpoint]);

  useEffect(() => {
    function onDoc(e: PointerEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  function choose(hit: Hit) {
    setPickedLabel(hit.label);
    setQ(hit.label);
    setHits([]);
    setOpen(false);
    onPick(String(hit.id));
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
        placeholder={placeholder}
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
          }
        }}
      />
      {showList && (
        <ul className="search-hits" id={listId} role="listbox">
          {busy && hits.length === 0 ? (
            <li className="search-hint">מחפש…</li>
          ) : hits.length === 0 ? (
            <li className="search-hint">אין תוצאות</li>
          ) : (
            hits.map((h, i) => (
              <li key={h.id} role="option" aria-selected={i === active}>
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
                  {h.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
