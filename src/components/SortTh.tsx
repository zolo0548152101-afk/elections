"use client";

import { useState, type ReactNode } from "react";

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir } | null;
export type SortGetters<T, K extends string> = Record<K, (row: T) => unknown>;

const collator = new Intl.Collator("he", { numeric: true, sensitivity: "base" });

function compare(a: unknown, b: unknown): number {
  const emptyA = a === null || a === undefined || a === "";
  const emptyB = b === null || b === undefined || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return collator.compare(String(a), String(b));
}

/** Rows sorted by a column. Empty values always go last. Stable for ties. */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  getters: SortGetters<T, K>,
  sort: SortState<K>,
): T[] {
  if (!sort) return [...rows];
  const get = getters[sort.key];
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((x, y) => {
      const emptyX = x.v === null || x.v === undefined || x.v === "";
      const emptyY = y.v === null || y.v === undefined || y.v === "";
      if (emptyX !== emptyY) return emptyX ? 1 : -1;
      return compare(x.v, y.v) * sign || x.i - y.i;
    })
    .map((x) => x.row);
}

/** Click a header: sort by it ascending, click again: descending, a third time: back to the original order. */
export function useSortState<K extends string>(initial: SortState<K> = null) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const toggle = (key: K) =>
    setSort((cur) =>
      !cur || cur.key !== key
        ? { key, dir: "asc" }
        : cur.dir === "asc"
          ? { key, dir: "desc" }
          : initial && initial.key === key
            ? { key, dir: "asc" }
            : null,
    );
  return { sort, toggle };
}

/** A sortable table header cell. */
export function SortTh<K extends string>({
  k,
  sort,
  onSort,
  children,
  className,
}: {
  k: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  children: ReactNode;
  className?: string;
}) {
  const active = sort?.key === k;
  return (
    <th
      className={className}
      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className={`th-btn${active ? " is-sorted" : ""}`} onClick={() => onSort(k)}>
        {children}
        <span className="th-sort-icon" aria-hidden="true">
          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
