// Feedback-sweep health — makes a failed / stuck / stale / zero-output sweep VISIBLE.
//
// The sweep already writes a run row to trainingpeaks_cron_run_logs (started → sent |
// failed, with counts + errorMessage), so a crash is recorded loudly. The gap was
// that nobody LOOKS. This classifier turns the latest run into a one-line status for
// a check script (scripts/check-feedback-sweep-health.ts) and is UI-ready for an
// admin indicator: `const h = await loadFeedbackSweepHealth(); render(h.level, h.message)`.
//
// No notifications are sent — visible status only (Igor's rule).

import { getLatestTrainingPeaksCronRunLog, type TrainingPeaksCronRunLog } from "@/features/trainingpeaks/repository";

export const FEEDBACK_ENQUEUE_JOB = "workout_feedback_enqueue";
/** Runs ~daily right after fit-ingest; no run in > this many hours = stale. */
export const SWEEP_STALE_HOURS = 30;
/** A "started" row older than this never finished = stuck. */
export const SWEEP_STUCK_HOURS = 2;

export type SweepHealthLevel = "ok" | "info" | "alert";
export type SweepHealth = {
  level: SweepHealthLevel;
  code: "no_runs" | "failed" | "stuck" | "stale" | "zero_output" | "ok";
  message: string;
  lastRun: TrainingPeaksCronRunLog | null;
};

/** Pure: classify the latest run. `nowMs` injected for testability. */
export function classifySweepHealth(
  run: TrainingPeaksCronRunLog | null,
  nowMs: number,
  opts?: { staleHours?: number; stuckHours?: number }
): SweepHealth {
  const staleHours = opts?.staleHours ?? SWEEP_STALE_HOURS;
  const stuckHours = opts?.stuckHours ?? SWEEP_STUCK_HOURS;
  if (!run) {
    return { level: "alert", code: "no_runs", message: "фидбек-свип: НЕТ прогонов в логе", lastRun: null };
  }
  const ageHours = (nowMs - new Date(run.startedAt).getTime()) / 3_600_000;
  if (run.status === "failed") {
    return { level: "alert", code: "failed", message: `фидбек-свип УПАЛ (${run.startedAt}): ${run.errorMessage ?? "без сообщения"}`, lastRun: run };
  }
  if (run.status === "started" && ageHours > stuckHours) {
    return { level: "alert", code: "stuck", message: `фидбек-свип завис в "started" ${ageHours.toFixed(1)}ч`, lastRun: run };
  }
  if (ageHours > staleHours) {
    return { level: "alert", code: "stale", message: `фидбек-свип не прогонялся ${Math.round(ageHours)}ч (порог ${staleHours}ч)`, lastRun: run };
  }
  const enqueued = Number(run.counts?.runsEnqueued ?? run.counts?.enqueued ?? 0);
  if (run.status === "sent" && enqueued === 0) {
    return { level: "info", code: "zero_output", message: `последний прогон (${run.startedAt}) — 0 в очередь (норма, если не было новых отчётов)`, lastRun: run };
  }
  return { level: "ok", code: "ok", message: `фидбек-свип ОК (${run.startedAt}), в очередь: ${enqueued}`, lastRun: run };
}

export async function loadFeedbackSweepHealth(nowMs: number = Date.now()): Promise<SweepHealth> {
  const run = await getLatestTrainingPeaksCronRunLog({ jobName: FEEDBACK_ENQUEUE_JOB });
  return classifySweepHealth(run, nowMs);
}
