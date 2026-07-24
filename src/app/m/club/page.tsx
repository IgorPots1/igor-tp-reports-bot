"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  ClubChallengeView,
  ClubFeedItem,
  ClubFeedView,
  ClubProfileView,
  ClubRecordsView,
} from "@/features/club/types";

// --- Telegram WebApp handle (isolated; does not clash with /m/desk or /m/n) ---
type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  setBackgroundColor?: (c: string) => void;
  setHeaderColor?: (c: string) => void;
};

function getTelegramWebApp(): TelegramWebApp | null {
  const tg = (globalThis as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  return tg ?? null;
}

// --- Dark "club" palette: dark theme + yellow accent (naryad) ---
const C = {
  bg: "#0e1116",
  card: "#171b22",
  cardAlt: "#1e232c",
  ink: "#f2f4f7",
  sub: "#9aa4b2",
  faint: "#5b6472",
  accent: "#f5c518",
  accentInk: "#0e1116",
  line: "#252b35",
  good: "#4ec9a5",
  warn: "#e0a13a",
  gold: "#f5c518",
  silver: "#c3ccd8",
  bronze: "#cd8a54",
};

const HEAD = "var(--font-oswald), var(--font-montserrat), system-ui, sans-serif";
const BODY = "var(--font-montserrat), system-ui, sans-serif";

type Tab = "feed" | "challenge" | "records" | "profile";
const TABS: Array<{ key: Tab; icon: string; label: string }> = [
  { key: "feed", icon: "📻", label: "Лента" },
  { key: "challenge", icon: "🔥", label: "Челлендж" },
  { key: "records", icon: "🏅", label: "Рекорды" },
  { key: "profile", icon: "👤", label: "Профиль" },
];

type Status = "idle" | "loading" | "ready" | "error";

// --- format helpers ---
function fmtKm(km: number | null): string {
  if (km === null || km <= 0) {
    return "—".replace("—", "-");
  }
  return `${km.toFixed(1).replace(".", ",")} км`;
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

async function apiPost<T>(
  path: string,
  initData: string,
  extra?: Record<string, unknown>
): Promise<{ ok: boolean; view?: T; error?: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, ...(extra ?? {}) }),
    });
    const json = (await res.json()) as { ok?: boolean; view?: T; error?: string };
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.error ?? "Ошибка загрузки." };
    }
    return { ok: true, view: json.view };
  } catch {
    return { ok: false, error: "Нет связи. Попробуй ещё раз." };
  }
}

