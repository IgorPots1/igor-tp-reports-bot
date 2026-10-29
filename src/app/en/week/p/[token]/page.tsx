import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isEnWeekEnabled } from "@/features/en-week/logic";
import { isToken, loadPlanPage } from "@/features/en-week/service";
import { supabaseEnWeekStore } from "@/features/en-week/store";

import { ComingSoon, Shell } from "../../Shell";
import PlanClient from "./PlanClient";

// Personal plan page of the free week: /en/week/p/<token>. The token is the only key.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your free training week · Igor, running coach",
  robots: { index: false, follow: false },
};

export default async function PlanPage({ params }: { params: Promise<{ token: string }> }) {
  if (!isEnWeekEnabled()) return <ComingSoon />;
  const { token } = await params;
  if (!isToken(token)) notFound();
  const view = await loadPlanPage(supabaseEnWeekStore(), token, new Date());
  if (!view) notFound();
  return (
    <Shell>
      <PlanClient initial={view} />
    </Shell>
  );
}
