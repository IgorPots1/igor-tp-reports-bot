import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { loadPlanView, resolvePlanToken } from "@/features/athlete-plans/repository";
import { todayIsoInZone } from "@/features/intervals/loop/clock";
import { isPlanPageEnabled } from "@/features/intervals/plan-page/core";
import { resolvePlanLink } from "@/features/intervals/plan-page/links";
import { loadPlanPageView } from "@/features/intervals/plan-page/view";
import { jetbrains, onest } from "@/lib/fonts";

import PlanView from "./PlanView";
import RunPlanView from "./RunPlanView";
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
// Функция рядом с базой (Supabase eu-west-1): из iad1 каждый запрос летал через
// Атлантику, и страница открывалась секунды. Как в /races.
export const preferredRegion = "dub1";

/**
 * ДВА ВИДА СТРАНИЦ ПОД ОДНОЙ ФОРМОЙ АДРЕСА [21.10.2026]. Сначала план из
 * athlete_plans (план целиком в jsonb, как у Ильи), затем ссылка ученицы
 * нашего плана из intervals_plan_links (данные те же, что у /m/run).
 * generateMetadata и страница резолвят токен в одном запросе: cache() делает
 * это один раз.
 */
const resolve = cache(async (slug: string, token: string) => {
  const athlete = await resolvePlanToken(slug, token).catch(() => null);
  if (athlete) return { kind: "athlete" as const, access: athlete };
  if (!isPlanPageEnabled()) return null;
  const run = await resolvePlanLink(slug, token).catch(() => null);
  return run ? { kind: "run" as const, access: run } : null;
});

type Props = {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<{ s?: string; w?: string; tab?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, token } = await params;
  const found = await resolve(slug, token);
  const name = found ? (found.kind === "athlete" ? found.access.athleteName : found.access.studentName) : null;
  const title = name ? `${name} · тренировки` : "Тренировки";
  const description = "План тренировок и отчёты для тренера";
  // Своя карточка ссылки: без неё Telegram берёт брендовую карточку клуба из
  // корневого layout, и ученик видит в чате «беговой клуб» вместо своего плана.
  // Картинку не даём (images: []), url не даём, чтобы токен не светился в og:url.
  return {
    title: (found?.kind === "athlete" && found.access.plan.title) || title,
    description,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    openGraph: { type: "website", siteName: "igorp.run", title, description, images: [] },
    twitter: { card: "summary", title, description, images: [] },
  };
}

export default async function PlanPage({ params, searchParams }: Props) {
  const { slug, token } = await params;
  const found = await resolve(slug, token);
  if (!found) notFound();

  if (found.kind === "run") {
    const access = found.access;
    const view = await loadPlanPageView({
      sourceId: access.sourceId,
      studentName: access.studentName,
      todayIso: todayIsoInZone(access.timezone),
    });
    const sp = await searchParams;
    return (
      <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
        <RunPlanView
          slug={slug}
          token={token}
          initialView={view}
          focus={{ sessionId: sp.s ?? null, weekStart: sp.w ?? null, tab: sp.tab === "coach" ? "coach" : null }}
        />
      </div>
    );
  }

  // План и отчёты отдаём сразу в HTML, без второго запроса из браузера после загрузки.
  const initialView = await loadPlanView(found.access).catch(() => null);

  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <PlanView slug={slug} token={token} initialView={initialView} />
    </div>
  );
}
