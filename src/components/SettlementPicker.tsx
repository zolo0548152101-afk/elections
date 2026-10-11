"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export function SettlementPicker({
  value,
  options,
  onChange,
  required,
  id,
}: {
  value: string;
  options: string[];
  onChange: (name: string) => void;
  required?: boolean;
  id?: string;
}) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setQ(value);
  }, [value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const hits = useMemo(() => {
    const needle = q.trim();
    if (!needle) return options.slice(0, 12);
    return options.filter((name) => name.includes(needle)).slice(0, 20);
  }, [options, q]);

  const exact = options.includes(value);

  return (
    <div className="settlement-picker" ref={wrapRef}>
      <input
        id={id}
        type="text"
        dir="rtl"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        required={required}
        value={q}
        placeholder="הקלידו שם יישוב…"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const next = e.target.value;
          setQ(next);
          setOpen(true);
          if (options.includes(next)) onChange(next);
          else if (!next.trim()) onChange("");
        }}
        onBlur={() => {
          // Keep only a known settlement name.
          if (q.trim() && !options.includes(q.trim())) {
            setQ(value);
          }
        }}
      />
      {value && exact && <p className="picker-selected">נבחר: {value}</p>}
      {open && (
        <ul className="picker-hits" role="listbox">
          {hits.length === 0 ? (
            <li className="picker-empty">אין יישוב תואם</li>
          ) : (
            hits.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  role="option"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(name);
                    setQ(name);
                    setOpen(false);
                  }}
                >
                  {name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
