"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  setBackgroundColor?: (c: string) => void;
  setHeaderColor?: (c: string) => void;
};

// Local cast (no global augmentation — /m/n already augments Window.Telegram; re-declaring here would
// clash). Reads the same window.Telegram.WebApp the nutrition mini app uses.
function getTelegramWebApp(): TelegramWebApp | undefined {
  return (globalThis as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

type HealthCard = { studentId: string | null; name: string; summary: string; days: number | null };
type Card = { studentId: string | null; name: string; summary: string };
type TodayView = {
  scanAlert: string | null;
  check: HealthCard[];
  pain: Card[];
  moves: Card[];
  background: { plan: string[]; noContact: string[]; missed: string[] };
  counts: { check: number; pain: number; moves: number; background: number };
};

// Force-light palette (a dark-theme phone must not wash out the desk). Teal lineage from /m/n.
const C = {
  bg: "#f5f8f7",
  card: "#ffffff",
  ink: "#12332c",
  sub: "#7c8a86",
  faint: "#aeb9b5",
  teal: "#1D9E75",
  tealDark: "#04342c",
  line: "#e7ecea",
  pill: "#eef3f1",
  danger: "#c2463a",
};

const S = {
  shell: {
    minHeight: "100vh",
    background: C.bg,
    fontFamily: "var(--font-montserrat), system-ui, sans-serif",
    color: C.ink,
    paddingBottom: 76,
  } as const,
  header: { padding: "18px 18px 8px" } as const,
  h1: { margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" } as const,
  date: { margin: "2px 0 0", fontSize: 13, fontWeight: 600, color: C.sub } as const,
  pillRow: {
    display: "flex" as const,
    gap: 6,
    overflowX: "auto" as const,
    padding: "12px 18px 6px",
    WebkitOverflowScrolling: "touch" as const,
  },
  pill: (active: boolean) => ({
    flex: "0 0 auto" as const,
    padding: "8px 13px",
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13.5,
    fontWeight: 700,
    background: active ? C.teal : C.pill,
    color: active ? "#fff" : C.sub,
  }),
  pillCount: (active: boolean) => ({
    marginLeft: 6,
    fontWeight: 800,
    opacity: active ? 0.95 : 0.6,
  }),
  list: { padding: "6px 14px 18px" } as const,
  card: {
    background: C.card,
    borderRadius: 14,
    padding: "13px 15px",
    marginBottom: 9,
    boxShadow: "0 1px 2px rgba(18,51,44,0.05)",
    border: `1px solid ${C.line}`,
  } as const,
  cardTop: { display: "flex" as const, justifyContent: "space-between" as const, alignItems: "baseline" as const, gap: 10 },
  name: { fontSize: 16, fontWeight: 700, lineHeight: 1.25 } as const,
  days: { flex: "0 0 auto" as const, fontSize: 12.5, fontWeight: 700, color: C.faint } as const,
  summary: { margin: "5px 0 0", fontSize: 14, fontWeight: 500, color: C.sub, lineHeight: 1.4 } as const,
  actionRow: { marginTop: 11, display: "flex" as const, justifyContent: "flex-end" as const },
  closeBtn: {
    padding: "8px 16px",
    borderRadius: 10,
    border: `1.5px solid ${C.teal}`,
    background: "#fff",
    color: C.teal,
    fontFamily: "inherit",
    fontSize: 13.5,
    fontWeight: 700,
    cursor: "pointer",
  } as const,
  banner: {
    margin: "4px 14px 10px",
    padding: "11px 14px",
    borderRadius: 12,
    background: "#fff7ec",
    border: "1px solid #f2e0c2",
    color: "#8a6a2f",
    fontSize: 13.5,
    fontWeight: 600,
    lineHeight: 1.4,
  } as const,
  empty: { padding: "28px 18px", textAlign: "center" as const, color: C.faint, fontSize: 14, fontWeight: 600 } as const,
  foldHead: {
    width: "100%",
    display: "flex" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    padding: "13px 15px",
    background: C.card,
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    marginBottom: 9,
    cursor: "pointer",
    fontFamily: "inherit",
    color: C.ink,
  } as const,
  foldTitle: { fontSize: 15, fontWeight: 700 } as const,
  foldCount: { fontSize: 13, fontWeight: 700, color: C.faint } as const,
  foldBody: { padding: "2px 4px 10px", display: "flex" as const, flexWrap: "wrap" as const, gap: 7 } as const,
  chip: { padding: "6px 11px", borderRadius: 999, background: C.pill, color: C.sub, fontSize: 13, fontWeight: 600 } as const,
  tabBar: {
    position: "fixed" as const,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex" as const,
    background: "#fff",
    borderTop: `1px solid ${C.line}`,
    paddingBottom: "env(safe-area-inset-bottom)",
  },
  tab: (active: boolean) => ({
    flex: 1,
    padding: "10px 0 12px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 11.5,
    fontWeight: 700,
    color: active ? C.teal : C.faint,
    display: "flex" as const,
    flexDirection: "column" as const,
    alignItems: "center" as const,
    gap: 3,
  }),
  tabIcon: { fontSize: 19, lineHeight: 1 } as const,
  soon: { fontSize: 9, fontWeight: 700, color: C.faint, letterSpacing: "0.04em" } as const,
};

type Pill = "check" | "pain" | "moves" | "bg";
type Tab = "today" | "moves" | "students" | "reports";

const PILL_LABELS: Record<Pill, string> = { check: "Проверить", pain: "Травмы", moves: "Переносы", bg: "Фон" };
const TABS: Array<{ key: Tab; icon: string; label: string; ready: boolean }> = [
  { key: "today", icon: "🩺", label: "Сегодня", ready: true },
  { key: "moves", icon: "🔁", label: "Переносы", ready: false },
  { key: "students", icon: "👥", label: "Ученики", ready: false },
  { key: "reports", icon: "📊", label: "Отчёты", ready: false },
];

function daysLabel(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "сегодня";
  if (days === 1) return "1 день";
  if (days >= 2 && days <= 4) return `${days} дня`;
  return `${days} дней`;
}

export default function CoachDeskPage() {
  const [initData, setInitData] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [view, setView] = useState<TodayView | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [pill, setPill] = useState<Pill>("check");
  const [closing, setClosing] = useState<Set<string>>(new Set());
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (tg) {
      tg.ready();
      tg.expand();
      setInitData(tg.initData);
      try {
        tg.setBackgroundColor?.(C.bg);
        tg.setHeaderColor?.(C.tealDark);
      } catch {
        /* older clients */
      }
    }
    // Even outside Telegram (dev), attempt the fetch — server rejects without valid initData.
    const id = tg?.initData ?? "";
    void loadToday(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadToday = useCallback(async (id: string) => {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/m/desk/today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: id }),
      });
      const json = (await res.json()) as { ok: boolean; view?: TodayView; date?: string; error?: string };
      if (!json.ok || !json.view) {
        setErrorMsg(json.error ?? "Не удалось загрузить.");
        setStatus("error");
        return;
      }
      setView(json.view);
      setDate(json.date ?? "");
      setStatus("ready");
    } catch {
      setErrorMsg("Ошибка сети. Потяни, чтобы обновить.");
      setStatus("error");
    }
  }, []);

  const handleClose = useCallback(
    async (studentId: string | null) => {
      if (!studentId) return;
      setClosing((prev) => new Set(prev).add(studentId));
      try {
        const res = await fetch("/api/m/desk/signal/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, studentId }),
        });
        const json = (await res.json()) as { ok: boolean };
        if (json.ok) {
          setView((prev) =>
            prev
              ? {
                  ...prev,
                  check: prev.check.filter((c) => c.studentId !== studentId),
                  counts: { ...prev.counts, check: prev.check.filter((c) => c.studentId !== studentId).length },
                }
              : prev
          );
        }
      } catch {
        /* leave the card; coach can retry */
      } finally {
        setClosing((prev) => {
          const next = new Set(prev);
          next.delete(studentId);
          return next;
        });
      }
    },
    [initData]
  );

  const toggleFold = useCallback((key: string) => {
    setOpenFolds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const pillList = useMemo<Pill[]>(() => ["check", "pain", "moves", "bg"], []);

  return (
    <main style={S.shell}>
      <header style={S.header}>
        <h1 style={S.h1}>Сегодня</h1>
        {date ? <p style={S.date}>{date}</p> : null}
      </header>

      {tab !== "today" ? (
        <div style={S.empty}>
          {TABS.find((t) => t.key === tab)?.label} — скоро.
          <br />
          Пока доступна вкладка «Сегодня».
        </div>
      ) : status === "loading" ? (
        <div style={S.empty}>Загружаю…</div>
      ) : status === "error" ? (
        <div style={S.empty}>{errorMsg}</div>
      ) : view ? (
        <>
          {view.scanAlert ? <div style={S.banner}>⚠️ {view.scanAlert}</div> : null}

          <nav style={S.pillRow}>
            {pillList.map((p) => (
              <button key={p} type="button" style={S.pill(pill === p)} onClick={() => setPill(p)}>
                {PILL_LABELS[p]}
                <span style={S.pillCount(pill === p)}>{view.counts[p === "bg" ? "background" : p]}</span>
              </button>
            ))}
          </nav>

          <section style={S.list}>
            {pill === "check" &&
              (view.check.length === 0 ? (
                <p style={S.empty}>Никого проверять — чисто.</p>
              ) : (
                view.check.map((c, i) => (
                  <div key={c.studentId ?? i} style={S.card}>
                    <div style={S.cardTop}>
                      <span style={S.name}>{c.name}</span>
                      {c.days !== null ? <span style={S.days}>{daysLabel(c.days)}</span> : null}
                    </div>
                    {c.summary ? <p style={S.summary}>{c.summary}</p> : null}
                    <div style={S.actionRow}>
                      <button
                        type="button"
                        style={S.closeBtn}
                        disabled={closing.has(c.studentId ?? "")}
                        onClick={() => handleClose(c.studentId)}
                      >
                        {closing.has(c.studentId ?? "") ? "Снимаю…" : "Снять"}
                      </button>
                    </div>
                  </div>
                ))
              ))}

            {pill === "pain" &&
              (view.pain.length === 0 ? (
                <p style={S.empty}>Травм нет.</p>
              ) : (
                view.pain.map((c, i) => (
                  <div key={c.studentId ?? i} style={S.card}>
                    <span style={S.name}>{c.name}</span>
                    {c.summary ? <p style={S.summary}>{c.summary}</p> : null}
                  </div>
                ))
              ))}

            {pill === "moves" &&
              (view.moves.length === 0 ? (
                <p style={S.empty}>Переносов нет.</p>
              ) : (
                view.moves.map((c, i) => (
                  <div key={c.studentId ?? i} style={S.card}>
                    <span style={S.name}>{c.name}</span>
                    {c.summary ? <p style={S.summary}>{c.summary}</p> : null}
                  </div>
                ))
              ))}

            {pill === "bg" && (
              <>
                <FoldGroup
                  title="Доступность / план"
                  names={view.background.plan}
                  open={openFolds.has("plan")}
                  onToggle={() => toggleFold("plan")}
                />
                <FoldGroup
                  title="Нет контакта 5+ дней"
                  names={view.background.noContact}
                  open={openFolds.has("noContact")}
                  onToggle={() => toggleFold("noContact")}
                />
                <FoldGroup
                  title="Без отметки о выполнении"
                  names={view.background.missed}
                  open={openFolds.has("missed")}
                  onToggle={() => toggleFold("missed")}
                />
              </>
            )}
          </section>
        </>
      ) : null}

      <nav style={S.tabBar}>
        {TABS.map((t) => (
          <button key={t.key} type="button" style={S.tab(tab === t.key)} onClick={() => setTab(t.key)}>
            <span style={S.tabIcon}>{t.icon}</span>
            <span>{t.label}</span>
            {!t.ready ? <span style={S.soon}>скоро</span> : null}
          </button>
        ))}
      </nav>
    </main>
  );
}

function FoldGroup(props: { title: string; names: string[]; open: boolean; onToggle: () => void }) {
  if (props.names.length === 0) {
    return null;
  }
  return (
    <div>
      <button type="button" style={S.foldHead} onClick={props.onToggle}>
        <span style={S.foldTitle}>{props.title}</span>
        <span style={S.foldCount}>
          {props.names.length} {props.open ? "▲" : "▼"}
        </span>
      </button>
      {props.open ? (
        <div style={S.foldBody}>
          {props.names.map((n, i) => (
            <span key={`${n}-${i}`} style={S.chip}>
              {n}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
