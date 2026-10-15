"use client";

import {
  CLUSTER_STAGE_COLOR,
  CLUSTER_STAGE_FILTER_LABEL,
  CLUSTER_STAGES,
  type ClusterStage,
} from "@/lib/cluster-stage";

export type StageFilterValue = "any" | ClusterStage;

/**
 * Cluster status filter: כל האשכולות · ממתינים · בתהליך · בוצעו, each with its count.
 * One tap, always visible, same colors as the map diamonds.
 */
export function StageTabs({
  value,
  onChange,
  counts,
  className,
}: {
  value: StageFilterValue;
  onChange: (value: StageFilterValue) => void;
  counts: Record<ClusterStage, number>;
  className?: string;
}) {
  const total = counts.pending + counts.partial + counts.done;
  const option = (key: StageFilterValue, label: string, n: number, color?: string) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={value === key}
      className={value === key ? "stage-tab is-active" : "stage-tab"}
      onClick={() => onChange(key)}
    >
      {color ? <span className="stage-dot" style={{ background: color }} aria-hidden="true" /> : null}
      {label}
      <span className="stage-count">{n}</span>
    </button>
  );
  return (
    <div className={`stage-tabs${className ? ` ${className}` : ""}`} role="radiogroup" aria-label="סינון לפי מצב ביצוע">
      {option("any", "כל האשכולות", total)}
      {CLUSTER_STAGES.map((s) => option(s, CLUSTER_STAGE_FILTER_LABEL[s], counts[s], CLUSTER_STAGE_COLOR[s]))}
    </div>
  );
}

/** Count clusters per stage. */
export function stageCounts<T>(rows: readonly T[], stageOf: (row: T) => ClusterStage) {
  const counts: Record<ClusterStage, number> = { pending: 0, partial: 0, done: 0 };
  for (const row of rows) counts[stageOf(row)] += 1;
  return counts;
}
