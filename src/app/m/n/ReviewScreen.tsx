"use client";

import { useEffect, useState } from "react";

type DayMarker = "ok" | "low_energy" | "unknown";

type DailyMacro = {
  day: string;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  marker: DayMarker;
  trainingLabel: string | null;
};

type ReviewData = {
  status: "ready" | "not_ready";
  week?: { from: string; to: string };
  studentName?: string;
  focus?: string | null;
  parts?: string[];
  dailyMacros?: DailyMacro[];
};

type Phase = "loading" | "ready" | "not_ready" | "error";

// Fixed XO Runners brand teal (hardcoded — not theme-driven).
const TEAL = {
  headerBg: "#E1F5EE",
  headerText: "#04342C",
  bar: "#1D9E75",
  darkBg: "#04342C",
  darkText: "#E1F5EE",
};

const MARKER_COLOR: Record<DayMarker, string> = {
  ok: "#1D9E75",
  low_energy: "#EF9F27",
  unknown: "var(--tg-theme-hint-color, #b0b6ba)",
};

const S = {
  page: {
    minHeight: "100vh",
    background: "var(--tg-theme-bg-color, #f5f5f5)",
    color: "var(--tg-theme-text-color, #222)",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 16,
    padding: "0 0 40px",
    boxSizing: "border-box" as const,
  },
  header: {
    background: TEAL.headerBg,
    color: TEAL.headerText,
    padding: "22px 18px",
    borderRadius: "0 0 18px 18px",
  },
  headerWeek: { fontSize: 13, fontWeight: 600, opacity: 0.8, margin: 0 },
  headerTitle: { fontSize: 22, fontWeight: 800, margin: "4px 0 2px" },
  headerName: { fontSize: 15, margin: 0, opacity: 0.9 },
  body: { padding: "16px 14px 0" },
  focus: {
    borderLeft: `4px solid ${TEAL.bar}`,
    background: "var(--tg-theme-secondary-bg-color, #fff)",
    padding: "12px 14px",
    borderRadius: "0 10px 10px 0",
    margin: "0 0 18px",
    fontSize: 15,
    lineHeight: 1.5,
  },
  focusLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    color: TEAL.bar,
    margin: "0 0 4px",
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--tg-theme-text-color, #222)",
    margin: "0 0 10px",
  },
  prose: {
    whiteSpace: "pre-wrap" as const,
    lineHeight: 1.7,
    fontSize: 15,
    margin: "0 0 22px",
    color: "var(--tg-theme-text-color, #222)",
  },
  dayCard: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 12,
    background: "var(--tg-theme-secondary-bg-color, #fff)",
    borderRadius: 12,
    padding: "12px 14px",
    marginBottom: 8,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },
  dayMarker: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  dayWhen: { flex: 1, minWidth: 0 },
  dayWeekday: { fontSize: 15, fontWeight: 600, textTransform: "capitalize" as const },
  dayType: { fontWeight: 400, color: "var(--tg-theme-hint-color, #888)", textTransform: "none" as const },
  dayDate: { fontSize: 12, color: "var(--tg-theme-hint-color, #888)" },
  dayKcal: { fontSize: 17, fontWeight: 700, textAlign: "right" as const },
  dayMacroLine: { fontSize: 12, color: "var(--tg-theme-hint-color, #888)", textAlign: "right" as const },
  planBlock: {
    background: TEAL.darkBg,
    color: TEAL.darkText,
    borderRadius: 14,
    padding: "18px 16px",
    margin: "22px 0 0",
    whiteSpace: "pre-wrap" as const,
    lineHeight: 1.7,
    fontSize: 15,
  },
  planLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    opacity: 0.85,
    margin: "0 0 8px",
  },
  center: { textAlign: "center" as const, padding: "60px 24px", color: "var(--tg-theme-hint-color, #888)" },
  skeletonBar: {
    height: 14,
    borderRadius: 7,
    background: "var(--tg-theme-secondary-bg-color, #e8eaed)",
    margin: "10px 0",
  },
};

const WEEKDAYS_RU = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

function formatWeekday(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return WEEKDAYS_RU[d.getDay()] ?? iso;
}

