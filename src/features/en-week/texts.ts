/* All English texts of the free week (page and DMs). Igor's voice: calm, practical, first
 * person, "you". No em dashes and no en dashes anywhere (Igor's rule): check:en-week runs
 * every text through that and through the 900-character DM limit.
 *
 * Cases: the Russian bot's cases (src/features/trial-bot/texts.ts), translated fact for fact,
 * with the same photos [Igor, 28.10.2026]. Nothing else is claimed. */

import { SITE_URL } from "@/lib/site";

import type { Goal, SummaryAdvice, Track } from "./logic";
import type { WorkoutEn } from "./workouts";

export const CONSULT_TOOL = "en-week";

/** Plain consult link (WhatsApp via /go/consult, click counted with tool=en-week). */
export function consultUrl(text: string): string {
  return `${SITE_URL}/go/consult?tool=${CONSULT_TOOL}&text=${encodeURIComponent(text)}`;
}

export const PREFILL_HEALTH = "Hi Igor! I filled in the free week form and want to talk about training with my health in mind";
export const PREFILL_OFFER = "Hi Igor! I'm doing the free week and want to keep going with you. My goal:";
export const PREFILL_SUMMARY = "Hi Igor! I finished the free week and want to keep going with you. My goal:";

export type CtaPlace = "offer" | "summary" | "health" | "followup";

export const PREFILL_RUNNER = "Hi Igor! I did the free week and want 1:1 coaching for my next race or a PR. My race:";

export function prefillFor(place: CtaPlace, track: Track = "beginner"): string {
  if (place === "health") return PREFILL_HEALTH;
  if (track === "runner") return PREFILL_RUNNER;
  if (place === "summary" || place === "followup") return PREFILL_SUMMARY;
  return PREFILL_OFFER;
}

export const CTA_LABEL = "Message Igor on WhatsApp";

// ── entry page ───────────────────────────────────────────────────────────────

export const INTRO_TITLE = "A free week of training, built around your goal";
export const INTRO_LEDE =
  "Hi, I'm Igor, a running coach. Answer a few quick questions and I'll give you a week of workouts that fits where you are right now.";
export const INTRO_POINTS = [
  "2 or 3 workouts on the days you choose",
  "Each workout and a quick check-in also come to your Instagram DMs",
  "The next workout adjusts to how the last one felt",
];

export const Q_GOAL = "What's your goal right now?";
export const Q_START_NOW = "Do you run now?";
export const Q_START_LONGEST = "How far can you run without stopping?";
export const Q_RETURN_LAST = "When did you last run regularly?";
export const Q_RETURN_LEVEL = "What could you do back then?";
export const Q_RACE = "Which race are you training for?";
export const Q_RACE_MONTH = "When is it?";
export const Q_RESULT = "Any race result in the last 12 months?";
export const Q_RESULT_LEDE = "I'll turn it into your training paces. No result yet? Then the week runs on effort.";
export const Q_RESULT_DISTANCE = "Distance";
export const Q_RESULT_TIME = "Your time (mm:ss or h:mm:ss)";
export const NO_RESULT = "No result yet";
export const RESULT_ERROR_FORMAT = "Use mm:ss or h:mm:ss, for example 52:00 or 1:52:30.";
export function resultErrorRange(label: string): string {
  return `That time looks off for a ${label}. Check it, or tap No result yet.`;
}
export const Q_DAYS = "How many days a week can you really train?";
export const Q_DAYS_HINT_BEGINNER = "2 or 3 is the right start. More days come later, once your body is used to it.";
export const Q_DAYS_HINT_RUNNER = "For a free week 3 or 4 is plenty. The long run goes on a weekend day.";
export const Q_PATTERN = "Which days work for you?";
export const Q_BASELINE = "Your running right now";
export const Q_BASELINE_LEDE = "Rough answers are fine. This sizes your week so it's not more than you run now.";
export const Q_WEEKLY_KM = "How much do you run in a typical week?";
export const Q_LONGEST_RUN = "Your longest run lately?";
export const Q_QUALITY = "Have you done intervals or tempo runs?";
export const Q_HEALTH = "Last one, and it matters. Does any of this apply to you?";
export const Q_HEALTH_HINT = "I only keep a yes or no here, never which one.";

export const HEALTH_STOP_TITLE = "Let's be careful first";
export const HEALTH_STOP =
  "Thank you for being honest. In this situation I won't give you a plan blind: first, please clear training with your doctor. If you want, message me and we'll look at your situation together.";

export const GOAL_LINES: Record<Goal, string> = {
  start_running: "Your goal: start running. This week is about getting your body used to it, calmly.",
  return_to_running: "Your goal: come back to running. Breathing comes back fast, tendons and joints slower, so we start with a test run and build up gradually.",
  run_consistently: "Your goal: run regularly. This week sets the rhythm: fixed days, easy effort.",
  train_for_race: "Your goal: your race. This week builds the base for it.",
};

