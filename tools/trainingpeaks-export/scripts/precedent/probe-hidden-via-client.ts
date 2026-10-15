/**
 * ПРОБНИК СКРЫТИЯ НА tp-api-client — тем же путём, что «раскидать» (hidden-flow.ts).
 * Заменяет tp-probe-workout-hidden-field.ts: тот шёл через Playwright, создавал видимой и не удалял за собой.
 *
 * ЦИКЛ (одна тренировка, один атлет — 3102415, зашит в код): создать СКРЫТОЙ в самом POST → прочитать →
 * открыть → прочитать → удалить → прочитать, что удалена. После каждой записи GET; любое расхождение — СТОП
 * с уборкой созданного. Если TP игнорирует isHidden в POST — скрываем отдельным PUT и пишем это в отчёт
 * как РАСХОЖДЕНИЕ.
 *
 * СУХОЙ ПРОГОН (по умолчанию): сети нет вообще. Печатает порядок шагов, точные тела запросов, состояние
 * ворот и два сценария на ПОДСТАВНОМ клиенте — показывает, как будет выглядеть отчёт.
 * РЕАЛЬНЫЙ: --apply + --confirm "PROBE TP HIDDEN VIA API CLIENT" + TP_ACTIONS_REAL_EXECUTION=true + дата не раньше
 * чем через 7 дней. Без «запускай» от Игоря не запускается.
 *
 * ЧТО ПРОБНИК НЕ МОЖЕТ ДОКАЗАТЬ: «ученик не видит» он видит только как флаг isHidden в ответе TP со стороны
 * тренера, а не глазами ученика. Это честно записывается в отчёт.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/probe-hidden-via-client.ts [--date YYYY-MM-DD] [--apply --confirm "..."]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { runProbeCycle, type FlowResult, type TpLike } from "./hidden-flow.ts";
import { liveClient, sessionState } from "./tp-live-client.ts";
import { addDays, iso } from "./corpus.ts";

export const PROBE_ATHLETE_ID = 3102415;
export const PROBE_CONFIRM = "PROBE TP HIDDEN VIA API CLIENT";
export const PROBE_MIN_DAYS_AHEAD = 7;
const REPORTS = "/Users/igor/igor-tp-reports-bot/reports";

export function probeBody(date: string): Record<string, unknown> {
  return { athleteId: PROBE_ATHLETE_ID, workoutDay: `${date}T00:00:00`, title: "ПРОБНИК скрытия — удалить", workoutTypeValueId: 3, workoutSubTypeId: null,
    description: "PROBE_HIDDEN_VIA_API_CLIENT", coachComments: null, distancePlanned: null, totalTimePlanned: 0.5, structure: null };
}

export type ProbeGate = { apply: boolean; confirm: string | null; realEnv: string | undefined; athleteId: number; date: string; today: string };
/** null — можно писать; иначе почему нельзя. Чистая функция. */
export function probeGate(g: ProbeGate): string | null {
  if (g.athleteId !== PROBE_ATHLETE_ID) return `атлет ${g.athleteId} не тестовый (разрешён только ${PROBE_ATHLETE_ID})`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date)) return `дата «${g.date}» не YYYY-MM-DD`;
  if (g.date < addDays(g.today, PROBE_MIN_DAYS_AHEAD)) return `дата ${g.date} раньше чем через ${PROBE_MIN_DAYS_AHEAD} дней (${addDays(g.today, PROBE_MIN_DAYS_AHEAD)}): пробник пишет только в будущее`;
  if (!g.apply) return "сухой прогон (нет --apply)";
  if (g.confirm !== PROBE_CONFIRM) return `нет точной фразы --confirm "${PROBE_CONFIRM}"`;
  if (g.realEnv !== "true") return "TP_ACTIONS_REAL_EXECUTION != true";
  return null;
}

/** Подставной клиент: ведёт себя как TP. Опции имитируют отказы: POST игнорирует isHidden, PUT не скрывает, DELETE не удаляет, на дате уже есть чужая тренировка. */
export type FakeOpts = { ignoreHiddenInPost?: boolean; putIgnoresHidden?: boolean; deleteNoop?: boolean; preExisting?: boolean };
export function fakeClient(opts: FakeOpts): TpLike & { log: string[]; store: Map<number, Record<string, unknown>>; created: () => number } {
  const store = new Map<number, Record<string, unknown>>(); let next = 9000001; let creates = 0; const log: string[] = [];
  if (opts.preExisting) store.set(1, { workoutId: 1, athleteId: PROBE_ATHLETE_ID, title: "чужая тренировка", isHidden: false });
  return {
    log, store, created: () => creates,
    async createWorkout(b) { const id = next++; creates++; const rec = { ...b, workoutId: id, isHidden: opts.ignoreHiddenInPost ? false : (b.isHidden ?? false) }; store.set(id, rec); log.push(`POST ${JSON.stringify(b)}`); return { workoutId: id, raw: rec }; },
    async getWorkoutDetail(_a, id) { const r = store.get(id); if (!r) throw Object.assign(new Error('HTTP 400 "Invalid workoutId"'), { gone: true }); return { ...r }; },
    async putWorkout(_a, id, b) { const prev = store.get(id) ?? {}; const next2 = { ...b, isHidden: opts.putIgnoresHidden ? prev.isHidden : b.isHidden }; store.set(id, next2); log.push(`PUT isHidden=${String(b.isHidden)}`); return { ...next2 }; },
    async deleteWorkout(_a, id) { if (!opts.deleteNoop) store.delete(id); log.push(`DELETE ${id}`); return { status: 200, body: true }; },
    async listDay() { return [...store.values()].map((r) => ({ workoutId: Number(r.workoutId), title: String(r.title) })); },
    isGone: (e) => (e as { gone?: boolean }).gone === true,
  };
}

