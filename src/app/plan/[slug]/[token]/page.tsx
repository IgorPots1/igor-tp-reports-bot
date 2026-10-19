import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { loadPlanView, resolvePlanToken } from "@/features/athlete-plans/repository";
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
// Функция рядом с базой (Supabase eu-west-1): из iad1 каждый запрос летал через
// Атлантику, и страница открывалась секунды. Как в /races.
export const preferredRegion = "dub1";

// generateMetadata и страница резолвят токен в одном запросе: cache() делает это один раз.
const resolve = cache((slug: string, token: string) => resolvePlanToken(slug, token).catch(() => null));

type Props = { params: Promise<{ slug: string; token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, token } = await params;
  const access = await resolve(slug, token);
  const title = access ? `${access.athleteName} · тренировки` : "Тренировки";
  const description = "План тренировок и отчёты для тренера";
  // Своя карточка ссылки: без неё Telegram берёт брендовую карточку клуба из
  // корневого layout, и ученик видит в чате «беговой клуб» вместо своего плана.
  // Картинку не даём (images: []), url не даём, чтобы токен не светился в og:url.
  return {
    title: access?.plan.title || title,
    description,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    openGraph: { type: "website", siteName: "igorp.run", title, description, images: [] },
    twitter: { card: "summary", title, description, images: [] },
  };
}

export default async function PlanPage({ params }: Props) {
  const { slug, token } = await params;
  const access = await resolve(slug, token);
  if (!access) notFound();
  // План и отчёты отдаём сразу в HTML, без второго запроса из браузера после загрузки.
  const initialView = await loadPlanView(access).catch(() => null);

  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${styles.page}`}>
      <PlanView slug={slug} token={token} initialView={initialView} />
    </div>
  );
}
