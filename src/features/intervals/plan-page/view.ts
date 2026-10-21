/**
 * Что показывает страница плана: те же intervals_*, что у /m/run, в форме
 * для четырёх вкладок (Тренировки / Мои дни / Тренер / История).
 *
 * Только чтение. Решения «что видно» здесь те же, что у мини-аппа:
 * - неделя без released не показывается (service.ts, 20.09.2026);
 * - заметки — только с адресатом student;
 * - ответ тренера — только видимый ей (visible_to_student_at).
 */
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

import { EFFORT_OPTIONS, PAIN_OPTIONS, SIMPLE_EFFORT_OPTIONS } from "../loop/effort-scale";
import { isPausedOn } from "../loop/pause";
import {
  getOnboardingAnswers,
  getProgression,
  getPublishedCycle,
  listPauses,
  listPlanWeeks,
  listSessionsInRange,
} from "../loop/repository";
import { studentNotes, type PlanSession, type SessionSegment, type SessionStep } from "../loop/types";

import { defaultSurface, type Surface } from "./core";

export const CHECKIN_FILE_BUCKET = "intervals-checkin-files";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;

export type SchemeStep = { v: string; w: string; rest?: boolean };
export type SessionScheme = {
  warm: string[];
  main: SchemeStep[];
  rep: { count: number; steps: SchemeStep[] } | null;
  cool: string[];
};

export type PageReport = {
  checkinId: string;
  surface: Surface | null;
  effortLabel: string | null;
  pain: boolean;
  minutes: number | null;
  distanceKm: number | null;
  speedKmh: number | null;
  recoverySpeedKmh: number | null;
  comment: string | null;
  files: { path: string; url: string | null }[];
};

export type PageReply = {
  id: string;
  body: string;
  at: string;
  isWeekReview: boolean;
  isNew: boolean;
};

export type PageSession = {
  id: string;
  date: string;
  weekStart: string;
  role: "quality" | "long" | "easy";
  title: string;
  minutes: number;
  movedFrom: string | null;
  scheme: SessionScheme;
  paused: boolean;
  report: PageReport | null;
  replies: PageReply[];
};

export type PageWeek = { weekStart: string; label: string; notes: string[]; sessions: PageSession[] };

export type CoachFeedItem = PageReply & { sessionId: string | null; sessionTitle: string | null; sessionDate: string | null };

export type PlanPageView = {
  studentName: string;
  todayIso: string;
  isManualEntry: boolean;
  effortQuestion: string;
  effortOptions: { code: string; label: string; hint: string }[];
  painOptions: { code: string; label: string }[];
  defaultSurface: Surface;
  current: PageWeek[];
  history: PageWeek[];
  coachFeed: CoachFeedItem[];
  myMessages: { id: string; body: string; at: string }[];
  days: { available: number[]; long: number | null };
};

const RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return shiftIso(iso, -((d.getUTCDay() + 6) % 7));
}

/** «19–25 октября», через границу месяца — «28 сентября – 4 октября». */
export function weekRangeLabel(weekStart: string): string {
  const end = shiftIso(weekStart, 6);
  const [, m1, d1] = weekStart.split("-").map(Number);
  const [, m2, d2] = end.split("-").map(Number);
  return m1 === m2
    ? `${d1}–${d2} ${RU_MONTHS[m2 - 1]}`
    : `${d1} ${RU_MONTHS[m1 - 1]} – ${d2} ${RU_MONTHS[m2 - 1]}`;
}

function minutesLabel(minutes: number): string {
  if (Number.isInteger(minutes)) return `${minutes}′`;
  const whole = Math.floor(minutes);
  const sec = Math.round((minutes - whole) * 60);
  return `${whole}:${String(sec).padStart(2, "0")}`;
}

function sentence(label: string, text: string | null | undefined): string {
  const t = (text ?? "").trim();
  return t ? `${label}. ${t}` : label;
}

const WORK_RE = /^Отрезок\s+\d+/u;

