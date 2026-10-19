import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

/* Личные страницы планов учеников (igorp.run/plan/<slug>/<token>).
 *
 * Доступ без аккаунтов, по двум секретным ссылкам из athlete_plans:
 *   athlete_token — ученик: видит план, шлёт и правит свои отчёты;
 *   coach_token   — тренер: видит то же, отвечает на отчёты.
 * Роль берётся ТОЛЬКО из токена, никогда из тела запроса. slug в пути нужен
 * для читаемости и обязан совпасть со строкой токена, иначе 404.
 *
 * План (plan jsonb) пишет тренер через SQL; страница его только читает.
 * Его форма описана типом PlanDoc ниже, рендер терпим к пропущенным полям. */

export const FILE_BUCKET = "athlete-plan-files";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;
const TOKEN_RE = /^[a-f0-9]{24,64}$/;
const SLUG_RE = /^[a-z0-9-]{2,40}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{1,60}$/;

export type PlanRole = "athlete" | "coach";

export type PlanStep = { v: string; w: string; rest?: boolean };
export type PlanSection = {
  h: string;
  items?: string[];
  stations?: [string, string?][];
  scheme?: { steps: PlanStep[]; repeat?: string };
};
export type PlanSession = {
  id: string;
  date?: string;
  kind?: string;
  duration?: string;
  title: string;
  summary?: string;
  sections?: PlanSection[];
  tips?: ({ b?: string; t: string } | string)[];
  ask?: string[];
};
export type PlanWeek = { id: string; label?: string; start?: string; title?: string; focus?: string; sessions: PlanSession[] };
export type PlanDoc = {
  title?: string;
  eyebrow?: string;
  note?: string;
  raceDate?: string | null;
  tags?: { k?: string; v?: string; hot?: boolean }[];
  weeks?: PlanWeek[];
};

export type PlanReport = {
  sessionId: string;
  status: "done" | "partial" | "skipped";
  rpe: number | null;
  feel: string | null;
  fields: Record<string, string>;
  comment: string | null;
  files: { path: string; url: string | null }[];
  coachReply: string | null;
  coachReplyAt: string | null;
  updatedAt: string;
};

export type PlanView = {
  role: PlanRole;
  athleteName: string;
  plan: PlanDoc;
  reports: Record<string, PlanReport>;
};

export type PlanAccess = {
  planId: string;
  role: PlanRole;
  athleteName: string;
  telegramChatId: string | null;
  plan: PlanDoc;
};

export class PlanInputError extends Error {}

export async function resolvePlanToken(slug: string, token: string): Promise<PlanAccess | null> {
  if (!SLUG_RE.test(slug) || !TOKEN_RE.test(token)) return null;
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_plans")
    .select("id,slug,athlete_name,telegram_chat_id,athlete_token,coach_token,plan,archived")
    .eq("slug", slug)
    .or(`athlete_token.eq.${token},coach_token.eq.${token}`)
    .maybeSingle();
  if (error) throw new Error(`athlete_plans lookup: ${describeSupabaseError(error)}`);
  if (!data || data.archived) return null;
  return {
    planId: data.id as string,
    role: data.coach_token === token ? "coach" : "athlete",
    athleteName: data.athlete_name as string,
    telegramChatId: (data.telegram_chat_id as string | null) ?? null,
    plan: (data.plan as PlanDoc) ?? {},
  };
}

