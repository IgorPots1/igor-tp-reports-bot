import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Onest, JetBrains_Mono } from "next/font/google";

import { publicPageMetadata } from "@/lib/site";
import {
  DEVICE_GUIDES,
  MARK_ALL_RU,
  NO_WATCH_BODY_RU,
  NO_WATCH_TITLE_RU,
  STEP_LEAD_RU,
  STEP_TITLE_RU,
  WHERE_TO_LOOK_RU,
  WHY_NOT_STRAVA_RU,
} from "@/features/intervals/device-guide";

import { CONNECT_PAGE } from "@/features/intervals/connect-content";
import { renderMarkdown } from "./markdown";

// Инструкция ДЛЯ УЧЕНИКА, живущая на сайте, а не в пересланном сообщении.
// Пересланное сообщение нельзя поправить: оно расходится с реальностью в тот
// день, когда Intervals меняет настройки, и тонет в переписке. Ссылку на
// страницу можно дать сто раз, и все сто раз она будет актуальной.
//
// Текст — в ./content.ts, список галочек — в features/intervals/device-guide.ts
// (он же показывается в мини-приложении). Здесь только разметка.

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-onest",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = publicPageMetadata({
  path: "/connect",
  title: `${CONNECT_PAGE.titleRu} — Игорь Поцелуев · Беговой клуб`,
  description:
    "Пошагово: как разрешить Intervals.icu забирать тренировки с часов и какие галочки нужно отметить, чтобы данные пошли.",
});

// Стили заинлайнены, как на /privacy: страницу открывают по ссылке из бота на
// любом телефоне, и она обязана выглядеть одинаково независимо от globals.css.
const BG = "#F6F4EF";
const SURFACE = "#FFFFFF";
const INK = "#16150F";
const INK_2 = "#4D483F";
const MUTED = "#857F73";
const LINE = "#E7E1D5";
const ACCENT = "#E5480E";
const GREEN_BG = "#EAF3EC";
const AMBER_BG = "#FBF3E4";

const SANS = "var(--font-onest), 'Onest', system-ui, sans-serif";
const MONO = "var(--font-jetbrains), ui-monospace, monospace";

const S: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: BG,
    color: INK,
    fontFamily: SANS,
    fontSize: 17,
    lineHeight: 1.6,
    padding: "40px 20px 72px",
  },
  wrap: { maxWidth: 680, margin: "0 auto" },
  eyebrow: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: ".14em",
    textTransform: "uppercase",
    color: ACCENT,
  },
  h1: { margin: "12px 0 0", fontSize: 34, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.1 },
  intro: { margin: "16px 0 0", color: INK_2 },
  h2: { margin: "40px 0 0", fontSize: 22, fontWeight: 700, letterSpacing: "-.01em" },
  h3: { margin: "26px 0 0", fontSize: 18, fontWeight: 700 },
  card: {
    background: SURFACE,
    border: `1px solid ${LINE}`,
    borderRadius: 14,
    padding: "18px 20px",
    marginTop: 14,
  },
  deviceName: { margin: 0, fontSize: 18, fontWeight: 700 },
  boxHint: { margin: "4px 0 0", color: MUTED, fontSize: 14, fontFamily: MONO },
  stepRow: { display: "flex", gap: 10, marginTop: 14, alignItems: "flex-start" },
  // КВАДРАТИК, А НЕ ПЛАШКА СО СЛОВОМ. Размер задан по обеим сторонам и
  // alignSelf прибит к верху: так его нечем растянуть, что бы ни случилось с
  // родительским flex. Прошлые плашки («обязательно») занимали треть ширины
  // телефона и ломали заголовок на две строки.
  check: {
    flexShrink: 0,
    alignSelf: "flex-start",
    width: 20,
    height: 20,
    marginTop: 3,
    borderRadius: 6,
    background: "#FDE8E0",
    color: ACCENT,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: "20px",
    textAlign: "center",
  },
  markAll: { margin: "10px 0 0", color: INK_2, fontSize: 14.5, lineHeight: 1.5 },
  bridge: { margin: "12px 0 0", color: INK_2, fontSize: 15.5, lineHeight: 1.55 },
  stepBody: { flex: 1 },
  stepTitle: { margin: 0, fontWeight: 600 },
  stepWhy: { margin: "3px 0 0", color: MUTED, fontSize: 14.5, lineHeight: 1.5 },
  note: {
    margin: "14px 0 0",
    background: AMBER_BG,
    borderRadius: 10,
    padding: "10px 12px",
    color: INK_2,
    fontSize: 14.5,
    lineHeight: 1.5,
  },
  where: {
    background: GREEN_BG,
    border: `1px solid ${LINE}`,
    borderRadius: 14,
    padding: "16px 20px",
    marginTop: 16,
    color: INK_2,
  },
  list: { margin: "12px 0 0", paddingLeft: 20, color: INK_2 },
  li: { marginTop: 8, lineHeight: 1.55 },
  closing: { marginTop: 40, color: MUTED, fontSize: 15 },
};

