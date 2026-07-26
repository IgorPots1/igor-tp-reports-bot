/**
 * Phase 3 dry-run — what WOULD be enqueued into the assisted-write pipeline for
 * every APPROVED club start / day-off request. STRICTLY READ-ONLY:
 *   - reads club_races + club_dayoff_requests (approved) + athlete ids
 *   - runs the PURE planners (src/features/club/tp-execution.ts)
 *   - writes docs/club-tp-dryrun.md
 * It does NOT enqueue an action, does NOT touch TrainingPeaks, does NOT change any
 * status. Real execution is out of scope and gated by CLUB_TP_EXECUTION_ENABLED.
 *
 * Run:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/club-tp-dryrun.ts
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  planClubRaceAction,
  planClubDayoffAction,
  type ClubActionPlan,
  type ClubRaceRow,
  type ClubDayoffRow,
} from "@/features/club/tp-execution";

async function loadAthleteIds(studentIds: string[]): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (studentIds.length === 0) return map;
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("trainingpeaks_students")
    .select("id, trainingpeaks_athlete_id")
    .in("id", studentIds);
  for (const r of (data as Array<{ id: string; trainingpeaks_athlete_id: number | string | null }> | null) ?? []) {
    const raw = r.trainingpeaks_athlete_id;
    map.set(r.id, raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null);
  }
  return map;
}

function planLine(p: ClubActionPlan): string {
  if (p.ok) {
    const u = p.unresolved.length ? ` · unresolved: ${p.unresolved.join("; ")}` : "";
    return `- ✅ [${p.kind}] ${p.label} → action_type=${p.actionType}, payload=${JSON.stringify(p.payload)}${u}`;
  }
  return `- ⏭️ [${p.kind}] request ${p.requestId.slice(0, 8)} — НЕ планируется: ${p.reason}`;
}

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const [{ data: raceData }, { data: dayoffData }] = await Promise.all([
    supabase
      .from("club_races")
      .select("id, student_id, name, race_date, distance_meters, distance_label, city, country, target_result_seconds, status")
      .eq("status", "approved"),
    supabase
      .from("club_dayoff_requests")
      .select("id, student_id, from_date, to_date, reason, status")
      .eq("status", "approved"),
  ]);

  const races = (raceData as Array<Record<string, unknown>> | null) ?? [];
  const dayoffs = (dayoffData as Array<Record<string, unknown>> | null) ?? [];
  const studentIds = [
    ...new Set([...races, ...dayoffs].map((r) => r.student_id as string).filter(Boolean)),
  ];
  const athleteIds = await loadAthleteIds(studentIds);

  const racePlans: ClubActionPlan[] = races.map((r) => {
    const row: ClubRaceRow = {
      id: r.id as string,
      studentId: r.student_id as string,
      name: (r.name as string | null) ?? null,
      raceDate: (r.race_date as string | null) ?? null,
      distanceMeters: (r.distance_meters as number | null) ?? null,
      distanceLabel: (r.distance_label as string | null) ?? null,
      city: (r.city as string | null) ?? null,
      country: (r.country as string | null) ?? null,
      targetResultSeconds: (r.target_result_seconds as number | null) ?? null,
      status: (r.status as string) ?? "",
    };
    return planClubRaceAction(row, athleteIds.get(row.studentId) ?? null);
  });

  const dayoffPlans: ClubActionPlan[] = dayoffs.map((r) => {
    const row: ClubDayoffRow = {
      id: r.id as string,
      studentId: r.student_id as string,
      fromDate: (r.from_date as string | null) ?? null,
      toDate: (r.to_date as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      status: (r.status as string) ?? "",
    };
    return planClubDayoffAction(row);
  });

  // Synthetic example so the report shows the payload shape even with an empty queue.
  const example = planClubRaceAction(
    {
      id: "00000000-example",
      studentId: "example",
      name: "Сочи Марафон",
      raceDate: "2026-11-01",
      distanceMeters: 42195,
      distanceLabel: "42.2 км",
      city: "Сочи",
      country: "Россия",
      targetResultSeconds: 12600,
      status: "approved",
    },
    123456
  );

  const okRaces = racePlans.filter((p) => p.ok).length;

  const lines: string[] = [];
  lines.push("# Club → TrainingPeaks: DRY-RUN (Фаза 3)");
  lines.push("");
  lines.push("Что БЫ произошло при исполнении накопленных ОДОБРЕННЫХ заявок. Ничего не исполнено,");
  lines.push("ничего не поставлено в очередь, статусы не изменены, в TP не записано. Флаг");
  lines.push("`CLUB_TP_EXECUTION_ENABLED` — ВЫКЛ. Планы строятся ЧИСТЫМ модулем tp-execution.ts;");
  lines.push("реальный путь — createTrainingPeaksAction(action_type=create_workout, status=pending_coach)");
  lines.push("→ существующий пайплайн: dry-run → подтверждение тренером → локальный раннер → verify → откат.");
  lines.push("");
  lines.push("## Итог");
  lines.push("");
  lines.push(`- Одобренных стартов: ${races.length} (спланировано в create_workout: ${okRaces})`);
  lines.push(`- Одобренных выходных: ${dayoffs.length} (все → ручной review-case, см. ниже)`);
  lines.push("");
  lines.push("## Старты (club_races, approved)");
  lines.push("");
  lines.push(races.length ? racePlans.map(planLine).join("\n") : "_нет одобренных стартов_");
  lines.push("");
  lines.push("## Выходные (club_dayoff_requests, approved)");
  lines.push("");
  lines.push(dayoffs.length ? dayoffPlans.map(planLine).join("\n") : "_нет одобренных выходных_");
  lines.push("");
  lines.push("## Пример плана старта (синтетический — форма payload)");
  lines.push("");
  lines.push(planLine(example));
  lines.push("");
  lines.push("## Как это исполнилось бы (когда флаг ВКЛ)");
  lines.push("");
  lines.push("1. План → `createTrainingPeaksAction` (action_type=create_workout, execution_status=not_started).");
  lines.push("2. Пакетное подтверждение тренером СПИСКОМ, но исполнение — по одному.");
  lines.push("3. Dry-run готовит точный payload; байт-в-байт ревалидация перед реальной отправкой.");
  lines.push("4. Локальный раннер применяет; verify (readback) подтверждает; при провале — откат (create→delete).");
  lines.push("5. Результат → club_races.sync_result_ref + status (applied/failed), виден тренеру и ученику.");
  lines.push("");
  lines.push("Выходные: TP-представление отдыха не подтверждено (нет type-id, деструктив не фабрикуется),");
  lines.push("поэтому они остаются ручным review-case до появления проверенного day-off типа.");
  lines.push("");

  const out = resolve(process.cwd(), "docs/club-tp-dryrun.md");
  writeFileSync(out, lines.join("\n"), "utf8");

  console.log("== club TP dry-run (read-only) ==");
  console.log(`approved races=${races.length} planned=${okRaces} · approved dayoffs=${dayoffs.length}`);
  console.log(`example plan ok=${example.ok}`);
  console.log(`wrote ${out} — NOTHING enqueued or executed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
