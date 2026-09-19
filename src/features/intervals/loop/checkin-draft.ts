/**
 * Черновик отчёта на устройстве.
 *
 * ЗАЧЕМ. 19.09.2026 ученица написала длинный рассказ о том, как закрыла
 * тренировку и открыла заново, нажала «Отправить», форма не пропустила из-за
 * темпа — и текст исчез. В базе не осталось ничего: чек-ин не сохранился, а
 * черновика не было. Потеря не в одном поле темпа: ЛЮБАЯ неудачная отправка
 * (нет сети, отказ сервера, промах в поле) уносила всё написанное.
 *
 * ГДЕ ЖИВЁТ. localStorage, то есть только на устройстве этого человека. Не в
 * базе: черновик — это не отчёт, тренеру он не нужен и показывать его нельзя.
 * Синхронизации между устройствами тоже нет, и это честно: человек писал
 * с телефона, туда и вернётся.
 *
 * ПОЧЕМУ ВСЕ ОБРАЩЕНИЯ ОБЁРНУТЫ. В приватном окне, при выключенных данных
 * сайта и внутри некоторых webview обращение к localStorage БРОСАЕТ, а не
 * возвращает пусто. Форма обязана работать и без хранилища: черновик — это
 * удобство, а не условие отправки.
 *
 * СРОК ЖИЗНИ. Черновик недельной давности описывает тренировку, которой человек
 * уже не помнит, и всплывать в форме он не должен. Неделя — ровно тот срок, за
 * который отчёт либо отправляют, либо забывают.
 */

export type CheckinDraft = {
  effort: string | null;
  pain: string | null;
  comment: string;
  date: string;
  durationMinutes: string;
  distanceKm: string;
  averageHeartrate: string;
  averagePace: string;
  /** Когда черновик записан, мс. По нему считается срок жизни. */
  savedAt: number;
};

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PREFIX = "run-checkin-draft:";

/** Ключ на конкретную тренировку. Внеплановая — свой собственный, не общий. */
export function draftKey(sessionId: string | null): string {
  return `${PREFIX}${sessionId ?? "unplanned"}`;
}

/** Пустой ли черновик: нечего восстанавливать — нечего и показывать. */
export function isDraftEmpty(draft: CheckinDraft): boolean {
  return (
    draft.effort === null &&
    draft.pain === null &&
    draft.comment.trim() === "" &&
    draft.durationMinutes.trim() === "" &&
    draft.distanceKm.trim() === "" &&
    draft.averageHeartrate.trim() === "" &&
    draft.averagePace.trim() === ""
  );
}

/** Разбор того, что лежит в хранилище. Мусор и просрочку отбрасываем молча. */
export function parseDraft(raw: string | null, nowMs: number): CheckinDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const row = parsed as Record<string, unknown>;
  const savedAt = typeof row.savedAt === "number" ? row.savedAt : 0;
  if (savedAt <= 0 || nowMs - savedAt > DRAFT_TTL_MS) return null;

  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const code = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
  const draft: CheckinDraft = {
    effort: code(row.effort),
    pain: code(row.pain),
    comment: text(row.comment),
    date: text(row.date),
    durationMinutes: text(row.durationMinutes),
    distanceKm: text(row.distanceKm),
    averageHeartrate: text(row.averageHeartrate),
    averagePace: text(row.averagePace),
    savedAt,
  };
  return isDraftEmpty(draft) ? null : draft;
}

export function serializeDraft(draft: CheckinDraft): string {
  return JSON.stringify(draft);
}

/* ── Обращения к хранилищу. Каждое в try/catch: бросает — живём без черновика ── */

export function readDraft(sessionId: string | null, nowMs: number): CheckinDraft | null {
  try {
    return parseDraft(window.localStorage.getItem(draftKey(sessionId)), nowMs);
  } catch {
    return null;
  }
}

export function writeDraft(sessionId: string | null, draft: CheckinDraft): void {
  try {
    if (isDraftEmpty(draft)) {
      window.localStorage.removeItem(draftKey(sessionId));
      return;
    }
    window.localStorage.setItem(draftKey(sessionId), serializeDraft(draft));
  } catch {
    /* хранилище недоступно — форма всё равно работает */
  }
}

export function clearDraft(sessionId: string | null): void {
  try {
    window.localStorage.removeItem(draftKey(sessionId));
  } catch {
    /* см. выше */
  }
}