/**
 * Схема тренировки в рамке, как у Ильи: разминка списком, основная часть
 * схемой (повторы — одной строкой «× N»), заминка списком.
 *
 * Источник по приоритету: шаги, написанные тренером рукой (steps), затем
 * сегменты генератора, затем описание одной строкой — у самых старых недель
 * ничего другого нет.
 */
export function buildScheme(session: Pick<PlanSession, "steps" | "segments" | "description" | "minutes" | "title">): SessionScheme {
  if (session.steps && session.steps.length > 0) return schemeFromSteps(session.steps);
  if (session.segments && session.segments.length > 0) return schemeFromSegments(session.segments);
  return {
    warm: [],
    main: [{ v: minutesLabel(session.minutes), w: session.description?.trim() || session.title }],
    rep: null,
    cool: [],
  };
}

function stepLine(step: SessionStep): SchemeStep {
  const rest = step.target?.kind === "free" && /шаг/iu.test(step.target.text ?? "");
  return { v: minutesLabel(step.minutes), w: sentence(step.name, step.detail), rest: rest || undefined };
}

function schemeFromSteps(steps: SessionStep[]): SessionScheme {
  const repIdx = steps.findIndex((s) => s.repeat);
  if (repIdx < 0) return { warm: [], main: steps.map(stepLine), rep: null, cool: [] };
  const repeat = steps[repIdx].repeat!;
  return {
    warm: steps.slice(0, repIdx).map((s) => `${sentence(s.name, s.detail)} ${minutesLabel(s.minutes)}`),
    main: [],
    rep: { count: repeat.count, steps: repeat.steps.map(stepLine) },
    cool: steps.slice(repIdx + 1).map((s) => `${sentence(s.name, s.detail)} ${minutesLabel(s.minutes)}`),
  };
}

function segText(seg: SessionSegment): string | null {
  return seg.noPaceText ?? (seg as SessionSegment & { text?: string | null }).text ?? null;
}

function schemeFromSegments(segments: SessionSegment[]): SessionScheme {
  const workIdx = segments.map((s, i) => (WORK_RE.test(s.label) ? i : -1)).filter((i) => i >= 0);
  if (workIdx.length < 2) {
    return {
      warm: [],
      main: segments.map((s) => ({ v: minutesLabel(s.minutes), w: sentence(s.label, segText(s)), rest: /шаг/iu.test(s.label) || undefined })),
      rep: null,
      cool: [],
    };
  }
  const first = workIdx[0];
  const last = workIdx[workIdx.length - 1];
  const work = segments[first];
  const rest = segments[first + 1] && !WORK_RE.test(segments[first + 1].label) ? segments[first + 1] : null;
  const repSteps: SchemeStep[] = [{ v: minutesLabel(work.minutes), w: sentence("Отрезок", segText(work)) }];
  if (rest) repSteps.push({ v: minutesLabel(rest.minutes), w: sentence(rest.label, segText(rest)), rest: true });
  return {
    warm: segments.slice(0, first).map((s) => `${sentence(s.label, segText(s))} ${minutesLabel(s.minutes)}`),
    main: [],
    rep: { count: workIdx.length, steps: repSteps },
    cool: segments.slice(last + 1).map((s) => `${sentence(s.label, segText(s))} ${minutesLabel(s.minutes)}`),
  };
}

function roleOf(role: string): PageSession["role"] {
  return role === "quality" ? "quality" : role === "long" ? "long" : "easy";
}

