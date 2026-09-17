/** Типы рабочего контура ученика: план, чек-ин, перенос, текст тренера. */

/**
 * Один отрезок тренировки: разминка, работа, заминка. Та же форма, что строит
 * autoplanner-week.ts (Segment) до сплющивания в description — see
 * intervals_plan_sessions.segments.
 */
export type SessionSegment = {
  minutes: number;
  fastSec: number | null;
  slowSec: number | null;
  label: string;
  noPaceText?: string;
};

/**
 * Ориентир шага: чем именно человек должен управлять усилием.
 *
 * ЧЕТЫРЕ ВИДА, А НЕ ДВА (число/без числа), потому что «подберите сами» и
 * «фиксированное усилие 6 из 10» — разные обещания ученику, хотя оба «без
 * темпа». Раньше их различить было нельзя: любой шаг без пары чисел падал в
 * noPaceText одной кучей.
 */
export type StepTarget =
  | { kind: "pace"; fastSec: number; slowSec: number }
  | { kind: "rpe"; rpe: number }
  /** «Подберите сами» — читается иначе (ключевым словом), а не как ощущение вообще. */
  | { kind: "self_discovery"; hint?: string }
  | { kind: "free"; text: string };

/**
 * Один шаг тренировки при РУЧНОМ авторстве плана [решение Игоря, 17.09.2026].
 *
 * ВЛОЖЕННОСТЬ НА ОДИН УРОВЕНЬ — ЭТОГО ДОСТАТОЧНО. «7 × (бег + шаг)» встречается
 * в практике, «повтор внутри повтора» — нет; глубже одного уровня усложняет
 * модель ради случая, которого не было ни разу.
 */
export type SessionStep = {
  minutes: number;
  name: string;
  /** Одна строка, не абзац — длинное объяснение уходит в SessionNote. */
  detail?: string;
  /** Необязателен ТОЛЬКО у обёртки повтора — там сам показывается repeat.count, а не ориентир. */
  target?: StepTarget;
  repeat?: { count: number; steps: SessionStep[] };
};

/**
 * Пояснение к тренировке ЦЕЛИКОМ, а не к одному шагу — «как подобрать
 * скорость», «почему 55, а не 70». Отдельно от SessionStep.detail: тому
 * положена одна строка, здесь — сколько нужно текста.
 *
 * title: null — ТОЛЬКО для заметок к неделе целиком (PlanCycle.weekNotes):
 * баннер без заголовка наверху экрана. У заметок к тренировке title всегда есть.
 */
export type SessionNote = { title: string | null; body: string };

export type PlanSession = {
  id: string;
  cycleId: string;
  weekIndex: number;
  weekStart: string;
  sessionDate: string;
  dayIdx: number;
  role: string;
  title: string;
  minutes: number;
  presetCode: string | null;
  description: string | null;
  /** null — сессия сгенерирована до появления колонки, структуры нет. */
  segments: SessionSegment[] | null;
  /** Ручное авторство. Заполнено — рендер идёт по шагам, а не по segments/description. */
  steps: SessionStep[] | null;
  /** Пояснения к тренировке целиком, отдельной свёрнутой карточкой. */
  notes: SessionNote[] | null;
  targetMode: "pace" | "rpe" | null;
  rpe: number | null;
  deferred: boolean;
  deferReason: string | null;
  originalSessionDate: string | null;
  movedAt: string | null;
};

export type PlanCycle = {
  id: string;
  sourceId: string;
  intent: string;
  firstWeekStart: string;
  lengthWeeks: number;
  days: number;
  status: "draft" | "published" | "superseded";
  publishedAt: string | null;
  dataLevel: "heartrate" | "pace_only" | "none";
  startPointSource: "history" | "questionnaire";
  createdAt: string;
  /**
   * Заметки к неделе целиком (дорожка/дыхание, «обязательно записывайте...») —
   * показываются один раз вверху экрана, не копируются в каждую сессию.
   * title: null — баннер без заголовка; title задан — отдельная видимая карточка.
   */
  weekNotes: SessionNote[] | null;
};

export type ProgressionState = {
  sourceId: string;
  methodologyId: string;
  methodologyVersion: string;
  currentStep: number;
  sessionsAtStep: number;
  lastTransitionAt: string | null;
  recentSessions: Array<{ date: string; rpe: number | null; pain: boolean }>;
  canRunContinuously: boolean | null;
};

export type Checkin = {
  id: string;
  sourceId: string;
  planSessionId: string | null;
  activityId: string | null;
  sessionDate: string;
  effortRpe: number | null;
  effortLabel: string | null;
  pain: boolean;
  painNote: string | null;
  commentText: string | null;
  voiceFileId: string | null;
  stepBefore: number | null;
  stepAfter: number | null;
  progressionAction: string | null;
  progressionReason: string | null;
  createdAt: string;
};

export type CoachMessage = {
  id: string;
  sourceId: string;
  planSessionId: string | null;
  checkinId: string | null;
  activityId: string | null;
  body: string;
  status: "draft" | "prepared" | "sent";
  sentAt: string | null;
  /**
   * Когда текст стал виден ученице В ПРИЛОЖЕНИИ. null — не видит.
   *
   * ЭТО НЕ ТО ЖЕ, ЧТО status. Статус описывает судьбу уведомления в телеграм,
   * а видимость в приложении от телеграма не зависит: killswitch стережёт
   * push, а не сам факт ответа. Раньше это было склеено, и при выключенном
   * флаге ученица не получала ответ вообще нигде.
   */
  visibleToStudentAt: string | null;
  createdAt: string;
  context: Record<string, unknown>;
};

/**
 * Снимок контекста для корпуса «контекст → текст тренера».
 *
 * Каждое поле здесь — то, что тренер ВИДЕЛ, когда писал. Ссылки вместо значений
 * не годятся: ступень сдвинется, план перегенерируется, и через месяц ссылка
 * будет указывать на другое состояние.
 */
export type CoachMessageContext = {
  capturedAt: string;
  step: { index: number; labelRu: string } | null;
  methodology: { id: string; version: string } | null;
  plannedSession: {
    date: string;
    title: string;
    minutes: number;
    description: string | null;
    movedFrom: string | null;
  } | null;
  checkin: {
    date: string;
    effortLabel: string | null;
    effortRpe: number | null;
    pain: boolean;
    painNote: string | null;
    commentText: string | null;
    hasVoice: boolean;
    progressionAction: string | null;
    progressionReason: string | null;
  } | null;
  activity: {
    activityId: string;
    name: string | null;
    startedAt: string | null;
    movingSeconds: number | null;
    distanceMeters: number | null;
    averageHeartrate: number | null;
    dataLevel: string | null;
  } | null;
};