export async function loadPlanView(access: PlanAccess): Promise<PlanView> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_plan_reports")
    .select("session_id,status,rpe,feel,fields,comment,file_paths,coach_reply,coach_reply_at,updated_at")
    .eq("plan_id", access.planId);
  if (error) throw new Error(`athlete_plan_reports: ${describeSupabaseError(error)}`);
  const rows = data ?? [];

  const paths = rows.flatMap((r) => (r.file_paths as string[] | null) ?? []);
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: s } = await supabase.storage.from(FILE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const x of s ?? []) if (x.path && x.signedUrl) signed.set(x.path, x.signedUrl);
  }

  const reports: Record<string, PlanReport> = {};
  for (const r of rows) {
    reports[r.session_id as string] = {
      sessionId: r.session_id as string,
      status: r.status as PlanReport["status"],
      rpe: (r.rpe as number | null) ?? null,
      feel: (r.feel as string | null) ?? null,
      fields: (r.fields as Record<string, string>) ?? {},
      comment: (r.comment as string | null) ?? null,
      files: ((r.file_paths as string[] | null) ?? []).map((p) => ({ path: p, url: signed.get(p) ?? null })),
      coachReply: (r.coach_reply as string | null) ?? null,
      coachReplyAt: (r.coach_reply_at as string | null) ?? null,
      updatedAt: r.updated_at as string,
    };
  }
  return { role: access.role, athleteName: access.athleteName, plan: access.plan, reports };
}

export function findSession(plan: PlanDoc, sessionId: string): { session: PlanSession; week: PlanWeek } | null {
  for (const week of plan.weeks ?? []) {
    const session = (week.sessions ?? []).find((s) => s.id === sessionId);
    if (session) return { session, week };
  }
  return null;
}

/* Поля отчёта, которые может попросить тренировка (session.ask). Ключи
 * фиксированы, чтобы в fields не утекало ничего, кроме этих строк. */
export const REPORT_FIELDS = ["distance", "time", "hr", "pace", "speed", "splits", "stations", "fuel"] as const;
const FEELS = ["Легко", "Нормально", "Тяжело", "Не вытянул"];
const MAX_FILES = 2;
const MAX_NEW_FILES = 2;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().slice(0, max);
  return v || null;
}

export type ReportInput = {
  sessionId: string;
  status: PlanReport["status"];
  rpe: number | null;
  feel: string | null;
  fields: Record<string, string>;
  comment: string | null;
  keepPaths: string[];
  newFiles: string[];
};

export function parseReportInput(body: Record<string, unknown>): ReportInput | { error: string } {
  const sessionId = typeof body.sessionId === "string" && SESSION_RE.test(body.sessionId) ? body.sessionId : null;
  if (!sessionId) return { error: "Не найдена тренировка" };
  const status = body.status === "partial" || body.status === "skipped" ? body.status : "done";
  const rpeNum = Number(body.rpe);
  const rpe = Number.isInteger(rpeNum) && rpeNum >= 1 && rpeNum <= 10 ? rpeNum : null;
  const feel = typeof body.feel === "string" && FEELS.includes(body.feel) ? body.feel : null;
  const fields: Record<string, string> = {};
  const rawFields = (body.fields ?? {}) as Record<string, unknown>;
  for (const k of REPORT_FIELDS) {
    const v = clean(rawFields[k], k === "splits" || k === "stations" ? 1200 : 120);
    if (v) fields[k] = v;
  }
  const keepPaths = Array.isArray(body.keepPaths)
    ? body.keepPaths.filter((p): p is string => typeof p === "string").slice(0, MAX_FILES)
    : [];
  const newFiles = Array.isArray(body.newFiles)
    ? body.newFiles.filter((p): p is string => typeof p === "string")
    : [];
  if (newFiles.length > MAX_NEW_FILES) return { error: `За раз можно добавить до ${MAX_NEW_FILES} скриншотов` };
  if (keepPaths.length + newFiles.length > MAX_FILES) return { error: `Не больше ${MAX_FILES} скриншотов на тренировку` };
  return { sessionId, status, rpe, feel, fields, comment: clean(body.comment, 3000), keepPaths, newFiles };
}

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

async function storeFile(planId: string, sessionId: string, dataUrl: string): Promise<string> {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) throw new PlanInputError("Скриншот должен быть JPG, PNG или WEBP");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_FILE_BYTES) throw new PlanInputError("Скриншот слишком большой");
  const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
  const path = `${planId}/${sessionId}/${crypto.randomUUID()}.${ext}`;
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.storage.from(FILE_BUCKET).upload(path, bytes, { contentType: m[1], upsert: false });
  if (error) throw new Error(`file upload: ${describeSupabaseError(error)}`);
  return path;
}

