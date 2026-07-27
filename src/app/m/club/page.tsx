"use client";

import { useCallback, useEffect, useState } from "react";

import { ClubIcon, type ClubIconName } from "@/features/club/icons";
import type {
  ClubBillingView,
  ClubCalendarEntry,
  ClubCalendarView,
  ClubChallengeView,
  ClubDayoffRequest,
  ClubExtendedTopsView,
  ClubFeedItem,
  ClubFeedView,
  ClubFreshness,
  ClubPrediction,
  ClubProfileDetailView,
  ClubPublicProfileView,
  ClubRace,
  ClubRecordsView,
  ClubComment,
  ClubStatisticsView,
  ClubTopRow,
  ClubTrack,
  ClubVolumePoint,
  ClubWish,
  ClubWorkoutDetailView,
} from "@/features/club/types";

type CabinetSection = "races" | "dayoff" | "wishes" | "billing" | "prediction";
const CABINET_META: Record<CabinetSection, { icon: ClubIconName; title: string; path: string }> = {
  races: { icon: "flag", title: "Старты", path: "/api/m/club/races" },
  dayoff: { icon: "moon", title: "Выходные", path: "/api/m/club/dayoff" },
  wishes: { icon: "messageCircle", title: "Пожелания", path: "/api/m/club/wishes" },
  billing: { icon: "creditCard", title: "Оплата", path: "/api/m/club/billing" },
  prediction: { icon: "target", title: "Прогноз старта", path: "/api/m/club/prediction" },
};

// --- Telegram WebApp handle (isolated; does not clash with /m/desk or /m/n) ---
type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  setBackgroundColor?: (c: string) => void;
  setHeaderColor?: (c: string) => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  platform?: string;
  version?: string;
  colorScheme?: "light" | "dark";
  themeParams?: { bg_color?: string };
  initDataUnsafe?: { user?: { id?: number }; start_param?: string };
};

/** Open an external URL in Telegram's in-app browser (falls back to a new tab). */
function openExternalLink(url: string): void {
  const tg = getTelegramWebApp();
  if (tg?.openLink) {
    tg.openLink(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function getTelegramWebApp(): TelegramWebApp | null {
  const tg = (globalThis as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  return tg ?? null;
}

/** Client-side diagnostics — distinguishes «SDK not loaded» vs «SDK loaded, no mini-app data»
 *  vs «launch hash lost before the page ran» (redirect). No secret values are captured. */
function clientDiag(): {
  hasTelegram: boolean;
  hasWebApp: boolean;
  platform: string | null;
  version: string | null;
  initDataLen: number;
  hasUser: boolean;
  hashLen: number;
  hashHasTgData: boolean;
  hasSessionInit: boolean;
  referrerHost: string | null;
} {
  const T = (globalThis as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram;
  const wa = T?.WebApp;
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  let referrerHost: string | null = null;
  try {
    referrerHost = typeof document !== "undefined" && document.referrer ? new URL(document.referrer).host : null;
  } catch {
    referrerHost = null;
  }
  let hasSessionInit = false;
  try {
    hasSessionInit =
      typeof sessionStorage !== "undefined" && (sessionStorage.getItem("__telegram__initParams") ?? "").includes("tgWebAppData");
  } catch {
    hasSessionInit = false;
  }
  return {
    hasTelegram: Boolean(T),
    hasWebApp: Boolean(wa),
    platform: wa?.platform ?? null,
    version: wa?.version ?? null,
    initDataLen: (wa?.initData ?? "").length,
    hasUser: Boolean(wa?.initDataUnsafe?.user?.id),
    // Was the launch hash (#tgWebAppData=…) still present when the page ran?
    // If false while hasWebApp is true, the hash was stripped (redirect) before load.
    hashLen: hash.length,
    hashHasTgData: hash.includes("tgWebAppData"),
    hasSessionInit,
    referrerHost,
  };
}

/** Recover initData when window.Telegram.WebApp.initData is empty — mirrors what
 *  telegram-web-app.js does internally: read it from the launch hash, then from the
 *  SDK's session store (survives in-app navigation after the hash is gone). Returns
 *  "" if neither source has it (genuinely no mini-app launch data). */
function recoverInitData(): string {
  // 1) Launch hash: #tgWebAppData=<urlencoded initData>&tgWebAppVersion=…
  try {
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (h.length > 1) {
      const fromHash = new URLSearchParams(h.slice(1)).get("tgWebAppData");
      if (fromHash) return fromHash;
    }
  } catch {
    /* ignore */
  }
  // 2) The raw SDK persists launch params here after the first load.
  try {
    const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("__telegram__initParams") : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { tgWebAppData?: string };
      if (parsed?.tgWebAppData) return parsed.tgWebAppData;
    }
  } catch {
    /* ignore */
  }
  return "";
}

// --- Themeable "club" palette (Phase 3.4) ---
// C.* are CSS custom-property references so every existing inline style / S.* stays
// unchanged; the actual colours come from `themeVars(theme)` applied to the shell.
// Yellow accent + Oswald are preserved in BOTH themes. Light is the default.
const C = {
  bg: "var(--c-bg)",
  card: "var(--c-card)",
  cardAlt: "var(--c-card-alt)",
  ink: "var(--c-ink)",
  sub: "var(--c-sub)",
  faint: "var(--c-faint)",
  accent: "var(--c-accent)",
  accentInk: "var(--c-accent-ink)",
  line: "var(--c-line)",
  good: "var(--c-good)",
  warn: "var(--c-warn)",
  gold: "var(--c-gold)",
  silver: "var(--c-silver)",
  bronze: "var(--c-bronze)",
};

type Theme = "light" | "dark";

// Real hex per theme (for the CSS custom properties + Telegram chrome, which needs a
// concrete colour, not a var()). Dark == the original club palette.
const THEME_HEX: Record<Theme, Record<string, string>> = {
  light: {
    bg: "#f4f6f9", card: "#ffffff", cardAlt: "#eef1f5", ink: "#131820", sub: "#5b6472",
    faint: "#9aa4b2", accent: "#f5c518", accentInk: "#151a1f", line: "#e3e7ec",
    good: "#1f9e78", warn: "#b57d1c", gold: "#e0a800", silver: "#8b95a3", bronze: "#b0743f",
  },
  dark: {
    bg: "#0e1116", card: "#171b22", cardAlt: "#1e232c", ink: "#f2f4f7", sub: "#9aa4b2",
    faint: "#5b6472", accent: "#f5c518", accentInk: "#0e1116", line: "#252b35",
    good: "#4ec9a5", warn: "#e0a13a", gold: "#f5c518", silver: "#c3ccd8", bronze: "#cd8a54",
  },
};

function themeVars(theme: Theme): React.CSSProperties {
  const h = THEME_HEX[theme];
  return {
    "--c-bg": h.bg, "--c-card": h.card, "--c-card-alt": h.cardAlt, "--c-ink": h.ink,
    "--c-sub": h.sub, "--c-faint": h.faint, "--c-accent": h.accent, "--c-accent-ink": h.accentInk,
    "--c-line": h.line, "--c-good": h.good, "--c-warn": h.warn, "--c-gold": h.gold,
    "--c-silver": h.silver, "--c-bronze": h.bronze,
  } as React.CSSProperties;
}

const HEAD = "var(--font-oswald), var(--font-montserrat), system-ui, sans-serif";
const BODY = "var(--font-montserrat), system-ui, sans-serif";

type Tab = "profile" | "feed" | "challenge" | "records" | "club";
// Phase 3.3 — Profile first, then Лента, Челлендж, Результаты, Клуб.
const TABS: Array<{ key: Tab; icon: ClubIconName; label: string }> = [
  { key: "profile", icon: "user", label: "Профиль" },
  { key: "feed", icon: "newspaper", label: "Лента" },
  { key: "challenge", icon: "flame", label: "Челлендж" },
  { key: "records", icon: "medal", label: "Результаты" },
  { key: "club", icon: "users", label: "Клуб" },
];

type Status = "idle" | "loading" | "ready" | "error";

// --- format helpers ---
function fmtKm(km: number | null): string {
  if (km === null || km <= 0) {
    return "0 км";
  }
  return `${km.toFixed(1).replace(".", ",")} км`;
}
const RU_MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function fmtIsoDate(iso: string | null): string {
  const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/u);
  return m ? `${Number(m[3])} ${RU_MON[Number(m[2]) - 1] ?? ""}` : (iso ?? "");
}
function fmtDuration(sec: number | null): string | null {
  if (!sec || sec <= 0) {
    return null;
  }
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtPace(sec: number | null): string | null {
  if (!sec || sec <= 0) {
    return null;
  }
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")} /км`;
}
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

type Candidate = { studentId: string; displayName: string };

async function apiPost<T>(
  path: string,
  initData: string,
  extra?: Record<string, unknown>
): Promise<{ ok: boolean; view?: T; error?: string; code?: string; candidate?: Candidate }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, ...(extra ?? {}) }),
    });
    const json = (await res.json()) as { ok?: boolean; view?: T; error?: string; code?: string; candidate?: Candidate };
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.error ?? "Ошибка загрузки.", code: json.code, candidate: json.candidate };
    }
    return { ok: true, view: json.view };
  } catch {
    return { ok: false, error: "Нет связи. Попробуй ещё раз." };
  }
}