export default function ConnectPage() {
  return (
    <main className={`${onest.variable} ${jetbrains.variable}`} style={S.page}>
      <div style={S.wrap}>
        <span style={S.eyebrow}>{CONNECT_PAGE.eyebrowRu}</span>
        <h1 style={S.h1}>{CONNECT_PAGE.titleRu}</h1>

        {/* ЕДИНОЕ ПОВЕСТВОВАНИЕ ИЗ РАЗНЫХ КУСКОВ. Порядок на странице:
            вступление → правила формата → шаг 1 с подразделом → ШАГ 2 целиком
            из device-guide → шаги 3-5 → почему не Strava → что делать, если.
            Читателю швов не видно: он видит подряд идущие шаги.

            ПОЧЕМУ КУСКОВ НЕСКОЛЬКО, А НЕ ОДИН introRu. Приложение показывает
            правила формата и шаги подключения на РАЗНЫХ экранах: в момент
            подключения человеку нечего запоминать про разборы, у него ещё нет
            плана. Странице это деление не мешает: она выводит всё подряд и
            выглядит ровно так же, как раньше. */}
        {renderMarkdown(CONNECT_PAGE.leadRu, "lead")}
        {renderMarkdown(CONNECT_PAGE.formatRu, "format")}
        {renderMarkdown(CONNECT_PAGE.step1Ru, "step1")}
        <h3 style={S.h3}>{CONNECT_PAGE.step1DetailsTitleRu}</h3>
        {renderMarkdown(CONNECT_PAGE.step1DetailsRu, "step1d")}

        <h2 style={S.h2}>{STEP_TITLE_RU}</h2>
        {/* Текст шага в markdown: в нём жирные предупреждения, они несут смысл. */}
        {renderMarkdown(STEP_LEAD_RU, "step2")}
        <div style={S.where}>{WHERE_TO_LOOK_RU}</div>
        {DEVICE_GUIDES.map((guide) => (
          <section key={guide.code} style={S.card}>
            <p style={S.deviceName}>{guide.labelRu}</p>
            {guide.settingsBoxRu ? (
              <p style={S.boxHint}>блок «{guide.settingsBoxRu}» в настройках</p>
            ) : null}
            {/* Часы без прямого подключения (Apple Watch): галочек нет,
                вместо них честный рассказ про посредника. */}
            {guide.bridgeRu.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} style={S.bridge}>
                {paragraph}
              </p>
            ))}
            {guide.steps.length > 0 ? <p style={S.markAll}>{MARK_ALL_RU}</p> : null}
            {guide.steps.map((step) => (
              <div key={step.titleRu} style={S.stepRow}>
                <span style={S.check} aria-hidden>
                  ✓
                </span>
                <div style={S.stepBody}>
                  <p style={S.stepTitle}>{step.titleRu}</p>
                  <p style={S.stepWhy}>{step.whyRu}</p>
                </div>
              </div>
            ))}
            {guide.noteRu ? <p style={S.note}>{guide.noteRu}</p> : null}
          </section>
        ))}

        {NO_WATCH_BODY_RU ? (
          <>
            <h3 style={S.h3}>{NO_WATCH_TITLE_RU}</h3>
            {renderMarkdown(NO_WATCH_BODY_RU, "nowatch")}
          </>
        ) : null}

        {renderMarkdown(CONNECT_PAGE.afterStepsRu, "after")}

        <h2 style={S.h2}>{WHY_NOT_STRAVA_RU.titleRu}</h2>
        <ul style={S.list}>
          {WHY_NOT_STRAVA_RU.pointsRu.map((point) => (
            <li key={point} style={S.li}>
              {point}
            </li>
          ))}
        </ul>

        {CONNECT_PAGE.troubleRu ? (
          <>
            <h2 style={S.h2}>{CONNECT_PAGE.troubleTitleRu}</h2>
            {renderMarkdown(CONNECT_PAGE.troubleRu, "trouble")}
          </>
        ) : null}

        {CONNECT_PAGE.closingRu ? <p style={S.closing}>{CONNECT_PAGE.closingRu}</p> : null}
      </div>
    </main>
  );
}
