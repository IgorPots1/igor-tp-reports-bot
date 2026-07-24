"use client";

import { useCallback, useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { ReportsTab, type ReportCardModel, type ReportsView } from "./reports-tab";

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  setBackgroundColor?: (c: string) => void;
  setHeaderColor?: (c: string) => void;
  openTelegramLink?: (url: string) => void;
};

// Local cast (no global augmentation — /m/n already augments Window.Telegram; re-declaring here would
// clash). Reads the same window.Telegram.WebApp the nutrition mini app uses.
function getTelegramWebApp(): TelegramWebApp | undefined {
  return (globalThis as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

// Open the coach's 1:1 chat with a student (= the business conversation). Falls back to opening the URL
// directly if openTelegramLink is unavailable (older client / dev browser).
function openStudentChat(username: string | null) {
  if (!username) return;
  const url = `https://t.me/${username.replace(/^@/, "")}`;
  const tg = getTelegramWebApp();
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else if (typeof window !== "undefined") window.open(url, "_blank");
}

type WithChat = { studentId: string | null; name: string; telegramUsername: string | null };
type HealthCard = WithChat & { summary: string; days: number | null; doubt?: string | null };
type Card = WithChat & { summary: string };
type Dismiss =
  | { kind: "action"; actionId: string }
  | { kind: "signal"; signalId: string }
  | { kind: "failed_move"; actionId: string }
  | null;
type PlanCard = Card & { dismiss: Dismiss };
type ErrorCard = { name: string | null; studentId: string | null; dismiss?: Dismiss; summary: string };
type NameRow = WithChat;
type TodayView = {
  scanAlert: string | null;
  check: HealthCard[];
  freshCheck: HealthCard[];
  errors: ErrorCard[];
  plan: PlanCard[];
  pain: Card[];
  noContact: NameRow[];
  missed: NameRow[];
  counts: {
    check: number;
    freshCheck: number;
    errors: number;
    plan: number;
    moves: number;
    pain: number;
    noContact: number;
    missed: number;
  };
};

type StartAthlete = { studentId: string; name: string; distance: string | null };
type StartEvent = {
  title: string;
  date: string;
  daysTo: number;
  thisWeek: boolean;
  athletes: StartAthlete[];
  distanceLabel: string | null;
};
type StartsView = {
  thisWeek: StartEvent[];
  later: StartEvent[];
  counts: { events: number; athletes: number; thisWeek: number };
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
  doubtBadge: {
    margin: "7px 0 0",
    padding: "6px 10px",
    borderRadius: 9,
    background: C.warnBg,
    border: `1px solid ${C.warnLine}`,
    color: C.warn,
    fontSize: 12.5,
    fontWeight: 600,
    lineHeight: 1.35,
  } as const,
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
  groupLabel: { padding: "12px 18px 2px", fontSize: 12, fontWeight: 700, color: C.faint, letterSpacing: "0.05em", textTransform: "uppercase" as const } as const,
  eventCard: (week: boolean) =>
    ({
      background: C.card,
      borderRadius: 14,
      padding: "13px 15px",
      margin: "0 14px 9px",
      boxShadow: "0 1px 2px rgba(18,51,44,0.05)",
      border: week ? `1.5px solid ${C.warnLine}` : `1px solid ${C.line}`,
    }) as const,
  eventHead: {
    width: "100%",
    display: "flex" as const,
    justifyContent: "space-between" as const,
    alignItems: "flex-start" as const,
    gap: 10,
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
    fontFamily: "inherit",
    color: C.ink,
    textAlign: "left" as const,
  } as const,
  eventTitle: { fontSize: 16, fontWeight: 700, lineHeight: 1.25 } as const,
  eventMeta: { margin: "4px 0 0", fontSize: 13, fontWeight: 600, color: C.sub } as const,
  eventWhen: (week: boolean) =>
    ({
      flex: "0 0 auto" as const,
      fontSize: 12.5,
      fontWeight: 800,
      color: week ? C.warn : C.faint,
      whiteSpace: "nowrap" as const,
    }) as const,
  eventCount: { margin: "6px 0 0", fontSize: 12.5, fontWeight: 700, color: C.faint } as const,
  roster: { marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 8 } as const,
  rosterRow: { display: "flex" as const, justifyContent: "space-between" as const, gap: 10, padding: "5px 0", fontSize: 14 } as const,
  rosterName: { fontWeight: 600, color: C.ink } as const,
  rosterDist: { flex: "0 0 auto" as const, fontWeight: 600, color: C.faint, fontSize: 13 } as const,
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
  fresh: { margin: "3px 0 0", fontSize: 11.5, fontWeight: 600, color: C.teal } as const,
  softNote: { margin: "0 18px 6px", fontSize: 11.5, fontWeight: 600, color: C.faint, fontStyle: "italic" as const } as const,
  nameRow: { display: "flex" as const, alignItems: "center" as const, gap: 6 } as const,
  chatDot: { fontSize: 13, color: C.teal, flex: "0 0 auto" as const } as const,
  noLink: { fontSize: 11, fontWeight: 700, color: C.faint } as const,
  dim: { opacity: 0.55 } as const,
  dismissRow: { marginTop: 11, display: "flex" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: 8 } as const,
  dismissNote: { fontSize: 11, fontWeight: 600, color: C.faint } as const,
  chipTap: { padding: "6px 11px", borderRadius: 999, background: C.pill, color: C.teal, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", fontFamily: "inherit" } as const,
};

type Tab = "today" | "moves" | "starts" | "students" | "reports";
const TABS: Array<{ key: Tab; icon: string; label: string; ready: boolean }> = [
  { key: "today", icon: "🩺", label: "Сегодня", ready: true },
  { key: "moves", icon: "🔁", label: "Переносы", ready: false },
  { key: "starts", icon: "🏁", label: "Старты", ready: true },
  { key: "students", icon: "👥", label: "Ученики", ready: false },
  { key: "reports", icon: "📊", label: "Отчёты", ready: true },
];

function daysLabel(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "сегодня";
  if (days === 1) return "1 день";
  if (days >= 2 && days <= 4) return `${days} дня`;
  return `${days} дней`;
}

function daysToLabel(days: number): string {
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  return `через ${days} ${days >= 2 && days <= 4 ? "дня" : "дней"}`;
}

export default function CoachDeskPage() {
  const [initData, setInitData] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [view, setView] = useState<TodayView | null>(null);
  const [freshAt, setFreshAt] = useState("");
  const [tab, setTab] = useState<Tab>("today");
  const [closing, setClosing] = useState<Set<string>>(new Set());
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  // Collapsible sections closed by default: the long tails (no-contact, no-completion).
  const [closedSections, setClosedSections] = useState<Set<string>>(new Set(["noContact", "missed"]));
  // Starts tab (lazy-loaded on first open).
  const [startsStatus, setStartsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [startsView, setStartsView] = useState<StartsView | null>(null);
  const [openEvents, setOpenEvents] = useState<Set<string>>(new Set());
  // Reports tab (feedback drafts — lazy-loaded on first open).
  const [reportsStatus, setReportsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [reportsView, setReportsView] = useState<ReportsView | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [reportBusy, setReportBusy] = useState<{ id: string; op: "send" | "dismiss" | "save" | "generate" } | null>(null);
  const [reportToast, setReportToast] = useState<Record<string, { ok: boolean; text: string; tone?: "info" }>>({});

  const loadToday = useCallback(async (id: string) => {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/m/desk/today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: id }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        view?: TodayView;
        date?: string;
        generatedAt?: string;
        error?: string;
      };
      if (!json.ok || !json.view) {
        setErrorMsg(json.error ?? "Не удалось загрузить.");
        setStatus("error");
        return;
      }
      setView(json.view);
      setDate(json.date ?? "");
      setFreshAt(
        json.generatedAt
          ? new Date(json.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
          : ""
      );
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
              const freshCheck = prev.freshCheck.filter((c) => c.studentId !== studentId);
              return { ...prev, check, freshCheck, counts: { ...prev.counts, check: check.length, freshCheck: freshCheck.length } };
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

  const handleDismiss = useCallback(
    async (index: number, dismiss: NonNullable<Dismiss>) => {
      const tag = `plan:${index}`;
      setDismissing((prev) => new Set(prev).add(tag));
      try {
        const body =
          dismiss.kind === "action"
            ? { initData, kind: "action", actionId: dismiss.actionId }
            : dismiss.kind === "failed_move"
              ? { initData, kind: "failed_move", actionId: dismiss.actionId }
              : { initData, kind: "signal", signalId: dismiss.signalId };
        const res = await fetch("/api/m/desk/plan/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { ok: boolean };
        if (json.ok) {
          setView((prev) => {
            if (!prev) return prev;
            const plan = prev.plan.filter((_, i) => i !== index);
            const moves = plan.filter((p) => p.dismiss !== null).length;
            return { ...prev, plan, counts: { ...prev.counts, plan: plan.length, moves } };
          });
        }
      } catch {
        /* leave the card; coach can retry */
      } finally {
        setDismissing((prev) => {
          const next = new Set(prev);
          next.delete(tag);
          return next;
        });
      }
    },
    [initData]
  );

  const handleErrorDismiss = useCallback(
    async (index: number, dismiss: NonNullable<Dismiss>) => {
      const tag = `err:${index}`;
      setDismissing((prev) => new Set(prev).add(tag));
      try {
        const body =
          dismiss.kind === "failed_move"
            ? { initData, kind: "failed_move", actionId: dismiss.actionId }
            : { initData, kind: "signal", signalId: (dismiss as { signalId: string }).signalId };
        const res = await fetch("/api/m/desk/plan/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { ok: boolean };
        if (json.ok) {
          setView((prev) => {
            if (!prev) return prev;
            const errors = prev.errors.filter((_, i) => i !== index);
            return { ...prev, errors, counts: { ...prev.counts, errors: errors.length } };
          });
        }
      } catch {
        /* leave the card; coach can retry */
      } finally {
        setDismissing((prev) => {
          const next = new Set(prev);
          next.delete(tag);
          return next;
        });
      }
    },
    [initData]
  );

  const loadStarts = useCallback(async (id: string) => {
    setStartsStatus("loading");
    try {
      const res = await fetch("/api/m/desk/starts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: id }),
      });
      const json = (await res.json()) as { ok: boolean; view?: StartsView };
      if (!json.ok || !json.view) {
        setStartsStatus("error");
        return;
      }
      setStartsView(json.view);
      setStartsStatus("ready");
    } catch {
      setStartsStatus("error");
    }
  }, []);

  // Lazy-load the Starts tab the first time it's opened.
  useEffect(() => {
    if (tab === "starts" && startsStatus === "idle") {
      void loadStarts(initData);
    }
  }, [tab, startsStatus, initData, loadStarts]);

  const loadReports = useCallback(async (id: string) => {
    setReportsStatus("loading");
    try {
      const res = await fetch("/api/m/desk/reports/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: id }),
      });
      const json = (await res.json()) as { ok: boolean; view?: ReportsView };
      if (!json.ok || !json.view) {
        setReportsStatus("error");
        return;
      }
      setReportsView(json.view);
      setReportsStatus("ready");
    } catch {
      setReportsStatus("error");
    }
  }, []);

  // Lazy-load the Reports tab the first time it's opened.
  useEffect(() => {
    if (tab === "reports" && reportsStatus === "idle") {
      void loadReports(initData);
    }
  }, [tab, reportsStatus, initData, loadReports]);

  const startEditReport = useCallback((card: ReportCardModel) => {
    setEditingId(card.id);
    setEditValue(card.draftText ?? "");
  }, []);

  const cancelEditReport = useCallback(() => {
    setEditingId(null);
    setEditValue("");
  }, []);

  const saveEditReport = useCallback(
    async (card: ReportCardModel) => {
      const text = editValue.trim();
      if (!text) return;
      setReportBusy({ id: card.id, op: "save" });
      try {
        const res = await fetch("/api/m/desk/reports/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, jobId: card.id, text }),
        });
        const json = (await res.json()) as { ok: boolean; text?: string; error?: string };
        if (json.ok) {
          setReportsView((prev) =>
            prev
              ? { ...prev, review: prev.review.map((c) => (c.id === card.id ? { ...c, draftText: json.text ?? text, coachEdited: true } : c)) }
              : prev
          );
          setEditingId(null);
          setEditValue("");
        } else {
          setReportToast((t) => ({ ...t, [card.id]: { ok: false, text: json.error ?? "Не удалось сохранить." } }));
        }
      } catch {
        setReportToast((t) => ({ ...t, [card.id]: { ok: false, text: "Ошибка сети." } }));
      } finally {
        setReportBusy(null);
      }
    },
    [editValue, initData]
  );

  const sendReport = useCallback(
    async (card: ReportCardModel) => {
      setReportBusy({ id: card.id, op: "send" });
      try {
        const res = await fetch("/api/m/desk/reports/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, jobId: card.id }),
        });
        const json = (await res.json()) as { ok: boolean; outcome?: string; note?: string; error?: string };
        if (json.ok && json.outcome === "sent") {
          // Delivered — drop from review into history.
          setReportsView((prev) =>
            prev
              ? {
                  ...prev,
                  review: prev.review.filter((c) => c.id !== card.id),
                  history: [{ ...card, status: "sent" }, ...prev.history],
                  counts: { ...prev.counts, review: prev.counts.review - 1, history: prev.counts.history + 1 },
                }
              : prev
          );
        } else if (json.ok && json.outcome === "prepared") {
          // Prepare-only is a deliberate mode, not a failure — neutral (info) note, not red.
          setReportToast((t) => ({ ...t, [card.id]: { ok: true, tone: "info", text: json.note ?? "Режим подготовки: черновик готов, отправка выключена." } }));
        } else {
          setReportToast((t) => ({ ...t, [card.id]: { ok: false, text: json.error ?? "Не удалось отправить." } }));
        }
      } catch {
        setReportToast((t) => ({ ...t, [card.id]: { ok: false, text: "Ошибка сети." } }));
      } finally {
        setReportBusy(null);
      }
    },
    [initData]
  );

  const dismissReport = useCallback(
    async (card: ReportCardModel, from: "review" | "attention" | "queue") => {
      setReportBusy({ id: card.id, op: "dismiss" });
      try {
        const res = await fetch("/api/m/desk/reports/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, jobId: card.id }),
        });
        const json = (await res.json()) as { ok: boolean; error?: string };
        if (json.ok) {
          setReportsView((prev) => {
            if (!prev) return prev;
            if (from === "attention") {
              return { ...prev, attention: prev.attention.filter((c) => c.id !== card.id), counts: { ...prev.counts, attention: prev.counts.attention - 1 } };
            }
            if (from === "queue") {
              return {
                ...prev,
                queue: prev.queue.filter((c) => c.id !== card.id),
                history: [{ ...card, status: "dismissed" }, ...prev.history],
                counts: { ...prev.counts, queue: prev.counts.queue - 1, history: prev.counts.history + 1 },
              };
            }
            return {
              ...prev,
              review: prev.review.filter((c) => c.id !== card.id),
              history: [{ ...card, status: "dismissed" }, ...prev.history],
              counts: { ...prev.counts, review: prev.counts.review - 1, history: prev.counts.history + 1 },
            };
          });
        } else {
          setReportToast((t) => ({ ...t, [card.id]: { ok: false, text: json.error ?? "Не удалось пропустить." } }));
        }
      } catch {
        setReportToast((t) => ({ ...t, [card.id]: { ok: false, text: "Ошибка сети." } }));
      } finally {
        setReportBusy(null);
      }
    },
    [initData]
  );

  // «Сгенерить» on a queue card: one paid API draft. On success the card becomes a normal
  // review card (text + send/edit/skip); a fact-check failure moves it to «Внимание».
  const generateReport = useCallback(
    async (card: ReportCardModel) => {
      setReportBusy({ id: card.id, op: "generate" });
      try {
        const res = await fetch("/api/m/desk/reports/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, jobId: card.id }),
        });
        const json = (await res.json()) as { ok: boolean; outcome?: string; draftText?: string; reason?: string; error?: string };
        if (json.ok && json.outcome === "done") {
          setReportsView((prev) =>
            prev
              ? {
                  ...prev,
                  queue: prev.queue.filter((c) => c.id !== card.id),
                  review: [{ ...card, status: "done", draftText: json.draftText ?? "" }, ...prev.review],
                  counts: { ...prev.counts, queue: prev.counts.queue - 1, review: prev.counts.review + 1 },
                }
              : prev
          );
        } else if (json.ok && json.outcome === "failed") {
          // Draft produced but fact-check rejected it → attention (coach signal, no student text).
          setReportsView((prev) =>
            prev
              ? {
                  ...prev,
                  queue: prev.queue.filter((c) => c.id !== card.id),
                  attention: [{ ...card, status: "failed", draftText: null, attentionReason: json.reason ?? "факт-чек отклонил" }, ...prev.attention],
                  counts: { ...prev.counts, queue: prev.counts.queue - 1, attention: prev.counts.attention + 1 },
                }
              : prev
          );
        } else {
          setReportToast((t) => ({ ...t, [card.id]: { ok: false, text: json.error ?? "Не удалось сгенерировать." } }));
        }
      } catch {
        setReportToast((t) => ({ ...t, [card.id]: { ok: false, text: "Ошибка сети." } }));
      } finally {
        setReportBusy(null);
      }
    },
    [initData]
  );

  // «Сгенерить свежие (до 10)» — top-N by significance. Deliberate two-step: confirm with
  // the count + a cost estimate before spending on a batch, then reload the tab.
  const generateBatch = useCallback(async () => {
    const limit = 10;
    if (typeof window !== "undefined" && !window.confirm(`Сгенерить до ${limit} самых значимых черновиков? Это платный API, ≈ $${(limit * 0.013).toFixed(2)}.`)) {
      return;
    }
    setReportBusy({ id: "__batch__", op: "generate" });
    try {
      const res = await fetch("/api/m/desk/reports/generate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, limit }),
      });
      const json = (await res.json()) as { ok: boolean; done?: number; failed?: number; error?: string };
      setReportBusy(null);
      if (json.ok) {
        await loadReports(initData);
      } else {
        setReportToast((t) => ({ ...t, __batch__: { ok: false, text: json.error ?? "Не удалось сгенерировать пакет." } }));
      }
    } catch {
      setReportBusy(null);
      setReportToast((t) => ({ ...t, __batch__: { ok: false, text: "Ошибка сети." } }));
    }
  }, [initData, loadReports]);

  // «Убрать старше 3 дней» — clear the «Новые» backlog Igor has already answered by hand.
  const bulkDismissOld = useCallback(async () => {
    if (typeof window !== "undefined" && !window.confirm("Убрать из «Новых» все тренировки старше 3 дней (по дате тренировки)? Ничего не удаляется — только уходят из списка.")) {
      return;
    }
    try {
      const res = await fetch("/api/m/desk/reports/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, olderThanDays: 3 }),
      });
      const json = (await res.json()) as { ok: boolean; dismissed?: number; error?: string };
      if (json.ok) await loadReports(initData);
      else setReportToast((t) => ({ ...t, __batch__: { ok: false, text: json.error ?? "Не удалось разобрать очередь." } }));
    } catch {
      setReportToast((t) => ({ ...t, __batch__: { ok: false, text: "Ошибка сети." } }));
    }
  }, [initData, loadReports]);

  // Group send: Business API can't post to a group, so open Telegram's share sheet from
  // Igor's own account (mention prefix → the student gets a notification), then RECORD it as
  // 'shared' (unverified) — unless the kill-switch is off, in which case it's prepare-only.
  const shareToGroup = useCallback(
    async (card: ReportCardModel) => {
      const body = card.draftText ?? "";
      const text = card.mention ? `${card.mention}\n${body}` : body;
      if (typeof window !== "undefined") {
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent("")}&text=${encodeURIComponent(text)}`;
        const tg = getTelegramWebApp();
        if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
        else window.open(shareUrl, "_blank");
      }
      setReportBusy({ id: card.id, op: "send" });
      try {
        const res = await fetch("/api/m/desk/reports/shared", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, jobId: card.id }),
        });
        const json = (await res.json()) as { ok: boolean; outcome?: string; note?: string; error?: string };
        if (json.ok && json.outcome === "shared") {
          setReportsView((prev) =>
            prev
              ? {
                  ...prev,
                  review: prev.review.filter((c) => c.id !== card.id),
                  history: [{ ...card, status: "shared" }, ...prev.history],
                  counts: { ...prev.counts, review: prev.counts.review - 1, history: prev.counts.history + 1 },
                }
              : prev
          );
        } else if (json.ok && json.outcome === "prepared") {
          setReportToast((t) => ({ ...t, [card.id]: { ok: true, tone: "info", text: json.note ?? "Режим подготовки: шаринг открыт, статус не меняю." } }));
        } else {
          setReportToast((t) => ({ ...t, [card.id]: { ok: false, text: json.error ?? "Не удалось отметить." } }));
        }
      } catch {
        setReportToast((t) => ({ ...t, [card.id]: { ok: false, text: "Ошибка сети." } }));
      } finally {
        setReportBusy(null);
      }
    },
    [initData]
  );

  // Coach-only backend toggle (api ⇄ cowork) — flips WHO writes the draft, no redeploy.
  const toggleMode = useCallback(async () => {
    const next = reportsView?.backend === "api" ? "cowork" : "api";
    try {
      const res = await fetch("/api/m/desk/reports/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, set: next }),
      });
      const json = (await res.json()) as { ok: boolean; backend?: "api" | "cowork"; error?: string };
      if (json.ok && json.backend) {
        setReportsView((prev) => (prev ? { ...prev, backend: json.backend! } : prev));
      }
    } catch {
      /* leave as-is; coach can retry */
    }
  }, [initData, reportsView?.backend]);

  const toggleEvent = useCallback((key: string) => {
    setOpenEvents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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
        <h1 style={S.h1}>{tab === "starts" ? "Старты" : tab === "reports" ? "Отчёты" : "Сегодня"}</h1>
        {tab === "starts" ? (
          <p style={S.date}>ближайшие 30 дней{startsView ? ` · ${startsView.counts.events}` : ""}</p>
        ) : tab === "reports" ? (
          <p style={S.date}>черновики ответов ученикам{reportsView ? ` · ${reportsView.counts.review} к отправке` : ""}</p>
        ) : date ? (
          <p style={S.date}>{date}</p>
        ) : null}
        {tab === "today" && status === "ready" ? (
          <p style={S.fresh}>
            🟢 Обновлено{freshAt ? ` в ${freshAt}` : " только что"} · пересчёт при каждом открытии
          </p>
        ) : null}
      </header>

      {tab === "today" && view ? (
        <div style={S.countRow}>
          <span style={S.countChip}>🩺 <span style={S.countN}>{view.counts.check}</span></span>
          <span style={S.countChip}>🦵 <span style={S.countN}>{view.counts.pain}</span></span>
          <span style={S.countChip}>🔁 <span style={S.countN}>{view.counts.moves}</span></span>
        </div>
      ) : null}

      {tab === "starts" ? (
        <StartsTab
          status={startsStatus}
          view={startsView}
          openEvents={openEvents}
          onToggleEvent={toggleEvent}
        />
      ) : tab === "reports" ? (
        <ReportsTab
          status={reportsStatus}
          view={reportsView}
          editingId={editingId}
          editValue={editValue}
          busy={reportBusy}
          toast={reportToast}
          onStartEdit={startEditReport}
          onChangeEdit={setEditValue}
          onSaveEdit={saveEditReport}
          onCancelEdit={cancelEditReport}
          onSend={sendReport}
          onShare={shareToGroup}
          onGenerate={generateReport}
          onGenerateBatch={generateBatch}
          onBulkDismissOld={bulkDismissOld}
          onToggleMode={toggleMode}
          onDismiss={dismissReport}
        />
      ) : tab !== "today" ? (
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
          {view.scanAlert ? (
            <>
              <div style={S.banner}>⚠️ {view.scanAlert}</div>
              <p style={S.softNote}>обновляется после ночного скана</p>
            </>
          ) : null}

          {/* 🩺 Проверить сегодня — illness (closable) + system errors (informational). */}
          <section style={S.section}>
            <div style={S.secHead}>
              <span style={S.secTitle}>🩺 Проверить сегодня</span>
              <span style={S.secCount}>{view.counts.check}</span>
            </div>
            {view.check.length === 0 && view.freshCheck.length === 0 && view.errors.length === 0 ? (
              <p style={S.empty}>Никого проверять — чисто.</p>
            ) : null}
            {view.check.map((c, i) => (
              <div
                key={c.studentId ?? `chk-${i}`}
                style={chatCardStyle(c.telegramUsername)}
                onClick={c.telegramUsername ? () => openStudentChat(c.telegramUsername) : undefined}
              >
                <CardName
                  name={c.name}
                  username={c.telegramUsername}
                  right={c.days !== null ? <span style={S.days}>{daysLabel(c.days)}</span> : null}
                />
                {c.summary ? <p style={S.summary}>{c.summary}</p> : null}
                {c.doubt ? <p style={S.doubtBadge}>⚠️ память сомневается: {c.doubt}</p> : null}
                <div style={S.actionRow}>
                  <button
                    type="button"
                    style={S.closeBtn}
                    disabled={closing.has(`illness:${c.studentId ?? ""}`)}
                    onClick={(e) => {
                      stop(e);
                      handleClose(c.studentId, "illness");
                    }}
                  >
                    {closing.has(`illness:${c.studentId ?? ""}`) ? "Снимаю…" : "Снять"}
                  </button>
                </div>
              </div>
            ))}
            {view.freshCheck.length > 0 ? (
              <>
                <p style={S.softNote}>сообщили сегодня</p>
                {view.freshCheck.map((c, i) => (
                  <div
                    key={c.studentId ?? `fresh-${i}`}
                    style={chatCardStyle(c.telegramUsername)}
                    onClick={c.telegramUsername ? () => openStudentChat(c.telegramUsername) : undefined}
                  >
                    <CardName name={c.name} username={c.telegramUsername} />
                    {c.summary ? <p style={S.summary}>{c.summary}</p> : null}
                    {c.doubt ? <p style={S.doubtBadge}>⚠️ память сомневается: {c.doubt}</p> : null}
                    <div style={S.actionRow}>
                      <button
                        type="button"
                        style={S.closeBtn}
                        disabled={closing.has(`illness:${c.studentId ?? ""}`)}
                        onClick={(e) => {
                          stop(e);
                          handleClose(c.studentId, "illness");
                        }}
                      >
                        {closing.has(`illness:${c.studentId ?? ""}`) ? "Снимаю…" : "Снять"}
                      </button>
                    </div>
                  </div>
                ))}
              </>
            ) : null}
            {view.errors.length > 0 ? (
              <div style={S.errBlock}>
                <p style={S.errHead}>⚠️ Ошибки / сбои · {view.errors.length}</p>
                {view.errors.map((e, i) => (
                  <div key={`err-${i}`} style={S.errCard}>
                    <span style={S.errName}>{e.name ?? "Система"}</span>
                    {e.summary ? <p style={S.errSummary}>{e.summary}</p> : null}
                    {e.dismiss ? (
                      <div style={S.dismissRow}>
                        <span style={S.dismissNote}>в TrainingPeaks ничего не меняется</span>
                        <button
                          type="button"
                          style={S.closeBtn}
                          disabled={dismissing.has(`err:${i}`)}
                          onClick={(ev) => {
                            stop(ev);
                            if (e.dismiss) void handleErrorDismiss(i, e.dismiss);
                          }}
                        >
                          {dismissing.has(`err:${i}`) ? "Снимаю…" : "Снять"}
                        </button>
                      </div>
                    ) : null}
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
                <div
                  key={c.studentId ?? `plan-${i}`}
                  style={chatCardStyle(c.telegramUsername)}
                  onClick={c.telegramUsername ? () => openStudentChat(c.telegramUsername) : undefined}
                >
                  <CardName name={c.name} username={c.telegramUsername} />
                  {c.summary ? <p style={S.summary}>{c.summary}</p> : null}
                  {c.dismiss ? (
                    <div style={S.dismissRow}>
                      <span style={S.dismissNote}>в TrainingPeaks ничего не меняется</span>
                      <button
                        type="button"
                        style={S.closeBtn}
                        disabled={dismissing.has(`plan:${i}`)}
                        onClick={(e) => {
                          stop(e);
                          if (c.dismiss) void handleDismiss(i, c.dismiss);
                        }}
                      >
                        {dismissing.has(`plan:${i}`) ? "Снимаю…" : "Снять"}
                      </button>
                    </div>
                  ) : null}
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
                <div
                  key={c.studentId ?? `pain-${i}`}
                  style={chatCardStyle(c.telegramUsername)}
                  onClick={c.telegramUsername ? () => openStudentChat(c.telegramUsername) : undefined}
                >
                  <CardName name={c.name} username={c.telegramUsername} />
                  {c.summary ? <p style={S.summary}>{c.summary}</p> : null}
                  <p style={S.manualNote}>Закрывается вручную — не уйдёт сама.</p>
                  <div style={S.actionRow}>
                    <button
                      type="button"
                      style={S.closeBtn}
                      disabled={closing.has(`injury:${c.studentId ?? ""}`)}
                      onClick={(e) => {
                        stop(e);
                        handleClose(c.studentId, "injury");
                      }}
                    >
                      {closing.has(`injury:${c.studentId ?? ""}`) ? "Снимаю…" : "Снять"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* 📭 Нет контакта — collapsible tail (tap name → chat). */}
          <CollapsibleNames
            title="📭 Нет контакта"
            rows={view.noContact}
            open={!closedSections.has("noContact")}
            onToggle={() => toggleSection("noContact")}
          />

          {/* 🏃 Нет выполнения — collapsible tail, from nightly workout_cache. */}
          <CollapsibleNames
            title="🏃 Нет выполнения"
            rows={view.missed}
            open={!closedSections.has("missed")}
            onToggle={() => toggleSection("missed")}
            note="обновляется после ночного скана"
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

function StartsTab(props: {
  status: "idle" | "loading" | "ready" | "error";
  view: StartsView | null;
  openEvents: Set<string>;
  onToggleEvent: (key: string) => void;
}) {
  if (props.status === "loading" || props.status === "idle") {
    return <div style={S.bigEmpty}>Загружаю…</div>;
  }
  if (props.status === "error" || !props.view) {
    return <div style={S.bigEmpty}>Не удалось загрузить старты.</div>;
  }
  if (props.view.counts.events === 0) {
    return <div style={S.bigEmpty}>Ближайших стартов нет.</div>;
  }
  return (
    <>
      {props.view.thisWeek.length > 0 ? (
        <>
          <p style={S.groupLabel}>На этой неделе</p>
          {props.view.thisWeek.map((e) => (
            <EventCard
              key={`${e.date}-${e.title}`}
              event={e}
              open={props.openEvents.has(`${e.date}-${e.title}`)}
              onToggle={() => props.onToggleEvent(`${e.date}-${e.title}`)}
            />
          ))}
        </>
      ) : null}
      {props.view.later.length > 0 ? (
        <>
          <p style={S.groupLabel}>Дальше</p>
          {props.view.later.map((e) => (
            <EventCard
              key={`${e.date}-${e.title}`}
              event={e}
              open={props.openEvents.has(`${e.date}-${e.title}`)}
              onToggle={() => props.onToggleEvent(`${e.date}-${e.title}`)}
            />
          ))}
        </>
      ) : null}
    </>
  );
}

function formatEventDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  return m ? `${m[3]}.${m[2]}` : iso;
}

function EventCard(props: { event: StartEvent; open: boolean; onToggle: () => void }) {
  const e = props.event;
  return (
    <div style={S.eventCard(e.thisWeek)}>
      <button type="button" style={S.eventHead} onClick={props.onToggle}>
        <span>
          <span style={S.eventTitle}>{e.title}</span>
          <p style={S.eventMeta}>
            {formatEventDate(e.date)}
            {e.distanceLabel ? ` · ${e.distanceLabel}` : " · дистанция уточняется"}
          </p>
        </span>
        <span style={S.eventWhen(e.thisWeek)}>{daysToLabel(e.daysTo)}</span>
      </button>
      <p style={S.eventCount}>
        {e.athletes.length} {e.athletes.length === 1 ? "ученик" : e.athletes.length >= 2 && e.athletes.length <= 4 ? "ученика" : "учеников"} {props.open ? "▲" : "▼"}
      </p>
      {props.open ? (
        <div style={S.roster}>
          {e.athletes.map((a) => (
            <div key={a.studentId} style={S.rosterRow}>
              <span style={S.rosterName}>{a.name}</span>
              <span style={S.rosterDist}>{a.distance ?? "уточняется"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// A per-student card that taps through to the 1:1 chat when a username exists; dimmed + inert otherwise.
function chatCardStyle(username: string | null): CSSProperties {
  return username ? { ...S.card, cursor: "pointer" } : { ...S.card, ...S.dim };
}

function CardName(props: { name: string; username: string | null; right?: ReactNode }) {
  return (
    <div style={S.cardTop}>
      <span style={S.nameRow}>
        <span style={S.name}>{props.name}</span>
        {props.username ? (
          <span style={S.chatDot}>💬</span>
        ) : (
          <span style={S.noLink}>нет привязки</span>
        )}
      </span>
      {props.right ?? null}
    </div>
  );
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

function CollapsibleNames(props: {
  title: string;
  rows: NameRow[];
  open: boolean;
  onToggle: () => void;
  note?: string;
}) {
  return (
    <section style={S.section}>
      <button type="button" style={S.secHead} onClick={props.onToggle}>
        <span style={S.secTitle}>{props.title}</span>
        <span style={S.secCount}>
          {props.rows.length} {props.rows.length > 0 ? (props.open ? "▲" : "▼") : ""}
        </span>
      </button>
      {props.open ? (
        <>
          {props.note ? <p style={S.softNote}>{props.note}</p> : null}
          {props.rows.length === 0 ? (
            <p style={S.empty}>Пусто.</p>
          ) : (
            <div style={S.chipsWrap}>
              {props.rows.map((r, i) =>
                r.telegramUsername ? (
                  <button
                    key={`${r.name}-${i}`}
                    type="button"
                    style={S.chipTap}
                    onClick={() => openStudentChat(r.telegramUsername)}
                  >
                    {r.name} 💬
                  </button>
                ) : (
                  <span key={`${r.name}-${i}`} style={{ ...S.chip, ...S.dim }}>
                    {r.name}
                  </span>
                )
              )}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
