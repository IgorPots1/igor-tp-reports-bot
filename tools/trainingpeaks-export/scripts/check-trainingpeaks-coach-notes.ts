import { buildTrainingPeaksCoachNotes } from "./lib/trainingpeaks-coach-notes.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  const notes = buildTrainingPeaksCoachNotes({
    summary: {
      student_id: "test",
      week: { from: "2026-05-11", to: "2026-05-17" },
      totals: { workouts_count: 2, completed_workouts_count: 2 },
      workouts: [
        {
          date: "2026-05-12",
          title: "Easy run",
          data_warnings: ["suspicious_if"],
          comparison: {
            mismatch_flags: { skipped: false },
            coach_attention_flags: { suspicious_if: true, suspicious_tss: false },
          },
        },
        {
          date: "2026-05-14",
          title: "Intervals",
          segment_comparison: [
            {
              segment_type: "interval",
              is_rest: false,
              coverage: "full",
              pace_vs_target: { status: "within" },
            },
            {
              segment_type: "interval",
              is_rest: false,
              coverage: "full",
              pace_vs_target: { status: "too_slow" },
            },
          ],
        },
      ],
    },
    recoveryContext: {
      include_in_athlete_report: true,
      profile: { recovery_metrics_enabled: true },
      summary: {
        status: "ready",
        coverage: {
          sleep_days: 4,
          hrv_days: 0,
          pulse_days: 4,
          body_battery_days: 4,
          stress_days: 0,
        },
        aggregates: {
          avg_sleep_hours: 6.2,
          nights_sleep_lt_6h: 2,
          nights_sleep_lt_7h: 3,
          avg_hrv: null,
          avg_pulse: 52,
          avg_body_battery: 30,
          avg_stress_level: null,
        },
        signals: {
          low_sleep_multiple_nights: true,
          limited_sleep_coverage: false,
          hrv_available: false,
          pulse_available: true,
          body_battery_available: true,
          low_body_battery_if_avg_below_reasonable_threshold: true,
        },
        text: "test",
      },
    },
  });

  assert(notes.schema_version === "coach-notes.v1", "Expected coach-notes.v1 schema.");
  assert(notes.data_quality_flags.some((s) => s.code === "suspicious_if_tss"), "Expected suspicious_if_tss flag.");
  assert(notes.training_signals.some((s) => s.code === "interval_late_fade"), "Expected interval_late_fade flag.");
  assert(notes.recovery_signals.some((s) => s.code === "short_sleep_multiple_nights"), "Expected sleep recovery flag.");
  assert(notes.generator.mode === "deterministic", "Expected deterministic generator mode.");

  console.log("check-trainingpeaks-coach-notes: ok");
}

run();