export type RaceNote = { label: string; month: string; soon: boolean };

const RUNNER_GOAL_LINES: Record<Goal, string> = {
  train_for_race: "Let's make your running count: easy days easy, one quality session, one long run. That's how race times drop.",
  run_consistently: "Let's make your running count: the structure good runners use, sized to your week.",
  start_running: "Let's make your running count: the structure good runners use, sized to your week.",
  return_to_running: "Let's make your comeback count: your engine remembers, your tendons need a careful week. It starts with a test run.",
};

export function runnerGoalLine(goal: Goal, race: RaceNote | null): string {
  if (!race) return RUNNER_GOAL_LINES[goal];
  return race.soon
    ? `${RUNNER_GOAL_LINES[goal]} Your ${race.label} is in ${race.month}: this week builds toward it without piling on fatigue.`
    : `${RUNNER_GOAL_LINES[goal]} Next race: ${race.label}, ${race.month}. This week starts the base for it.`;
}

export const RUNNER_PLAN_RULE =
  "The main rule: easy runs at effort 2-4 out of 10 (the pace is a guide, the effort wins), one quality session never above 7 out of 10. If anything hurts, stop and walk.";

export const PLAN_RULE = "The main rule for easy running: effort 2-4 out of 10, you can talk in full sentences. If anything hurts, switch to walking.";
export const INTERVAL_RULE = "The main rule: the warm-up and cool-down stay easy, the work never goes above 7 out of 10. If anything hurts, stop and walk.";
export const PLAN_DM_NOTE = "Your workouts and a quick check-in also come to your Instagram DMs. Tap how it went there or here, it's the same.";
export const PLAN_LINK_NOTE = "Save this page: it's your personal link to come back to the week.";

// ── check-ins ────────────────────────────────────────────────────────────────

export const CHECKIN_LABELS = {
  easy: "Easy",
  ok: "OK",
  hard: "Hard",
  skipped: "Skipped",
  pain: "Something hurt",
} as const;

export const CHECKIN_REPLIES = {
  easy: "Great. If it keeps feeling easy, we'll add a little.",
  ok: "That's how it should feel. This is the zone where endurance grows.",
  hard: "Thanks for being honest. We won't add anything. Next time go slower, slow enough to talk, and if it gets hard, switch to walking right away.",
  skipped: "It happens. Don't pile anything on top, just do the next one as planned.",
  pain: "Swap your next workout for a 30 minute brisk walk. If the pain doesn't go away in 2-3 days, it's worth seeing a doctor.",
} as const;

/** Runner track replies: same rules, a runner's tone. */
export const RUNNER_CHECKIN_REPLIES = {
  easy: "Good. Easy days easy is how the fast days get faster.",
  ok: "That's the zone. Consistency beats heroics.",
  hard: "Thanks for being honest. We won't add anything. Next time ease off earlier.",
  skipped: "Fine. Don't make it up, just hit the next one.",
  pain: CHECKIN_REPLIES.pain,
} as const;

/** Runner week: "Hard" turns the next session into the recovery run, so the reply says that. */
export const RUNNER_HARD_REPLY = "Thanks for being honest. We won't add anything: the next session is an easy recovery run.";

export function checkinReply(
  value: keyof typeof CHECKIN_REPLIES,
  next: { title: string; date: string } | null,
  summaryDay: string,
  runner = false,
  /** Runner-type week (not the ladder): "Hard" turns the next session into the recovery run. */
  recoveryNext = runner,
): string {
  const tail = next
    ? `Next: ${next.title}, ${next.date}.`
    : `That was the last workout of the week. Your summary comes ${summaryDay}.`;
  const head = value === "hard" && next && recoveryNext ? RUNNER_HARD_REPLY : runner ? RUNNER_CHECKIN_REPLIES[value] : CHECKIN_REPLIES[value];
  return `${head} ${tail}`;
}

export const NOTHING_TO_CHECKIN = "Nothing to check in right now: your next workout hasn't come yet.";

// ── DMs ──────────────────────────────────────────────────────────────────────

export function workoutDm(w: WorkoutEn, isWalk: boolean, isInterval = false, runner = false): string {
  if (isWalk) {
    return (
      "Good morning! Today, instead of running: a 30 minute brisk walk. Smooth and steady, no bursts: this is recovery, not a skipped day.\n\n" +
      "Afterwards, tap how it went."
    );
  }
  return (
    `Good morning! Today's workout: ${w.title}.\n\n${w.steps.map((s) => `- ${s}`).join("\n")}\n\n` +
    `${isInterval ? INTERVAL_RULE : runner ? RUNNER_PLAN_RULE : PLAN_RULE}\n\nAfter your run, tap how it went.`
  );
}

