/* Превью ссылки (Open Graph) для страниц igorp.run: один шаблон на все страницы.
 *
 * ЗАЧЕМ. До этого каждая страница отдавала одну и ту же клубную картинку с
 * логотипом и подписью «Беговой клуб», и ссылка на календарь стартов в
 * Telegram выглядела как реклама клуба. Теперь у каждой страницы своя
 * картинка, а страницы отличаются только текстом: метка, заголовок, строка о
 * том, что внутри, и (для /races) живые цифры. Клубная картинка осталась
 * главной и /club.
 *
 * ШРИФТЫ. next/og (satori) не читает ни woff2, ни переменные шрифты, которыми
 * пользуется сайт, поэтому рядом лежат статические TTF: Onest 400 и 800,
 * JetBrains Mono 700, нарезанные из тех же файлов google/fonts (OFL) под
 * латиницу, кириллицу и типографскую пунктуацию. Пути литеральные от
 * process.cwd(): так их видит трассировка файлов Vercel.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const C = {
  bg: "#F6F4EF",
  surface: "#FFFFFF",
  ink: "#191712",
  ink2: "#4D483F",
  muted: "#857F73",
  line: "#E7E1D5",
  line2: "#D8D0C0",
  accent: "#E5480E",
  accentInk: "#B53707",
  green: "#2E7D45",
};

export type OgMotif = "calendar" | "track" | "doc";

export type OgCardInput = {
  /** Маленькая метка над заголовком. По умолчанию «IGORP.RUN». */
  label?: string;
  title: string;
  /** Одна строка о том, что внутри. */
  subtitle: string;
  /** Строка цифр моноширинным шрифтом, например «437 стартов · 227 городов». */
  stats?: string | null;
  motif?: OgMotif;
};

async function fonts() {
  const [regular, extrabold, mono] = await Promise.all([
    readFile(join(process.cwd(), "src/lib/og/fonts/Onest-Regular.ttf")),
    readFile(join(process.cwd(), "src/lib/og/fonts/Onest-ExtraBold.ttf")),
    readFile(join(process.cwd(), "src/lib/og/fonts/JetBrainsMono-Bold.ttf")),
  ]);
  return [
    { name: "Onest", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Onest", data: extrabold, weight: 800 as const, style: "normal" as const },
    { name: "JetBrains Mono", data: mono, weight: 700 as const, style: "normal" as const },
  ];
}

/** Календарь: шапка месяца и сетка дней, несколько дней отмечены стартами. */
function CalendarMotif() {
  const marked = new Set([3, 9, 10, 16, 23, 24]);
  const today = 13;
  const rows = [0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4, 5, 6].map((c) => r * 7 + c));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 330,
        borderRadius: 28,
        background: C.surface,
        border: `2px solid ${C.line}`,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", height: 64, background: C.accent, alignItems: "center", paddingLeft: 28, gap: 14 }}>
        <div style={{ display: "flex", width: 16, height: 16, borderRadius: 8, background: C.bg }} />
        <div style={{ display: "flex", width: 120, height: 14, borderRadius: 7, background: "rgba(255,255,255,0.55)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: 22, gap: 10 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            {row.map((d) => (
              <div
                key={d}
                style={{
                  display: "flex",
                  width: 30,
                  height: 30,
                  borderRadius: d === today ? 15 : 7,
                  background: marked.has(d) ? C.accent : d === today ? C.ink : C.line,
                  opacity: marked.has(d) || d === today ? 1 : 0.9,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Беговая дорожка: вложенные овалы стадиона и точка бегуна. */
function TrackMotif() {
  const lanes = [0, 1, 2, 3];
  return (
    <div style={{ display: "flex", width: 340, height: 340, alignItems: "center", justifyContent: "center", position: "relative" }}>
      {lanes.map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            position: "absolute",
            width: 300 - i * 52,
            height: 330 - i * 52,
            borderRadius: 999,
            border: `${i === 0 ? 14 : 3}px solid ${i === 0 ? C.accent : C.line2}`,
          }}
        />
      ))}
      <div style={{ display: "flex", position: "absolute", top: 4, left: 160, width: 26, height: 26, borderRadius: 13, background: C.ink }} />
    </div>
  );
}

/** Документ: лист со строками текста, для служебных страниц. */
function DocMotif() {
  const lines = [220, 250, 180, 240, 200, 150];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 300,
        height: 360,
        borderRadius: 24,
        background: C.surface,
        border: `2px solid ${C.line}`,
        padding: 34,
        gap: 18,
      }}
    >
      <div style={{ display: "flex", width: 120, height: 18, borderRadius: 9, background: C.accent }} />
      {lines.map((w, i) => (
        <div key={i} style={{ display: "flex", width: w, height: 12, borderRadius: 6, background: C.line2 }} />
      ))}
    </div>
  );
}

export async function renderOgCard({ label = "IGORP.RUN", title, subtitle, stats, motif = "track" }: OgCardInput) {
  const Motif = motif === "calendar" ? CalendarMotif : motif === "doc" ? DocMotif : TrackMotif;
  // Длинный заголовок мельче, чтобы влезал в три строки, а самое длинное слово в
  // колонку шириной около 640 px («конфиденциальности» иначе уезжает под рисунок).
  const byLength = title.length > 34 ? 64 : title.length > 22 ? 74 : 84;
  const longestWord = Math.max(...title.split(/\s+/).map((w) => w.length));
  const titleSize = Math.min(byLength, Math.floor(640 / (longestWord * 0.6)));
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: C.bg,
          padding: "68px 72px",
          fontFamily: "Onest",
          color: C.ink,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between", paddingRight: 40 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: C.accent }} />
              <div style={{ display: "flex", fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: 24, letterSpacing: 4, color: C.accentInk }}>
                {label}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 34,
                fontWeight: 800,
                fontSize: titleSize,
                lineHeight: 1.04,
                letterSpacing: -2,
              }}
            >
              {title}
            </div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 32, lineHeight: 1.3, color: C.ink2 }}>{subtitle}</div>
          </div>
          {stats ? (
            <div style={{ display: "flex", fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: 26, color: C.ink, whiteSpace: "nowrap" }}>{stats}</div>
          ) : (
            <div style={{ display: "flex", width: 120, height: 8, borderRadius: 4, background: C.accent }} />
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 360 }}>
          <Motif />
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await fonts() },
  );
}
