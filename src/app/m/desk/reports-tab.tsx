"use client";

import { useState, type CSSProperties } from "react";

// «Отчёты» tab: Igor reviews AI-drafted workout replies and consciously sends them.
// INVARIANT: draft → read → edit if needed → tap Send. Zero auto-send. Sending is
// gated by FEEDBACK_SEND_ENABLED server-side (view.sendEnabled here is only a UI hint;
// the server refuses regardless). Presentational — all state lives in the parent page,
// so this whole surface can be SSR-rendered on real drafts for proof.

// Shape mirrors /api/m/desk/reports/list (feedback-review-view.ts).
export type ReportTransparencyItem = {
  kind: "arc" | "praise" | "correction" | "care" | "question" | "comparison" | "signal" | "words";
  text: string;
};
export type ReportCardModel = {
  id: string;
  studentName: string;
  telegramUsername: string | null;
  workoutDate: string | null;
  dateLabel: string;
  sessionTypeLabel: string;
  status: "pending" | "generating" | "done" | "failed" | "blocked" | "sent" | "shared" | "dismissed";
  draftText: string | null;
  coachEdited: boolean;
  transparency: ReportTransparencyItem[];
  attentionReason: string | null;
  significanceBadge: "разбор" | "прогресс" | "чисто" | null;
  channel: "dm" | "group" | "none";
  mention: string | null;
  windowOpen: boolean | null;
};
export type ReportsView = {
  queue: ReportCardModel[];
  review: ReportCardModel[];
  attention: ReportCardModel[];
  history: ReportCardModel[];
  sendEnabled: boolean;
  backend: "api" | "cowork";
  counts: { queue: number; review: number; attention: number; history: number };
};

export type ReportBusy = { id: string; op: "send" | "dismiss" | "save" | "generate" } | null;
// tone "info" is a neutral (not-error) note — used for prepare-only, which is a deliberate
// mode, not a failure. Without it a "не отправлено" note renders red and reads as a bug.
export type ReportToast = { ok: boolean; text: string; tone?: "info" };
export type ReportToasts = Record<string, ReportToast>;

// UI mirror of the server's MAX_BATCH (feedback-generate.ts). Kept local so this client
// component doesn't import the server generation module (and its Supabase deps).
const MAX_BATCH_UI = 10;

// Force-light palette (self-contained; a dark phone must not wash out the desk).
const C = {
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
  draftBg: "#f3f8f6",
};

