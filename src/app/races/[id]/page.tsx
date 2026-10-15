/* Страница старта igorp.run/races/<id> (вариант Б, наряд 15.10.2026): дата, место, дистанции и блок
 * «Что важно знать» — строка «Важное» наверху и те же разделы, что экран «Всё о старте» в боте
 * (src/features/race-details/full.ts). В списке /races строки «Важное» нет. <id> — id старта как в
 * календаре (probeg:71741); форма probeg_71741 тоже принимается. Данные — публичным ключом. */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import SiteHeader from "@/components/SiteHeader";
import { jetbrains, onest } from "@/lib/fonts";
import { publicPageMetadata } from "@/lib/site";
import { courseList } from "@/features/race-course";
import { fullDetails, sourceText } from "@/features/race-details/full";
import { importantLine } from "@/features/race-details/important";
import { raceCode } from "@/features/races-bot/core";

import { loadRacePage } from "../load";
import { TYPE_LABEL, distPills, MONTHS_GEN } from "../races-logic";
import "../races-page.css";
import pageStyles from "../races.module.css";
import styles from "./trassa/trassa.module.css";
import own from "./race.module.css";

export const revalidate = 3600;

const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${WD[d.getUTCDay()]}`;
}

/** id из адреса: «probeg%3A71741», «probeg:71741» или «probeg_71741». */
function raceIdOf(param: string): string {
  let id = param;
  try {
    id = decodeURIComponent(param);
  } catch {
    // битая кодировка — как есть
  }
  return id.includes(":") ? id : id.replace("_", ":");
}

const BOT = (process.env.RACES_BOT_USERNAME || "ruruns_bot").trim().replace(/^@/, "");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const page = await loadRacePage(raceIdOf(id));
  if (!page) return {};
  const r = page.race;
  return publicPageMetadata({
    path: `/races/${encodeURIComponent(r.id)}`,
    title: `${r.name}, ${longDate(r.ds)} | igorp.run`,
    description: `${r.name}: что важно знать — старт по дистанциям, место, выдача номеров, лимиты, регистрация.`,
  });
}

export default async function RacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await loadRacePage(raceIdOf(id));
  if (!page) notFound();
  const { race: r, rows } = page;
  const courses = courseList(r.id);
  const d = fullDetails(rows, r.ds, courses.length > 0);
  const important = importantLine(rows);
  const dist = distPills(r).join(" / ");
  const follow = `https://t.me/${BOT}?start=r_${raceCode(r.id)}`;
  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${pageStyles.page}`}>
      <SiteHeader />
      <main className={styles.wrap}>
        <Link className={styles.back} href="/races">
          ← Календарь забегов
        </Link>
        <h1 className={styles.h1}>{r.name}</h1>
        <p className={styles.lede}>
          {longDate(r.ds)} · {r.city || r.region || "место уточняется"}
          {TYPE_LABEL[r.type] ? ` · ${TYPE_LABEL[r.type]}` : ""}
          {dist ? ` · ${dist}` : ""}
        </p>
        <a className={styles.follow} href={follow}>
          ⭐ Следить в Telegram
        </a>

        {d.sections.length ? (
          <section className={styles.block}>
            <h2 className={styles.h2}>Что важно знать</h2>
            {important ? (
              <p className={own.important}>
                <b>Важное:</b>
                {important.replace(/^Важное:/, "")}
              </p>
            ) : null}
            {d.sections.map((s) => (
              <div key={s.key} className={own.sec}>
                <h3 className={own.k}>{s.title}</h3>
                {s.times?.length ? (
                  <div className={own.times}>
                    {s.times.map((t) => (
                      <span key={t.label} className={own.row}>
                        <span>{t.label}</span>
                        <span>{t.time}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {s.lines.map((l, i) => (
                  <p key={i} className={own.line}>
                    {l}
                  </p>
                ))}
                {s.key === "track" && courses.length ? (
                  <p className={own.line}>
                    {courses.map((c, i) => (
                      <span key={c.url}>
                        {i ? " · " : ""}
                        <a href={c.url}>{courses.length > 1 && c.km != null ? `Разбор трассы ${String(c.km).replace(".", ",")} км` : "Разбор трассы"}</a>
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            ))}
            {d.source ? (
              <p className={styles.note}>
                <a href={d.source.url}>{sourceText(d.source)}</a>
              </p>
            ) : null}
          </section>
        ) : null}

        <p className={own.links}>
          {r.reg ? <a href={r.reg}>Регистрация</a> : null}
          {r.reg && r.site ? " · " : null}
          {r.site ? <a href={r.site}>Сайт старта</a> : null}
        </p>
      </main>
    </div>
  );
}
