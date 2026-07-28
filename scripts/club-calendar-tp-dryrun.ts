/**
 * Phase 11 dry-run — what WOULD be created in TrainingPeaks for every APPROVED,
 * not-yet-applied club_calendar_entries row. STRICTLY READ-ONLY:
 *   - reads club_calendar_entries (approved, applied_tp_workout_id IS NULL) + athlete ids
 *   - detects CONFLICTS: a day_off entry on a date where the student already has a
 *     planned workout (naryad 11.3 — that plan is NOT touched, only surfaced)
 *   - runs the PURE planner (planCalendarEntryAction, src/features/club/tp-execution.ts)
 *   - writes docs/club-tp-dryrun.md, line by line: who, what date, which kind, TP title
 * It does NOT enqueue an action, does NOT touch TrainingPeaks, does NOT change any
 * status. Real execution is Igor's hand and is gated by CLUB_TP_EXECUTION_ENABLED (OFF).
 *
 * Run:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/club-calendar-tp-dryrun.ts
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  planCalendarEntryAction,
  CLUB_MARKER_TITLE_STYLE,
  CLUB_RACE_SET_PLANNED_TIME,
  type ClubActionPlan,
  type ClubCalendarEntryRow,
} from "@/features/club/tp-execution";
import { isClubRaceAsEventEnabled } from "@/features/club/constants";
import { parseAthleteIdFromUrl } from "@/features/trainingpeaks/athlete-roster-import";

const RACE_AS_EVENT = isClubRaceAsEventEnabled();

// Rough distance-label → meters for the planned-workout distance (best-effort; the
// marker workout is fine without it — distance is only useful for a race).
function distanceLabelToMeters(label: string | null): number | null {
  if (!label) return null;
  const m = label.replace(",", ".").match(/([\d.]+)\s*км/iu);
  if (m) return Math.round(Number(m[1]) * 1000);
  const mm = label.replace(",", ".").match(/([\d.]+)\s*м\b/iu);
  if (mm) return Math.round(Number(mm[1]));
  return null;
}

async function loadAthleteIds(studentIds: string[]): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (studentIds.length === 0) return map;
  const supabase = createSupabaseServerClient();
  // The numeric TP athlete id lives only inside trainingpeaks_athlete_url
  // (".../athletes/{id}") — there is no trainingpeaks_athlete_id column.
  const { data } = await supabase.from("trainingpeaks_students").select("id, trainingpeaks_athlete_url").in("id", studentIds);
  for (const r of (data as Array<{ id: string; trainingpeaks_athlete_url: string | null }> | null) ?? []) {
    map.set(r.id, r.trainingpeaks_athlete_url ? parseAthleteIdFromUrl(r.trainingpeaks_athlete_url) : null);
  }
  return map;
}

/** Planned workouts on the given (student, date) pairs — for day_off conflict flags. */
async function loadPlannedByDate(pairs: Array<{ studentId: string; date: string }>): Promise<Set<string>> {
  const set = new Set<string>();
  if (pairs.length === 0) return set;
  const supabase = createSupabaseServerClient();
  const studentIds = [...new Set(pairs.map((p) => p.studentId))];
  const dates = [...new Set(pairs.map((p) => p.date))];
  const { data } = await supabase
    .from("trainingpeaks_workout_cache")
    .select("student_id, workout_date, is_planned")
    .in("student_id", studentIds)
    .in("workout_date", dates)
    .eq("is_planned", true);
  for (const r of (data as Array<{ student_id: string; workout_date: string }> | null) ?? []) {
    set.add(`${r.student_id}|${r.workout_date}`);
  }
  return set;
}

