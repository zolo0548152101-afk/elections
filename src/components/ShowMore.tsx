"use client";

import { useState } from "react";

const LIMIT = 25;

/** Collapse name fields longer than 25 characters behind "הצג עוד". */
export function ShowMore({
  text,
  limit = LIMIT,
}: {
  text: string | null | undefined;
  limit?: number;
}) {
  const [open, setOpen] = useState(false);
  const value = (text ?? "").trim();
  if (!value) return <>—</>;
  if ([...value].length <= limit) return <>{value}</>;
  const short = [...value].slice(0, limit).join("");
  return (
    <span className={`show-more${open ? " is-open" : ""}`}>
      <span>{open ? value : `${short}…`}</span>
      <button
        type="button"
        className="show-more-btn"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {open ? "הצג פחות" : "הצג עוד"}
      </button>
    </span>
  );
}