export default function ClubPage() {
  const [initData, setInitData] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("profile");
  // Phase 3.4: light by default. On first load, honour a saved choice, else the
  // Telegram client's colorScheme (themeParams). Toggle lives in the profile.
  const [theme, setThemeState] = useState<Theme>("light");
  const [freshness, setFreshness] = useState<ClubFreshness | null>(null);
  const [openStudentId, setOpenStudentId] = useState<string | null>(null);
  const [openWorkoutId, setOpenWorkoutId] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<CabinetSection | null>(null);
  const [openCalendar, setOpenCalendar] = useState(false);

  const [feed, setFeed] = useState<ClubFeedView | null>(null);
  const [feedItems, setFeedItems] = useState<ClubFeedItem[]>([]);
  const [feedStatus, setFeedStatus] = useState<Status>("idle");
  const [feedMoreLoading, setFeedMoreLoading] = useState(false);

  const [challenge, setChallenge] = useState<ClubChallengeView | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<Status>("idle");
  const [challengePeriod, setChallengePeriod] = useState<"week" | "month">("week");

  const [records, setRecords] = useState<ClubRecordsView | null>(null);
  const [recordsStatus, setRecordsStatus] = useState<Status>("idle");
  const [recDistance, setRecDistance] = useState<"5k" | "10k" | "21k" | "42k">("10k");

  const [club, setClub] = useState<{ stats: ClubStatisticsView; tops: ClubExtendedTopsView } | null>(null);
  const [clubStatus, setClubStatus] = useState<Status>("idle");

  const [profile, setProfile] = useState<ClubProfileDetailView | null>(null);
  const [profileStatus, setProfileStatus] = useState<Status>("idle");

  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState<Candidate | null>(null);
  const [accessRequested, setAccessRequested] = useState(false);
  const [noInitData, setNoInitData] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [linkOutcome, setLinkOutcome] = useState<"idle" | "rejected" | "conflict">("idle");

  const maybeConfirm = useCallback((r: { code?: string; candidate?: Candidate }): boolean => {
    if (r.code === "needs_confirm" && r.candidate) {
      setNeedsConfirm(r.candidate);
      return true;
    }
    // Unbound on the general link → an access request was recorded server-side.
    // Show a friendly waiting screen (not the red error banner). No club data.
    if (r.code === "needs_request") {
      setAccessRequested(true);
      return true;
    }
    return false;
  }, []);

  const confirmLink = useCallback(async () => {
    if (initData === null) return;
    setConfirming(true);
    const res = await fetch("/api/m/club/confirm-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    })
      .then((r) => r.json())
      .catch(() => ({ ok: false, error: "Ошибка" }));
    setConfirming(false);
    if (res.ok) {
      setNeedsConfirm(null);
      setLinkOutcome("idle");
      // reset every tab so the current one reloads now that we're bound
      setFeedStatus("idle");
      setChallengeStatus("idle");
      setRecordsStatus("idle");
      setClubStatus("idle");
      setProfileStatus("idle");
    } else {
      // Binding failed (collision / already-bound / …) — terminal, no retry.
      setLinkOutcome("conflict");
    }
  }, [initData]);

  const rejectLink = useCallback(async () => {
    if (initData === null) return;
    await fetch("/api/m/club/reject-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    }).catch(() => undefined);
    setLinkOutcome("rejected"); // terminal, no retry
  }, [initData]);

  useEffect(() => {
    // The Telegram Web App SDK is loaded by /m/layout. `beforeInteractive` only
    // takes effect in the ROOT layout (Next.js constraint) — in this nested layout
    // the script can still be loading when this effect first runs, so reading
    // window.Telegram.WebApp once would give null → empty initData → 401 for
    // everyone. Poll briefly until initData is present (or give up → auth error).
    let cancelled = false;
    let applied = false;
    let tries = 0;
    const MAX_TRIES = 100; // ~5s at 50ms - tolerate a slow webview loading the SDK

    const apply = (tg: TelegramWebApp | null, id: string, source: "sdk" | "recovered" | "none") => {
      if (applied || cancelled) return;
      applied = true;
      if (tg) {
        try {
          tg.ready();
          tg.expand();
          // Chrome colour is applied by the theme effect (needs real hex, not var()).
        } catch {
          /* older clients */
        }
      }
      // Log the resolution when the SDK gave nothing: either we recovered initData
      // from the launch hash / session store (source="recovered" — SDK timing/race),
      // or we have nothing at all (source="none" — hash stripped or non-Telegram open).
      // Ship the full client state to the server log so Vercel shows WHY.
      if (source !== "sdk") {
        const diag = { ...clientDiag(), source, recoveredLen: id.length };
        console.warn("[club.client] initData not from SDK", diag);
        void fetch("/api/m/club/clientlog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(diag),
        }).catch(() => undefined);
      }
      if (id === "") {
        setNoInitData(true); // clear screen, not a red error
      }
      setInitData(id);
    };

    const tick = () => {
      if (cancelled) return;
      const tg = getTelegramWebApp();
      const sdkId = tg?.initData ?? "";
      if (sdkId !== "") {
        apply(tg, sdkId, "sdk");
        return;
      }
      // SDK has no initData yet — try recovering it from the launch hash / session store.
      const recovered = recoverInitData();
      if (recovered !== "") {
        apply(tg, recovered, "recovered");
        return;
      }
      tries += 1;
      if (tries >= MAX_TRIES) {
        apply(tg, "", "none"); // give up: real non-Telegram open or genuinely no initData
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve initial theme once: saved choice wins, else the Telegram colorScheme.
  useEffect(() => {
    let initial: Theme = "light";
    try {
      const saved = typeof localStorage !== "undefined" ? localStorage.getItem("club_theme") : null;
      if (saved === "light" || saved === "dark") {
        initial = saved;
      } else {
        const scheme = getTelegramWebApp()?.colorScheme;
        if (scheme === "dark") initial = "dark";
      }
    } catch {
      /* ignore */
    }
    setThemeState(initial);
  }, []);

  // Apply the theme to the Telegram chrome (real hex) whenever it changes.
  useEffect(() => {
    const tg = getTelegramWebApp();
    const hex = THEME_HEX[theme].bg;
    try {
      tg?.setBackgroundColor?.(hex);
      tg?.setHeaderColor?.(hex);
    } catch {
      /* older clients */
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem("club_theme", next);
    } catch {
      /* ignore */
    }
  }, []);

  const loadFeed = useCallback(async () => {
    if (initData === null) return;
    setFeedStatus("loading");
    const r = await apiPost<ClubFeedView>("/api/m/club/feed", initData);
    if (!r.ok || !r.view) {
      if (maybeConfirm(r)) return;
      setError(r.error ?? null);
      setFeedStatus("error");
      return;
    }
    setFeed(r.view);
    setFeedItems(r.view.items);
    setFreshness(r.view.freshness);
    setFeedStatus("ready");
  }, [initData, maybeConfirm]);

  const loadMoreFeed = useCallback(async () => {
    if (initData === null || !feed?.nextCursor) return;
    setFeedMoreLoading(true);
    const r = await apiPost<ClubFeedView>("/api/m/club/feed", initData, { cursor: feed.nextCursor });
    setFeedMoreLoading(false);
    if (r.ok && r.view) {
      setFeedItems((prev) => [...prev, ...r.view!.items]);
      setFeed(r.view);
    }
  }, [initData, feed]);

  const loadChallenge = useCallback(async (periodArg?: "week" | "month") => {
    if (initData === null) return;
    const period = periodArg ?? challengePeriod;
    setChallengeStatus("loading");
    const r = await apiPost<ClubChallengeView>("/api/m/club/challenge", initData, { period });
    if (!r.ok || !r.view) {
      if (maybeConfirm(r)) return;
      setError(r.error ?? null);
      setChallengeStatus("error");
      return;
    }
    setChallenge(r.view);
    setFreshness(r.view.freshness);
    setChallengeStatus("ready");
  }, [initData, maybeConfirm, challengePeriod]);

  const onChallengePeriod = useCallback((p: "week" | "month") => {
    setChallengePeriod(p);
    void loadChallenge(p);
  }, [loadChallenge]);

  const loadRecords = useCallback(async () => {
    if (initData === null) return;
    setRecordsStatus("loading");
    const r = await apiPost<ClubRecordsView>("/api/m/club/records", initData);
    if (!r.ok || !r.view) {
      if (maybeConfirm(r)) return;
      setError(r.error ?? null);
      setRecordsStatus("error");
      return;
    }
    setRecords(r.view);
    setFreshness(r.view.freshness);
    setRecordsStatus("ready");
  }, [initData, maybeConfirm]);

  const loadClub = useCallback(async () => {
    if (initData === null) return;
    setClubStatus("loading");
    const [s, t] = await Promise.all([
      apiPost<ClubStatisticsView>("/api/m/club/statistics", initData),
      apiPost<ClubExtendedTopsView>("/api/m/club/tops", initData),
    ]);
    if (!s.ok || !s.view || !t.ok || !t.view) {
      if (maybeConfirm(s) || maybeConfirm(t)) return;
      setError(s.error ?? t.error ?? null);
      setClubStatus("error");
      return;
    }
    setClub({ stats: s.view, tops: t.view });
    setFreshness(s.view.freshness);
    setClubStatus("ready");
  }, [initData, maybeConfirm]);

  const loadProfile = useCallback(async () => {
    if (initData === null) return;
    setProfileStatus("loading");
    const r = await apiPost<ClubProfileDetailView>("/api/m/club/profile", initData);
    if (!r.ok || !r.view) {
      if (maybeConfirm(r)) return;
      setError(r.error ?? null);
      setProfileStatus("error");
      return;
    }
    setProfile(r.view);
    setFreshness(r.view.freshness);
    setProfileStatus("ready");
  }, [initData, maybeConfirm]);

  useEffect(() => {
    if (initData === null) return;
    if (tab === "feed" && feedStatus === "idle") void loadFeed();
    else if (tab === "challenge" && challengeStatus === "idle") void loadChallenge();
    else if (tab === "records" && recordsStatus === "idle") void loadRecords();
    else if (tab === "club" && clubStatus === "idle") void loadClub();
    else if (tab === "profile" && profileStatus === "idle") void loadProfile();
  }, [
    tab, initData, feedStatus, challengeStatus, recordsStatus, clubStatus, profileStatus,
    loadFeed, loadChallenge, loadRecords, loadClub, loadProfile,
  ]);

  return (
    <div style={{ ...S.shell, ...themeVars(theme) }}>
      <header style={S.header}>
        <h1 style={S.h1}>КЛУБ</h1>
        {freshness?.label ? <span style={S.fresh}>{freshness.label}</span> : null}
      </header>

      {error ? (
        <div style={{ margin: "0 12px 8px", ...S.errorBanner }} onClick={() => setError(null)}>
          {error}
        </div>
      ) : null}

      <main style={S.main}>
        {tab === "feed" ? (
          <FeedTab
            status={feedStatus}
            items={feedItems}
            hasMore={Boolean(feed?.nextCursor)}
            moreLoading={feedMoreLoading}
            onMore={loadMoreFeed}
            onRetry={loadFeed}
            onOpenStudent={setOpenStudentId}
            onOpenWorkout={setOpenWorkoutId}
            initData={initData ?? ""}
          />
        ) : null}
        {tab === "challenge" ? (
          <ChallengeTab status={challengeStatus} view={challenge} onRetry={loadChallenge} onOpenStudent={setOpenStudentId} period={challengePeriod} onPeriod={onChallengePeriod} />
        ) : null}
        {tab === "records" ? (
          <RecordsTab status={recordsStatus} view={records} distance={recDistance} onDistance={setRecDistance} onRetry={loadRecords} onOpenStudent={setOpenStudentId} />
        ) : null}
        {tab === "club" ? (
          <ClubTab status={clubStatus} data={club} onRetry={loadClub} onOpenStudent={setOpenStudentId} />
        ) : null}
        {tab === "profile" ? (
          <ProfileTab status={profileStatus} view={profile} onRetry={loadProfile} initData={initData ?? ""} onOpenSection={setOpenSection} onOpenCalendar={() => setOpenCalendar(true)} theme={theme} onTheme={setTheme} />
        ) : null}
      </main>

      {openSection ? (
        <CabinetOverlay section={openSection} initData={initData ?? ""} onClose={() => setOpenSection(null)} />
      ) : null}

      {openCalendar ? (
        <CalendarOverlay initData={initData ?? ""} onClose={() => setOpenCalendar(false)} />
      ) : null}

      {openStudentId ? (
        <PublicProfileOverlay studentId={openStudentId} initData={initData ?? ""} onClose={() => setOpenStudentId(null)} onOpenWorkout={setOpenWorkoutId} />
      ) : null}

      {openWorkoutId ? (
        <WorkoutDetailOverlay workoutId={openWorkoutId} initData={initData ?? ""} onClose={() => setOpenWorkoutId(null)} />
      ) : null}

      {needsConfirm ? (
        <ConfirmScreen candidate={needsConfirm} confirming={confirming} outcome={linkOutcome} onConfirm={confirmLink} onReject={rejectLink} />
      ) : null}

      {accessRequested ? <RequestSentScreen /> : null}

      {noInitData ? <NoInitDataScreen /> : null}

      <nav style={S.tabBar}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button key={t.key} style={S.tab(active)} onClick={() => setTab(t.key)} type="button">
              <ClubIcon name={t.icon} size={21} strokeWidth={active ? 2.4 : 2} />
              <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500 }}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Monogram({ text, tone, onClick, size = 40 }: { text: string; tone?: string; onClick?: () => void; size?: number }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: size, height: size, borderRadius: 999,
        background: tone ?? C.cardAlt, color: tone ? C.accentInk : C.accent,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: HEAD, fontWeight: 600, fontSize: Math.round(size * 0.375), flexShrink: 0,
        border: `1px solid ${C.line}`, cursor: onClick ? "pointer" : "default",
      }}
    >
      {text}
    </div>
  );
}
function Loading() {
  return <div style={S.state}>Загрузка…</div>;
}
function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={S.state}>
      <div style={{ marginBottom: 12 }}>Не удалось загрузить</div>
      <button style={S.retry} onClick={onRetry} type="button">Повторить</button>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div style={S.state}>{text}</div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: HEAD, fontSize: 18, color: C.ink, fontWeight: 600 }}>{value}</div>
      <div style={{ color: C.sub, fontSize: 11.5 }}>{label}</div>
    </div>
  );
}
// Club statistics tile (item 11): a boxed number + caption, laid out in a grid.
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.statTile}>
      <div style={{ fontFamily: HEAD, fontSize: 22, fontWeight: 700, color: C.ink, lineHeight: 1.1 }}>{value}</div>
      <div style={{ color: C.sub, fontSize: 11.5, marginTop: 3 }}>{label}</div>
    </div>
  );
}
// Primary metric (distance / time / pace) — large value with a small caption below.
function MetricBig({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: HEAD, fontSize: 26, color: C.ink, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      <div style={{ color: C.sub, fontSize: 12, marginTop: 2 }}>{label}</div>
    </div>
  );
}
// Phase 4 — SVG route silhouette from a simplified polyline. No map tiles/keys:
// coordinates are normalised into the bbox and drawn as a stroke, aspect-corrected
// for latitude. Renders nothing when there is no track.
function TrackSilhouette({ track, height }: { track: ClubTrack; height: number }) {
  const { polyline, bbox } = track;
  if (!polyline || polyline.length < 2) return null;
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const cosLat = Math.max(0.01, Math.cos((midLat * Math.PI) / 180));
  const spanLng = Math.max(1e-6, (bbox.maxLng - bbox.minLng) * cosLat);
  const spanLat = Math.max(1e-6, bbox.maxLat - bbox.minLat);
  const aspect = spanLng / spanLat; // width / height
  const VH = 100;
  const VW = Math.max(24, Math.min(400, Math.round(VH * aspect)));
  const pad = 6;
  const pts = polyline
    .map(([lat, lng]) => {
      const x = pad + (((lng - bbox.minLng) * cosLat) / spanLng) * (VW - 2 * pad);
      const y = pad + (1 - (lat - bbox.minLat) / spanLat) * (VH - 2 * pad); // flip: lat up
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <polyline points={pts} fill="none" style={{ stroke: C.accent, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }} />
    </svg>
  );
}

function TrustBadge({ trust }: { trust: "verified" | "preliminary" | "hidden" }) {
  if (trust === "verified") {
    return <span style={{ ...S.badge, color: C.good, borderColor: C.line }}>подтверждён</span>;
  }
  return <span style={{ ...S.badge, color: C.warn, borderColor: C.line }}>предварительно</span>;
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

function FeedTab(props: {
  status: Status;
  items: ClubFeedItem[];
  hasMore: boolean;
  moreLoading: boolean;
  onMore: () => void;
  onRetry: () => void;
  onOpenStudent: (id: string) => void;
  onOpenWorkout: (id: string) => void;
  initData: string;
}) {
  if (props.status === "loading" || props.status === "idle") return <Loading />;
  if (props.status === "error") return <ErrorState onRetry={props.onRetry} />;
  if (props.items.length === 0) return <Empty text="Пока нет завершённых тренировок в клубе" />;
  return (
    <div>
      {props.items.map((item) => (
        <FeedCard key={item.id} item={item} onOpenStudent={props.onOpenStudent} onOpenWorkout={props.onOpenWorkout} initData={props.initData} />
      ))}
      {props.hasMore ? (
        <button style={S.more} onClick={props.onMore} type="button" disabled={props.moreLoading}>
          {props.moreLoading ? "Загрузка…" : "Показать ещё"}
        </button>
      ) : (
        <div style={S.endHint}>Это всё за последнее время</div>
      )}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: HEAD, fontSize: 19, fontWeight: 700, color: C.ink, lineHeight: "21px" }}>{value}</div>
      <div style={{ color: C.sub, fontSize: 11 }}>{label}</div>
    </div>
  );
}

