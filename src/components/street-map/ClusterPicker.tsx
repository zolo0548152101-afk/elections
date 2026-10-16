"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { matchesSearch } from "@/lib/text-search";

export type PickerOption = { value: string; label: string; meta?: string };

/**
 * Cluster picker: opens with the full list (like a select), and typing narrows it
 * by city or cluster number. Arrow keys + Enter, Escape closes.
 */
export function ClusterPicker({
  options,
  value,
  onChange,
  placeholder = "בחרו אשכול",
  allowEmpty = true,
}: {
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const q = query.trim();
    if (!q) return options;
    return options.filter((o) => matchesSearch(`${o.label} ${o.meta ?? ""}`, q));
  }, [options, query]);

  // Closed: the field shows the chosen cluster. Open: it is a search box.
  const display = open ? query : current ? current.label + (current.meta ? ` · ${current.meta}` : "") : "";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, shown.findIndex((o) => o.value === value));
    setActive(i);
    // Bring the chosen cluster into view when the list opens.
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.scrollIntoView({ block: "nearest" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when it opens
  }, [open]);

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const n = shown.length;
      if (n === 0) return;
      const next = (active + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      setActive(next);
      listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = shown[active];
      if (open && pick) choose(pick.value);
      else setOpen(true);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="cluster-picker" ref={boxRef}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={display}
        placeholder={open && current ? "הקלידו עיר או מספר אשכול" : placeholder}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <span className="cluster-picker-caret" aria-hidden="true">
        ▾
      </span>
      {open ? (
        <ul className="cluster-picker-list" id={listId} role="listbox" ref={listRef}>
          {allowEmpty && !query.trim() ? (
            <li>
              <button type="button" role="option" aria-selected={!value} onClick={() => choose("")}>
                <span className="cluster-picker-empty">ללא אשכול נבחר</span>
              </button>
            </li>
          ) : null}
          {shown.length === 0 ? <li className="cluster-picker-none">לא נמצא אשכול. נסו עיר או מספר</li> : null}
          {shown.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                data-index={i}
                aria-selected={o.value === value}
                className={i === active ? "is-active" : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.value)}
              >
                <span>{o.label}</span>
                {o.meta ? <span className="cluster-picker-meta">{o.meta}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
