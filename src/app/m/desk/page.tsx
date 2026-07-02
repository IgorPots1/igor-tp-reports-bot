"use client";

import { useCallback, useEffect, useState } from "react";

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
type ErrorCard = { name: string | null; summary: string };
type TodayView = {
  scanAlert: string | null;
  check: HealthCard[];
  errors: ErrorCard[];
  plan: Card[];
  pain: Card[];
  noContact: string[];
  missed: string[];
  counts: {
    check: number;
    errors: number;
    plan: number;
    moves: number;
    pain: number;
    noContact: number;
    missed: number;
  };
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
  warn: "#8a6a2f",
  warnBg: "#fff7ec",
  warnLine: "#f2e0c2",
};

const S = {
  shell: {
    minHeight: "100vh",
    background: C.bg,
    fontFamily: "var(--font-montserrat), system-ui, sans-serif",
    color: C.ink,
    paddingBottom: 76,
  } as const,
  header: { padding: "18px 18px 6px" } as const,
  h1: { margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" } as const,
  date: { margin: "2px 0 0", fontSize: 13, fontWeight: 600, color: C.sub } as const,
  countRow: { display: "flex" as const, gap: 8, padding: "10px 18px 4px" },
  countChip: {
    display: "flex" as const,
    alignItems: "baseline" as const,
    gap: 5,
    padding: "6px 11px",
    borderRadius: 999,
    background: C.pill,
    fontSize: 13,
    fontWeight: 700,
    color: C.sub,
  } as const,
  countN: { fontSize: 14, fontWeight: 800, color: C.ink } as const,
  banner: {
    margin: "6px 14px 4px",
    padding: "11px 14px",
    borderRadius: 12,
    background: C.warnBg,
    border: `1px solid ${C.warnLine}`,
    color: C.warn,
    fontSize: 13.5,
    fontWeight: 600,
    lineHeight: 1.4,
  } as const,
  section: { padding: "10px 14px 2px" } as const,
  secHead: {
    width: "100%",
    display: "flex" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    padding: "6px 4px 8px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    color: C.ink,
    textAlign: "left" as const,
  } as const,
  secTitle: { fontSize: 15.5, fontWeight: 800, letterSpacing: "-0.01em" } as const,
  secCount: { fontSize: 13, fontWeight: 700, color: C.faint } as const,
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
  manualNote: { margin: "6px 0 0", fontSize: 12, fontWeight: 600, color: C.faint } as const,
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
  errBlock: { marginTop: 4 } as const,
  errHead: { fontSize: 13, fontWeight: 700, color: C.warn, margin: "4px 4px 8px" } as const,
  errCard: {
    background: C.warnBg,
    border: `1px solid ${C.warnLine}`,
    borderRadius: 12,
    padding: "11px 14px",
    marginBottom: 8,
  } as const,
  errName: { fontSize: 14.5, fontWeight: 700, color: C.ink } as const,
  errSummary: { margin: "3px 0 0", fontSize: 13.5, fontWeight: 500, color: C.warn, lineHeight: 1.4 } as const,
  chipsWrap: { padding: "2px 4px 10px", display: "flex" as const, flexWrap: "wrap" as const, gap: 7 } as const,
  chip: { padding: "6px 11px", borderRadius: 999, background: C.pill, color: C.sub, fontSize: 13, fontWeight: 600 } as const,
  empty: { padding: "8px 6px 14px", color: C.faint, fontSize: 13.5, fontWeight: 600 } as const,
  bigEmpty: { padding: "28px 18px", textAlign: "center" as const, color: C.faint, fontSize: 14, fontWeight: 600 } as const,
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

type Tab = "today" | "moves" | "students" | "reports";
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
  const [closing, setClosing] = useState<Set<string>>(new Set());
  // Collapsible sections closed by default: the long tails (no-contact, no-completion).
  const [closedSections, setClosedSections] = useState<Set<string>>(new Set(["noContact", "missed"]));

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
    void loadToday(tg?.initData ?? "");
  }, [loadToday]);

  const handleClose = useCallback(
    async (studentId: string | null, kind: "illness" | "injury") => {
      if (!studentId) return;
      const tag = `${kind}:${studentId}`;
      setClosing((prev) => new Set(prev).add(tag));
      try {
        const res = await fetch("/api/m/desk/signal/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, studentId, kind }),
        });
        const json = (await res.json()) as { ok: boolean };
        if (json.ok) {
          setView((prev) => {
            if (!prev) return prev;
            if (kind === "illness") {
              const check = prev.check.filter((c) => c.studentId !== studentId);
              return { ...prev, check, counts: { ...prev.counts, check: check.length } };
            }
            const pain = prev.pain.filter((c) => c.studentId !== studentId);
            return { ...prev, pain, counts: { ...prev.counts, pain: pain.length } };
          });
        }
      } catch {
        /* leave the card; coach can retry */
      } finally {
        setClosing((prev) => {
          const next = new Set(prev);
          next.delete(tag);
          return next;
        });
      }
    },
    [initData]
  );

  const toggleSection = useCallback((key: string) => {
    setClosedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <main style={S.shell}>
      <header style={S.header}>
        <h1 style={S.h1}>Сегодня</h1>
        {date ? <p style={S.date}>{date}</p> : null}
      </header>

      {tab === "today" && view ? (
        <div style={S.countRow}>
          <span style={S.countChip}>🩺 <span style={S.countN}>{view.counts.check}</span></span>
          <span style={S.countChip}>🦵 <span style={S.countN}>{view.counts.pain}</span></span>
          <span style={S.countChip}>🔁 <span style={S.countN}>{view.counts.moves}</span></span>
        </div>
      ) : null}

      {tab !== "today" ? (
        <div style={S.bigEmpty}>
          {TABS.find((t) => t.key === tab)?.label} — скоро.
          <br />
          Пока доступна вкладка «Сегодня».
        </div>
      ) : status === "loading" ? (
        <div style={S.bigEmpty}>Загружаю…</div>
      ) : status === "error" ? (
        <div style={S.bigEmpty}>{errorMsg}</div>
      ) : view ? (
        <>
          {view.scanAlert ? <div style={S.banner}>⚠️ {view.scanAlert}</div> : null}

          {/* 🩺 Проверить сегодня — illness (closable) + system errors (informational). */}
          <section style={S.section}>
            <div style={S.secHead}>
              <span style={S.secTitle}>🩺 Проверить сегодня</span>
              <span style={S.secCount}>{view.counts.check}</span>
            </div>
            {view.check.length === 0 && view.errors.length === 0 ? (
              <p style={S.empty}>Никого проверять — чисто.</p>
            ) : null}
            {view.check.map((c, i) => (
              <div key={c.studentId ?? `chk-${i}`} style={S.card}>
                <div style={S.cardTop}>
                  <span style={S.name}>{c.name}</span>
                  {c.days !== null ? <span style={S.days}>{daysLabel(c.days)}</span> : null}
                </div>
                {c.summary ? <p style={S.summary}>{c.summary}</p> : null}
                <div style={S.actionRow}>
                  <button
                    type="button"
                    style={S.closeBtn}
                    disabled={closing.has(`illness:${c.studentId ?? ""}`)}
                    onClick={() => handleClose(c.studentId, "illness")}
                  >
                    {closing.has(`illness:${c.studentId ?? ""}`) ? "Снимаю…" : "Снять"}
                  </button>
                </div>
              </div>
            ))}
            {view.errors.length > 0 ? (
              <div style={S.errBlock}>
                <p style={S.errHead}>⚠️ Ошибки / сбои · {view.errors.length}</p>
                {view.errors.map((e, i) => (
                  <div key={`err-${i}`} style={S.errCard}>
                    <span style={S.errName}>{e.name ?? "Система"}</span>
                    {e.summary ? <p style={S.errSummary}>{e.summary}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {/* 📅 Учесть в плане — availability / constraints / move candidates & requests. */}
          <section style={S.section}>
            <div style={S.secHead}>
              <span style={S.secTitle}>📅 Учесть в плане</span>
              <span style={S.secCount}>{view.counts.plan}</span>
            </div>
            {view.plan.length === 0 ? (
              <p style={S.empty}>Ничего учитывать.</p>
            ) : (
              view.plan.map((c, i) => (
                <div key={c.studentId ?? `plan-${i}`} style={S.card}>
                  <span style={S.name}>{c.name}</span>
                  {c.summary ? <p style={S.summary}>{c.summary}</p> : null}
                </div>
              ))
            )}
          </section>

          {/* 🦵 Травмы — admin-closable, manual only. */}
          <section style={S.section}>
            <div style={S.secHead}>
              <span style={S.secTitle}>🦵 Травмы</span>
              <span style={S.secCount}>{view.counts.pain}</span>
            </div>
            {view.pain.length === 0 ? (
              <p style={S.empty}>Травм нет.</p>
            ) : (
              view.pain.map((c, i) => (
                <div key={c.studentId ?? `pain-${i}`} style={S.card}>
                  <span style={S.name}>{c.name}</span>
                  {c.summary ? <p style={S.summary}>{c.summary}</p> : null}
                  <p style={S.manualNote}>Закрывается вручную — не уйдёт сама.</p>
                  <div style={S.actionRow}>
                    <button
                      type="button"
                      style={S.closeBtn}
                      disabled={closing.has(`injury:${c.studentId ?? ""}`)}
                      onClick={() => handleClose(c.studentId, "injury")}
                    >
                      {closing.has(`injury:${c.studentId ?? ""}`) ? "Снимаю…" : "Снять"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* 📭 Нет контакта — collapsible tail. */}
          <CollapsibleNames
            title="📭 Нет контакта"
            names={view.noContact}
            open={!closedSections.has("noContact")}
            onToggle={() => toggleSection("noContact")}
          />

          {/* 🏃 Нет выполнения — collapsible tail. */}
          <CollapsibleNames
            title="🏃 Нет выполнения"
            names={view.missed}
            open={!closedSections.has("missed")}
            onToggle={() => toggleSection("missed")}
          />
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

function CollapsibleNames(props: { title: string; names: string[]; open: boolean; onToggle: () => void }) {
  return (
    <section style={S.section}>
      <button type="button" style={S.secHead} onClick={props.onToggle}>
        <span style={S.secTitle}>{props.title}</span>
        <span style={S.secCount}>
          {props.names.length} {props.names.length > 0 ? (props.open ? "▲" : "▼") : ""}
        </span>
      </button>
      {props.open ? (
        props.names.length === 0 ? (
          <p style={S.empty}>Пусто.</p>
        ) : (
          <div style={S.chipsWrap}>
            {props.names.map((n, i) => (
              <span key={`${n}-${i}`} style={S.chip}>
                {n}
              </span>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