function markdown(r: FlowResult, head: string[]): string {
  const out = [...head, "", "| # | шаг | итог | что прочитано (дословно) |", "|---:|---|---|---|"];
  for (const s of r.steps) out.push(`| ${s.n} | ${s.name} | ${s.ok ? "ok" : "РАСХОЖДЕНИЕ"} | ${s.observed.replace(/\|/g, "/")} |`);
  out.push("", `- workoutId: \`${r.workoutId ?? "null"}\``, `- isHidden принят прямо из POST: \`${r.hiddenInPost}\``);
  out.push(`- hidden_verify_pass: \`${r.hiddenVerifyPass}\``, `- unhidden_verify_pass: \`${r.unhiddenVerifyPass}\``, `- deleted_verify_pass: \`${r.deletedVerifyPass}\``);
  out.push(`- stopped: \`${r.stopped ?? "нет"}\``, `- cleaned_up: \`${r.cleanedUp}\``);
  out.push(`- discrepancies: ${r.discrepancies.length ? "" : "нет"}`); for (const d of r.discrepancies) out.push(`  - ${d}`);
  out.push("- граница доказательства: «ученик не видит» подтверждено только флагом isHidden в ответе TP со стороны тренера, не глазами ученика.");
  return out.join("\n") + "\n";
}

async function main(): Promise<void> {
  const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] ?? null : null; };
  const today = iso(Date.now());
  const date = arg("date") ?? addDays(today, 14);
  const gate = probeGate({ apply: process.argv.includes("--apply"), confirm: arg("confirm"), realEnv: process.env.TP_ACTIONS_REAL_EXECUTION, athleteId: PROBE_ATHLETE_ID, date, today });
  const body = probeBody(date);

  if (gate) {
    console.log(`# Пробник скрытия на tp-api-client — СУХОЙ ПРОГОН (${gate})\n`);
    console.log(`Атлет: ${PROBE_ATHLETE_ID} (единственный разрешённый). Дата: ${date}. Одна тренировка. ${await sessionState()}.`);
    console.log(`\n## Порядок шагов реального прогона (после каждой записи — GET; расхождение = СТОП + уборка)`);
    console.log(`0. GET календарь ${date} — должно быть пусто (чужое не трогаем)`);
    console.log(`1. POST /fitness/v6/athletes/${PROBE_ATHLETE_ID}/workouts  тело: ${JSON.stringify({ ...body, isHidden: true, workoutId: 0 })}`);
    console.log(`2. GET /workouts/{id} — isHidden должен быть true. Если false/нет — РАСХОЖДЕНИЕ в отчёт, скрыть PUT-ом, снова GET`);
    console.log(`3. GET календарь ${date} — пробная тренировка в списке`);
    console.log(`4. PUT /workouts/{id}  тело: прежний объект из GET + isHidden:false  → GET: isHidden=false`);
    console.log(`5. DELETE /workouts/{id} → GET: «Invalid workoutId» (400) — тренировка удалена`);
    console.log(`6. GET календарь ${date} — снова пусто`);
    for (const ign of [false, true]) {
      const fc = fakeClient({ ignoreHiddenInPost: ign });
      const r = await runProbeCycle(fc, PROBE_ATHLETE_ID, date, body);
      console.log(`\n## ПРИМЕР ОТЧЁТА на ПОДСТАВНОМ клиенте (${ign ? "TP игнорирует isHidden в POST" : "TP принимает isHidden в POST"}) — это не TP, сети не было`);
      console.log(markdown(r, []));
    }
    console.log(`Реальный запуск: TP_ACTIONS_REAL_EXECUTION=true npx tsx tools/trainingpeaks-export/scripts/precedent/probe-hidden-via-client.ts --date ${date} --apply --confirm "${PROBE_CONFIRM}"`);
    return;
  }
  const r = await runProbeCycle(await liveClient(), PROBE_ATHLETE_ID, date, body);
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const head = [`# Пробник скрытия на tp-api-client — РЕАЛЬНЫЙ ПРОГОН ${ts}`, "", `- path: \`tp-api-client\``, `- athlete_id: \`${PROBE_ATHLETE_ID}\``, `- date: \`${date}\``];
  const md = markdown(r, head);
  for (const dir of [path.join(REPORTS, "precedent", "probe", ts), path.join(REPORTS, "hidden-workout-proof", `${ts}-api-client`)]) {
    mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "summary.md"), md); writeFileSync(path.join(dir, "summary.json"), JSON.stringify(r, null, 2));
  }
  console.log(md);
  if (r.stopped) process.exit(1);
}

if (process.argv[1]?.endsWith("probe-hidden-via-client.ts")) main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
