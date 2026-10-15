/** Cluster progress stage, shared by the map, the clusters page and filters. */
export type ClusterStage = "pending" | "partial" | "done";

export const CLUSTER_STAGE_LABEL: Record<ClusterStage, string> = {
  pending: "טרם התחיל",
  partial: "בתהליך",
  done: "הושלם",
};

/** הושלם when done; בתהליך once at least one street is marked; otherwise טרם התחיל. */
export function clusterStage(done: boolean, streetDone: number): ClusterStage {
  if (done) return "done";
  return streetDone > 0 ? "partial" : "pending";
}
