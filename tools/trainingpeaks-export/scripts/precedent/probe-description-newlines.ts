/**
 * ПРОБА: сохраняет ли TP переносы строк в description при записи через tp-api-client (POST). Тест-атлет 3102415, скрыто, удаляется за собой.
 * Сравнение БАЙТ В БАЙТ: записанное vs прочитанное из GET (обычная строка с \n, без экранирования). Источник текста — подлинное описание тренировки образца.
 * По умолчанию СУХАЯ (сети нет). Живой запуск: TP_ACTIONS_REAL_EXECUTION=true tsx probe-description-newlines.ts --execute-real --confirm "ПРОБА ПЕРЕНОСОВ 3102415"
 */
import process from "node:process";
import type { TpLike } from "./hidden-flow.ts";

export const NL_PROBE_ATHLETE = 3102415;
export const NL_CONFIRM = "ПРОБА ПЕРЕНОСОВ 3102415";
export const SAMPLE = "Разминка:\n\n— 10 минут в темпе 06:24-06:41 /км\n\nОсновная часть — 8 повторений:\n\n— 4 минуты в темпе 04:42-04:52 /км\n\n— 1,5 минуты — легко бегом\n\nЗаминка:\n\n— 5 минут в темпе 06:24-06:41 /км";

export type NlResult = { ok: boolean; steps: string[]; written: string; read: string | null; workoutId: number | null; cleaned: boolean | null };

/** Побайтовая сверка с расшифровкой первого расхождения. */
export function byteDiff(a: string, b: string | null): string | null {
  if (b == null) return "прочитано null";
  if (a === b) return null;
  const n = Math.min(a.length, b.length); let i = 0; while (i < n && a[i] === b[i]) i++;
  return `первое расхождение на позиции ${i}: записано ${JSON.stringify(a.slice(i, i + 12))}, прочитано ${JSON.stringify(b.slice(i, i + 12))}; \\n: ${(a.match(/\n/g) ?? []).length} против ${(b.match(/\n/g) ?? []).length}, длина ${a.length} против ${b.length}`;
}

export async function runNewlineProbe(tp: TpLike, text: string): Promise<NlResult> {
  const r: NlResult = { ok: false, steps: [], written: text, read: null, workoutId: null, cleaned: null };
  try {
    const created = await tp.createWorkout({ athleteId: NL_PROBE_ATHLETE, workoutDay: "2026-11-30T00:00:00", title: "ПРОБА ПЕРЕНОСОВ", workoutTypeValueId: 3, workoutSubTypeId: null, description: text, coachComments: null, distancePlanned: null, totalTimePlanned: 0.5, structure: null, isHidden: true });
    r.workoutId = created.workoutId; r.steps.push(`POST: workoutId=${created.workoutId}`);
    const got = await tp.getWorkoutDetail(NL_PROBE_ATHLETE, created.workoutId);
    r.read = typeof got.description === "string" ? got.description : null; r.steps.push(`GET: athleteId=${JSON.stringify(got.athleteId)} isHidden=${JSON.stringify(got.isHidden)}; переносов \\n записано ${(text.match(/\n/g) ?? []).length}, прочитано ${r.read == null ? "null" : (r.read.match(/\n/g) ?? []).length}`);
    const d = byteDiff(text, r.read); r.steps.push(`сверка байт в байт: ${d ?? "совпала"}`); r.ok = d == null && got.isHidden === true && Number(got.athleteId) === NL_PROBE_ATHLETE;
  } catch (e) { r.steps.push(`СТОП: ${e instanceof Error ? e.message : String(e)}`); }
  if (r.workoutId != null) {
    try { await tp.deleteWorkout(NL_PROBE_ATHLETE, r.workoutId); r.steps.push("DELETE");
      try { await tp.getWorkoutDetail(NL_PROBE_ATHLETE, r.workoutId); r.cleaned = false; r.steps.push("GET после DELETE: ещё читается"); } catch (e) { r.cleaned = tp.isGone(e); r.steps.push(`GET после DELETE: ${r.cleaned ? "удалена (400 Invalid workoutId)" : "ошибка, не похожая на «удалена»"}`); }
    } catch (e) { r.cleaned = false; r.steps.push(`DELETE упал: ${e instanceof Error ? e.message : String(e)}`); }
    if (r.cleaned !== true) r.ok = false;
  }
  return r;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2); const real = args.includes("--execute-real"); const confirm = args.includes("--confirm") ? args[args.indexOf("--confirm") + 1] : null;
  console.log(`# Проба переносов строк — ${real ? "ЖИВОЙ ЗАПУСК" : "СУХОЙ (сети нет)"}\nатлет ${NL_PROBE_ATHLETE}, скрыто, удаляется; текст (${(SAMPLE.match(/\n/g) ?? []).length} переносов): ${JSON.stringify(SAMPLE)}`);
  if (!real) { console.log("\nЗапуск: TP_ACTIONS_REAL_EXECUTION=true tsx probe-description-newlines.ts --execute-real --confirm \"" + NL_CONFIRM + "\""); return; }
  if (confirm !== NL_CONFIRM || process.env.TP_ACTIONS_REAL_EXECUTION !== "true") { console.error("ОТКАЗ: нужны --confirm и TP_ACTIONS_REAL_EXECUTION=true"); process.exit(2); }
  const { liveClient } = await import("./tp-live-client.ts"); const r = await runNewlineProbe(await liveClient(), SAMPLE);
  console.log(`\n## РЕЗУЛЬТАТ (дословно): ${r.ok ? "ПРОШЛА" : "НЕ ПРОШЛА"}`); for (const s of r.steps) console.log(`- ${s}`);
  console.log(`- записано: ${JSON.stringify(r.written)}\n- прочитано: ${JSON.stringify(r.read)}\n- удалена и проверено: ${r.cleaned}`);
}
if (process.argv[1]?.endsWith("probe-description-newlines.ts")) main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
