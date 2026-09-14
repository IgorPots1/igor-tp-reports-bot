/** Типы рабочего контура ученика: план, чек-ин, перенос, текст тренера. */

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