export const SCREENSHOT_DM_LINE =
  "Got a screenshot from your watch or app (Garmin, Strava, Apple Fitness)? Add it to this workout on your plan page: tap My plan below.";

export function checkinAskDm(w: WorkoutEn): string {
  return `How did today's workout go? (${w.title})\n\nTap one: Easy, OK, Hard, Skipped or Something hurt.\n\n${SCREENSHOT_DM_LINE}`;
}

// ── screenshots on the plan page ─────────────────────────────────────────────

export const SCREENSHOT_UPLOAD = "Upload screenshot";
export const SCREENSHOT_HINT = "From your watch or app: Garmin, Strava, Apple Fitness. Up to 3 per workout.";
export const SCREENSHOT_ERRORS: Record<string, string> = {
  type: "That file isn't a picture I can read. Use a JPG, PNG or WEBP screenshot.",
  size: "That picture is too big. Try a regular screenshot.",
  limit: "Up to 3 screenshots per workout.",
  not_yet: "You can add screenshots once the workout day has come.",
  not_found: "Couldn't find this workout. Reload the page.",
  network: "No connection. Check your internet and try again.",
};

export function nextLine(next: { title: string; date: string } | null, summaryDay: string | null): string {
  if (next) return `Next workout: ${next.title}, ${next.date}.`;
  return summaryDay ? `No more workouts this week. Your summary comes ${summaryDay}.` : "No more workouts this week.";
}

export function loggedDm(next: { title: string; date: string } | null, summaryDay: string | null): string {
  return `Logged, thank you. ${nextLine(next, summaryDay)}`;
}

/** Rest-day tips, rotated by day. General coaching guidance, no claims. */
export const TIPS = [
  "Rest days are part of the plan: this is when your body adapts to the work.",
  "Easy should feel easy. If you can't talk in full sentences, slow down or walk. Slow is not wrong, it's how endurance is built.",
  "Sleep and a normal meal do more for your next run than any gadget.",
  "Some calf soreness after the first runs is normal. Sharp or growing pain is not: then walk instead and tell me.",
  "Run the first minutes slower than you want to. Your body warms up on its own, there's no need to push it.",
  "Missed a workout? Don't double up. The next one as planned is the best fix.",
];

export function tipFor(day: number): string {
  return TIPS[((day % TIPS.length) + TIPS.length) % TIPS.length];
}

/** Midday and evening of the same rest day get different tips (2 per day). */
export function restDm(day: number, next: { title: string; date: string } | null, summaryDay: string | null): string {
  return `Rest day today. ${tipFor(day * 2)}\n\n${nextLine(next, summaryDay)}`;
}

/** Evening: tomorrow's workout if there is one; else a tip, without repeating the midday "next workout" line. */
export function previewDm(day: number, tomorrow: { title: string } | null, next: { title: string; date: string } | null, summaryDay: string | null): string {
  if (tomorrow) return `Tomorrow: ${tomorrow.title}. I'll send the details in the morning.`;
  if (next) return `Nothing planned tomorrow, rest is part of the plan. ${tipFor(day * 2 + 1)}`;
  return nextLine(next, summaryDay);
}

export function beforeStartDm(first: { title: string; date: string }, day: number): string {
  return `Your free week starts ${first.date}: ${first.title}.\n\n${tipFor(day)}`;
}

export const ACK_PROMPT = "Tap Got it so I know this reached you.";

// ── cases and offer ──────────────────────────────────────────────────────────

export type CaseStory = { name: string; imageUrl: string; text: string };

/** Day 2. Russian: CASE_MARINA. */
export const CASE_MARINA: CaseStory = {
  name: "Marina",
  imageUrl: "https://igorp.run/landing/16-review-marina.jpg",
  text:
    "Let me tell you about Marina. In May 2025 she messaged me on Instagram: the day before, she had run 10K in 1:02:31 and was sure she couldn't run slowly and didn't like it.\n\n" +
    "The first thing we learned was exactly that, slow running. In summer 2025 her easy pace was 7:03 per km at a heart rate of 145. A year later, at the same heart rate: 5:59.\n\n" +
    "In 14 months: 214 of 216 planned sessions and not one missed for injury. The result: 10K in 48:09, 14 minutes faster.\n\n" +
    "No secret: easy running, patience and a system. Exactly what you're doing this week.",
};

/** English version: Marina only [Igor, 28.10.2026: Anna, Nadya and Sasha are not used in en-week]. */
export const CASES = [CASE_MARINA];