const R = {
  groupLabel: { padding: "14px 18px 4px", fontSize: 12, fontWeight: 700, color: C.faint, letterSpacing: "0.05em", textTransform: "uppercase" as const } as CSSProperties,
  bigEmpty: { padding: "40px 18px", textAlign: "center" as const, color: C.faint, fontSize: 14, fontWeight: 600, lineHeight: 1.5 } as CSSProperties,
  card: { background: C.card, borderRadius: 16, padding: "15px 16px", margin: "0 14px 12px", boxShadow: "0 1px 3px rgba(18,51,44,0.06)", border: `1px solid ${C.line}` } as CSSProperties,
  top: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 } as CSSProperties,
  nameRow: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 } as CSSProperties,
  name: { fontSize: 16, fontWeight: 700, color: C.ink, lineHeight: 1.25 } as CSSProperties,
  chatDot: { fontSize: 13, color: C.teal, flex: "0 0 auto" } as CSSProperties,
  meta: { flex: "0 0 auto", fontSize: 12.5, fontWeight: 700, color: C.faint, whiteSpace: "nowrap" } as CSSProperties,
  draft: { margin: "11px 0 0", padding: "13px 15px", borderRadius: 12, background: C.draftBg, border: `1px solid ${C.line}`, fontSize: 16.5, fontWeight: 500, lineHeight: 1.5, color: C.ink, whiteSpace: "pre-wrap" } as CSSProperties,
  editedTag: { fontSize: 11, fontWeight: 700, color: C.teal, marginLeft: 6 } as CSSProperties,
  area: { width: "100%", boxSizing: "border-box", margin: "11px 0 0", padding: "13px 15px", borderRadius: 12, border: `1.5px solid ${C.teal}`, fontSize: 16.5, fontWeight: 500, lineHeight: 1.5, color: C.ink, fontFamily: "inherit", background: "#fff", minHeight: 130, resize: "vertical" } as CSSProperties,
  why: { marginTop: 12, borderTop: `1px dashed ${C.line}`, paddingTop: 10 } as CSSProperties,
  whyHead: { fontSize: 11.5, fontWeight: 800, color: C.faint, letterSpacing: "0.04em", textTransform: "uppercase" as const, margin: "0 0 8px" } as CSSProperties,
  whyRow: { display: "flex", gap: 8, alignItems: "baseline", margin: "0 0 6px" } as CSSProperties,
  whyText: { fontSize: 13, fontWeight: 500, color: C.sub, lineHeight: 1.4 } as CSSProperties,
  actions: { display: "flex", gap: 9, marginTop: 14 } as CSSProperties,
  edit: { flex: "0 0 auto", padding: "13px 18px", borderRadius: 12, border: `1.5px solid ${C.teal}`, background: "#fff", color: C.teal, fontFamily: "inherit", fontSize: 14.5, fontWeight: 700, cursor: "pointer" } as CSSProperties,
  skip: { flex: "0 0 auto", padding: "13px 16px", borderRadius: 12, border: `1px solid ${C.line}`, background: "#fff", color: C.faint, fontFamily: "inherit", fontSize: 14.5, fontWeight: 700, cursor: "pointer" } as CSSProperties,
  save: { flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: C.teal, color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 800, cursor: "pointer" } as CSSProperties,
  prepHint: { margin: "9px 2px 0", fontSize: 11.5, fontWeight: 700, color: C.faint, textAlign: "center" as const } as CSSProperties,
  channelInfo: (open: boolean): CSSProperties => ({ margin: "11px 2px 0", fontSize: 12, fontWeight: 700, color: open ? "#1D7A54" : C.warn, textAlign: "center" }),
  attn: { background: C.warnBg, borderRadius: 16, padding: "15px 16px", margin: "0 14px 12px", border: `1px solid ${C.warnLine}` } as CSSProperties,
  attnReason: { margin: "8px 0 0", fontSize: 14, fontWeight: 600, color: C.warn, lineHeight: 1.4 } as CSSProperties,
  attnNote: { margin: "8px 0 0", fontSize: 12.5, fontWeight: 600, color: C.faint, lineHeight: 1.4 } as CSSProperties,
  histRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "10px 16px", margin: "0 14px", borderBottom: `1px solid ${C.line}` } as CSSProperties,
  histName: { fontSize: 14, fontWeight: 600, color: C.sub } as CSSProperties,
  // «Новые» (queue) — a card WITHOUT draft text: name/date/type + "суть" + generate/skip.
  essence: { margin: "9px 0 2px", fontSize: 13.5, fontWeight: 500, color: C.sub, lineHeight: 1.45 } as CSSProperties,
  queueActions: { display: "flex", gap: 9, marginTop: 12 } as CSSProperties,
  gen: { flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: C.teal, color: "#fff", fontFamily: "inherit", fontSize: 14.5, fontWeight: 800, cursor: "pointer" } as CSSProperties,
  genGhost: { flex: "0 0 auto", padding: "12px 16px", borderRadius: 12, border: `1px solid ${C.line}`, background: "#fff", color: C.faint, fontFamily: "inherit", fontSize: 14.5, fontWeight: 700, cursor: "pointer" } as CSSProperties,
  controlBar: { display: "flex", flexWrap: "wrap", gap: 8, padding: "4px 14px 10px" } as CSSProperties,
  controlBtn: { flex: "1 1 auto", padding: "10px 12px", borderRadius: 11, border: `1px solid ${C.line}`, background: "#fff", color: C.sub, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" } as CSSProperties,
  collapseHead: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", boxSizing: "border-box", padding: "14px 18px 8px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: C.faint, letterSpacing: "0.05em", textTransform: "uppercase" as const } as CSSProperties,
  showMore: { display: "block", boxSizing: "border-box", width: "calc(100% - 28px)", margin: "0 14px 12px", padding: "11px 12px", borderRadius: 11, border: `1px solid ${C.line}`, background: "#fff", color: C.sub, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" } as CSSProperties,
  chevron: { fontSize: 10, color: C.faint, fontWeight: 700 } as CSSProperties,
  modeRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 18px 6px" } as CSSProperties,
  modeLabel: { fontSize: 12, fontWeight: 700, color: C.faint } as CSSProperties,
  modeChip: (api: boolean): CSSProperties => ({ padding: "5px 11px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 800, background: api ? "#e7f5ee" : "#f0efec", color: api ? "#1D7A54" : "#8a8577" }),
};

const SIG_BADGE: Record<NonNullable<ReportCardModel["significanceBadge"]>, { bg: string; fg: string }> = {
  "разбор": { bg: "#fbf0dd", fg: "#8a6a2f" },
  "прогресс": { bg: "#e9f6e6", fg: "#3f7a2f" },
  "чисто": { bg: "#eef3f1", fg: "#5b6f69" },
};

function sendButtonStyle(on: boolean): CSSProperties {
  return { flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: on ? C.teal : "#9cc9ba", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 800, cursor: "pointer" };
}

function toastStyle(t: ReportToast): CSSProperties {
  const base = { margin: "11px 0 0", padding: "10px 13px", borderRadius: 11, fontSize: 13, fontWeight: 700, lineHeight: 1.4 };
  // Neutral note (prepare-only, informational) — blue, not the alarming warn-orange.
  if (t.tone === "info") return { ...base, background: "#eaf2f8", border: "1px solid #d3e3f0", color: "#2f6ea8" };
  return { ...base, background: t.ok ? "#eaf6f1" : C.warnBg, border: `1px solid ${t.ok ? "#cfe9df" : C.warnLine}`, color: t.ok ? C.tealDark : C.warn };
}

function tagStyle(bg: string, fg: string): CSSProperties {
  return { flex: "0 0 auto", padding: "1px 7px", borderRadius: 6, background: bg, color: fg, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.02em", textTransform: "uppercase", whiteSpace: "nowrap" };
}

const TAGS: Record<ReportTransparencyItem["kind"], { label: string; bg: string; fg: string }> = {
  praise: { label: "похвала", bg: "#e7f5ee", fg: "#1D7A54" },
  correction: { label: "коррекция", bg: "#fbf0dd", fg: "#8a6a2f" },
  care: { label: "забота", bg: "#efeafb", fg: "#6b4fa8" },
  question: { label: "вопрос", bg: "#e7f0fb", fg: "#3a6ea8" },
  comparison: { label: "сравнение", bg: "#e9f6e6", fg: "#3f7a2f" },
  arc: { label: "дуга", bg: "#eef3f1", fg: "#5b6f69" },
  signal: { label: "тренеру", bg: "#f0efec", fg: "#8a8577" },
  words: { label: "ученик писал", bg: "#eaf2f8", fg: "#2f6ea8" },
};

function openStudentChat(username: string | null) {
  if (!username || typeof window === "undefined") return;
  const url = `https://t.me/${username.replace(/^@/, "")}`;
  const tg = (globalThis as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } } }).Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank");
}

