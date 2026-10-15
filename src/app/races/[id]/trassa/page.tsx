/* Разбор трассы (пилот 14.10.2026): igorp.run/races/<id>/trassa. Профиль высот, карта трека,
 * ключевые точки, ветер в эти дни по архиву и блок консультации. Данные — src/data/race-courses,
 * их собирает scripts/race-course/build.ts; персональных данных учеников в них нет. */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import SiteHeader from "@/components/SiteHeader";
import { jetbrains, onest } from "@/lib/fonts";
import { publicPageMetadata } from "@/lib/site";
import { listCourses, loadCourse } from "@/features/race-course/load";
import { raceCode } from "@/features/races-bot/core";
import { ru, trackFreshness, windFrom } from "@/features/race-course/types";

import { CourseMap, ProfileChart, WindStrip } from "./CourseViews";
import "../../races-page.css";
import pageStyles from "../../races.module.css";
import styles from "./trassa.module.css";

export const dynamicParams = false;

export function generateStaticParams() {
  // Страница — только для разборов, прошедших сверку (publish); остальные — 404, как и кнопки в боте нет.
  // Адрес — имя файла: у старта с несколькими дистанциями страница на каждую («probeg_77976-30k»).
  return listCourses().filter((c) => c.checks.publish).map((c) => ({ id: c.slug }));
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${WD[d.getUTCDay()]}`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const c = loadCourse(id);
  if (!c) return {};
  return publicPageMetadata({
    path: `/races/${id}/trassa`,
    title: `${c.name}: разбор трассы | igorp.run`,
    description: c.checks.lite
      ? `Карта, повороты и покрытие, ветер в эти дни и тактика по участкам: ${c.name}, ${longDate(c.date)}.`
      : `Профиль высот, подъёмы и спуски, ветер в эти дни и тактика по участкам: ${c.name}, ${longDate(c.date)}.`,
  });
}

const COACH = (process.env.COACH_TG_USERNAME || "IgorPotseluev").replace(/^@/, "");
const BOT = (process.env.RACES_BOT_USERNAME || "ruruns_bot").trim().replace(/^@/, "");

export default async function TrassaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = loadCourse(id);
  if (!c || !c.checks.publish) notFound();
  const consult = `https://t.me/${COACH}?text=${encodeURIComponent(`Привет! Хочу консультацию по подготовке к ${c.name}`)}`;
  const heads = c.perKm.filter((k) => k.wind === "head").length;
  const fresh = trackFreshness(c);
  // Урезанный разбор (эталона набора нет, 15.10.2026): ни профиля, ни цифр набора и сброса нигде на странице.
  const lite = c.checks.lite === true;
  const surface = lite && c.surface && c.surface.known >= 50
    ? (Object.entries(c.surface.share) as [string, number][]).filter(([, v]) => v >= 5).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}%`).join(", ")
    : null;
  // «Следить в Telegram»: та же ссылка r_<код>, что у звёздочки в календаре на сайте.
  const follow = `https://t.me/${BOT}?start=r_${raceCode(c.raceId)}`;
  return (
    <div className={`${onest.variable} ${jetbrains.variable} ${pageStyles.page}`}>
      <SiteHeader />
      <main className={styles.wrap}>
        <Link className={styles.back} href="/races">
          ← Календарь забегов
        </Link>
        <h1 className={styles.h1}>{c.name}</h1>
        <p className={styles.lede}>
          {longDate(c.date)} · {ru(c.distanceKm)} км · разбор трассы
        </p>
        {fresh ? <p className={styles.fresh}>{fresh}</p> : null}
        {lite ? (
          <p className={styles.facts}>
            Набор высоты уточняется{surface ? ` · покрытие по данным карты: ${surface}` : ""}
          </p>
        ) : (
          <p className={styles.facts}>
            Набор {c.gain} м · сброс {c.loss} м{c.checks.organizer !== null ? ` · у организатора ${c.checks.organizer} м` : ""}
          </p>
        )}
        <a className={styles.follow} href={follow}>
          ⭐ Следить в Telegram
        </a>

        {lite ? null : (
        <section className={styles.block}>
          <h2 className={styles.h2}>Профиль высот</h2>
          {c.checks.publish ? (
            <>
              <ProfileChart c={c} />
              <p className={styles.note}>
                Набор {c.gain} м, сброс {c.loss} м по цифровой модели рельефа
                {c.checks.organizer !== null ? `; у организатора ${c.checks.organizer} м` : ""}. Цифры на графике: ключевые точки ниже.
              </p>
            </>
          ) : (
            <p className={styles.note}>Профиль высот не публикуем: {c.checks.reason}</p>
          )}
        </section>
        )}

        <section className={styles.block}>
          <h2 className={styles.h2}>Карта трассы</h2>
          <CourseMap c={c} />
        </section>

        {c.keyPoints.length ? (
          <section className={styles.block}>
            <h2 className={styles.h2}>Ключевые точки</h2>
            <ol className={styles.points}>
              {c.keyPoints.map((p, i) => (
                <li key={i}>
                  <b>
                    {i + 1}. {ru(p.km)} км.
                  </b>{" "}
                  {p.text}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {c.wind ? (
          <section className={styles.block}>
            <h2 className={styles.h2}>Ветер</h2>
            <p>
              Обычно в эти дни ветер дует {windFrom(c.wind.dirLabel)}, около {ru(c.wind.medianMs)} м/с, бывает до {ru(c.wind.p75Ms)} м/с, порывы до {ru(c.wind.gustP75Ms)} м/с
              (архив погоды за {c.wind.years} лет, на час старта).
              {heads ? ` Встречный примерно на ${heads} км из ${c.perKm.length}.` : ""}
            </p>
            <WindStrip c={c} />
            <p className={styles.legend}>
              <span className={`${styles.dot} ${styles.head}`} /> в лицо <span className={`${styles.dot} ${styles.tail}`} /> в спину{" "}
              <span className={`${styles.dot} ${styles.cross}`} /> сбоку
            </p>
            {c.forecast ? (
              <p>
                Прогноз на день старта: ветер {windFrom(c.forecast.dirLabel)}, {ru(c.forecast.speedMs)} м/с
                {c.forecast.gustMs ? `, порывы до ${ru(c.forecast.gustMs)} м/с` : ""}.
              </p>
            ) : (
              <p className={styles.note}>Прогноз на день старта появится здесь за неделю.</p>
            )}
          </section>
        ) : null}

        <section className={`${styles.block} ${styles.consult}`}>
          <h2 className={styles.h2}>Нужна помощь с подготовкой?</h2>
          <p>Запишись на бесплатную консультацию: тренер разберёт твою ситуацию и даст конкретное решение.</p>
          <a className={styles.cta} href={consult}>
            Записаться на консультацию
          </a>
        </section>

        <p className={styles.sources}>
          Трек: {c.source.note || c.source.kind}
          {c.source.url ? (
            <>
              {" "}
              (<a href={c.source.url}>источник</a>)
            </>
          ) : null}
          . Высоты: Copernicus DEM через Open-Meteo. Погода: архив Open-Meteo. Карта: © OpenStreetMap.
        </p>
      </main>
    </div>
  );
}