export async function loadPlanPageView(input: {
  sourceId: string;
  studentName: string;
  todayIso: string;
}): Promise<PlanPageView> {
  const { sourceId, todayIso } = input;
  const supabase = createSupabaseServerClient();

  const [cycle, answers, progression, pauses, sourceRow] = await Promise.all([
    getPublishedCycle(sourceId),
    getOnboardingAnswers(sourceId),
    getProgression(sourceId),
    listPauses(sourceId),
    supabase.from("student_data_sources").select("auth_method").eq("id", sourceId).maybeSingle(),
  ]);
  const isManualEntry = (sourceRow.data as { auth_method?: string } | null)?.auth_method === "manual";

  const effortList = progression ? EFFORT_OPTIONS : SIMPLE_EFFORT_OPTIONS;
  const base = {
    studentName: input.studentName,
    todayIso,
    isManualEntry,
    effortQuestion: progression ? "Как далась" : "Как прошла",
    effortOptions: effortList.map((o) => ({ code: o.code, label: o.labelRu, hint: o.hintRu })),
    painOptions: PAIN_OPTIONS.map((o) => ({ code: o.code, label: o.labelRu })),
    defaultSurface: defaultSurface(answers?.runSurfaces ?? null),
    days: {
      available:
        answers && answers.availableWeekdays.length > 0
          ? [...answers.availableWeekdays].sort()
          : answers && answers.unavailableWeekdays.length > 0
            ? [0, 1, 2, 3, 4, 5, 6].filter((d) => !answers.unavailableWeekdays.includes(d))
            : [],
      long: answers?.preferredLongWeekday ?? null,
    },
  };

  const { data: msgRows, error: msgError } = await supabase
    .from("intervals_student_messages")
    .select("id, body, created_at")
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (msgError) throw new Error(`intervals_student_messages: ${describeSupabaseError(msgError)}`);
  const myMessages = (msgRows ?? []).map((r) => ({ id: String(r.id), body: String(r.body), at: String(r.created_at) }));

  if (!cycle) return { ...base, current: [], history: [], coachFeed: [], myMessages };

  const weeks = await listPlanWeeks(cycle.id);
  const released = weeks.filter((w) => w.status === "released").sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (released.length === 0) return { ...base, current: [], history: [], coachFeed: [], myMessages };

  const from = released[0].weekStart;
  const to = shiftIso(released[released.length - 1].weekStart, 6);
  const releasedSet = new Set(released.map((w) => w.weekStart));
  const sessions = (await listSessionsInRange(cycle.id, from, to)).filter((s) => releasedSet.has(s.weekStart));

  const [checkinRes, replyRes] = await Promise.all([
    supabase
      .from("intervals_checkins")
      .select("id, plan_session_id, session_date, activity_id, effort_label, pain, comment_text, surface, file_paths")
      .eq("source_id", sourceId)
      .gte("session_date", from),
    supabase
      .from("intervals_coach_messages")
      .select("id, plan_session_id, checkin_id, body, visible_to_student_at, created_at, seen_by_student_at, is_week_review")
      .eq("source_id", sourceId)
      .not("visible_to_student_at", "is", null)
      .order("visible_to_student_at", { ascending: false })
      .limit(200),
  ]);
  if (checkinRes.error) throw new Error(`intervals_checkins: ${describeSupabaseError(checkinRes.error)}`);
  if (replyRes.error) throw new Error(`intervals_coach_messages: ${describeSupabaseError(replyRes.error)}`);

  type CheckinRow = {
    id: string;
    plan_session_id: string | null;
    session_date: string;
    activity_id: string | null;
    effort_label: string | null;
    pain: boolean | null;
    comment_text: string | null;
    surface: Surface | null;
    file_paths: string[] | null;
  };
  const checkins = (checkinRes.data ?? []) as CheckinRow[];

  const activityIds = checkins.map((c) => c.activity_id).filter((x): x is string => !!x);
  const activities = new Map<string, { moving_time_s: number | null; distance_m: number | null; entered_speed_kmh: number | null; entered_recovery_speed_kmh: number | null }>();
  if (activityIds.length) {
    const { data, error } = await supabase
      .from("intervals_activities")
      .select("activity_id, moving_time_s, distance_m, entered_speed_kmh, entered_recovery_speed_kmh")
      .eq("source_id", sourceId)
      .in("activity_id", activityIds);
    if (error) throw new Error(`intervals_activities: ${describeSupabaseError(error)}`);
    for (const a of data ?? []) activities.set(String(a.activity_id), a as never);
  }

  const paths = checkins.flatMap((c) => c.file_paths ?? []);
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data } = await supabase.storage.from(CHECKIN_FILE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const x of data ?? []) if (x.path && x.signedUrl) signed.set(x.path, x.signedUrl);
  }

  /**
   * ОТЧЁТ К ТРЕНИРОВКЕ: по plan_session_id, иначе по дате.
   *
   * Второй путь не роскошь. У Валентины шесть циклов, пять заменены, и её
   * сентябрьские отчёты указывают на тренировки ЗАМЕНЁННЫХ циклов. По одному
   * id текущего цикла сентябрь читался бы «не отмечено» при живых отчётах.
   */
  const sessionIds = new Set(sessions.map((s) => s.id));
  const byId = new Map<string, CheckinRow>();
  const byDate = new Map<string, CheckinRow>();
  for (const c of checkins) {
    if (c.plan_session_id && sessionIds.has(c.plan_session_id)) byId.set(c.plan_session_id, c);
    else if (c.plan_session_id) byDate.set(c.session_date, c);
  }

  const checkinToSession = new Map<string, string>();
  const toReport = (c: CheckinRow): PageReport => {
    const a = c.activity_id ? activities.get(c.activity_id) : undefined;
    return {
      checkinId: c.id,
      surface: c.surface,
      effortLabel: c.effort_label,
      pain: c.pain === true,
      minutes: a?.moving_time_s ? Math.round(Number(a.moving_time_s) / 60) : null,
      distanceKm: a?.distance_m ? Math.round(Number(a.distance_m) / 10) / 100 : null,
      speedKmh: a?.entered_speed_kmh != null ? Number(a.entered_speed_kmh) : null,
      recoverySpeedKmh: a?.entered_recovery_speed_kmh != null ? Number(a.entered_recovery_speed_kmh) : null,
      comment: c.comment_text,
      files: (c.file_paths ?? []).map((p) => ({ path: p, url: signed.get(p) ?? null })),
    };
  };

  const pageSessions: PageSession[] = sessions.map((s) => {
    const c = byId.get(s.id) ?? byDate.get(s.sessionDate) ?? null;
    if (c) checkinToSession.set(c.id, s.id);
    return {
      id: s.id,
      date: s.sessionDate,
      weekStart: s.weekStart,
      role: roleOf(s.role),
      title: s.title,
      minutes: s.minutes,
      movedFrom: s.originalSessionDate,
      scheme: buildScheme(s),
      paused: isPausedOn(s.sessionDate, pauses),
      report: c ? toReport(c) : null,
      replies: [],
    };
  });
  const sessionById = new Map(pageSessions.map((s) => [s.id, s]));

  const coachFeed: CoachFeedItem[] = [];
  for (const r of replyRes.data ?? []) {
    const reply: PageReply = {
      id: String(r.id),
      body: String(r.body),
      at: String(r.visible_to_student_at ?? r.created_at),
      isWeekReview: r.is_week_review === true,
      isNew: r.seen_by_student_at === null,
    };
    const sessionId =
      (r.checkin_id && checkinToSession.get(String(r.checkin_id))) ||
      (r.plan_session_id && sessionById.has(String(r.plan_session_id)) ? String(r.plan_session_id) : null);
    const session = sessionId ? sessionById.get(sessionId) ?? null : null;
    if (session) session.replies.push(reply);
    coachFeed.push({ ...reply, sessionId, sessionTitle: session?.title ?? null, sessionDate: session?.date ?? null });
  }
  for (const s of pageSessions) s.replies.sort((a, b) => a.at.localeCompare(b.at));

  const thisMonday = mondayOf(todayIso);
  const toWeek = (w: (typeof released)[number]): PageWeek => ({
    weekStart: w.weekStart,
    label: weekRangeLabel(w.weekStart),
    notes: studentNotes(w.notes).map((n) => n.body),
    sessions: pageSessions.filter((s) => s.weekStart === w.weekStart),
  });
  let current = released.filter((w) => w.weekStart >= thisMonday).map(toWeek);
  let history = released.filter((w) => w.weekStart < thisMonday).map(toWeek).reverse();
  // Своя неделя ещё не отдана — показываем последнюю отданную, а не пустоту.
  if (current.length === 0 && history.length > 0) {
    current = [history[0]];
    history = history.slice(1);
  }

  return { ...base, current, history, coachFeed, myMessages };
}