function CardHead(props: { card: ReportCardModel }) {
  const c = props.card;
  const tappable = Boolean(c.telegramUsername);
  return (
    <div style={R.top}>
      <span
        style={{ ...R.nameRow, cursor: tappable ? "pointer" : "default" }}
        onClick={tappable ? () => openStudentChat(c.telegramUsername) : undefined}
      >
        <span style={R.name}>{c.studentName}</span>
        {tappable ? <span style={R.chatDot}>💬</span> : null}
        {c.coachEdited ? <span style={R.editedTag}>правлено</span> : null}
      </span>
      <span style={R.meta}>{[c.dateLabel, c.sessionTypeLabel].filter(Boolean).join(" · ")}</span>
    </div>
  );
}

function Transparency(props: { items: ReportTransparencyItem[] }) {
  if (props.items.length === 0) return null;
  return (
    <div style={R.why}>
      <p style={R.whyHead}>Почему так</p>
      {props.items.map((item, i) => {
        const t = TAGS[item.kind];
        return (
          <div key={i} style={R.whyRow}>
            <span style={tagStyle(t.bg, t.fg)}>{t.label}</span>
            <span style={R.whyText}>{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}

// Compact "суть" for a card WITHOUT a draft: the first couple of transparency lines
// (skip the coach-only signal), so Igor sees what there is to discuss before generating.
function essenceOf(items: ReportTransparencyItem[]): string {
  const texts = items.filter((i) => i.kind !== "signal").map((i) => i.text);
  return texts.slice(0, 2).join(" · ");
}

function SigBadge(props: { badge: ReportCardModel["significanceBadge"] }) {
  if (!props.badge) return null;
  const c = SIG_BADGE[props.badge];
  return <span style={tagStyle(c.bg, c.fg)}>{props.badge}</span>;
}

// «Новые» card: no draft text yet. Igor decides per workout — «Сгенерить» (spend a paid
// API draft) or «Убрать» (he'll answer by hand). A signal-only coach note stays for context.
export function ReportQueueCard(props: {
  card: ReportCardModel;
  busy: ReportBusy;
  toast: ReportToast | undefined;
  onGenerate: (card: ReportCardModel) => void;
  onDismiss: (card: ReportCardModel, from: "queue") => void;
}) {
  const c = props.card;
  const busyHere = props.busy?.id === c.id ? props.busy.op : null;
  const generating = c.status === "generating" || busyHere === "generate";
  const essence = essenceOf(c.transparency);
  return (
    <div style={R.card}>
      <div style={R.top}>
        <span style={R.nameRow}>
          <span style={R.name}>{c.studentName}</span>
          <SigBadge badge={c.significanceBadge} />
        </span>
        <span style={R.meta}>{[c.dateLabel, c.sessionTypeLabel].filter(Boolean).join(" · ")}</span>
      </div>
      {essence ? <p style={R.essence}>{essence}</p> : null}
      <div style={R.queueActions}>
        <button type="button" style={R.gen} disabled={generating} onClick={() => props.onGenerate(c)}>
          {generating ? "Генерирую…" : "Сгенерить"}
        </button>
        <button type="button" style={R.genGhost} disabled={busyHere === "dismiss" || generating} onClick={() => props.onDismiss(c, "queue")}>
          Убрать
        </button>
      </div>
      {props.toast ? <p style={toastStyle(props.toast)}>{props.toast.text}</p> : null}
    </div>
  );
}

export function ReportReviewCard(props: {
  card: ReportCardModel;
  sendEnabled: boolean;
  editing: boolean;
  editValue: string;
  busy: ReportBusy;
  toast: ReportToast | undefined;
  onStartEdit: (card: ReportCardModel) => void;
  onChangeEdit: (v: string) => void;
  onSaveEdit: (card: ReportCardModel) => void;
  onCancelEdit: () => void;
  onSend: (card: ReportCardModel) => void;
  onShare: (card: ReportCardModel) => void;
  onDismiss: (card: ReportCardModel, from: "review" | "attention") => void;
}) {
  const c = props.card;
  const busyHere = props.busy?.id === c.id ? props.busy.op : null;

  return (
    <div style={R.card}>
      <CardHead card={c} />

      {props.editing ? (
        <>
          <textarea
            style={R.area}
            value={props.editValue}
            onChange={(e) => props.onChangeEdit(e.target.value)}
            autoFocus
          />
          <div style={R.actions}>
            <button type="button" style={R.save} disabled={busyHere === "save"} onClick={() => props.onSaveEdit(c)}>
              {busyHere === "save" ? "Сохраняю…" : "Сохранить"}
            </button>
            <button type="button" style={R.skip} onClick={props.onCancelEdit}>
              Отмена
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={R.draft}>{c.draftText}</p>
          <Transparency items={c.transparency} />
          {(() => {
            // Share is the path for a group, and the fallback for a DM whose 24h window is closed
            // (Business API would fail). So no card is ever left without a working way to send.
            const useShare = c.channel === "group" || (c.channel === "dm" && !c.windowOpen);
            const badge =
              c.channel === "none"
                ? "нет привязанного чата — отправить нельзя"
                : c.channel === "group"
                  ? `💬 группа — уйдёт шарингом с твоего аккаунта${c.mention ? `, с упоминанием ${c.mention}` : ""}`
                  : c.windowOpen
                    ? "✓ окно открыто — уйдёт в личку по «Отправить»"
                    : "⏳ окно закрыто (>24ч) — уйдёт шарингом по «Отправить в чат»";
            return (
              <>
                <p style={R.channelInfo(c.channel === "dm" && c.windowOpen === true)}>{badge}</p>
                <div style={R.actions}>
                  {c.channel === "none" ? (
                    <button type="button" style={{ ...sendButtonStyle(false), cursor: "default", opacity: 0.6 }} disabled>
                      Нет канала
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={sendButtonStyle(props.sendEnabled)}
                      disabled={busyHere === "send"}
                      onClick={() => (useShare ? props.onShare(c) : props.onSend(c))}
                    >
                      {busyHere === "send" ? "…" : useShare ? "Отправить в чат" : "Отправить"}
                    </button>
                  )}
                  <button type="button" style={R.edit} onClick={() => props.onStartEdit(c)}>
                    Править
                  </button>
                  <button type="button" style={R.skip} disabled={busyHere === "dismiss"} onClick={() => props.onDismiss(c, "review")}>
                    Пропустить
                  </button>
                </div>
                {!props.sendEnabled && c.channel !== "none" ? (
                  <p style={R.prepHint}>отправка выключена — кнопка готовит, но не шлёт (prepare-only)</p>
                ) : null}
              </>
            );
          })()}
        </>
      )}

      {props.toast ? <p style={toastStyle(props.toast)}>{props.toast.text}</p> : null}
    </div>
  );
}

export function ReportAttentionCard(props: {
  card: ReportCardModel;
  busy: ReportBusy;
  toast: ReportToast | undefined;
  onDismiss: (card: ReportCardModel, from: "review" | "attention") => void;
}) {
  const c = props.card;
  const busyHere = props.busy?.id === c.id ? props.busy.op : null;
  return (
    <div style={R.attn}>
      <CardHead card={c} />
      <p style={R.attnReason}>⚠️ {c.attentionReason}</p>
      <p style={R.attnNote}>Черновика ученику нет — это сигнал разобраться, не сообщение.</p>
      <div style={R.actions}>
        <button
          type="button"
          style={R.skip}
          disabled={busyHere === "dismiss"}
          onClick={() => props.onDismiss(c, "attention")}
        >
          {busyHere === "dismiss" ? "…" : "Разобрался"}
        </button>
      </div>
      {props.toast ? <p style={toastStyle(props.toast)}>{props.toast.text}</p> : null}
    </div>
  );
}

export function ReportsTab(props: {
  status: "idle" | "loading" | "ready" | "error";
  view: ReportsView | null;
  editingId: string | null;
  editValue: string;
  busy: ReportBusy;
  toast: ReportToasts;
  onStartEdit: (card: ReportCardModel) => void;
  onChangeEdit: (v: string) => void;
  onSaveEdit: (card: ReportCardModel) => void;
  onCancelEdit: () => void;
  onSend: (card: ReportCardModel) => void;
  onShare: (card: ReportCardModel) => void;
  onGenerate: (card: ReportCardModel) => void;
  onGenerateBatch: () => void;
  onBulkDismissOld: () => void;
  onToggleMode: () => void;
  onDismiss: (card: ReportCardModel, from: "review" | "attention" | "queue") => void;
}) {
  // «Новые» is capped to the top-N most-significant cards (queue is pre-sorted by
  // significance server-side) so a backlog doesn't render as a wall; the rest expand on
  // tap. «Разберись» and «История» are collapsed by default — coach opens them when needed.
  const [queueShowAll, setQueueShowAll] = useState(false);
  const [attnOpen, setAttnOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);

  if (props.status === "loading" || props.status === "idle") {
    return <div style={R.bigEmpty}>Загружаю…</div>;
  }
  if (props.status === "error" || !props.view) {
    return <div style={R.bigEmpty}>Не удалось загрузить отчёты.</div>;
  }
  const v = props.view;
  const batchBusy = props.busy?.op === "generate";
  const QUEUE_CAP = 15;
  const queueShown = queueShowAll ? v.queue : v.queue.slice(0, QUEUE_CAP);
  if (v.queue.length === 0 && v.review.length === 0 && v.attention.length === 0 && v.history.length === 0) {
    return <div style={R.bigEmpty}>Тренировок пока нет.<br />Появятся здесь после ночного разбора — по каждой решишь, генерить ответ или ответить самому.</div>;
  }

  return (
    <>
      {/* Backend toggle (coach-only): who writes the draft — paid API or Cowork subscription. */}
      <div style={R.modeRow}>
        <span style={R.modeLabel}>Генератор</span>
        <button type="button" style={R.modeChip(v.backend === "api")} onClick={props.onToggleMode}>
          {v.backend === "api" ? "API" : "Cowork"} · сменить
        </button>
      </div>

      {v.queue.length > 0 ? (
        <>
          <p style={R.groupLabel}>Новые · {v.queue.length}</p>
          <div style={R.controlBar}>
            <button type="button" style={R.controlBtn} disabled={batchBusy} onClick={props.onGenerateBatch}>
              {batchBusy ? "Генерирую…" : `Сгенерить свежие (до ${MAX_BATCH_UI})`}
            </button>
            <button type="button" style={R.controlBtn} onClick={props.onBulkDismissOld}>
              Убрать старше 3 дней
            </button>
          </div>
          {queueShown.map((card) => (
            <ReportQueueCard
              key={card.id}
              card={card}
              busy={props.busy}
              toast={props.toast[card.id]}
              onGenerate={props.onGenerate}
              onDismiss={props.onDismiss}
            />
          ))}
          {!queueShowAll && v.queue.length > QUEUE_CAP ? (
            <button type="button" style={R.showMore} onClick={() => setQueueShowAll(true)}>
              Показать ещё {v.queue.length - QUEUE_CAP}
            </button>
          ) : null}
        </>
      ) : null}

      {v.review.length > 0 ? (
        <>
          <p style={R.groupLabel}>Готовы к отправке · {v.review.length}</p>
          {v.review.map((card) => (
            <ReportReviewCard
              key={card.id}
              card={card}
              sendEnabled={v.sendEnabled}
              editing={props.editingId === card.id}
              editValue={props.editValue}
              busy={props.busy}
              toast={props.toast[card.id]}
              onStartEdit={props.onStartEdit}
              onChangeEdit={props.onChangeEdit}
              onSaveEdit={props.onSaveEdit}
              onCancelEdit={props.onCancelEdit}
              onSend={props.onSend}
              onShare={props.onShare}
              onDismiss={props.onDismiss}
            />
          ))}
        </>
      ) : null}

      {v.attention.length > 0 ? (
        <>
          <button type="button" style={R.collapseHead} onClick={() => setAttnOpen((o) => !o)}>
            <span>⚠️ Разберись · {v.attention.length}</span>
            <span style={R.chevron}>{attnOpen ? "▲ свернуть" : "▼ показать"}</span>
          </button>
          {attnOpen
            ? v.attention.map((card) => (
                <ReportAttentionCard key={card.id} card={card} busy={props.busy} toast={props.toast[card.id]} onDismiss={props.onDismiss} />
              ))
            : null}
        </>
      ) : null}

      {v.history.length > 0 ? (
        <>
          <button type="button" style={R.collapseHead} onClick={() => setHistOpen((o) => !o)}>
            <span>История · {v.history.length}</span>
            <span style={R.chevron}>{histOpen ? "▲ свернуть" : "▼ показать"}</span>
          </button>
          {histOpen
            ? v.history.map((card) => (
                <div key={card.id} style={R.histRow}>
                  <span style={R.histName}>{card.studentName}</span>
                  <span style={{ flex: "0 0 auto", fontSize: 12, fontWeight: 700, color: card.status === "sent" ? C.teal : C.warn }}>
                    {card.status === "sent" ? "отправлено ✓" : "передано в чат"}
                  </span>
                </div>
              ))
            : null}
        </>
      ) : null}
    </>
  );
}
