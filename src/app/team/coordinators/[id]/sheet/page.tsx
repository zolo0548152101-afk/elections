"use client";

import { use } from "react";
import { WorkSheet } from "@/components/WorkSheet";

export default function CoordinatorSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <WorkSheet endpoint={`/api/team/coordinators/${encodeURIComponent(id)}/sheet`} />;
}