export default function ClubPage() {
  const [initData, setInitData] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("feed");

  // Per-tab state
  const [feed, setFeed] = useState<ClubFeedView | null>(null);
  const [feedItems, setFeedItems] = useState<ClubFeedItem[]>([]);
  const [feedStatus, setFeedStatus] = useState<Status>("idle");
  const [feedMoreLoading, setFeedMoreLoading] = useState(false);

  const [challenge, setChallenge] = useState<ClubChallengeView | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<Status>("idle");

  const [records, setRecords] = useState<ClubRecordsView | null>(null);
  const [recordsStatus, setRecordsStatus] = useState<Status>("idle");
  const [recDistance, setRecDistance] = useState<"5k" | "10k" | "21k" | "42k">("10k");

  const [profile, setProfile] = useState<ClubProfileView | null>(null);
  const [profileStatus, setProfileStatus] = useState<Status>("idle");

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (tg) {
      try {
        tg.ready();
        tg.expand();
        tg.setBackgroundColor?.(C.bg);
        tg.setHeaderColor?.(C.bg);
      } catch {
        /* older clients */
      }
      setInitData(tg.initData ?? "");
    } else {
      setInitData("");
    }
  }, []);

  const loadFeed = useCallback(async () => {
    if (initData === null) {
      return;
    }
    setFeedStatus("loading");
    const r = await apiPost<ClubFeedView>("/api/m/club/feed", initData);
    if (!r.ok || !r.view) {
      setError(r.error ?? null);
      setFeedStatus("error");
      return;
    }
    setFeed(r.view);
    setFeedItems(r.view.items);
    setFeedStatus("ready");
  }, [initData]);

  const loadMoreFeed = useCallback(async () => {
    if (initData === null || !feed?.nextCursor) {
      return;
    }
    setFeedMoreLoading(true);
    const r = await apiPost<ClubFeedView>("/api/m/club/feed", initData, { cursor: feed.nextCursor });
    setFeedMoreLoading(false);
    if (r.ok && r.view) {
      setFeedItems((prev) => [...prev, ...r.view!.items]);
      setFeed(r.view);
    }
  }, [initData, feed]);

  const loadChallenge = useCallback(async () => {
    if (initData === null) {
      return;
    }
    setChallengeStatus("loading");
    const r = await apiPost<ClubChallengeView>("/api/m/club/challenge", initData);
    if (!r.ok || !r.view) {
      setError(r.error ?? null);
      setChallengeStatus("error");
      return;
    }
    setChallenge(r.view);
    setChallengeStatus("ready");
  }, [initData]);

  const loadRecords = useCallback(async () => {
    if (initData === null) {
      return;
    }
    setRecordsStatus("loading");
    const r = await apiPost<ClubRecordsView>("/api/m/club/records", initData);
    if (!r.ok || !r.view) {
      setError(r.error ?? null);
      setRecordsStatus("error");
      return;
    }
    setRecords(r.view);
    setRecordsStatus("ready");
  }, [initData]);

  const loadProfile = useCallback(async () => {
    if (initData === null) {
      return;
    }
    setProfileStatus("loading");
    const r = await apiPost<ClubProfileView>("/api/m/club/profile", initData);
    if (!r.ok || !r.view) {
      setError(r.error ?? null);
      setProfileStatus("error");
      return;
    }
    setProfile(r.view);
    setProfileStatus("ready");
  }, [initData]);

  // Lazy-load each tab on first open.
  useEffect(() => {
    if (initData === null) {
      return;
    }
    if (tab === "feed" && feedStatus === "idle") {
      void loadFeed();
    } else if (tab === "challenge" && challengeStatus === "idle") {
      void loadChallenge();
    } else if (tab === "records" && recordsStatus === "idle") {
      void loadRecords();
    } else if (tab === "profile" && profileStatus === "idle") {
      void loadProfile();
    }
  }, [
    tab,
    initData,
    feedStatus,
    challengeStatus,
    recordsStatus,
    profileStatus,
    loadFeed,
    loadChallenge,
    loadRecords,
    loadProfile,
  ]);

  return (
    <div style={S.shell}>
      <header style={S.header}>
        <h1 style={S.h1}>КЛУБ</h1>
        {feed?.freshness.label ? <span style={S.fresh}>{feed.freshness.label}</span> : null}
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
          />
        ) : null}
        {tab === "challenge" ? (
          <ChallengeTab status={challengeStatus} view={challenge} onRetry={loadChallenge} />
        ) : null}
        {tab === "records" ? (
          <RecordsTab
            status={recordsStatus}
            view={records}
            distance={recDistance}
            onDistance={setRecDistance}
            onRetry={loadRecords}
          />
        ) : null}
        {tab === "profile" ? (
          <ProfileTab status={profileStatus} view={profile} onRetry={loadProfile} />
        ) : null}
      </main>

      <nav style={S.tabBar}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button key={t.key} style={S.tab(active)} onClick={() => setTab(t.key)} type="button">
              <span style={{ fontSize: 20, lineHeight: "20px" }}>{t.icon}</span>
              <span style={{ fontSize: 11, fontWeight: active ? 700 : 500 }}>{t.label}</span>
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

