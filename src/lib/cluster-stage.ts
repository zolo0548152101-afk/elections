/** Cluster progress stage, shared by the map, the clusters page and filters. */
export type ClusterStage = "pending" | "partial" | "done";

export const CLUSTER_STAGE_LABEL: Record<ClusterStage, string> = {
  pending: "ממתין",
  partial: "בתהליך",
  done: "בוצע",
};

/** Plural labels for the status filter. */
export const CLUSTER_STAGE_FILTER_LABEL: Record<ClusterStage, string> = {
  pending: "ממתינים",
  partial: "בתהליך",
  done: "בוצעו",
};

export const CLUSTER_STAGES: readonly ClusterStage[] = ["pending", "partial", "done"];

/** Same colors as the diamonds on the map. */
export const CLUSTER_STAGE_COLOR: Record<ClusterStage, string> = {
  pending: "#2563eb",
  partial: "#f97316",
  done: "#16a34a",
};

/** בוצע when done; בתהליך once at least one street is marked; otherwise ממתין. */
export function clusterStage(done: boolean, streetDone: number): ClusterStage {
  if (done) return "done";
  return streetDone > 0 ? "partial" : "pending";
}
