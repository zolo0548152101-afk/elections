"use client";

import { use } from "react";
import { WorkSheet } from "@/components/WorkSheet";

export default function ClusterSheetPage({
  params,
}: {
  params: Promise<{ ashkol: string }>;
}) {
  const { ashkol } = use(params);
  return (
    <WorkSheet
      endpoint={`/api/team/clusters/${encodeURIComponent(ashkol)}/sheet`}
    />
  );
}
