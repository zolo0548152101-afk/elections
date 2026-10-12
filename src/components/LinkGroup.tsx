"use client";

import type { ReactNode } from "react";
import { ShowMore } from "@/components/ShowMore";

export type LinkChip = { id: string; label: string };

/** Chips already linked, plus a search control for adding one more. */
export function LinkGroup({
  title,
  chips,
  busy,
  onRemove,
  search,
  empty,
}: {
  title: string;
  chips: LinkChip[];
  busy?: boolean;
  onRemove: (id: string) => void;
  search: ReactNode;
  empty?: string;
}) {
  return (
    <section className="link-group">
      <h3>{title}</h3>
      {chips.length > 0 ? (
        <ul className="coord-cluster-list">
          {chips.map((chip) => (
            <li key={chip.id}>
              <ShowMore text={chip.label} />
              <button
                type="button"
                className="reset"
                disabled={busy}
                onClick={() => onRemove(chip.id)}
              >
                הסר
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lede" style={{ margin: 0 }}>
          {empty ?? "אין קישורים"}
        </p>
      )}
      <div className="coord-cluster-add">{search}</div>
    </section>
  );
}