function Monogram({ text, tone }: { text: string; tone?: string }) {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 999,
        background: tone ?? C.cardAlt,
        color: tone ? C.accentInk : C.accent,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: HEAD,
        fontWeight: 600,
        fontSize: 15,
        flexShrink: 0,
        border: `1px solid ${C.line}`,
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
      <button style={S.retry} onClick={onRetry} type="button">
        Повторить
      </button>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div style={S.state}>{text}</div>;
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
}) {
  if (props.status === "loading" || props.status === "idle") {
    return <Loading />;
  }
  if (props.status === "error") {
    return <ErrorState onRetry={props.onRetry} />;
  }
  if (props.items.length === 0) {
    return <Empty text="Пока нет завершённых тренировок в клубе" />;
  }
  return (
    <div>
      {props.items.map((item) => (
        <FeedCard key={item.id} item={item} />
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

function FeedCard({ item }: { item: ClubFeedItem }) {
  const stats: string[] = [];
  if (item.distanceKm && item.distanceKm > 0) {
    stats.push(fmtKm(item.distanceKm));
  }
  const dur = fmtDuration(item.durationSeconds);
  if (dur) {
    stats.push(dur);
  }
  const pace = fmtPace(item.paceSecPerKm);
  if (pace) {
    stats.push(pace);
  }
  return (
    <div style={S.card}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Monogram text={item.monogram} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={S.cardName}>{item.studentDisplayName}</div>
          <div style={S.cardMeta}>
            {item.typeLabel} · {item.dateLabel}
          </div>
        </div>
      </div>
      {stats.length > 0 ? (
        <div style={S.statRow}>
          {stats.map((s, i) => (
            <span key={i} style={S.stat}>
              {s}
            </span>
          ))}
        </div>
      ) : null}
      {item.caption ? <div style={S.caption}>{item.caption}</div> : null}
      {/* room reserved for future reactions (disabled in v1) */}
      <div style={S.reactRow} aria-hidden>
        <span style={S.reactChip}>♡</span>
        <span style={S.reactChip}>💬</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Challenge
// ---------------------------------------------------------------------------

function ChallengeTab(props: {
  status: Status;
  view: ClubChallengeView | null;
  onRetry: () => void;
}) {
  if (props.status === "loading" || props.status === "idle") {
    return <Loading />;
  }
  if (props.status === "error" || !props.view) {
    return <ErrorState onRetry={props.onRetry} />;
  }
  const v = props.view;
  return (
    <div>
      <div style={S.card}>
        <div style={S.secHead}>Клубный километраж · неделя</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
          <span style={S.bigNumber}>{v.clubKm.toFixed(1).replace(".", ",")}</span>
          <span style={{ color: C.sub, fontSize: 14 }}>из {v.goalKm} км</span>
        </div>
        <div style={S.progressTrack}>
          <div style={{ ...S.progressFill, width: `${v.progressPct}%` }} />
        </div>
        <div style={S.cardMeta}>{v.weekLabel}</div>
        {v.goalIsFixture ? (
          <div style={S.fixtureNote}>Демо-цель. Прогресс — реальный.</div>
        ) : null}
      </div>

      {v.personal ? (
        <div style={S.card}>
          <div style={S.secHead}>Мой вклад</div>
          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            <Metric label="км за неделю" value={fmtKm(v.personal.contributionKm)} />
            <Metric label="доля клуба" value={`${v.personal.contributionPct}%`} />
            <Metric
              label="выполнено"
              value={v.personal.noPlan ? "нет плана" : pct(v.personal.completionPct)}
            />
          </div>
        </div>
      ) : null}

      <div style={S.card}>
        <div style={S.secHead}>Красавчики недели · по проценту выполнения</div>
        {v.topPerformers.length === 0 ? (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 8 }}>Пока нет данных за неделю</div>
        ) : (
          v.topPerformers.map((p, i) => (
            <div key={p.studentId} style={S.rankRow(p.isCurrentStudent)}>
              <span style={S.rankBadge(i)}>{i + 1}</span>
              <Monogram text={p.monogram} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.cardName}>
                  {p.displayName}
                  {p.isCurrentStudent ? " · ты" : ""}
                </div>
                <div style={S.cardMeta}>
                  {p.noPlan
                    ? `${p.completedCount} тренировок, без плана`
                    : `${p.completedCount} из ${p.plannedCount} тренировок`}
                </div>
              </div>
              <span style={S.pctBig}>{p.noPlan ? "—".replace("—", "-") : pct(p.completionPct)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: HEAD, fontSize: 20, color: C.ink, fontWeight: 600 }}>{value}</div>
      <div style={{ color: C.sub, fontSize: 12 }}>{label}</div>
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
}) {
  if (props.status === "loading" || props.status === "idle") {
    return <Loading />;
  }
  if (props.status === "error" || !props.view) {
    return <ErrorState onRetry={props.onRetry} />;
  }
  const v = props.view;
  const club = v.clubTops.find((c) => c.distanceKey === props.distance);
  const mine = v.personal.find((p) => p.distanceKey === props.distance);

  return (
    <div>
      <div style={S.tabsRow}>
        {v.clubTops.map((c) => (
          <button
            key={c.distanceKey}
            style={S.pill(c.distanceKey === props.distance)}
            onClick={() => props.onDistance(c.distanceKey)}
            type="button"
          >
            {c.distanceLabel}
          </button>
        ))}
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Мой рекорд</div>
        {mine ? (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={S.bigNumber}>{fmtDuration(mine.durationSeconds)}</span>
              {mine.paceSecPerKm ? (
                <span style={{ color: C.sub, fontSize: 14 }}>{fmtPace(mine.paceSecPerKm)}</span>
              ) : null}
            </div>
            <div style={S.cardMeta}>{mine.dateLabel}</div>
            {!mine.reliable ? <span style={S.prelim}>предварительно</span> : null}
          </div>
        ) : (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 6 }}>
            Пока нет тренировки на эту дистанцию
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Клубный топ · {club?.distanceLabel}</div>
        {club && club.rows.length > 0 ? (
          club.rows.map((row) => (
            <div key={`${row.rank}-${row.displayName}`} style={S.rankRow(row.isCurrentStudent)}>
              <span style={S.rankBadge(row.rank - 1)}>{row.rank}</span>
              <Monogram text={row.monogram} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.cardName}>
                  {row.displayName}
                  {row.isCurrentStudent ? " · ты" : ""}
                </div>
                <div style={S.cardMeta}>
                  {fmtPace(row.paceSecPerKm) ?? ""}
                  {!row.reliable ? " · предв." : ""}
                </div>
              </div>
              <span style={S.timeBig}>{fmtDuration(row.durationSeconds)}</span>
            </div>
          ))
        ) : (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 8 }}>Пока нет рекордов клуба</div>
        )}
        {club?.alwaysPreliminary ? (
          <div style={S.fixtureNote}>5 км помечаем как предварительный по методике</div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile / personal cabinet
// ---------------------------------------------------------------------------

function ProfileTab(props: { status: Status; view: ClubProfileView | null; onRetry: () => void }) {
  if (props.status === "loading" || props.status === "idle") {
    return <Loading />;
  }
  if (props.status === "error" || !props.view) {
    return <ErrorState onRetry={props.onRetry} />;
  }
  const v = props.view;
  return (
    <div>
      <div style={S.card}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 999,
              background: C.accent,
              color: C.accentInk,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: HEAD,
              fontWeight: 700,
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            {v.monogram}
          </div>
          <div>
            <div style={{ fontFamily: HEAD, fontSize: 22, color: C.ink, fontWeight: 600 }}>
              {v.displayName}
            </div>
            <div style={S.cardMeta}>
              {v.challengeRank
                ? `Место в челлендже: ${v.challengeRank} из ${v.challengeParticipants}`
                : "Челлендж недели: нет данных"}
            </div>
          </div>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ display: "flex", gap: 16 }}>
          <Metric label="км за неделю" value={fmtKm(v.weekKm)} />
          <Metric label="км за месяц" value={fmtKm(v.monthKm)} />
          <Metric label="серия дней" value={String(v.streakDays)} />
        </div>
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Выполнение плана · неделя</div>
        <div style={{ marginTop: 6 }}>
          <span style={S.bigNumber}>{v.noPlan ? "нет плана" : pct(v.completionPct)}</span>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.secHead}>Личные рекорды</div>
        {v.records.length === 0 ? (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 8 }}>
            Пока нет реконструированных рекордов
          </div>
        ) : (
          v.records.map((r) => (
            <div key={r.distanceKey} style={S.recRow}>
              <span style={{ fontFamily: HEAD, fontSize: 15, color: C.ink, width: 64 }}>
                {r.distanceLabel}
              </span>
              <span style={{ flex: 1, fontFamily: HEAD, fontSize: 17, color: C.ink }}>
                {fmtDuration(r.durationSeconds)}
              </span>
              <span style={{ color: C.sub, fontSize: 13 }}>
                {fmtPace(r.paceSecPerKm) ?? ""}
                {!r.reliable ? " · предв." : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S = {
  shell: {
    minHeight: "100vh",
    background: C.bg,
    color: C.ink,
    fontFamily: BODY,
    paddingBottom: 78,
  } as React.CSSProperties,
  header: {
    padding: "16px 16px 8px",
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  } as React.CSSProperties,
  h1: {
    fontFamily: HEAD,
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "0.06em",
    margin: 0,
    color: C.ink,
  } as React.CSSProperties,
  fresh: { color: C.faint, fontSize: 12 } as React.CSSProperties,
  main: { padding: "4px 12px 12px" } as React.CSSProperties,
  errorBanner: {
    background: "rgba(224,161,58,0.12)",
    border: `1px solid ${C.warn}`,
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 13,
    color: C.warn,
    cursor: "pointer",
  } as React.CSSProperties,
  card: {
    background: C.card,
    border: `1px solid ${C.line}`,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  } as React.CSSProperties,
  cardName: {
    fontSize: 15,
    fontWeight: 600,
    color: C.ink,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } as React.CSSProperties,
  cardMeta: { fontSize: 12.5, color: C.sub, marginTop: 2 } as React.CSSProperties,
  statRow: { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" } as React.CSSProperties,
  stat: {
    background: C.cardAlt,
    borderRadius: 999,
    padding: "5px 12px",
    fontSize: 14,
    fontWeight: 600,
    color: C.ink,
    fontFamily: HEAD,
  } as React.CSSProperties,
  caption: { marginTop: 10, fontSize: 13.5, color: C.sub, lineHeight: 1.4 } as React.CSSProperties,
  reactRow: { display: "flex", gap: 10, marginTop: 12, opacity: 0.35 } as React.CSSProperties,
  reactChip: {
    fontSize: 14,
    color: C.sub,
    border: `1px solid ${C.line}`,
    borderRadius: 999,
    padding: "2px 12px",
  } as React.CSSProperties,
  secHead: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    color: C.faint,
  } as React.CSSProperties,
  bigNumber: {
    fontFamily: HEAD,
    fontSize: 32,
    fontWeight: 700,
    color: C.accent,
    lineHeight: "34px",
  } as React.CSSProperties,
  progressTrack: {
    height: 10,
    background: C.cardAlt,
    borderRadius: 999,
    marginTop: 12,
    overflow: "hidden",
  } as React.CSSProperties,
  progressFill: {
    height: "100%",
    background: C.accent,
    borderRadius: 999,
    transition: "width 0.3s",
  } as React.CSSProperties,
  fixtureNote: { marginTop: 8, fontSize: 12, color: C.warn } as React.CSSProperties,
  prelim: {
    display: "inline-block",
    marginTop: 8,
    fontSize: 12,
    color: C.warn,
    border: `1px solid ${C.line}`,
    borderRadius: 999,
    padding: "2px 10px",
  } as React.CSSProperties,
  rankRow: (me: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 8px",
    marginTop: 6,
    borderRadius: 10,
    background: me ? "rgba(245,197,24,0.08)" : "transparent",
    border: me ? `1px solid ${C.accent}` : "1px solid transparent",
  }),
  rankBadge: (i: number): React.CSSProperties => ({
    width: 22,
    textAlign: "center",
    fontFamily: HEAD,
    fontWeight: 700,
    fontSize: 15,
    color: i === 0 ? C.gold : i === 1 ? C.silver : i === 2 ? C.bronze : C.faint,
    flexShrink: 0,
  }),
  pctBig: { fontFamily: HEAD, fontSize: 18, fontWeight: 700, color: C.ink } as React.CSSProperties,
  timeBig: { fontFamily: HEAD, fontSize: 17, fontWeight: 600, color: C.ink } as React.CSSProperties,
  tabsRow: { display: "flex", gap: 8, marginBottom: 12 } as React.CSSProperties,
  pill: (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "8px 0",
    borderRadius: 999,
    border: `1px solid ${active ? C.accent : C.line}`,
    background: active ? C.accent : C.card,
    color: active ? C.accentInk : C.sub,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: HEAD,
    cursor: "pointer",
  }),
  recRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 0",
    borderTop: `1px solid ${C.line}`,
    marginTop: 2,
  } as React.CSSProperties,
  more: {
    width: "100%",
    padding: "12px 0",
    borderRadius: 12,
    border: `1px solid ${C.line}`,
    background: C.card,
    color: C.accent,
    fontFamily: HEAD,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
  } as React.CSSProperties,
  endHint: { textAlign: "center", color: C.faint, fontSize: 12, padding: "12px 0" } as React.CSSProperties,
  state: { textAlign: "center", color: C.sub, fontSize: 14, padding: "48px 16px" } as React.CSSProperties,
  retry: {
    padding: "10px 20px",
    borderRadius: 10,
    border: "none",
    background: C.accent,
    color: C.accentInk,
    fontFamily: HEAD,
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  } as React.CSSProperties,
  tabBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    background: C.card,
    borderTop: `1px solid ${C.line}`,
    paddingBottom: "env(safe-area-inset-bottom)",
  } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    padding: "8px 0 6px",
    background: "transparent",
    border: "none",
    color: active ? C.accent : C.faint,
    cursor: "pointer",
    fontFamily: BODY,
  }),
};
