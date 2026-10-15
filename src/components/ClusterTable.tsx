"use client";

import { ShowMore } from "@/components/ShowMore";
import { Quip } from "@/components/Quip";
import { EMPTY_CLUSTERS } from "@/lib/quips";

export type ClusterView = {
  ashkol: string;
  settlement_name: string;
  bzb: number;
  voters: number;
  valid: number;
  right_votes: number;
  turnout_pct: number;
  right_pct: number;
  ballot_count: number;
  likud_votes?: number;
  likud_pct?: number;
  map_lat: number | null;
  map_lng: number | null;
  /** Linked to at least one institution. */
  linked?: boolean;
  /** All streets in the ashkol marked done for the current user. */
  done?: boolean;
  /** Linked street lines in the cluster, and how many are marked done. */
  street_total?: number;
  street_done?: number;
  /** An admin marked the whole cluster done. */
  ops_done?: boolean;
};

type SortKey =
  | "settlement_name"
  | "ashkol"
  | "bzb"
  | "voters"
  | "turnout_pct"
  | "right_pct"
  | "right_votes"
  | "likud_pct"
  | "likud_votes";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "settlement_name", label: "יישוב" },
  { key: "ashkol", label: "אשכול" },
  { key: "bzb", label: "בז״ב" },
  { key: "voters", label: "מצביעים" },
  { key: "turnout_pct", label: "% הצבעה" },
  { key: "right_votes", label: "קולות ימין" },
  { key: "right_pct", label: "% ימין" },
  { key: "likud_votes", label: "קולות מחל" },
  { key: "likud_pct", label: "% מחל" },
];

export function ClusterTable({
  clusters,
  sort,
  dir,
  onSort,
  selectedAshkol,
  onSelect,
}: {
  clusters: ClusterView[];
  sort: SortKey;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  selectedAshkol?: string;
  onSelect?: (cluster: ClusterView) => void;
}) {
  return (
    <div className="table-wrap cluster-table">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key}>
                <button type="button" className="th-btn" onClick={() => onSort(col.key)}>
                  {col.label}
                  {sort === col.key ? (dir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
            ))}
            <th>קלפיות</th>
            <th>מפה</th>
          </tr>
        </thead>
        <tbody>
          {clusters.map((c) => (
            <tr
              key={c.ashkol}
              className={[
                onSelect ? "cluster-row-selectable" : "",
                selectedAshkol === c.ashkol ? "cluster-row-selected" : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined}
              onClick={onSelect ? () => onSelect(c) : undefined}
              title={onSelect ? "הצג אשכול במפה" : undefined}
            >
              <td>
                <ShowMore text={c.settlement_name} />
              </td>
              <td className="mono">{c.ashkol}</td>
              <td>{c.bzb.toLocaleString("he-IL")}</td>
              <td>{c.voters.toLocaleString("he-IL")}</td>
              <td>{c.turnout_pct.toFixed(1)}%</td>
              <td>{c.right_votes.toLocaleString("he-IL")}</td>
              <td>{c.right_pct.toFixed(1)}%</td>
              <td>{(c.likud_votes ?? 0).toLocaleString("he-IL")}</td>
              <td>{(c.likud_pct ?? 0).toFixed(1)}%</td>
              <td>{c.ballot_count}</td>
              <td>{c.map_lat != null ? "כן" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {clusters.length === 0 && <p className="empty"><Quip list={EMPTY_CLUSTERS} /> · נסו לרכך את הפילטרים</p>}
    </div>
  );
}
