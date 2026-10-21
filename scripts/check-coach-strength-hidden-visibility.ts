/**
 * Проверка: скрытая тренерская силовая не видна ученику (решение Игоря 21.10).
 *
 * С 21.10 скан пишет в кэш и СКРЫТЫЕ тренерские силовые (source_snapshot.source =
 * tp_strength_service, isHidden = true) — их должны видеть автопланировщик и тренерские экраны,
 * но не ученик. Держит:
 *  1. предикат isHiddenCoachStrengthCacheRow (snake/camel; скрытый БЕГ из ленты tpapi он не трогает);
 *  2. фильтр базы ATHLETE_VISIBLE_CACHE_ROWS_OR_FILTER означает РОВНО то же, что предикат
 *     (разбор строки PostgREST .or() и прогон на образцах);
 *  3. проводку во все места, которые видит ученик: клуб «следующая тренировка», план питания,
 *     черновики ответов ученику, ответы на групповые отчёты; и что тренерский путь по умолчанию
 *     видит всё (опция выключена).
 *
 * Запуск: npx tsx scripts/check-coach-strength-hidden-visibility.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ATHLETE_VISIBLE_CACHE_ROWS_OR_FILTER,
  COACH_STRENGTH_CACHE_SOURCE,
  isCoachStrengthCacheRow,
  isHiddenCoachStrengthCacheRow,
} from "../src/features/trainingpeaks/coach-strength-visibility.ts";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

// ─── 1. предикат ─────────────────────────────────────────────────────────────
const hiddenStrength = { source_snapshot: { source: COACH_STRENGTH_CACHE_SOURCE, isHidden: true } };
const visibleStrength = { source_snapshot: { source: COACH_STRENGTH_CACHE_SOURCE, isHidden: false } };
const hiddenRunTpapi = { source_snapshot: { rawTitle: "Темп", isHidden: true } };
const plainRow = { source_snapshot: {} };
const noSnapshot = { source_snapshot: null };

assert.equal(isHiddenCoachStrengthCacheRow(hiddenStrength), true);
assert.equal(isHiddenCoachStrengthCacheRow({ sourceSnapshot: hiddenStrength.source_snapshot }), true, "camel из repository");
assert.equal(isHiddenCoachStrengthCacheRow(visibleStrength), false);
assert.equal(isHiddenCoachStrengthCacheRow(hiddenRunTpapi), false, "скрытый бег из ленты — прежнее поведение, не наш фильтр");
assert.equal(isHiddenCoachStrengthCacheRow(plainRow), false);
assert.equal(isHiddenCoachStrengthCacheRow(noSnapshot), false);
assert.equal(isHiddenCoachStrengthCacheRow({ source_snapshot: { source: COACH_STRENGTH_CACHE_SOURCE, isHidden: "true" } }), false, "только булево true");
assert.equal(isCoachStrengthCacheRow(hiddenStrength), true);
assert.equal(isCoachStrengthCacheRow(hiddenRunTpapi), false);

// ─── 2. фильтр базы ≡ предикат ───────────────────────────────────────────────
// Модель PostgREST: or=(a,b,…) — строка проходит, если верно хотя бы одно; json ->> даёт текст или
// NULL; neq с NULL — NULL (не проходит), как в SQL.
type Clause = { path: string; op: "is" | "neq"; value: string };
const clauses: Clause[] = ATHLETE_VISIBLE_CACHE_ROWS_OR_FILTER.split(",").map((part) => {
  const match = part.match(/^source_snapshot->>(\w+)\.(is|neq)\.(.+)$/);
  assert.ok(match, `неожиданный кусок фильтра: ${part}`);
  return { path: match![1]!, op: match![2] as Clause["op"], value: match![3]! };
});
function jsonText(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = (snapshot as Record<string, unknown>)[key];
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}
function passesDbFilter(row: { source_snapshot: unknown }): boolean {
  return clauses.some((clause) => {
    const text = jsonText(row.source_snapshot, clause.path);
    if (clause.op === "is") return clause.value === "null" ? text === null : false;
    return text !== null && text !== clause.value;
  });
}
const samples = [
  hiddenStrength, visibleStrength, hiddenRunTpapi, plainRow, noSnapshot,
  { source_snapshot: { source: COACH_STRENGTH_CACHE_SOURCE } },
  { source_snapshot: { source: "other", isHidden: true } },
  { source_snapshot: { isHidden: false } },
];
for (const sample of samples) {
  assert.equal(passesDbFilter(sample), !isHiddenCoachStrengthCacheRow(sample), `фильтр базы и предикат разошлись на ${JSON.stringify(sample)}`);
}
assert.equal(passesDbFilter(hiddenStrength), false, "скрытая силовая базой отсекается");
assert.equal(passesDbFilter(hiddenRunTpapi), true, "строки ленты tpapi базой не отсекаются");

// ─── 3. проводка в местах, которые видит ученик ──────────────────────────────
const club = read("src/features/club/service.ts");
const nextWorkout = club.slice(club.indexOf("export async function getClubNextWorkout"));
const nextWorkoutQuery = nextWorkout.slice(0, nextWorkout.indexOf(".limit(1)"));
assert.match(nextWorkoutQuery, /\.or\(ATHLETE_VISIBLE_CACHE_ROWS_OR_FILTER\)/, "клуб «следующая тренировка»: фильтр скрытых в запросе, ДО limit(1)");

const repository = read("src/features/trainingpeaks/repository.ts");
const listFn = repository.slice(repository.indexOf("export async function listTrainingPeaksWorkoutCacheForStudentDateRange"));
assert.match(
  listFn.slice(0, listFn.indexOf("if (error)")),
  /input\.athleteVisibleOnly \? query\.or\(ATHLETE_VISIBLE_CACHE_ROWS_OR_FILTER\) : query/,
  "repository: athleteVisibleOnly включает фильтр базы, без него — прежний запрос (тренерские пути видят всё)",
);

const replyDraft = read("src/features/trainingpeaks/reply-draft-context.ts");
assert.match(replyDraft, /listTrainingPeaksWorkoutCacheForStudentDateRange\(\{[\s\S]{0,900}?athleteVisibleOnly: true/, "черновики ответов ученику: athleteVisibleOnly");
const groupFlow = read("src/features/trainingpeaks/group-workout-report-review-flow.ts");
assert.match(groupFlow, /listTrainingPeaksWorkoutCacheForStudentDateRange\(\{[\s\S]{0,300}?athleteVisibleOnly: true/, "ответ на групповой отчёт: athleteVisibleOnly");

const nutrition = read("src/features/nutrition/context.ts");
assert.match(
  nutrition,
  /const baseRows = allRows\.filter\(\(row\) => !isClubMarkerTitle\(row\.title\) && !isHiddenCoachStrengthCacheRow\(row\)\)/,
  "план питания: скрытая силовая отсекается в той же точке, что и клубные пометки (до plannedOnly и подсчётов)",
);
const nutritionLoad = nutrition.slice(nutrition.indexOf("const allRows = await getNutritionTrainingPeaksCacheWindow"));
assert.doesNotMatch(nutritionLoad.slice(0, nutritionLoad.indexOf("});")), /includeSourceSnapshot:\s*false/, "план питания читает source_snapshot — без него пометку скрытия не увидеть");

console.log("PASS check-coach-strength-hidden-visibility");
