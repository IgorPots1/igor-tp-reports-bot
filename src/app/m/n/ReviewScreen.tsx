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

type PlanDay = {
  date: string | null;
  weekdayRu: string | null;
  trainingLabel: string | null;
  targetKcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  isRest: boolean;
  isRun: boolean;
  isKey: boolean;
  isRace: boolean;
  isRecovery: boolean;
};

type ReviewData = {
  status: "ready" | "not_ready";
  week?: { from: string; to: string };
  studentName?: string;
  focus?: string | null;
  parts?: string[];
  dailyMacros?: DailyMacro[];
  planDays?: PlanDay[];
  planFocusText?: string | null;
  planRaceDayText?: string | null;
  planKeyTrainingText?: string | null;
  planNoteText?: string | null;
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

// Plan-day accent tokens (green = accent, not fill).
const PLAN_MARKER = { rest: "#5b8def", run: "#23b07f", key: "#0e8d76", race: "#e0533f", recovery: "#5b8def" };

function planDayMarkerColor(d: PlanDay): string {
  if (d.isRace) return PLAN_MARKER.race;
  if (d.isRecovery) return PLAN_MARKER.recovery;
  if (d.isKey) return PLAN_MARKER.key;
  if (d.isRest) return PLAN_MARKER.rest;
  if (d.isRun) return PLAN_MARKER.run;
  return "var(--tg-theme-hint-color, #b0b6ba)";
}

// Left border (special days only) + optional badge.
function planDayAccent(d: PlanDay): { borderLeft: string; background?: string; badge?: { text: string; color: string } } {
  if (d.isRace) return { borderLeft: `4px solid ${PLAN_MARKER.race}`, background: "#fdf3f1" };
  if (d.isRecovery) return { borderLeft: `4px solid ${PLAN_MARKER.recovery}`, badge: { text: "восстановление", color: PLAN_MARKER.recovery } };
  if (d.isKey) return { borderLeft: `4px solid ${PLAN_MARKER.key}`, badge: { text: "ключевой", color: PLAN_MARKER.key } };
  return { borderLeft: "1px solid #e6ebe9" };
}

// Section blocks (race / pre-key) already carry their own heading on the first line.
// Split it off so the card can colour the heading; the rest is the body.
function splitSectionText(text: string): { heading: string; body: string } {
  const idx = text.indexOf("\n");
  return idx === -1 ? { heading: text.trim(), body: "" } : { heading: text.slice(0, idx).trim(), body: text.slice(idx + 1).trim() };
}

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
  // Plan section (card layout). Green = accent only; dense text on white cards.
  planFocusPlate: {
    background: "#15302a",
    color: "#eaf6f1",
    borderRadius: 14,
    padding: "16px 16px",
    margin: "4px 0 16px",
    lineHeight: 1.6,
    fontSize: 15,
    whiteSpace: "pre-wrap" as const,
  },
  planFocusPlateLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    color: "#7fd7bf",
    margin: "0 0 6px",
  },
  planCard: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 12,
    background: "#fff",
    border: "1px solid #e6ebe9",
    borderLeft: "1px solid #e6ebe9",
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 8,
  },
  planChip: {
    background: "#eef5f2",
    borderRadius: 10,
    padding: "6px 10px",
    textAlign: "right" as const,
    flexShrink: 0,
  },
  planChipKcal: { fontSize: 16, fontWeight: 700, color: "#04342c" },
  planChipMacro: { fontSize: 12, color: "#5b6b66" },
  planBadge: {
    display: "inline-block" as const,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.03em",
    textTransform: "uppercase" as const,
    borderRadius: 6,
    padding: "1px 6px",
    marginLeft: 8,
    verticalAlign: "middle" as const,
  },
  planWhiteCard: {
    background: "#fff",
    border: "1px solid #e6ebe9",
    borderRadius: 14,
    padding: "14px 16px",
    margin: "12px 0 0",
  },
  planCardHeading: { fontSize: 15, fontWeight: 700, margin: "0 0 8px" },
  planCardBody: { whiteSpace: "pre-wrap" as const, lineHeight: 1.6, fontSize: 14, color: "#2a3a35" },
  planNote: {
    fontSize: 12.5,
    color: "var(--tg-theme-hint-color, #8a938f)",
    lineHeight: 1.5,
    margin: "12px 2px 0",
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

// The shared review renderer prepends a deterministic greeting ("Здравствуйте!" /
// "Привет!"). On the athlete mini-app the screen has its own header and the form
// already greeted on send, so drop a leading greeting line (render-only — the
// Telegram coach copy keeps it; numbers and the rest of the text are untouched).
function stripLeadingGreeting(text: string): string {
  return text.replace(/^\s*(?:здравствуйте|привет)[!.…]*\s*\n+/iu, "");
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
  const planDays = data?.planDays ?? [];

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

        {parts[0] ? <div style={S.prose}>{stripLeadingGreeting(parts[0])}</div> : null}

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

        {planDays.length > 0 || data?.planFocusText ? (
          <>
            <p style={{ ...S.sectionLabel, marginTop: 22 }}>🎯 План на следующую неделю</p>

            {data?.planFocusText ? (
              <div style={S.planFocusPlate}>
                <p style={S.planFocusPlateLabel}>Фокус недели</p>
                {data.planFocusText}
              </div>
            ) : null}

            {planDays.map((d) => {
              const accent = planDayAccent(d);
              return (
                <div
                  key={d.date ?? Math.random()}
                  style={{ ...S.planCard, borderLeft: accent.borderLeft, ...(accent.background ? { background: accent.background } : {}) }}
                >
                  <span style={{ ...S.dayMarker, background: planDayMarkerColor(d) }} aria-hidden />
                  <div style={S.dayWhen}>
                    <div style={S.dayWeekday}>
                      {d.weekdayRu ?? (d.date ? formatWeekday(d.date) : "")}
                      {d.trainingLabel ? <span style={S.dayType}> · {d.trainingLabel}</span> : null}
                      {accent.badge ? (
                        <span style={{ ...S.planBadge, color: accent.badge.color, background: `${accent.badge.color}1a` }}>
                          {accent.badge.text}
                        </span>
                      ) : null}
                    </div>
                    {d.date ? <div style={S.dayDate}>{formatDateShort(d.date)}</div> : null}
                  </div>
                  <div style={S.planChip}>
                    <div style={S.planChipKcal}>{r(d.targetKcal)} ккал</div>
                    <div style={S.planChipMacro}>
                      Б {r(d.proteinG)} · Ж {r(d.fatG)} · У {r(d.carbsG)}
                    </div>
                  </div>
                </div>
              );
            })}

            {data?.planNoteText ? <p style={S.planNote}>{data.planNoteText}</p> : null}

            {data?.planRaceDayText
              ? (() => {
                  const s = splitSectionText(data.planRaceDayText!);
                  return (
                    <div style={S.planWhiteCard}>
                      <p style={{ ...S.planCardHeading, color: PLAN_MARKER.race }}>{s.heading}</p>
                      {s.body ? <div style={S.planCardBody}>{s.body}</div> : null}
                    </div>
                  );
                })()
              : null}

            {data?.planKeyTrainingText
              ? (() => {
                  const s = splitSectionText(data.planKeyTrainingText!);
                  return (
                    <div style={S.planWhiteCard}>
                      <p style={{ ...S.planCardHeading, color: PLAN_MARKER.key }}>{s.heading}</p>
                      {s.body ? <div style={S.planCardBody}>{s.body}</div> : null}
                    </div>
                  );
                })()
              : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
