/* English renderings of the workouts in the free week. Nothing here is invented:
 *
 *   ladder sessions → BEGINNER_LADDER (src/features/methodology/beginner.ts): every number
 *     (reps, run and walk minutes, continuous minutes, total) comes from the step itself, and
 *     the wording follows stepDescriptionRu line by line (the library texts in
 *     workout_template_description_refs are generated from it, see check:beginner-methodology);
 *   runner sessions → library presets of the easy and long_run families
 *     (supabase/migrations/20260911000000_seed_parametric_easy_long_steady_presets.sql);
 *   the walk after "Something hurt" → the Russian bot's brisk_walk_30 (WALK_WORKOUT).
 *
 * RUNNER DURATIONS come from the weekly volume the person gave (logic.ts runnerWeek), inside
 * the library's advisory bands (checked against the migration by check:en-week):
 *   easy_continuous 30..60 (band 30-70), easy_plus_strides 30..55 (band 30-55) incl. 5 x 15 sec
 *   strides (preset reps 5, 15 sec), long_aerobic 35..90, recovery_easy 25 (band 20-35).
 * Paces (when there is a best result) come from paces.ts, the same math as Igor's calculator.
 * Effort wording for easy running: "effort 2-4 out of 10", as in the beginner methodology.
 *
 * INTERVALS (int_walk_3x3 / 4x3 / 5x3, why these: logic.ts intervalFor). From the library:
 *   reps 3/4/5 x 3 min, recovery 1 min WALKING, RPE target 6, cap 7
 *   (supabase/migrations/20260918_short_interval_presets.sql);
 *   warm-up / cool-down refs of the family (copied from thr_5x4): warmup_standard_easy_10_15 and
 *   cooldown_easy_10_15. Their texts in the library are placeholders, so the words come from
 *   how the generator writes the same session (tools/trainingpeaks-export/scripts/lib/
 *   autoplanner-week.ts): simple warm-up 10 min easy for L0-L1, effortText(6) for the work
 *   ("breathing noticeably faster, you can still talk in sentences"), "just walk" for the
 *   walking recovery, cool-down until breathing settles. 10 min each end: the bottom of the
 *   refs' 10-15 band, a stranger's first quality session. */

import { BEGINNER_LADDER, stepByIndex, type BeginnerStep } from "@/features/methodology/beginner";
import { WALK_PRESET, presetForRung } from "@/features/trial-bot/logic";

import { isInterval, type EnPlanned, type IntervalPreset, type RunnerPreset } from "./logic";
import { paceRangeText, slowerThanText, type Paces } from "./paces";

export type WorkoutEn = {
  presetCode: string;
  title: string;
  minutes: number;
  /** Short lines for the plan page (expandable list). */
  steps: string[];
  /** One paragraph: the full description, stored in en_week_sessions.body_en. */
  body: string;
};

export const STRIDES = { reps: 5, seconds: 15 } as const;

/** Library parameters of the int_walk presets used in the free week. */
export const INTERVALS: Record<IntervalPreset, { reps: number; workMin: number; walkMin: number; rpeTarget: number; rpeCap: number }> = {
  int_walk_3x3: { reps: 3, workMin: 3, walkMin: 1, rpeTarget: 6, rpeCap: 7 },
  int_walk_4x3: { reps: 4, workMin: 3, walkMin: 1, rpeTarget: 6, rpeCap: 7 },
  int_walk_5x3: { reps: 5, workMin: 3, walkMin: 1, rpeTarget: 6, rpeCap: 7 },
};
export const INTERVAL_WARMUP_MIN = 10;
export const INTERVAL_COOLDOWN_MIN = 10;

export function intervalMinutes(p: IntervalPreset): number {
  const i = INTERVALS[p];
  return INTERVAL_WARMUP_MIN + i.reps * i.workMin + (i.reps - 1) * i.walkMin + INTERVAL_COOLDOWN_MIN;
}

const FEEL =
  "Don't look at pace or heart rate, only at how it feels: effort 2-4 out of 10, steady breathing, you can talk in full sentences.";
const STOP = "If anything hurts or feels wrong, stop or switch to walking, and tell me.";
const RATE_LADDER = "After the workout, tap how it went: easy, OK or hard. The next workout depends on it.";
const RATE_RUNNER = "After the run, tap how it went: easy, OK or hard. The next session depends on it.";