/** Сохраняет отчёт ученика. Возвращает true, если отчёт новый (не правка). */
export async function saveReport(planId: string, input: ReportInput): Promise<boolean> {
  const supabase = createSupabaseServerClient();
  const { data: existing, error: readErr } = await supabase
    .from("athlete_plan_reports")
    .select("id,file_paths")
    .eq("plan_id", planId)
    .eq("session_id", input.sessionId)
    .maybeSingle();
  if (readErr) throw new Error(`athlete_plan_reports read: ${describeSupabaseError(readErr)}`);

  // Оставить можно только свои же прежние файлы этой тренировки.
  const prev = ((existing?.file_paths as string[] | null) ?? []);
  const keep = input.keepPaths.filter((p) => prev.includes(p));
  const added: string[] = [];
  for (const f of input.newFiles) added.push(await storeFile(planId, input.sessionId, f));

  const row = {
    plan_id: planId,
    session_id: input.sessionId,
    status: input.status,
    rpe: input.status === "skipped" ? null : input.rpe,
    feel: input.status === "skipped" ? null : input.feel,
    fields: input.status === "skipped" ? {} : input.fields,
    comment: input.comment,
    file_paths: [...keep, ...added],
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    const { error } = await supabase.from("athlete_plan_reports").update(row).eq("id", existing.id as string);
    if (error) throw new Error(`athlete_plan_reports update: ${describeSupabaseError(error)}`);
    const removed = prev.filter((p) => !keep.includes(p));
    if (removed.length) await supabase.storage.from(FILE_BUCKET).remove(removed);
    return false;
  }
  const { error } = await supabase.from("athlete_plan_reports").insert(row);
  if (error) throw new Error(`athlete_plan_reports insert: ${describeSupabaseError(error)}`);
  return true;
}

export async function saveCoachReply(planId: string, sessionId: string, reply: string | null): Promise<void> {
  if (!SESSION_RE.test(sessionId)) throw new PlanInputError("Не найдена тренировка");
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_plan_reports")
    .update({ coach_reply: reply, coach_reply_at: reply ? new Date().toISOString() : null })
    .eq("plan_id", planId)
    .eq("session_id", sessionId)
    .select("id");
  if (error) throw new Error(`athlete_plan_reports reply: ${describeSupabaseError(error)}`);
  if (!data?.length) throw new PlanInputError("Отчёта по этой тренировке ещё нет");
}

const STATUS_RU = { done: "выполнил", partial: "частично", skipped: "пропустил" } as const;
const FIELD_RU: Record<string, string> = {
  distance: "Дистанция",
  time: "Время",
  hr: "Пульс",
  pace: "Темп",
  speed: "Скорость",
  splits: "Отрезки",
  stations: "Станции",
  fuel: "Еда",
};

/** Короткое уведомление тренеру в чат лидов. Сбой уведомления отчёт не валит. */
export async function notifyCoach(access: PlanAccess, input: ReportInput, isNew: boolean, filesCount: number): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.LEADS_CHAT_ID;
  if (!botToken || !chat) return;
  const found = findSession(access.plan, input.sessionId);
  const title = found ? `${found.session.title}${found.session.date ? ` (${found.session.date})` : ""}` : input.sessionId;
  const lines = [
    `${isNew ? "📋 Отчёт" : "✏️ Правка отчёта"}: ${access.athleteName}`,
    `${title}: ${STATUS_RU[input.status]}`,
  ];
  if (input.rpe) lines.push(`Нагрузка ${input.rpe}/10${input.feel ? `, ${input.feel.toLowerCase()}` : ""}`);
  for (const [k, v] of Object.entries(input.fields)) lines.push(`${FIELD_RU[k] ?? k}: ${v}`);
  if (input.comment) lines.push(`«${input.comment.slice(0, 600)}»`);
  if (filesCount) lines.push(`Скриншотов: ${filesCount}`);
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: lines.join("\n"), disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error("[plan] notify failed", e);
  }
}
