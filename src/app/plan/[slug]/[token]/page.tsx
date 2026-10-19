import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { resolvePlanToken } from "@/features/athlete-plans/repository";
import { jetbrains, onest } from "@/lib/fonts";

import PlanView from "./PlanView";
import styles from "./plan.module.css";

// Личная страница по секретной ссылке: не индексируется, адрес с токеном
// не уходит в Referer.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f2ec",
};

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, token } = await params;
  const access = await resolvePlanToken(slug, token).catch(() => null);
  return {
    title: access?.plan.title || (access ? `${access.athleteName} · план` : "План"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function PlanPage({ params }: Props) {
  const { slug, token } = await params;
  const access = await resolvePlanToken(slug, token).catch(() => null);
  if (!access) notFound();

  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <PlanView slug={slug} token={token} />
    </div>
  );
}