function formatDateShort(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}` : iso;
}

function r(value: number | null): string {
  return value === null ? "—" : String(Math.round(value));
}

export default function ReviewScreen({ initData }: { initData: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<ReviewData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const form = new FormData();
        form.append("initData", initData);
        const res = await fetch("/api/m/r", { method: "POST", body: form });
        const json = (await res.json()) as { ok: boolean; status?: string; error?: string } & ReviewData;
        if (cancelled) return;
        if (!json.ok) {
          setErrorMsg(json.error ?? "Не удалось загрузить разбор.");
          setPhase("error");
          return;
        }
        if (json.status === "not_ready") {
          setPhase("not_ready");
          return;
        }
        setData(json);
        setPhase("ready");
      } catch {
        if (!cancelled) {
          setErrorMsg("Ошибка сети. Попробуй ещё раз.");
          setPhase("error");
        }
      }
    }
    if (initData) load();
    return () => {
      cancelled = true;
    };
  }, [initData]);

  if (phase === "loading") {
    return (
      <div style={S.page}>
        <div style={S.header}>
          <p style={S.headerTitle}>Твой разбор недели</p>
        </div>
        <div style={S.body}>
          <div style={{ ...S.skeletonBar, width: "60%" }} />
          <div style={S.skeletonBar} />
          <div style={S.skeletonBar} />
          <div style={{ ...S.skeletonBar, width: "80%" }} />
        </div>
      </div>
    );
  }

  if (phase === "not_ready") {
    return (
      <div style={S.page}>
        <div style={S.center}>
          <p style={{ fontSize: 18, marginBottom: 8 }}>🌱 Разбор ещё готовится</p>
          <p>Тренер скоро пришлёт твой разбор недели. Загляни немного позже.</p>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div style={S.page}>
        <div style={S.center}>
          <p style={{ fontSize: 18, marginBottom: 8 }}>Не получилось открыть разбор</p>
          <p>{errorMsg}</p>
          <p style={{ marginTop: 8, fontSize: 13 }}>Открой разбор через ссылку от тренера в Telegram.</p>
        </div>
      </div>
    );
  }

  const week = data?.week;
  const parts = data?.parts ?? [];
  const macros = data?.dailyMacros ?? [];

  return (
    <div style={S.page}>
      <header style={S.header}>
        {week ? (
          <p style={S.headerWeek}>
            🏃 {formatDateShort(week.from)}–{formatDateShort(week.to)}
          </p>
        ) : null}
        <h1 style={S.headerTitle}>Твой разбор недели</h1>
        {data?.studentName ? <p style={S.headerName}>{data.studentName}</p> : null}
      </header>

      <div style={S.body}>
        {data?.focus ? (
          <div style={S.focus}>
            <p style={S.focusLabel}>Фокус недели</p>
            {data.focus}
          </div>
        ) : null}

        {parts[0] ? <div style={S.prose}>{parts[0]}</div> : null}

        {macros.length > 0 ? (
          <>
            <p style={S.sectionLabel}>По дням</p>
            {macros.map((m) => (
              <div key={m.day} style={S.dayCard}>
                <span style={{ ...S.dayMarker, background: MARKER_COLOR[m.marker] }} aria-hidden />
                <div style={S.dayWhen}>
                  <div style={S.dayWeekday}>
                    {formatWeekday(m.day)}
                    {m.trainingLabel ? (
                      <span style={S.dayType}> · {m.trainingLabel}</span>
                    ) : null}
                  </div>
                  <div style={S.dayDate}>{formatDateShort(m.day)}</div>
                </div>
                <div>
                  <div style={S.dayKcal}>{r(m.kcal)} ккал</div>
                  <div style={S.dayMacroLine}>
                    Б {r(m.proteinG)} · Ж {r(m.fatG)} · У {r(m.carbsG)}
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : null}

        {parts[1] ? (
          <div style={S.planBlock}>
            <p style={S.planLabel}>🎯 План на следующую неделю</p>
            {parts[1]}
          </div>
        ) : null}
      </div>
    </div>
  );
}