function walkText(min: number): string {
  if (min === 1.5) return "1 min 30 sec";
  return `${min} min`;
}

function repsText(step: BeginnerStep): string {
  return step.repsMin && step.repsMin !== step.reps ? `${step.repsMin}-${step.reps}` : String(step.reps);
}

/** stepDescriptionRu in English, same structure and numbers. */
export function stepDescriptionEn(step: BeginnerStep): string {
  const tail = `${FEEL} ${STOP} ${RATE_LADDER}`;
  if (step.kind === "continuous") {
    return (
      `${step.continuousMin} minutes of continuous easy running, no walking breaks. ` +
      `If it gets hard, switch to walking and tap Hard: the next workout will be easier. ${tail}`
    );
  }
  return `${repsText(step)} rounds: ${step.runMin} min easy running + ${walkText(step.walkMin!)} walking. Walking is your rest, take it easy. ${tail}`;
}

export function stepTitleEn(step: BeginnerStep): string {
  if (step.kind === "continuous") return `${step.continuousMin} min easy run`;
  return `${repsText(step)} x (${step.runMin} min run + ${walkText(step.walkMin!)} walk)`;
}

export function ladderWorkout(rung: number): WorkoutEn {
  const step = stepByIndex(rung);
  const steps =
    step.kind === "continuous"
      ? [`Run ${step.continuousMin} min without stopping, effort 2-4 out of 10`, "If it gets hard, walk and tap Hard afterwards"]
      : [
          `Run easy for ${step.runMin} min`,
          `Walk for ${walkText(step.walkMin!)}`,
          `Repeat ${repsText(step)} times (about ${Math.round(step.totalMinutes)} min in total)`,
        ];
  return { presetCode: presetForRung(rung), title: stepTitleEn(step), minutes: step.totalMinutes, steps, body: stepDescriptionEn(step) };
}

export const WALK_WORKOUT_EN: WorkoutEn = {
  presetCode: WALK_PRESET,
  title: "30 min brisk walk",
  minutes: 30,
  steps: ["Walk briskly for 30 min instead of running", "Smooth and steady, no bursts"],
  body: "A 30 minute brisk walk instead of running: smooth and steady, no bursts. This is recovery, not a skipped day.",
};

export function intervalTitle(p: IntervalPreset): string {
  const i = INTERVALS[p];
  return `${i.reps} x ${i.workMin} min with ${i.walkMin} min walking`;
}

export function intervalWorkout(p: IntervalPreset, paces: Paces | null = null): WorkoutEn {
  const i = INTERVALS[p];
  const work = `effort ${i.rpeTarget} out of 10: breathing noticeably faster, you can still talk in sentences`;
  const workPace = paces ? ` Pace guide: ${paceRangeText(paces.tempo)}, but effort comes first.` : "";
  const easyPace = paces ? `, ${paceRangeText(paces.easy)}` : "";
  return {
    presetCode: p,
    title: intervalTitle(p),
    minutes: intervalMinutes(p),
    steps: [
      `Warm-up: ${INTERVAL_WARMUP_MIN} min easy running, effort 2-4 out of 10${easyPace}`,
      `${i.reps} x ${i.workMin} min at ${work}${paces ? `, ${paceRangeText(paces.tempo)}` : ""}`,
      `Between them: ${i.walkMin} min walking. Just walk`,
      `Cool-down: ${INTERVAL_COOLDOWN_MIN} min easy running or walking, until your breathing settles`,
    ],
    body:
      `Warm up with ${INTERVAL_WARMUP_MIN} minutes of easy running. Then ${i.reps} times ${i.workMin} minutes at ${work}, ` +
      `with ${i.walkMin} minute of walking between them. Keep every rep at the same effort: not a sprint, never above ${i.rpeCap} out of 10.${workPace} ` +
      `Cool down with ${INTERVAL_COOLDOWN_MIN} minutes of easy running or walking, until your breathing settles. ${STOP} ${RATE_RUNNER}`,
  };
}

/** Runner sessions: preset + minutes (from runnerWeek) + paces (from the best result, or none). */
/**
 * The return week's first session: the app's control "test run"
 * (ai-running-coach plans/methodology.ts getReturnToRunningDiagnosticWorkout /
 * getNonRaceDiagnosticWorkout), translated. Duration band from selfReportBand.
 */