export const OFFER_TEXT =
  "If you like how this week feels and want to keep going with a plan built around your goal, I coach runners 1:1: your plan, adjusted every week to how you actually feel, and feedback on every run.";
export const OFFER_DM = `${OFFER_TEXT} Tap "Message Igor" and tell me your goal.`;

export const RUNNER_OFFER_TEXT =
  "If you want a plan aimed at your next race or a new PR, I coach runners 1:1: a plan built around your race, adjusted every week to how your runs actually go, and feedback on every run.";
export const RUNNER_OFFER_DM = `${RUNNER_OFFER_TEXT} Tap "Message Igor" and tell me the race and the date.`;

export function offerText(track: Track): string {
  return track === "runner" ? RUNNER_OFFER_TEXT : OFFER_TEXT;
}
export function offerDm(track: Track): string {
  return track === "runner" ? RUNNER_OFFER_DM : OFFER_DM;
}

// ── summary and after ────────────────────────────────────────────────────────

export function doneLine(runs: number, walks: number): string {
  const r = `${runs} ${runs === 1 ? "run" : "runs"}`;
  const w = `${walks} ${walks === 1 ? "walk" : "walks"}`;
  if (runs > 0 && walks > 0) return `${r} and ${w}`;
  return walks > 0 ? w : r;
}

export function feelLine(counts: Partial<Record<"easy" | "ok" | "hard" | "pain", number>>): string {
  const names = { easy: "easy", ok: "OK", hard: "hard", pain: "something hurt" } as const;
  const parts = (["easy", "ok", "hard", "pain"] as const).filter((k) => (counts[k] ?? 0) > 0).map((k) => `${names[k]} ${counts[k]}`);
  return parts.length ? `felt: ${parts.join(", ")}` : "no check-ins on how it felt";
}

export function adviceText(advice: SummaryAdvice, nextTitle: string): string {
  switch (advice.kind) {
    case "up":
      return `move one step up: ${nextTitle}`;
    case "same":
      return `repeat ${nextTitle} for one more week`;
    case "careful":
      return `first make sure nothing hurts, then repeat ${nextTitle} without adding anything`;
    case "runner_keep":
      return "keep the same structure for another week: easy runs at effort 2-4 and one longer run";
    case "runner_careful":
      return "first make sure nothing hurts, then repeat this week without adding anything";
  }
}

export function summaryText(
  runs: number,
  walks: number,
  counts: Partial<Record<"easy" | "ok" | "hard" | "pain", number>>,
  advice: SummaryAdvice,
  nextTitle: string,
  track: Track = "beginner",
  race: RaceNote | null = null,
): string {
  const done = runs + walks;
  const head =
    done === 0
      ? "Your week is done. This time the workouts didn't happen, and that's normal for almost everyone who starts without support."
      : `Your week is done. Summary: ${doneLine(runs, walks)}, ${feelLine(counts)}.`;
  const step = done === 0 ? `start again with ${nextTitle}` : adviceText(advice, nextTitle);
  return `${head} Your next step: ${step}.\n\n${track === "runner" ? runnerSummaryOffer(race) : SUMMARY_OFFER}`;
}

export function runnerSummaryOffer(race: RaceNote | null): string {
  const toward = race ? `toward your ${race.label} in ${race.month}` : "toward your next race or a PR";
  return `Want to keep this going ${toward}? I coach runners 1:1: a plan built around your race, adjusted every week, and feedback on every run. Tap "Message Igor" and tell me the race and the date.`;
}

export const SUMMARY_OFFER =
  "If you want to keep going with me: I coach runners 1:1, with a plan for your goal, adjusted every week to how you feel, and feedback on every run. Tap \"Message Igor\" and tell me your goal.";

/** Day 8 (Russian FOLLOWUP_8), no case. */
export const FOLLOWUP_DM =
  "The free week is behind you, and now is the time not to lose the rhythm. If you want a plan for the next weeks built around how this one felt, message me and tell me your goal.";
/** Day 10 (Russian FOLLOWUP_10 + the last-message line), no case. */
export const FINAL_DM =
  "The hardest part starts when the novelty wears off. With 1:1 coaching I'm there every week, so running doesn't get dropped. This is my last message about it: your plan stays at your personal link.";

export const RUNNER_FOLLOWUP_DM =
  "Your free week is done. Now the real work: turning good weeks into a race result. If you want a plan for your next race or a PR, message me and tell me the race and the date.";
export const RUNNER_FINAL_DM =
  "Fitness builds in blocks, not single weeks. With 1:1 coaching I plan the block toward your race and adjust it every week. This is my last message about it: your plan stays at your personal link.";

export const NO_PLAN_DM = "Your free week is one minute away: 4 quick questions and you get your workouts.";
export const HEALTH_STOP_DM = HEALTH_STOP;
