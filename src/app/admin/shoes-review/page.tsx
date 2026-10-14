import Link from "next/link";

import { listDraftBatch, listDraftBatches } from "@/features/shoes/coach-drafts-repository";

import { getSingleSearchParam } from "../lib";
import ReviewScreen from "./ReviewScreen";
import styles from "./review.module.css";

export const dynamic = "force-dynamic";

/**
 * Проверка черновиков тренерского каталога кроссовок (решение Игоря,
 * 14.10.2026). Одна модель на экран, черновые значения выставлены, рядом с
 * полем — цитата и ссылка на обзор. Страница только для Игоря: доступ
 * закрыт общей проверкой админки (layout), а запись — серверным действием с
 * той же проверкой.
 *
 * Пачки по 25 моделей; пачка 0 — пустые карточки китайских брендов.
 */
export default async function ShoesReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const batches = await listDraftBatches();
  const requested = Number(getSingleSearchParam(params.batch) ?? "");
  const batch = batches.some((b) => b.batch === requested) ? requested : (batches.find((b) => b.batch > 0)?.batch ?? 0);
  const drafts = batches.length ? await listDraftBatch(batch) : [];

  return (
    <div className={styles.wrap}>
      <h1 className={styles.h1}>Кроссовки: проверка черновиков</h1>
      <p className="admin-muted">
        Цитаты здесь только для тебя. В карточку подбора уходят названия площадок и ссылки, в подбор — только
        подтверждённое.
      </p>
      <nav className={styles.batches}>
        {batches.map((b) => (
          <Link
            key={b.batch}
            href={`/admin/shoes-review?batch=${b.batch}`}
            className={b.batch === batch ? styles.batchActive : styles.batch}
          >
            {b.batch === 0 ? "Китайские (пустые)" : `Пачка ${b.batch}`} · {b.confirmed}/{b.total}
          </Link>
        ))}
      </nav>
      {drafts.length === 0 ? (
        <p>Черновиков нет. Загрузка: npx tsx tools/shoes-pipeline/drafts-upload.ts</p>
      ) : (
        <ReviewScreen key={batch} initial={drafts} />
      )}
    </div>
  );
}