export function testRunWorkout(minutes: number, range: [number, number] = [20, 50]): WorkoutEn {
  const label = `${range[0]}-${range[1]} min by feel`;
  return {
    presetCode: "test_run",
    title: `Test run, ${label}`,
    minutes,
    steps: [
      "Start the first minutes very easy, no rush",
      `Then keep running easy and continuously, ${label}, with no goal for pace, distance or speed`,
      "Stop when easy running stops feeling easy, or you notice unusual tiredness or discomfort",
    ],
    body:
      `Run very calmly, at a feel of 2-3 out of 10. Guide: ${label}. Don't go by pace or distance: stop when easy running stops feeling easy, ` +
      `you notice unusual tiredness or any discomfort. This first run shows me where you are after the break. ${RATE_RUNNER}`,
  };
}

export function runnerWorkout(preset: RunnerPreset, minutes: number, paces: Paces | null = null, range?: [number, number]): WorkoutEn {
  if (isInterval(preset)) return intervalWorkout(preset, paces);
  if (preset === "test_run") return testRunWorkout(minutes, range);
  const min = minutes;
  const easyLine = paces ? `Pace: ${paceRangeText(paces.easy)}, or by feel: effort 2-4 out of 10` : "Effort 2-4 out of 10, slower than you think";
  const paceSentence = paces ? ` Your easy pace is ${paceRangeText(paces.easy)}. If the pace and the feel disagree, trust the feel.` : "";
  switch (preset) {
    case "easy_continuous":
      return {
        presetCode: preset,
        title: `Easy run, ${min} min`,
        minutes: min,
        steps: [`Run ${min} min at an easy, conversational effort`, easyLine],
        body: `${min} minutes of easy running. ${FEEL}${paceSentence} If you can't talk, slow down or walk for a minute. ${STOP} ${RATE_RUNNER}`,
      };
    case "easy_plus_strides": {
      const easy = min - 5;
      return {
        presetCode: preset,
        title: `Easy run + strides, ${min} min`,
        minutes: min,
        steps: [
          `Run ${easy} min easy${paces ? `, ${paceRangeText(paces.easy)}` : ", effort 2-4 out of 10"}`,
          `Then ${STRIDES.reps} strides of ${STRIDES.seconds} sec: quick and relaxed, not a sprint`,
          "Walk or jog very easy for about 45 sec between strides",
        ],
        body:
          `${easy} minutes of easy running, then ${STRIDES.reps} strides of ${STRIDES.seconds} seconds with an easy walk or jog between them. ` +
          `Strides are quick but relaxed: smooth form, light feet, not a sprint. The easy part stays easy: ${FEEL.charAt(0).toLowerCase()}${FEEL.slice(1)}${paceSentence} ${STOP} ${RATE_RUNNER}`,
      };
    }
    case "long_aerobic":
      return {
        presetCode: preset,
        title: `Long easy run, ${min} min`,
        minutes: min,
        steps: [
          `Run ${min} min easy, the same effort as your easy runs`,
          paces ? `Pace: ${paceRangeText(paces.easy)}, the slower end is fine` : "Start slower than feels natural, keep it even to the end",
        ],
        body:
          `${min} minutes of easy running, the longest run of the week. Start slower than feels natural and keep the effort even to the end. ${FEEL}${paceSentence} ${STOP} ${RATE_RUNNER}`,
      };
    case "recovery_easy":
      return {
        presetCode: preset,
        title: `Recovery run, ${min} min`,
        minutes: min,
        steps: [
          `Run ${min} min very easy, slower than your easy runs${paces ? `: ${slowerThanText(paces.easy[1])}` : ""}`,
          "Walk breaks are fine",
        ],
        body:
          `${min} minutes of very easy running, slower than your usual easy run. Walk breaks are fine. ${FEEL} ${STOP} ${RATE_RUNNER}`,
      };
  }
}

export function workoutFor(p: EnPlanned, paces: Paces | null = null): WorkoutEn {
  if (p.kind === "walk") return WALK_WORKOUT_EN;
  if (p.kind === "rung") return ladderWorkout(p.rung);
  return runnerWorkout(p.preset, p.minutes, paces, p.range);
}

export const LADDER_PRESET_CODES = BEGINNER_LADDER.map((s) => s.presetCode);