function FeedCard({ item, onOpenStudent, onOpenWorkout, initData }: { item: ClubFeedItem; onOpenStudent: (id: string) => void; onOpenWorkout: (id: string) => void; initData: string }) {
  const [reacted, setReacted] = useState<{ like: boolean; fire: boolean }>({ like: item.mine.like, fire: item.mine.fire });
  const countOf = (kind: "like" | "fire") =>
    item.reactions[kind] + (reacted[kind] === item.mine[kind] ? 0 : reacted[kind] ? 1 : -1);

  // Phase 3.7 mockup: large distance / time / pace / avg pulse as a metrics grid.
  const cells: Array<{ label: string; value: string }> = [];
  if (item.distanceKm && item.distanceKm > 0) cells.push({ label: "дистанция", value: fmtKm(item.distanceKm) });
  const dur = fmtDuration(item.durationSeconds);
  if (dur) cells.push({ label: "время", value: dur });
  const pace = fmtPace(item.paceSecPerKm);
  if (pace) cells.push({ label: "темп", value: pace.replace(" /км", "") });
  if (item.avgHr) cells.push({ label: "ср. пульс", value: `${item.avgHr}` });

  async function react(kind: "like" | "fire") {
    if (!item.reactionsEnabled) return;
    setReacted((r) => ({ ...r, [kind]: !r[kind] }));
    await fetch("/api/m/club/react", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, workoutId: item.id, kind }),
    }).catch(() => undefined);
  }

  return (
    <div style={S.card}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Monogram text={item.monogram} onClick={() => onOpenStudent(item.studentId)} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={S.cardName} onClick={() => onOpenStudent(item.studentId)}>{item.studentDisplayName}</div>
          <div style={S.cardMeta}>{item.typeLabel} · {item.dateLabel}</div>
        </div>
      </div>
      <div style={{ cursor: "pointer" }} onClick={() => onOpenWorkout(item.id)}>
        {item.track ? (
          <div style={{ marginTop: 10, background: C.cardAlt, borderRadius: 10, padding: 6 }}>
            <TrackSilhouette track={item.track} height={72} />
          </div>
        ) : null}
        {item.title ? <div style={{ ...S.cardName, whiteSpace: "normal", marginTop: 10, fontSize: 14, color: C.ink }}>{item.title}</div> : null}
        {cells.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cells.length}, 1fr)`, gap: 10, marginTop: 10 }}>
            {cells.map((c, i) => (<StatCell key={i} label={c.label} value={c.value} />))}
          </div>
        ) : null}
        {item.caption && !item.title ? <div style={S.caption}>{item.caption}</div> : null}
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>Тапни, чтобы открыть тренировку →</div>
      </div>
      <div style={{ ...S.reactRow, opacity: item.reactionsEnabled ? 1 : 0.35 }} aria-hidden={!item.reactionsEnabled}>
        <span style={{ ...S.reactChip, display: "inline-flex", alignItems: "center", gap: 5, color: reacted.like ? C.accent : C.sub }} onClick={() => react("like")}><ClubIcon name="thumbsUp" size={15} /> {countOf("like")}</span>
        <span style={{ ...S.reactChip, display: "inline-flex", alignItems: "center", gap: 5, color: reacted.fire ? C.accent : C.sub }} onClick={() => react("fire")}><ClubIcon name="flame" size={15} /> {countOf("fire")}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Challenge
// ---------------------------------------------------------------------------

function ChallengeTab(props: { status: Status; view: ClubChallengeView | null; onRetry: () => void; onOpenStudent: (id: string) => void; period: "week" | "month"; onPeriod: (p: "week" | "month") => void }) {
  if (props.status === "loading" || props.status === "idle") return <Loading />;
  if (props.status === "error" || !props.view) return <ErrorState onRetry={props.onRetry} />;
  const v = props.view;
  const fmtGoal = (val: number, type: "km" | "workouts") => (type === "km" ? fmtKm(val) : `${val} трен.`);
  return (
    <div>
      {v.challenges.length > 0 ? (
        v.challenges.map((ch) => (
          <div key={ch.id} style={S.card}>
            <div style={S.secHead}>{ch.title}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
              <span style={S.bigNumber}>{ch.goalType === "km" ? ch.clubProgress.toFixed(1).replace(".", ",") : ch.clubProgress}</span>
              <span style={{ color: C.sub, fontSize: 14 }}>из {fmtGoal(ch.goalValue, ch.goalType)}</span>
            </div>
            <div style={S.progressTrack}><div style={{ ...S.progressFill, width: `${ch.progressPct}%` }} /></div>
            <div style={S.cardMeta}>{ch.dateLabel} · осталось {ch.daysLeft} дн{ch.participantScope === "selected" ? ` · участников ${ch.participantCount}` : ""}</div>
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              <Metric label="мой вклад" value={fmtGoal(ch.personalProgress, ch.goalType)} />
              <Metric label="доля клуба" value={`${ch.clubProgress > 0 ? Math.round((ch.personalProgress / ch.clubProgress) * 100) : 0}%`} />
            </div>
          </div>
        ))
      ) : (
        <div style={S.card}>
          <div style={S.secHead}>Клубный километраж · неделя</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
            <span style={S.bigNumber}>{v.clubKm.toFixed(1).replace(".", ",")}</span>
            <span style={{ color: C.sub, fontSize: 14 }}>из {v.goalKm} км</span>
          </div>
          <div style={S.progressTrack}><div style={{ ...S.progressFill, width: `${v.progressPct}%` }} /></div>
          <div style={S.cardMeta}>{v.weekLabel}</div>
          {v.goalMode === "auto" ? <div style={S.okNote}>Цель авто: среднее клуба за 4 недели</div> : null}
          {v.goalMode === "fixture" ? <div style={S.fixtureNote}>Демо-цель. Прогресс - реальный.</div> : null}
        </div>
      )}

      {v.personal ? (
        <div style={S.card}>
          <div style={S.secHead}>Мой вклад · неделя</div>
          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            <Metric label="км за неделю" value={fmtKm(v.personal.contributionKm)} />
            <Metric label="доля клуба" value={`${v.personal.contributionPct}%`} />
            <Metric label="выполнено" value={v.personal.noPlan ? "нет плана" : pct(v.personal.completionPct)} />
          </div>
        </div>
      ) : null}

      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.secHead}>Красавчики {v.performersPeriodLabel} · по проценту выполнения</div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button style={S.pill(props.period === "week")} type="button" onClick={() => props.onPeriod("week")}>Неделя</button>
          <button style={S.pill(props.period === "month")} type="button" onClick={() => props.onPeriod("month")}>Месяц</button>
        </div>
        {v.topPerformers.length === 0 ? (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 8 }}>Пока нет данных {v.performersPeriodLabel}</div>
        ) : (
          v.topPerformers.map((p, i) => (
            <div key={p.studentId} style={S.rankRow(p.isCurrentStudent)}>
              <span style={S.rankBadge(i)}>{i + 1}</span>
              <Monogram text={p.monogram} onClick={() => props.onOpenStudent(p.studentId)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.cardName}>{p.displayName}{p.isCurrentStudent ? " · ты" : ""}</div>
                <div style={S.cardMeta}>{p.noPlan ? `${p.completedCount} тренировок, без плана` : `${p.completedCount} из ${p.plannedCount} тренировок`}</div>
              </div>
              <span style={S.pctBig}>{p.noPlan ? "-" : pct(p.completionPct)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

function RecordsTab(props: {
  status: Status;
  view: ClubRecordsView | null;
  distance: "5k" | "10k" | "21k" | "42k";
  onDistance: (d: "5k" | "10k" | "21k" | "42k") => void;
  onRetry: () => void;
  onOpenStudent: (id: string) => void;
}) {
  if (props.status === "loading" || props.status === "idle") return <Loading />;
  if (props.status === "error" || !props.view) return <ErrorState onRetry={props.onRetry} />;
  const v = props.view;
  const clubTop = v.clubTops.find((c) => c.distanceKey === props.distance);
  const mineAll = v.personal.filter((p) => p.distanceKey === props.distance);
  const mineRace = mineAll.find((p) => p.recordType === "race");
  const mineTraining = mineAll.find((p) => p.recordType === "training_split");

  const recordBlock = (rec: typeof mineAll[number], label: string) => (
    <div style={{ marginTop: 6 }}>
      <div style={S.cardMeta}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
        <span style={S.bigNumber}>{fmtDuration(rec.durationSeconds)}</span>
        {rec.paceSecPerKm ? <span style={{ color: C.sub, fontSize: 14 }}>{fmtPace(rec.paceSecPerKm)}</span> : null}
      </div>
      <div style={S.cardMeta}>{rec.dateLabel}</div>
      <div style={{ marginTop: 8 }}><TrustBadge trust={rec.trust} /></div>
    </div>
  );

  return (
    <div>
      <div style={S.tabsRow}>
        {v.clubTops.map((c) => (
          <button key={c.distanceKey} style={S.pill(c.distanceKey === props.distance)} onClick={() => props.onDistance(c.distanceKey)} type="button">
            {c.distanceLabel}
          </button>
        ))}
      </div>

      <div style={S.card}>
        <div style={{ ...S.secHead, display: "flex", alignItems: "center", gap: 6 }}><ClubIcon name="flag" size={14} />Гонки · {clubTop?.distanceLabel}</div>
        {mineRace ? (
          recordBlock(mineRace, "Подтверждённая гонка")
        ) : (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 6 }}>Пока нет подтверждённых гонок</div>
        )}
      </div>

      <div style={S.card}>
        <div style={{ ...S.secHead, display: "flex", alignItems: "center", gap: 6 }}><ClubIcon name="footprints" size={14} />Лучшие отрезки тренировок · {clubTop?.distanceLabel}</div>
        {mineTraining ? (
          <>
            {recordBlock(mineTraining, "Быстрый отрезок из тренировки")}
            <div style={S.fixtureNote}>Это отрезок из тренировки, не соревновательный результат. Подтверждённый результат появится после забега.</div>
          </>
        ) : (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 6 }}>Нет данных на эту дистанцию</div>
        )}
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Клубный топ · {clubTop?.distanceLabel} · только гонки</div>
        {clubTop && clubTop.rows.length > 0 ? (
          clubTop.rows.map((row) => (
            <div key={`${row.rank}-${row.studentId}`} style={S.rankRow(row.isCurrentStudent)}>
              <span style={S.rankBadge(row.rank - 1)}>{row.rank}</span>
              <Monogram text={row.monogram} onClick={() => props.onOpenStudent(row.studentId)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.cardName}>{row.displayName}{row.isCurrentStudent ? " · ты" : ""}</div>
                <div style={S.cardMeta}>{fmtPace(row.paceSecPerKm) ?? ""}</div>
              </div>
              <span style={S.timeBig}>{fmtDuration(row.durationSeconds)}</span>
            </div>
          ))
        ) : (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 8 }}>Пока нет гонок в данных - топ появится, когда забеги подтянутся в TrainingPeaks</div>
        )}
        {clubTop?.alwaysPreliminary ? <div style={S.fixtureNote}>5 км - только предварительно по методике, в клубный топ не идёт</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Club (stats + extended tops)
// ---------------------------------------------------------------------------

function TopList({ title, rows, onOpenStudent }: { title: string; rows: ClubTopRow[]; onOpenStudent: (id: string) => void }) {
  // Collapsed by default (item 10): the club tab opens compact; tap a top to expand it.
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...S.card, padding: 12 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={S.collapseHead}>
        <span style={S.secHead}>{title}{rows.length > 0 ? ` · ${Math.min(rows.length, 10)}` : ""}</span>
        <span style={{ ...S.chevron, transform: open ? "rotate(90deg)" : "rotate(0deg)" }} />
      </button>
      {open ? (
        rows.length === 0 ? (
          <div style={{ color: C.sub, fontSize: 13, marginTop: 8 }}>Нет данных</div>
        ) : (
          rows.slice(0, 10).map((r, i) => (
            <div key={r.studentId} style={S.rankRowSm(r.isCurrentStudent)}>
              <span style={S.rankBadgeSm(i)}>{i + 1}</span>
              <Monogram text={r.monogram} size={26} onClick={() => onOpenStudent(r.studentId)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.cardNameSm}>{r.displayName}{r.isCurrentStudent ? " · ты" : ""}</div>
              </div>
              <span style={S.timeSm}>{r.value}</span>
            </div>
          ))
        )
      ) : null}
    </div>
  );
}

function ClubTab(props: { status: Status; data: { stats: ClubStatisticsView; tops: ClubExtendedTopsView } | null; onRetry: () => void; onOpenStudent: (id: string) => void }) {
  if (props.status === "loading" || props.status === "idle") return <Loading />;
  if (props.status === "error" || !props.data) return <ErrorState onRetry={props.onRetry} />;
  const { stats, tops } = props.data;
  return (
    <div>
      <div style={{ ...S.card, padding: 12 }}>
        <div style={S.secHead}>Статистика клуба · неделя</div>
        <div style={S.statTiles}>
          <StatTile label="км клуба" value={fmtKm(stats.clubKm)} />
          <StatTile label="активных" value={String(stats.activeCount)} />
          <StatTile label="тренировок" value={String(stats.workoutsCount)} />
          <StatTile label="выполнение" value={pct(stats.avgCompletionPct)} />
        </div>
        <div style={{ ...S.cardMeta, marginTop: 10 }}>
          {stats.weekLabel}
          {stats.weekOverWeekPct !== null ? ` · неделя к неделе ${stats.weekOverWeekPct > 0 ? "+" : ""}${stats.weekOverWeekPct}%` : ""}
        </div>
      </div>
      <TopList title="Топ недели · объём" rows={tops.byVolume} onOpenStudent={props.onOpenStudent} />
      <TopList title="Топ недели · число тренировок" rows={tops.byCount} onOpenStudent={props.onOpenStudent} />
      <TopList title="Топ недели · выполнение плана" rows={tops.byCompletion} onOpenStudent={props.onOpenStudent} />
      <TopList title="Топ · серия дней" rows={tops.byStreak} onOpenStudent={props.onOpenStudent} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile / personal cabinet
// ---------------------------------------------------------------------------

function VolumeChart({ series }: { series: ClubVolumePoint[] }) {
  const w = 320;
  const h = 90;
  const pad = 4;
  const max = Math.max(1, ...series.map((p) => p.km));
  const barW = (w - pad * 2) / Math.max(1, series.length);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ marginTop: 10 }}>
      {series.map((p, i) => {
        const bh = Math.round((p.km / max) * (h - 16));
        const x = pad + i * barW;
        const y = h - bh - 2;
        return (
          <g key={i}>
            <rect x={x + 1} y={y} width={Math.max(2, barW - 3)} height={Math.max(1, bh)} rx={2} style={{ fill: i === series.length - 1 ? C.accent : C.cardAlt, stroke: C.line, strokeWidth: 0.5 }} />
          </g>
        );
      })}
    </svg>
  );
}

// One entry card in «Мои разделы» / «Кабинет»: icon badge + title + subtitle + chevron.
function SectionCard({ icon, title, subtitle, onClick }: { icon: ClubIconName; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button type="button" style={S.sectionCard} onClick={onClick}>
      <span style={S.sectionIconWrap}><ClubIcon name={icon} size={20} color={C.accent} /></span>
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <span style={{ display: "block", fontFamily: HEAD, fontSize: 15, fontWeight: 600, color: C.ink }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: C.sub, whiteSpace: "normal" }}>{subtitle}</span>
      </span>
      <ClubIcon name="chevronRight" size={18} color={C.faint} />
    </button>
  );
}

function ProfileTab(props: { status: Status; view: ClubProfileDetailView | null; onRetry: () => void; initData: string; onOpenSection: (s: CabinetSection) => void; onOpenCalendar: () => void; theme: Theme; onTheme: (t: Theme) => void }) {
  const [privacyMsg, setPrivacyMsg] = useState<string | null>(null);
  const [visible, setVisibleState] = useState<boolean | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  if (props.status === "loading" || props.status === "idle") return <Loading />;
  if (props.status === "error" || !props.view) return <ErrorState onRetry={props.onRetry} />;
  const v = props.view;
  const current = visible ?? v.clubVisible;
  const nameValue = nameDraft ?? v.displayName;

  async function saveName() {
    setNameSaving(true);
    const res = await fetch("/api/m/club/display-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: props.initData, name: nameValue }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "Ошибка" }));
    setNameSaving(false);
    setNameMsg(res.ok ? "Имя обновлено" : (res.error ?? "Недоступно"));
  }

  async function setVisibility(next: boolean) {
    setVisibleState(next);
    const res = await fetch("/api/m/club/privacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: props.initData, visible: next }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "Ошибка" }));
    if (!res.ok) {
      setVisibleState(v.clubVisible); // revert optimistic toggle
    }
    setPrivacyMsg(res.ok ? (next ? "Ты в клубной ленте" : "Скрыт из клубной ленты") : (res.error ?? "Недоступно"));
  }

  return (
    <div>
      <div style={S.card}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 999, background: C.accent, color: C.accentInk, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 20, flexShrink: 0 }}>{v.monogram}</div>
          <div>
            <div style={{ fontFamily: HEAD, fontSize: 22, color: C.ink, fontWeight: 600 }}>{v.displayName}</div>
            <div style={S.cardMeta}>{v.challengeRank ? `Место в челлендже: ${v.challengeRank} из ${v.challengeParticipants}` : "Челлендж недели: нет данных"}</div>
          </div>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Metric label="км за неделю" value={fmtKm(v.weekKm)} />
          <Metric label="км за месяц" value={fmtKm(v.monthKm)} />
          <Metric label="км за год" value={fmtKm(v.yearKm)} />
          <Metric label="серия дней" value={String(v.streakDays)} />
        </div>
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Объём по неделям</div>
        <VolumeChart series={v.weeklySeries} />
        <div style={S.cardMeta}>{v.bestWeekLabel ? `Лучшая неделя: ${fmtKm(v.bestWeekKm)} (${v.bestWeekLabel})` : "Нет данных по неделям"}</div>
      </div>

      {v.typeBreakdown.length > 0 ? (
        <div style={S.card}>
          <div style={S.secHead}>По типам тренировок</div>
          {v.typeBreakdown.map((t) => (
            <div key={t.family} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "12px 0", borderTop: `1px solid ${C.line}` }}>
              <span style={{ flex: 1, color: C.ink, fontSize: 17, fontWeight: 600, fontFamily: HEAD }}>{t.label}</span>
              <span style={{ fontFamily: HEAD, fontSize: 20, fontWeight: 700, color: C.accent }}>{t.count}</span>
              <span style={{ color: C.sub, fontSize: 12 }}>трен.</span>
              {t.km > 0 ? <span style={{ fontFamily: HEAD, fontSize: 16, color: C.ink, marginLeft: 8 }}>{fmtKm(t.km)}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div style={S.card}>
        <div style={S.secHead}>Выполнение плана · неделя</div>
        <div style={{ marginTop: 6 }}><span style={S.bigNumber}>{v.noPlan ? "нет плана" : pct(v.completionPct)}</span></div>
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Достижения</div>
        <div style={{ marginTop: 8 }}>
          {v.achievements.map((a) => {
            const pctDone = a.progress && a.progress.target > 0 ? Math.min(100, Math.round((a.progress.current / a.progress.target) * 100)) : (a.earned ? 100 : 0);
            return (
              <div key={a.code} style={{ padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-flex" }}><ClubIcon name={a.earned ? "medal" : "lock"} size={16} color={a.earned ? C.accent : C.faint} /></span>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: a.earned ? C.ink : C.sub }}>{a.title}</span>
                  {a.progress ? <span style={{ fontFamily: HEAD, fontSize: 13, color: a.earned ? C.accent : C.sub }}>{a.progress.current}/{a.progress.target} {a.progress.unit}</span> : (a.earned ? <span style={{ fontSize: 12, color: C.good }}>получено</span> : null)}
                </div>
                <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>{a.hint}</div>
                {!a.earned ? (
                  <div style={{ height: 5, background: C.cardAlt, borderRadius: 999, marginTop: 6, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pctDone}%`, background: C.accent }} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Личные результаты</div>
        {v.records.length === 0 ? (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 8 }}>Пока нет данных</div>
        ) : (
          v.records.map((r) => (
            <div key={`${r.distanceKey}-${r.recordType}`} style={S.recRow}>
              <span style={{ width: 18, display: "inline-flex" }}><ClubIcon name={r.recordType === "race" ? "flag" : "footprints"} size={13} color={C.sub} /></span>
              <span style={{ fontFamily: HEAD, fontSize: 15, color: C.ink, width: 64 }}>{r.distanceLabel}</span>
              <span style={{ flex: 1, fontFamily: HEAD, fontSize: 17, color: C.ink }}>{fmtDuration(r.durationSeconds)}</span>
              <span style={{ color: r.trust === "verified" ? C.good : C.warn, fontSize: 12 }}>{r.trust === "verified" ? "подтв." : "предв."}</span>
            </div>
          ))
        )}
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Мои разделы</div>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <SectionCard icon="flag" title="Старты" subtitle="Добавить забег и посмотреть свои" onClick={() => props.onOpenSection("races")} />
          <SectionCard icon="calendar" title="Расписание" subtitle="Дни без тренировок и пожелания по типу" onClick={props.onOpenCalendar} />
          <SectionCard icon="messageCircle" title="Пожелания" subtitle="Свободный фидбек тренеру" onClick={() => props.onOpenSection("wishes")} />
        </div>
        <div style={S.hint}>Всё уходит тренеру на подтверждение - в TrainingPeaks ничего не пишется автоматически.</div>
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Кабинет</div>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <SectionCard icon="target" title="Прогноз старта" subtitle="Ожидаемый результат на ближайший старт" onClick={() => props.onOpenSection("prediction")} />
          <SectionCard icon="creditCard" title="Оплата" subtitle="Статус, история и оплата" onClick={() => props.onOpenSection("billing")} />
        </div>
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Тема</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button style={S.pill(props.theme === "light")} type="button" onClick={() => props.onTheme("light")}><span style={S.pillInner}><ClubIcon name="sun" size={16} />Светлая</span></button>
          <button style={S.pill(props.theme === "dark")} type="button" onClick={() => props.onTheme("dark")}><span style={S.pillInner}><ClubIcon name="moon" size={16} />Тёмная</span></button>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Имя в клубе</div>
        <input
          style={{ ...S.input, marginTop: 10, marginBottom: 8 }}
          value={nameValue}
          maxLength={40}
          onChange={(e) => setNameDraft(e.target.value)}
          placeholder="Как показывать тебя в клубе"
        />
        <button style={{ ...S.saveBtn, opacity: nameSaving ? 0.6 : 1 }} type="button" disabled={nameSaving} onClick={saveName}>
          {nameSaving ? "Сохраняю…" : "Сохранить имя"}
        </button>
        {nameMsg ? <div style={S.cardMeta}>{nameMsg}</div> : null}
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Видимость в клубе</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button style={S.pill(current === true)} type="button" onClick={() => setVisibility(true)}>Участвую</button>
          <button style={S.pill(current === false)} type="button" onClick={() => setVisibility(false)}>Скрыть меня</button>
        </div>
        {!v.privacyEnabled ? <div style={S.cardMeta}>Управление видимостью включит тренер</div> : null}
        {privacyMsg ? <div style={S.cardMeta}>{privacyMsg}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public profile overlay
// ---------------------------------------------------------------------------

function PublicProfileOverlay({ studentId, initData, onClose, onOpenWorkout }: { studentId: string; initData: string; onClose: () => void; onOpenWorkout: (id: string) => void }) {
  const [view, setView] = useState<ClubPublicProfileView | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await apiPost<ClubPublicProfileView>("/api/m/club/public-profile", initData, { studentId });
      if (!alive) return;
      if (r.ok && r.view) {
        setView(r.view);
        setStatus("ready");
      } else {
        setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [studentId, initData]);

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontFamily: HEAD, fontSize: 18, color: C.ink }}>Профиль</span>
          <button style={S.closeBtn} onClick={onClose} type="button" aria-label="Закрыть"><ClubIcon name="x" size={15} /></button>
        </div>
        {status === "loading" ? <Loading /> : null}
        {status === "error" ? <Empty text="Не удалось загрузить профиль" /> : null}
        {status === "ready" && view ? (
          !view.visible ? (
            <Empty text="Этот участник скрыл свой профиль" />
          ) : (
            <div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 999, background: C.accent, color: C.accentInk, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 17 }}>{view.monogram}</div>
                <div style={{ fontFamily: HEAD, fontSize: 20, color: C.ink }}>{view.displayName}</div>
              </div>
              <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
                <Metric label="км за неделю" value={fmtKm(view.weekKm)} />
                <Metric label="км за месяц" value={fmtKm(view.monthKm)} />
                <Metric label="серия дней" value={String(view.streakDays)} />
              </div>
              {view.weeklySeries.some((p) => p.km > 0) ? (
                <div style={{ marginBottom: 14 }}>
                  <div style={S.secHead}>Объём по неделям</div>
                  <VolumeChart series={view.weeklySeries} />
                </div>
              ) : null}
              {view.records.length > 0 ? (
                <div style={{ marginBottom: 14 }}>
                  <div style={S.secHead}>Личные результаты</div>
                  {view.records.map((r) => (
                    <div key={`${r.distanceKey}-${r.recordType}`} style={S.recRow}>
                      <span style={{ width: 16, display: "inline-flex" }}><ClubIcon name={r.recordType === "race" ? "flag" : "footprints"} size={12} color={C.sub} /></span>
                      <span style={{ fontFamily: HEAD, fontSize: 14, color: C.ink, width: 60 }}>{r.distanceLabel}</span>
                      <span style={{ flex: 1, fontFamily: HEAD, fontSize: 16, color: C.ink }}>{fmtDuration(r.durationSeconds)}</span>
                      <span style={{ color: r.trust === "verified" ? C.good : C.warn, fontSize: 12 }}>{r.trust === "verified" ? "подтв." : "предв."}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div style={S.secHead}>Последние тренировки</div>
              {view.recentFeed.map((it) => (
                <div key={it.id} style={{ ...S.recRow, cursor: "pointer" }} onClick={() => onOpenWorkout(it.id)}>
                  <span style={{ flex: 1, color: C.ink, fontSize: 14 }}>{it.typeLabel} · {it.dateLabel}</span>
                  <span style={{ color: C.sub, fontSize: 13 }}>{it.distanceKm ? fmtKm(it.distanceKm) : (fmtDuration(it.durationSeconds) ?? "")}</span>
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workout detail (Phase 3.8) — tap a feed card
// ---------------------------------------------------------------------------

function LapBars({ values }: { values: Array<number | null> }) {
  const nums = values.filter((v): v is number => v != null && v > 0);
  if (nums.length === 0) return null;
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = Math.max(1, max - min);
  const w = 320;
  const h = 46;
  const barW = (w - 2) / Math.max(1, values.length);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ marginTop: 6 }}>
      {values.map((v, i) => {
        if (v == null || v <= 0) return null;
        // Normalise within [min,max] so differences between laps are visible.
        const bh = 6 + Math.round(((v - min) / span) * (h - 12));
        const x = 1 + i * barW;
        return <rect key={i} x={x + 1} y={h - bh} width={Math.max(2, barW - 2)} height={bh} rx={2} style={{ fill: C.accent }} opacity={0.85} />;
      })}
    </svg>
  );
}

function WorkoutDetailOverlay({ workoutId, initData, onClose }: { workoutId: string; initData: string; onClose: () => void }) {
  const [view, setView] = useState<ClubWorkoutDetailView | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await apiPost<ClubWorkoutDetailView>("/api/m/club/workout", initData, { workoutId });
      if (!alive) return;
      if (r.ok && r.view) {
        setView(r.view);
        setStatus("ready");
      } else {
        setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [workoutId, initData]);

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontFamily: HEAD, fontSize: 18, color: C.ink }}>Тренировка</span>
          <button style={S.closeBtn} onClick={onClose} type="button" aria-label="Закрыть"><ClubIcon name="x" size={15} /></button>
        </div>
        {status === "loading" ? <Loading /> : null}
        {status === "error" ? <Empty text="Тренировка недоступна" /> : null}
        {status === "ready" && view ? (
          <div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 4 }}>
              <Monogram text={view.monogram} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: HEAD, fontSize: 17, color: C.ink }}>{view.studentDisplayName}</div>
                <div style={S.cardMeta}>{view.typeLabel} · {view.dateLabel}</div>
              </div>
            </div>
            {view.title ? <div style={{ ...S.cardName, whiteSpace: "normal", marginTop: 8, marginBottom: 4 }}>{view.title}</div> : null}

            {view.track ? (
              <div style={{ ...S.card, padding: 12 }}>
                <div style={S.secHead}>Маршрут</div>
                <TrackSilhouette track={view.track} height={180} />
              </div>
            ) : null}

            <div style={S.card}>
              <div style={S.metricPrimary}>
                <MetricBig label="дистанция" value={view.distanceKm ? fmtKm(view.distanceKm) : "-"} />
                <MetricBig label="время" value={fmtDuration(view.durationSeconds) ?? "-"} />
                <MetricBig label="темп" value={fmtPace(view.paceSecPerKm) ?? "-"} />
              </div>
              {view.avgHr || view.maxHr || view.avgCadence || view.ascentM ? (
                <div style={S.metricSecondary}>
                  {view.avgHr ? <Metric label="ср. пульс" value={`${view.avgHr}`} /> : null}
                  {view.maxHr ? <Metric label="макс. пульс" value={`${view.maxHr}`} /> : null}
                  {view.avgCadence ? <Metric label={view.isRunning ? "каденс, шаг/мин" : "каденс, об/мин"} value={`${view.avgCadence}`} /> : null}
                  {view.ascentM ? <Metric label="набор" value={`${view.ascentM} м`} /> : null}
                </div>
              ) : null}
            </div>

            {view.laps.length > 0 ? (
              <div style={S.card}>
                <div style={S.secHead}>Разбивка по кругам</div>
                <div style={{ marginTop: 8 }}>
                  {view.laps.map((l) => (
                    <div key={l.index} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: l.index > 1 ? `1px solid ${C.line}` : "none" }}>
                      <span style={{ width: 22, color: C.faint, fontFamily: HEAD, fontSize: 13 }}>{l.index}</span>
                      <span style={{ width: 58, color: C.ink, fontSize: 13 }}>{l.distanceKm ? fmtKm(l.distanceKm) : "-"}</span>
                      <span style={{ width: 52, color: C.sub, fontSize: 13 }}>{fmtDuration(l.durationSeconds) ?? "-"}</span>
                      <span style={{ flex: 1, color: C.ink, fontSize: 13 }}>{fmtPace(l.paceSecPerKm)?.replace(" /км", "") ?? "-"}</span>
                      <span style={{ width: 44, textAlign: "right", color: C.sub, fontSize: 13 }}>{l.avgHr ? `${l.avgHr}` : "-"}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}>
                  <div style={S.cardMeta}>Темп по кругам</div>
                  <LapBars values={view.laps.map((l) => (l.paceSecPerKm ? -l.paceSecPerKm : null))} />
                </div>
                {view.laps.some((l) => l.avgHr) ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={S.cardMeta}>Пульс по кругам</div>
                    <LapBars values={view.laps.map((l) => l.avgHr)} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {view.commentsEnabled ? <WorkoutComments workoutId={view.id} initData={initData} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Phase D — comments on a workout. Fetches on mount; supports add / edit / delete of
// the caller's own comment. The server authorizes by initData (student_id from the
// resolver) and returns the fresh list after every write, so the client just mirrors it.
function WorkoutComments({ workoutId, initData }: { workoutId: string; initData: string }) {
  const [comments, setComments] = useState<ClubComment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(payload: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/m/club/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, ...payload }),
      });
      const json = (await res.json()) as { ok?: boolean; comments?: ClubComment[]; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "Не удалось.");
        return;
      }
      if (Array.isArray(json.comments)) setComments(json.comments);
    } catch {
      setErr("Нет связи. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/m/club/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, action: "list", workoutId }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; comments?: ClubComment[] };
      if (!alive) return;
      if (json.ok && Array.isArray(json.comments)) setComments(json.comments);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [workoutId, initData]);

  async function add() {
    const text = draft.trim();
    if (!text || busy) return;
    await call({ action: "create", workoutId, body: text });
    setDraft("");
  }
  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text || busy) return;
    await call({ action: "edit", commentId: id, body: text });
    setEditingId(null);
    setEditText("");
  }

  return (
    <div style={S.card}>
      <div style={S.secHead}>Комментарии{comments.length > 0 ? ` · ${comments.length}` : ""}</div>
      <div style={{ marginTop: 8 }}>
        {loaded && comments.length === 0 ? <div style={{ ...S.cardMeta, marginTop: 4 }}>Пока нет комментариев.</div> : null}
        {comments.map((c) => (
          <div key={c.id} style={{ padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: HEAD, fontSize: 14, color: C.ink }}>{c.authorName}</span>
              <span style={{ fontSize: 11, color: C.faint }}>{c.dateLabel}{c.edited ? ", изм." : ""}</span>
            </div>
            {editingId === c.id ? (
              <div style={{ marginTop: 6 }}>
                <textarea style={{ ...S.input, minHeight: 44 }} value={editText} maxLength={500} onChange={(e) => setEditText(e.target.value)} />
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button type="button" style={S.smallPrimaryBtn} disabled={busy} onClick={() => saveEdit(c.id)}>Сохранить</button>
                  <button type="button" style={S.smallBtn} onClick={() => { setEditingId(null); setEditText(""); }}>Отмена</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 14, color: C.ink, marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.body}</div>
                {c.mine ? (
                  <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                    <span style={S.linkAction} onClick={() => { setEditingId(c.id); setEditText(c.body); }}>Изменить</span>
                    <span style={S.linkAction} onClick={() => call({ action: "delete", commentId: c.id })}>Удалить</span>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <textarea style={{ ...S.input, minHeight: 44 }} placeholder="Написать комментарий" value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
          {err ? <span style={{ fontSize: 12, color: "#d9534f" }}>{err}</span> : <span />}
          <button type="button" style={S.smallPrimaryBtn} disabled={busy || !draft.trim()} onClick={add}>Отправить</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar (Phase 5) — 45-day forward calendar: day-off / preference / note / race
// ---------------------------------------------------------------------------

const PREF_LABEL: Record<string, string> = { long: "Длительная", intervals: "Интервальная", rest: "Отдых" };
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function entryMarks(entries: ClubCalendarEntry[]): ClubIconName[] {
  const marks: ClubIconName[] = [];
  if (entries.some((e) => e.kind === "day_off")) marks.push("moon");
  if (entries.some((e) => e.kind === "preference")) marks.push("target");
  if (entries.some((e) => e.kind === "note")) marks.push("stickyNote");
  if (entries.some((e) => e.kind === "race")) marks.push("flag");
  return marks;
}

function CalendarOverlay({ initData, onClose }: { initData: string; onClose: () => void }) {
  const [view, setView] = useState<ClubCalendarView | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [wishNote, setWishNote] = useState("");
  const [wishMsg, setWishMsg] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const reload = useCallback(async (extra?: Record<string, unknown>) => {
    const res = await fetch("/api/m/club/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, ...(extra ?? {}) }),
    });
    const json = await res.json().catch(() => ({ ok: false }));
    if (res.status === 503) {
      setStatus("error");
      setMsg("Календарь пока не активен.");
      return;
    }
    if (res.ok && json.ok && json.view) {
      setView(json.view as ClubCalendarView);
      setStatus("ready");
    } else {
      setMsg(json.error ?? null);
      if (!view) setStatus("error");
    }
  }, [initData, view]);

  useEffect(() => { void reload(); }, [reload]);

  async function create(entry: Record<string, unknown>) {
    setSaving(true);
    setMsg(null);
    await reload({ action: "create", entry });
    setSaving(false);
    setForm({});
  }
  async function remove(entryId: string) {
    setSaving(true);
    await reload({ action: "delete", entryId });
    setSaving(false);
  }
  async function sendWish() {
    if (!wishNote.trim()) return;
    setSaving(true);
    const res = await fetch("/api/m/club/wishes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, action: "create", wish: { note: wishNote } }),
    }).then((r) => r.json()).catch(() => ({ ok: false }));
    setSaving(false);
    setWishMsg(res.ok ? "Пожелание отправлено тренеру" : "Раздел пожеланий пока не активен");
    if (res.ok) setWishNote("");
  }

  const selDay = view?.days.find((d) => d.date === selected) ?? null;
  const pad = view && view.days.length > 0 ? view.days[0].weekday : 0;

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: HEAD, fontSize: 18, color: C.ink }}><ClubIcon name="calendar" size={19} />Расписание · 45 дней</span>
          <button style={S.closeBtn} onClick={onClose} type="button" aria-label="Закрыть"><ClubIcon name="x" size={15} /></button>
        </div>
        {status === "loading" ? <Loading /> : null}
        {status === "error" ? <Empty text={msg ?? "Не удалось загрузить"} /> : null}
        {status === "ready" && view ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
              {WEEKDAY_LABELS.map((w) => (<div key={w} style={{ textAlign: "center", fontSize: 10, color: C.faint }}>{w}</div>))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
              {Array.from({ length: pad }).map((_, i) => (<div key={`pad${i}`} />))}
              {view.days.map((d) => {
                const active = d.date === selected;
                const marks = entryMarks(d.entries);
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => { setSelected(d.date); setForm({}); setMsg(null); }}
                    style={{
                      aspectRatio: "1", borderRadius: 8, border: `1px solid ${active ? C.accent : C.line}`,
                      background: active ? "rgba(245,197,24,0.12)" : d.isToday ? C.cardAlt : C.card,
                      color: C.ink, cursor: "pointer", display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center", gap: 1, padding: 0,
                    }}
                  >
                    <span style={{ fontSize: 13, fontFamily: HEAD, fontWeight: d.isToday ? 700 : 500, color: d.isToday ? C.accent : C.ink }}>{d.date.slice(8)}</span>
                    <span style={{ display: "flex", gap: 1, height: 10, alignItems: "center", color: C.sub }}>{marks.map((m, i) => <ClubIcon key={i} name={m} size={9} />)}</span>
                  </button>
                );
              })}
            </div>

            {view.raceSuggestions.length > 0 ? (
              <div style={{ ...S.formCard, marginTop: 12 }}>
                <div style={S.secHead}>Известные забеги - тапни, чтобы заявить</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {view.raceSuggestions.map((sug, i) => (
                    <button
                      key={`${sug.date}-${i}`}
                      type="button"
                      style={{ ...S.sectionBtn, display: "inline-flex", alignItems: "center", gap: 6 }}
                      onClick={() => {
                        setSelected(sug.date);
                        setForm({ rname: sug.title, rdist: sug.distanceLabel ?? "" });
                        setMsg(null);
                      }}
                    >
                      <ClubIcon name="flag" size={14} /> {sug.title} · {sug.dateLabel}{sug.distanceLabel ? ` · ${sug.distanceLabel}` : ""}
                    </button>
                  ))}
                </div>
                <div style={S.hint}>Подставит название и дистанцию в форму забега выбранного дня — останется подтвердить.</div>
              </div>
            ) : null}

            {selDay ? (
              <div style={{ ...S.formCard, marginTop: 12 }}>
                <div style={{ fontFamily: HEAD, fontSize: 16, color: C.ink, marginBottom: 8 }}>{selDay.dateLabel}</div>

                {selDay.entries.length > 0 ? (
                  <div style={{ marginBottom: 10 }}>
                    {selDay.entries.map((e) => (
                      <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${C.line}` }}>
                        <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.ink }}>
                          <ClubIcon name={e.kind === "day_off" ? "moon" : e.kind === "preference" ? "target" : e.kind === "note" ? "stickyNote" : "flag"} size={13} color={C.sub} />
                          <span style={{ minWidth: 0 }}>
                            {e.kind === "day_off" ? "Выходной" : null}
                            {e.kind === "preference" ? (PREF_LABEL[e.preferredType ?? ""] ?? e.preferredType) : null}
                            {e.kind === "note" ? e.note : null}
                            {e.kind === "race" ? `${e.raceName}${e.raceCity ? ` · ${e.raceCity}` : ""}${e.raceDistanceLabel ? ` · ${e.raceDistanceLabel}` : ""}` : null}
                          </span>
                        </span>
                        <span style={{ fontSize: 10.5, color: e.status === "approved" || e.status === "applied" ? C.good : C.sub }}>
                          {e.status === "pending" ? "на подтв." : e.status === "approved" ? "подтв." : e.status === "applied" ? "в TP" : "отклонён"}
                        </span>
                        {e.status === "pending" ? (
                          <button type="button" style={{ ...S.reactChip, cursor: "pointer", display: "inline-flex", alignItems: "center" }} onClick={() => remove(e.id)} aria-label="Удалить"><ClubIcon name="x" size={13} /></button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  <button type="button" style={{ ...S.sectionBtn, display: "inline-flex", alignItems: "center", gap: 6 }} disabled={saving} onClick={() => create({ date: selDay.date, kind: "day_off" })}><ClubIcon name="moon" size={14} />Выходной</button>
                  {(["long", "intervals", "rest"] as const).map((p) => (
                    <button key={p} type="button" style={{ ...S.sectionBtn, display: "inline-flex", alignItems: "center", gap: 6 }} disabled={saving} onClick={() => create({ date: selDay.date, kind: "preference", preferredType: p })}><ClubIcon name="target" size={14} />{PREF_LABEL[p]}</button>
                  ))}
                </div>

                <textarea style={{ ...S.input, minHeight: 44 }} placeholder="Заметка на этот день" value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} />
                <button type="button" style={{ ...S.saveBtn, marginBottom: 10 }} disabled={saving || !(form.note ?? "").trim()} onClick={() => create({ date: selDay.date, kind: "note", note: form.note })}>Добавить заметку</button>

                <div style={{ fontSize: 12, color: C.faint, margin: "6px 0" }}>Забег на этот день:</div>
                <input style={S.input} placeholder="Точное название забега *" value={form.rname ?? ""} onChange={(e) => set("rname", e.target.value)} />
                <input style={S.input} placeholder="Город" value={form.rcity ?? ""} onChange={(e) => set("rcity", e.target.value)} />
                <input style={S.input} placeholder="Дистанция (напр. 21.1 км)" value={form.rdist ?? ""} onChange={(e) => set("rdist", e.target.value)} />
                <input style={S.input} placeholder="Целевое время чч:мм:сс" value={form.rtarget ?? ""} onChange={(e) => set("rtarget", e.target.value)} />
                <input style={S.input} placeholder="Пожелания к забегу" value={form.rnote ?? ""} onChange={(e) => set("rnote", e.target.value)} />
                <button type="button" style={S.saveBtn} disabled={saving || !(form.rname ?? "").trim()} onClick={() => create({ date: selDay.date, kind: "race", raceName: form.rname, raceCity: form.rcity, raceDistanceLabel: form.rdist, raceTarget: form.rtarget, note: form.rnote })}>Заявить забег</button>

                {msg ? <div style={{ ...S.cardMeta, color: C.warn }}>{msg}</div> : null}
              </div>
            ) : (
              <div style={{ ...S.cardMeta, marginTop: 10 }}>Тапни день, чтобы отметить выходной, пожелание, заметку или забег.</div>
            )}

            <div style={{ ...S.formCard, marginTop: 12 }}>
              <div style={S.secHead}>Общие пожелания по процессу</div>
              <textarea style={{ ...S.input, minHeight: 56, marginTop: 8 }} placeholder="Что хочется поменять в тренировках в целом?" value={wishNote} onChange={(e) => setWishNote(e.target.value)} />
              <button type="button" style={S.saveBtn} disabled={saving || !wishNote.trim()} onClick={sendWish}>Отправить пожелание</button>
              {wishMsg ? <div style={S.cardMeta}>{wishMsg}</div> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cabinet sections (races / day-off / wishes / billing / prediction)
// ---------------------------------------------------------------------------

function parseHms(v: string): number | null {
  const parts = v.trim().split(":").map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}
const RACE_STATUS_LABEL: Record<string, string> = {
  declared: "на подтверждении", approved: "подтверждён", synced_to_tp: "в TP", rejected: "отклонён",
};
const DAYOFF_STATUS_LABEL: Record<string, string> = {
  pending: "на подтверждении", approved: "подтверждён", rejected: "отклонён", applied: "применён",
};

function CabinetOverlay({ section, initData, onClose }: { section: CabinetSection; initData: string; onClose: () => void }) {
  const meta = CABINET_META[section];
  const [status, setStatus] = useState<Status>("loading");
  const [inactive, setInactive] = useState(false);
  const [races, setRaces] = useState<ClubRace[]>([]);
  const [requests, setRequests] = useState<ClubDayoffRequest[]>([]);
  const [wishes, setWishes] = useState<ClubWish[]>([]);
  const [billing, setBilling] = useState<ClubBillingView | null>(null);
  const [prediction, setPrediction] = useState<ClubPrediction | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [claim, setClaim] = useState<"idle" | "sending" | "sent">("idle");
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submitPaymentClaim() {
    setClaim("sending");
    try {
      await fetch("/api/m/club/payment-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });
    } catch {
      /* swallow — claim is best-effort; coach reconciles manually */
    }
    setClaim("sent");
  }

  const load = useCallback(
    async (extra?: Record<string, unknown>) => {
      const res = await fetch(meta.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, ...(extra ?? {}) }),
      });
      const json = await res.json().catch(() => ({ ok: false }));
      if (res.status === 503) {
        setInactive(true);
        setStatus("ready");
        return;
      }
      if (!res.ok || !json.ok) {
        setStatus("error");
        return;
      }
      const v = json.view ?? {};
      if (section === "races") setRaces(v.races ?? []);
      else if (section === "dayoff") setRequests(v.requests ?? []);
      else if (section === "wishes") setWishes(v.wishes ?? []);
      else if (section === "billing") setBilling(v as ClubBillingView);
      else if (section === "prediction") setPrediction(v as ClubPrediction);
      setStatus("ready");
    },
    [initData, meta.path, section]
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(extra: Record<string, unknown>) {
    setSaving(true);
    await load({ action: "create", ...extra });
    setSaving(false);
    setForm({});
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: HEAD, fontSize: 18, color: C.ink }}><ClubIcon name={meta.icon} size={20} />{meta.title}</span>
          <button style={S.closeBtn} onClick={onClose} type="button" aria-label="Закрыть"><ClubIcon name="x" size={16} /></button>
        </div>
        {status === "loading" ? <Loading /> : null}
        {status === "error" ? <Empty text="Не удалось загрузить" /> : null}
        {status === "ready" && inactive ? <Empty text="Раздел пока не активен" /> : null}

        {status === "ready" && !inactive && section === "races" ? (
          <div>
            <div style={S.formCard}>
              <input style={S.input} placeholder="Название старта" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
              <input style={S.input} type="date" value={form.date ?? ""} onChange={(e) => set("date", e.target.value)} />
              <input style={S.input} placeholder="Дистанция (напр. 21.1 км)" value={form.dist ?? ""} onChange={(e) => set("dist", e.target.value)} />
              <input style={S.input} placeholder="Город (необязательно)" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
              <input style={S.input} placeholder="Цель, чч:мм:сс (необязательно)" value={form.target ?? ""} onChange={(e) => set("target", e.target.value)} />
              <button style={S.saveBtn} type="button" disabled={saving} onClick={() => submit({ race: { name: form.name, raceDate: form.date, distanceLabel: form.dist, city: form.city, targetResultSeconds: form.target ? parseHms(form.target) : null } })}>
                {saving ? "Отправляю…" : "Заявить старт"}
              </button>
              <div style={S.hint}>Заявка уйдёт тренеру на подтверждение. В TrainingPeaks ничего не пишется.</div>
            </div>
            {races.map((r) => (
              <div key={r.id} style={S.listRow}>
                <div style={{ flex: 1 }}>
                  <div style={S.cardName}>{r.name}</div>
                  <div style={S.cardMeta}>{r.dateLabel}{r.distanceLabel ? ` · ${r.distanceLabel}` : ""}{r.city ? ` · ${r.city}` : ""}</div>
                </div>
                <span style={S.statusChip}>{RACE_STATUS_LABEL[r.status] ?? r.status}</span>
              </div>
            ))}
            {races.length === 0 ? <Empty text="Пока нет заявленных стартов" /> : null}
          </div>
        ) : null}

        {status === "ready" && !inactive && section === "dayoff" ? (
          <div>
            <div style={S.formCard}>
              <input style={S.input} type="date" value={form.from ?? ""} onChange={(e) => set("from", e.target.value)} />
              <input style={S.input} type="date" placeholder="по (необязательно)" value={form.to ?? ""} onChange={(e) => set("to", e.target.value)} />
              <input style={S.input} placeholder="Причина (необязательно)" value={form.reason ?? ""} onChange={(e) => set("reason", e.target.value)} />
              <button style={S.saveBtn} type="button" disabled={saving} onClick={() => submit({ request: { fromDate: form.from, toDate: form.to || form.from, reason: form.reason } })}>
                {saving ? "Отправляю…" : "Запросить выходной"}
              </button>
              <div style={S.hint}>Это заявка тренеру. Выходной не проставляется автоматически.</div>
            </div>
            {requests.map((r) => (
              <div key={r.id} style={S.listRow}>
                <div style={{ flex: 1 }}>
                  <div style={S.cardName}>{r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} - ${r.toDate}`}</div>
                  {r.reason ? <div style={S.cardMeta}>{r.reason}</div> : null}
                </div>
                <span style={S.statusChip}>{DAYOFF_STATUS_LABEL[r.status] ?? r.status}</span>
              </div>
            ))}
            {requests.length === 0 ? <Empty text="Пока нет заявок на выходные" /> : null}
          </div>
        ) : null}

        {status === "ready" && !inactive && section === "wishes" ? (
          <div>
            <div style={S.formCard}>
              {[["load", "Нагрузка"], ["wellbeing", "Самочувствие"], ["schedule", "Удобство расписания"]].map(([k, label]) => (
                <div key={k} style={{ marginBottom: 10 }}>
                  <div style={S.cardMeta}>{label}: {form[k] ?? "-"}</div>
                  <input type="range" min={1} max={10} value={form[k] ?? "5"} onChange={(e) => set(k, e.target.value)} style={{ width: "100%", accentColor: C.accent }} />
                </div>
              ))}
              <textarea style={{ ...S.input, minHeight: 60 }} placeholder="Что хочется поменять в тренировках?" value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} />
              <button style={S.saveBtn} type="button" disabled={saving} onClick={() => submit({ wish: { load: form.load ? Number(form.load) : null, wellbeing: form.wellbeing ? Number(form.wellbeing) : null, schedule: form.schedule ? Number(form.schedule) : null, note: form.note } })}>
                {saving ? "Отправляю…" : "Отправить пожелание"}
              </button>
              <div style={S.hint}>Тренер увидит это в своём разделе. Ничего не отправляется автоматически.</div>
            </div>
            {wishes.map((w) => (
              <div key={w.id} style={S.listRow}>
                <div style={{ flex: 1 }}>
                  <div style={S.cardMeta}>{w.dateLabel} · нагрузка {w.loadScale ?? "-"} · самочувствие {w.wellbeingScale ?? "-"} · расписание {w.scheduleScale ?? "-"}</div>
                  {w.note ? <div style={{ ...S.cardName, whiteSpace: "normal" }}>{w.note}</div> : null}
                </div>
              </div>
            ))}
            {wishes.length === 0 ? <Empty text="Пока нет отправленных пожеланий" /> : null}
          </div>
        ) : null}

        {status === "ready" && !inactive && section === "billing" && billing ? (
          <div style={S.formCard}>
            {billing.note ? <div style={S.cardMeta}>{billing.note}</div> : null}
            {billing.status ? <div style={{ ...S.bigNumber, fontSize: 22, marginTop: 8 }}>{billing.status}</div> : null}
            {billing.amountLabel || billing.nextDueDate ? (
              <div style={{ ...S.cardMeta, marginTop: 4 }}>
                {billing.amountLabel ? `Сумма: ${billing.amountLabel}` : ""}
                {billing.amountLabel && billing.nextDueDate ? " · " : ""}
                {billing.nextDueDate ? `След. платёж: ${fmtIsoDate(billing.nextDueDate)}` : ""}
              </div>
            ) : null}
            {billing.history.length > 0 ? <div style={{ ...S.secHead, marginTop: 12 }}>История</div> : null}
            {billing.history.map((h, i) => (
              <div key={i} style={S.listRow}>
                <span style={{ flex: 1, color: C.ink, fontSize: 14 }}>{h.label}</span>
                <span style={{ color: C.sub, fontSize: 13 }}>{h.amount ?? ""}</span>
              </div>
            ))}
            {billing.available ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                {billing.payUrl ? (
                  <button type="button" style={S.saveBtn} onClick={() => openExternalLink(billing.payUrl!)}>Оплатить</button>
                ) : null}
                {claim === "sent" ? (
                  <div style={{ ...S.hint, textAlign: "center" }}>Заявка отправлена тренеру. Он сверит платёж вручную.</div>
                ) : (
                  <button type="button" style={S.smallBtn} disabled={claim === "sending"} onClick={submitPaymentClaim}>
                    {claim === "sending" ? "Отправляю…" : "Я оплатил"}
                  </button>
                )}
                <div style={S.hint}>Оплата открывается на защищённой странице Т-Банка. Реквизитов и карт в приложении нет. Ничего не списывается автоматически.</div>
              </div>
            ) : null}
          </div>
        ) : null}

        {status === "ready" && !inactive && section === "prediction" && prediction ? (
          <div style={S.formCard}>
            {prediction.available ? (
              <div>
                <div style={S.cardMeta}>{prediction.raceName} · {prediction.distanceLabel}</div>
                <div style={{ ...S.bigNumber, marginTop: 8 }}>
                  {fmtDuration(prediction.low)}-{fmtDuration(prediction.high)}
                </div>
                <div style={S.cardMeta}>Пересчитано: {prediction.recomputedLabel} · {prediction.basedOn}</div>
                <div style={S.hint}>Это диапазон-оценка по твоим результатам, не гарантия.</div>
              </div>
            ) : (
              <Empty text={prediction.reason} />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Explicit registration confirmation (club-scoped; replaces silent auto-bind)
// ---------------------------------------------------------------------------

// Spec v3 block 2.1. ONLY the name is shown to an unverified account — never birth
// date / avatar / metrics / any training or payment data.
function ConfirmScreen({
  candidate,
  confirming,
  outcome,
  onConfirm,
  onReject,
}: {
  candidate: Candidate;
  confirming: boolean;
  outcome: "idle" | "rejected" | "conflict";
  onConfirm: () => void;
  onReject: () => void;
}) {
  const wrap = (children: React.ReactNode) => (
    <div style={{ ...S.overlay, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ ...S.card, maxWidth: 340, width: "100%", textAlign: "center", marginBottom: 0 }}>{children}</div>
    </div>
  );

  if (outcome === "rejected") {
    return wrap(
      <>
        <div style={{ fontFamily: HEAD, fontSize: 20, color: C.ink, marginBottom: 10 }}>Привязка аккаунта</div>
        <div style={{ color: C.sub, fontSize: 14 }}>Хорошо, ничего не привязали. Напиши тренеру, чтобы он проверил.</div>
      </>
    );
  }
  if (outcome === "conflict") {
    return wrap(
      <>
        <div style={{ fontFamily: HEAD, fontSize: 20, color: C.ink, marginBottom: 10 }}>Привязка аккаунта</div>
        <div style={{ color: C.sub, fontSize: 14 }}>Не получилось привязать. Напиши тренеру.</div>
      </>
    );
  }
  return wrap(
    <>
      <div style={{ fontFamily: HEAD, fontSize: 20, color: C.ink, marginBottom: 8 }}>Привязка аккаунта</div>
      <div style={{ color: C.sub, fontSize: 14, marginBottom: 12 }}>Похоже, это твой аккаунт в клубе.</div>
      <div style={{ fontFamily: HEAD, fontSize: 24, color: C.accent, marginBottom: 14 }}>{candidate.displayName}</div>
      <div style={{ color: C.faint, fontSize: 12.5, lineHeight: 1.5, marginBottom: 20 }}>
        После подтверждения этот Telegram будет привязан к твоему профилю. Изменить привязку можно только через тренера.
      </div>
      <button style={{ ...S.retry, width: "100%", opacity: confirming ? 0.6 : 1 }} type="button" disabled={confirming} onClick={onConfirm}>
        {confirming ? "Привязываю…" : "Да, это я"}
      </button>
      <button
        style={{ background: "none", border: "none", color: C.sub, fontFamily: BODY, fontSize: 14, marginTop: 14, cursor: "pointer" }}
        type="button"
        disabled={confirming}
        onClick={onReject}
      >
        Это не я
      </button>
    </>
  );
}

/** Shown to an unbound account on the general link — a request was recorded server-side. */
/** Telegram passed no initData — opened as a plain page or via a bad link. */
function NoInitDataScreen() {
  return (
    <div style={{ ...S.overlay, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ ...S.card, maxWidth: 340, width: "100%", textAlign: "center", marginBottom: 0 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, color: C.accent }}><ClubIcon name="smartphone" size={40} /></div>
        <div style={{ fontFamily: HEAD, fontSize: 22, color: C.ink, marginBottom: 10 }}>Открой внутри Telegram</div>
        <div style={{ color: C.sub, fontSize: 14, lineHeight: 1.5 }}>
          Клуб открывается только по ссылке <b style={{ color: C.accent }}>t.me/igorp_coach_bot/XOclub</b> в приложении Telegram (не в браузере). Нажми ссылку от тренера ещё раз.
        </div>
      </div>
    </div>
  );
}

function RequestSentScreen() {
  return (
    <div style={{ ...S.overlay, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ ...S.card, maxWidth: 340, width: "100%", textAlign: "center", marginBottom: 0 }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
        <div style={{ fontFamily: HEAD, fontSize: 22, color: C.ink, marginBottom: 10 }}>Заявка отправлена</div>
        <div style={{ color: C.sub, fontSize: 14, lineHeight: 1.5 }}>
          Тренер подтвердит доступ. Когда он привяжет твой аккаунт - открой клуб снова, и всё появится.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S = {
  shell: { minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: BODY, paddingBottom: 78 } as React.CSSProperties,
  header: { padding: "16px 16px 8px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 } as React.CSSProperties,
  h1: { fontFamily: HEAD, fontSize: 26, fontWeight: 700, letterSpacing: "0.06em", margin: 0, color: C.ink } as React.CSSProperties,
  fresh: { color: C.faint, fontSize: 12 } as React.CSSProperties,
  main: { padding: "4px 12px 12px" } as React.CSSProperties,
  errorBanner: { background: "rgba(224,161,58,0.12)", border: `1px solid ${C.warn}`, borderRadius: 10, padding: "8px 12px", fontSize: 13, color: C.warn, cursor: "pointer" } as React.CSSProperties,
  card: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginBottom: 12 } as React.CSSProperties,
  cardName: { fontSize: 15, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as React.CSSProperties,
  cardMeta: { fontSize: 12.5, color: C.sub, marginTop: 2 } as React.CSSProperties,
  statRow: { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" } as React.CSSProperties,
  stat: { background: C.cardAlt, borderRadius: 999, padding: "5px 12px", fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: HEAD } as React.CSSProperties,
  caption: { marginTop: 10, fontSize: 13.5, color: C.sub, lineHeight: 1.4 } as React.CSSProperties,
  reactRow: { display: "flex", gap: 10, marginTop: 12 } as React.CSSProperties,
  reactChip: { fontSize: 13, color: C.sub, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 12px", cursor: "pointer" } as React.CSSProperties,
  secHead: { fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" as const, color: C.faint } as React.CSSProperties,
  bigNumber: { fontFamily: HEAD, fontSize: 32, fontWeight: 700, color: C.accent, lineHeight: "34px" } as React.CSSProperties,
  progressTrack: { height: 10, background: C.cardAlt, borderRadius: 999, marginTop: 12, overflow: "hidden" } as React.CSSProperties,
  progressFill: { height: "100%", background: C.accent, borderRadius: 999, transition: "width 0.3s" } as React.CSSProperties,
  fixtureNote: { marginTop: 8, fontSize: 12, color: C.warn } as React.CSSProperties,
  okNote: { marginTop: 8, fontSize: 12, color: C.good } as React.CSSProperties,
  badge: { display: "inline-block", fontSize: 12, border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 10px" } as React.CSSProperties,
  rankRow: (me: boolean): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px", marginTop: 6, borderRadius: 10, background: me ? "rgba(245,197,24,0.08)" : "transparent", border: me ? `1px solid ${C.accent}` : "1px solid transparent" }),
  rankBadge: (i: number): React.CSSProperties => ({ width: 22, textAlign: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: i === 0 ? C.gold : i === 1 ? C.silver : i === 2 ? C.bronze : C.faint, flexShrink: 0 }),
  pctBig: { fontFamily: HEAD, fontSize: 18, fontWeight: 700, color: C.ink } as React.CSSProperties,
  timeBig: { fontFamily: HEAD, fontSize: 17, fontWeight: 600, color: C.ink } as React.CSSProperties,
  tabsRow: { display: "flex", gap: 8, marginBottom: 12 } as React.CSSProperties,
  pill: (active: boolean): React.CSSProperties => ({ flex: 1, padding: "8px 0", borderRadius: 999, border: `1px solid ${active ? C.accent : C.line}`, background: active ? C.accent : C.card, color: active ? C.accentInk : C.sub, fontSize: 13, fontWeight: 600, fontFamily: HEAD, cursor: "pointer" }),
  recRow: { display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderTop: `1px solid ${C.line}`, marginTop: 2 } as React.CSSProperties,
  badgeCard: (earned: boolean): React.CSSProperties => ({ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: "calc(33% - 6px)", padding: "10px 4px", borderRadius: 10, background: earned ? "rgba(245,197,24,0.10)" : C.cardAlt, border: `1px solid ${earned ? C.accent : C.line}`, color: earned ? C.ink : C.sub, textAlign: "center" }),
  more: { width: "100%", padding: "12px 0", borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, color: C.accent, fontFamily: HEAD, fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 4 } as React.CSSProperties,
  endHint: { textAlign: "center", color: C.faint, fontSize: 12, padding: "12px 0" } as React.CSSProperties,
  state: { textAlign: "center", color: C.sub, fontSize: 14, padding: "48px 16px" } as React.CSSProperties,
  retry: { padding: "10px 20px", borderRadius: 10, border: "none", background: C.accent, color: C.accentInk, fontFamily: HEAD, fontWeight: 600, fontSize: 14, cursor: "pointer" } as React.CSSProperties,
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", zIndex: 50 } as React.CSSProperties,
  sheet: { background: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTop: `1px solid ${C.line}`, padding: 16, width: "100%", maxHeight: "82vh", overflowY: "auto", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" } as React.CSSProperties,
  closeBtn: { background: C.cardAlt, border: `1px solid ${C.line}`, color: C.sub, borderRadius: 999, width: 30, height: 30, cursor: "pointer", fontSize: 14 } as React.CSSProperties,
  sectionBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.cardAlt, color: C.ink, fontSize: 13, fontWeight: 600, fontFamily: HEAD, cursor: "pointer" } as React.CSSProperties,
  sectionCard: { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.cardAlt, cursor: "pointer" } as React.CSSProperties,
  sectionIconWrap: { display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, background: "rgba(245,197,24,0.10)", border: `1px solid ${C.line}`, flexShrink: 0 } as React.CSSProperties,
  pillInner: { display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" } as React.CSSProperties,
  formCard: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, marginBottom: 12 } as React.CSSProperties,
  input: { display: "block", width: "100%", boxSizing: "border-box", padding: "10px 12px", marginBottom: 8, borderRadius: 10, border: `1px solid ${C.line}`, background: C.bg, color: C.ink, fontSize: 14, fontFamily: BODY } as React.CSSProperties,
  saveBtn: { width: "100%", padding: "11px 0", borderRadius: 10, border: "none", background: C.accent, color: C.accentInk, fontFamily: HEAD, fontWeight: 600, fontSize: 14, cursor: "pointer" } as React.CSSProperties,
  metricPrimary: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 } as React.CSSProperties,
  metricSecondary: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(78px, 1fr))", gap: 12, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` } as React.CSSProperties,
  statTiles: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginTop: 10 } as React.CSSProperties,
  statTile: { background: C.cardAlt, borderRadius: 10, padding: "10px 12px", border: `1px solid ${C.line}` } as React.CSSProperties,
  collapseHead: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer" } as React.CSSProperties,
  chevron: { width: 7, height: 7, borderRight: `2px solid ${C.sub}`, borderBottom: `2px solid ${C.sub}`, transform: "rotate(0deg)", transition: "transform 0.15s", flexShrink: 0, marginRight: 3 } as React.CSSProperties,
  rankRowSm: (me: boolean): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px", marginTop: 4, borderRadius: 8, background: me ? "rgba(245,197,24,0.08)" : "transparent", border: me ? `1px solid ${C.accent}` : "1px solid transparent" }),
  rankBadgeSm: (i: number): React.CSSProperties => ({ width: 18, textAlign: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 13, color: i === 0 ? C.gold : i === 1 ? C.silver : i === 2 ? C.bronze : C.faint, flexShrink: 0 }),
  cardNameSm: { fontSize: 13, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as React.CSSProperties,
  timeSm: { fontFamily: HEAD, fontSize: 13, fontWeight: 600, color: C.ink, flexShrink: 0 } as React.CSSProperties,
  smallPrimaryBtn: { padding: "7px 16px", borderRadius: 999, border: "none", background: C.accent, color: C.accentInk, fontFamily: HEAD, fontWeight: 600, fontSize: 13, cursor: "pointer" } as React.CSSProperties,
  smallBtn: { padding: "7px 14px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.cardAlt, color: C.sub, fontFamily: HEAD, fontWeight: 600, fontSize: 13, cursor: "pointer" } as React.CSSProperties,
  linkAction: { fontSize: 12.5, color: C.sub, cursor: "pointer", textDecoration: "underline" } as React.CSSProperties,
  hint: { color: C.faint, fontSize: 11.5, marginTop: 8, lineHeight: 1.4 } as React.CSSProperties,
  listRow: { display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderTop: `1px solid ${C.line}` } as React.CSSProperties,
  statusChip: { fontSize: 11.5, color: C.sub, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" } as React.CSSProperties,
  tabBar: { position: "fixed", left: 0, right: 0, bottom: 0, display: "flex", background: C.card, borderTop: `1px solid ${C.line}`, paddingBottom: "env(safe-area-inset-bottom)" } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 0 6px", background: "transparent", border: "none", color: active ? C.accent : C.faint, cursor: "pointer", fontFamily: BODY }),
};