function planLine(p: ClubActionPlan, conflict: boolean): string {
  const flag = conflict ? " [КОНФЛИКТ]: на этот день уже есть запланированная тренировка (НЕ трогаем, ручной просмотр)" : "";
  if (p.ok) {
    const u = p.unresolved.length ? ` · unresolved: ${p.unresolved.join("; ")}` : "";
    const what = p.actionType === "create_event"
      ? `create_event (Event) name="${p.eventPayload.name}" type=${p.eventPayload.eventType}`
      : `create_workout title="${p.payload.title}"`;
    // Full entry id так, чтобы можно было сразу запустить execute-one <id> --apply.
    return `- [план] id=${p.requestId} · ${p.label} -> ${what}${u}${flag}`;
  }
  return `- [skip] id=${p.requestId} - не планируется: ${p.reason}${flag}`;
}

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { data: entryData, error } = await supabase
    .from("club_calendar_entries")
    .select("id, student_id, entry_date, kind, preferred_workout_type, note, race_name, race_city, race_distance_label, race_target_seconds, status, applied_tp_workout_id")
    .eq("status", "approved")
    .is("applied_tp_workout_id", null)
    .order("entry_date", { ascending: true });

  const entries = (entryData as Array<Record<string, unknown>> | null) ?? [];
  const studentIds = [...new Set(entries.map((r) => r.student_id as string).filter(Boolean))];
  const athleteIds = await loadAthleteIds(studentIds);
  const dayoffPairs = entries.filter((r) => r.kind === "day_off").map((r) => ({ studentId: r.student_id as string, date: r.entry_date as string }));
  const plannedSet = await loadPlannedByDate(dayoffPairs);

  const rows: ClubCalendarEntryRow[] = entries.map((r) => ({
    id: r.id as string,
    studentId: r.student_id as string,
    date: (r.entry_date as string | null) ?? null,
    kind: (r.kind as ClubCalendarEntryRow["kind"]) ?? "note",
    preferredType: (r.preferred_workout_type as ClubCalendarEntryRow["preferredType"]) ?? null,
    note: (r.note as string | null) ?? null,
    raceName: (r.race_name as string | null) ?? null,
    raceCity: (r.race_city as string | null) ?? null,
    raceDistanceLabel: (r.race_distance_label as string | null) ?? null,
    raceDistanceMeters: distanceLabelToMeters((r.race_distance_label as string | null) ?? null),
    raceTargetSeconds: (r.race_target_seconds as number | null) ?? null,
    status: (r.status as string) ?? "",
    appliedTpWorkoutId: (r.applied_tp_workout_id as number | null) ?? null,
  }));

  const planned = rows.map((row) => {
    const plan = planCalendarEntryAction(row, athleteIds.get(row.studentId) ?? null, { raceAsEvent: RACE_AS_EVENT });
    const conflict = row.kind === "day_off" && plannedSet.has(`${row.studentId}|${row.date}`);
    return { row, plan, conflict };
  });

  // Synthetic examples so the report shows every marker's shape even with an empty queue.
  const examples = (["day_off", "preference", "note", "race"] as const).map((kind) =>
    planCalendarEntryAction(
      {
        id: `example-${kind}`, studentId: "example", date: "2026-08-15", kind,
        preferredType: kind === "preference" ? "intervals" : null,
        note: kind === "note" ? "Утром совещание, лучше вечерняя тренировка" : null,
        raceName: kind === "race" ? "Сочи Полумарафон" : null,
        raceCity: kind === "race" ? "Сочи" : null,
        raceDistanceLabel: kind === "race" ? "21.1 км" : null,
        raceDistanceMeters: kind === "race" ? 21097 : null,
        raceTargetSeconds: kind === "race" ? 5400 : null,
        status: "approved", appliedTpWorkoutId: null,
      },
      123456,
      { raceAsEvent: RACE_AS_EVENT }
    )
  );

  const okCount = planned.filter((p) => p.plan.ok).length;
  const conflictCount = planned.filter((p) => p.conflict).length;

  const L: string[] = [];
  L.push("# Club → TrainingPeaks: DRY-RUN (Фаза 11)");
  L.push("");
  L.push("Что БЫ создалось в TP при исполнении накопленных ОДОБРЕННЫХ записей календаря. Ничего не");
  L.push("исполнено, не поставлено в очередь, статусы не изменены, в TP не записано. Флаг");
  L.push("`CLUB_TP_EXECUTION_ENABLED` — ВЫКЛ. Реальное исполнение — рука Игоря после просмотра этого отчёта.");
  L.push("");
  L.push("**Принцип:** в TP создаются ТОЛЬКО НОВЫЕ пометки-тренировки (описательные), существующие");
  L.push("планы/тренировки НЕ трогаются. TP-клиент умеет создавать только workout (события/заметки —");
  L.push("непроверенный API, см. docs/club-phase11-report.md §1), поэтому каждая пометка — это");
  L.push("описательная запланированная тренировка с узнаваемым заголовком, сосуществующая с планом дня.");
  L.push("");
  L.push("## Итог");
  L.push(`- Одобренных записей (не применённых): ${rows.length}; спланировано create_workout: ${okCount}`);
  L.push(`- Конфликтов (day_off на дне с планом — не трогаем, ручной просмотр): ${conflictCount}`);
  L.push("");
  L.push("## Записи (club_calendar_entries, approved, ещё не применённые)");
  L.push("");
  L.push("`id=` - это club_calendar_entries.id для команды `scripts/club-execute-one.ts <id> --apply`.");
  L.push("");
  L.push(rows.length ? planned.map((p) => planLine(p.plan, p.conflict)).join("\n") : "_нет одобренных записей (календарь ещё не наполнен / миграция не применена)_");
  L.push("");
  L.push("## Примеры форм по каждому типу (синтетические)");
  L.push("");
  L.push(examples.map((e) => planLine(e, false)).join("\n"));
  L.push("");
  L.push("## Что увидит ученик в своём календаре TP");
  L.push(`- Стиль заголовка пометки: ${CLUB_MARKER_TITLE_STYLE} (константа CLUB_MARKER_TITLE_STYLE в tp-execution.ts; "text" = префикс [Клуб], "emoji" = 🛌/🎯/📝/🏁).`);
  L.push("- day_off → РОДНОЙ тип TP «Day off» (value_id=7, подтверждён фактом), заголовок «[Клуб] Выходной · клубная пометка»; is_planned=false, план на день не тронут.");
  L.push("- preference → тип Other(100), «[Клуб] Пожелание: длительная/интервальная/отдых · клубная пометка».");
  L.push("- note → тип Other(100), «[Клуб] Заметка · клубная пометка».");
  L.push(`- race → ${RACE_AS_EVENT
    ? "РОДНОЙ TP Event (RunningRoad, POST /event); в кэш тренировок НЕ попадает, не считается тренировкой; клуб видит старт из club_calendar_entries. Цель " + (CLUB_RACE_SET_PLANNED_TIME ? "в goals.time + описании" : "в описании (goals.time за CLUB_RACE_SET_PLANNED_TIME)")
    : "запланированный бег (Run) с названием и дистанцией; цель " + (CLUB_RACE_SET_PLANNED_TIME ? "в поле totalTimePlanned + описании" : "в описании") + ". Включи CLUB_RACE_AS_EVENT=true, чтобы создавать как Event"}.`);
  L.push("");
  L.push("## Идемпотентность и отмена");
  L.push("- После успеха id созданной тренировки пишется в club_calendar_entries.applied_tp_workout_id;");
  L.push("  планировщик пропускает применённые записи → повторный прогон не плодит дубли.");
  L.push("- Отмена = удалить созданную тренировку по этому id (существующий delete_workout) и очистить колонку.");
  L.push("");
  L.push("## Исполнение (когда флаг ВКЛ) — существующий пайплайн, не тронут");
  L.push("createTrainingPeaksAction(create_workout, pending_coach) → dry-run → подтверждение тренером");
  L.push("→ execute_pending → локальный раннер → executeByType(create_workout) → verify(readback) → откат при провале.");
  L.push("");

  const out = resolve(process.cwd(), "docs/club-tp-dryrun.md");
  writeFileSync(out, L.join("\n"), "utf8");

  console.log("== club calendar TP dry-run (read-only) ==");
  if (error) console.log(`(club_calendar_entries недоступна: ${error.message} — миграция не применена?)`);
  console.log(`approved entries=${rows.length} planned=${okCount} conflicts=${conflictCount}`);
  console.log(`wrote ${out} — NOTHING enqueued or executed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
