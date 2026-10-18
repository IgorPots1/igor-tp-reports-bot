/* Разделы выжимки «Что важно знать» / «Всё о старте» (16.10.2026): одна разметка для страницы старта
 * /races/<id> и блока в мини-приложении. Данные — fullDetails (те же правила, что в боте: пустые
 * разделы не показываются, «нет данных» не выводится, источник и дата проверки внизу). */

import { nbsp } from "@/lib/typography";
import type { FullDetails } from "@/features/race-details/full";
import { sourceText } from "@/features/race-details/full";

import styles from "./details.module.css";

export type CourseRef = { url: string; label: string };

export default function DetailsSections({ d, important, courses }: { d: FullDetails; important?: string | null; courses: CourseRef[] }) {
  return (
    <>
      {important ? (
        <p className={styles.important}>
          <b>Важное:</b>
          {nbsp(important.replace(/^Важное:/, ""))}
        </p>
      ) : null}
      {d.sections.map((s) => (
        <div key={s.key} className={styles.sec}>
          <h3 className={styles.k}>{s.title}</h3>
          {s.times?.length ? (
            <div className={styles.times}>
              {s.times.map((t) => (
                <span key={t.label} className={styles.row}>
                  <span>{nbsp(t.label)}</span>
                  <span>{t.time}</span>
                </span>
              ))}
            </div>
          ) : null}
          {s.lines.map((l, i) => (
            <p key={i} className={styles.line}>
              {nbsp(l)}
            </p>
          ))}
          {s.key === "track" && courses.length ? (
            <p className={styles.line}>
              {courses.map((c, i) => (
                <span key={c.url}>
                  {i ? " · " : ""}
                  <a href={c.url}>{c.label}</a>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ))}
      {d.source ? (
        <p className={styles.src}>
          <a href={d.source.url} target="_blank" rel="noopener noreferrer">
            {sourceText(d.source)}
          </a>
        </p>
      ) : null}
    </>
  );
}

/** Ссылки на разборы трассы старта: «Разбор трассы» или по дистанциям «Разбор трассы 12 км». */
export function courseRefs(list: { url: string; km: number | null }[]): CourseRef[] {
  return list.map((c) => ({
    url: c.url,
    label: list.length > 1 && c.km != null ? `Разбор трассы ${String(c.km).replace(".", ",")} км` : "Разбор трассы",
  }));
}
