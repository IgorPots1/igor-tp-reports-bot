/**
 * ВИДЕО К СВОИМ УПРАЖНЕНИЯМ ТРЕНЕРА (Игорь 21.10). Правка упражнения в клиенте TP отдельного вызова не имеет — тот же PUT /rx/activity/v1/exercises,
 * что и создание (createNewExercise), с моделью, в которой уже есть id. Это не проверено живьём, поэтому сначала --probe на одноразовом «ПРОБА ВИДЕО»:
 *   создать (видео A) → прочитать → PUT с id (видео B) → прочитать: id тот же, видео B, дубля нет → удалить → прочитать (нет) → библиотека как была.
 * --apply: проставить видео упражнениям из MAP; после каждого — чтение: id, название, параметры прежние, видео новое; обновляется локальная копия
 * reports/strength/exercises/{id}.json (из неё собираются тела тренировок).
 *   TP_ACTIONS_REAL_EXECUTION=true tsx exercise-video.ts --probe --confirm "ПРОБА ВИДЕО"
 *   TP_ACTIONS_REAL_EXECUTION=true tsx exercise-video.ts --apply --confirm "ВИДЕО К УПРАЖНЕНИЯМ"
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const HERE = path.dirname(new URL(import.meta.url).pathname); const REPO = path.resolve(HERE, "../../../..");
const CANON = "/Users/igor/igor-tp-reports-bot"; const COACH = 5457637;
export const MAP: Record<string, string> = { "664210": "https://www.youtube.com/shorts/EotSw18oR9w", "664212": "https://youtu.be/Zw6z2oXWfGA",
  // Ирина 6701419, выбор Игоря 25.10 — вариант 1 у всех трёх.
  "670278": "https://www.youtube.com/watch?v=HUWWm1_CZxA", "670279": "https://www.youtube.com/watch?v=pdP0uJXvc44", "670280": "https://www.youtube.com/watch?v=sBww6q9Zybs" };
const tp = await import(`${REPO}/src/features/trainingpeaks/tp-api-client.ts`) as {
  getTpApiJsonRaw: (h: "strength", p: string) => Promise<{ status: number; body: unknown }>;
  newStrengthExerciseModel: () => Promise<Record<string, unknown>>; createStrengthExercise: (m: Record<string, unknown>) => Promise<Record<string, unknown>>;
  deleteStrengthExercise: (id: string) => Promise<{ status: number; body: unknown }>;
};
const args = process.argv.slice(2); const ci = args.indexOf("--confirm");
const gate = (p: string): void => { if (args[ci + 1] !== p || process.env.TP_ACTIONS_REAL_EXECUTION !== "true") { console.error(`ОТКАЗ: нужны --confirm "${p}" и TP_ACTIONS_REAL_EXECUTION=true`); process.exit(2); } };
const getEx = async (id: string): Promise<{ status: number; d: Record<string, unknown> }> => { const r = await tp.getTpApiJsonRaw("strength", `/rx/activity/v1/exercises/${id}`); return { status: r.status, d: ((r.body as { data?: Record<string, unknown> })?.data ?? {}) }; };
const ownCount = async (): Promise<{ n: number; titles: string[] }> => { const r = await tp.getTpApiJsonRaw("strength", "/rx/activity/v1/libraryContent"); const out: string[] = [];
  const walk = (o: unknown): void => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { const x = o as Record<string, unknown>; if ("exerciseId" in x && "title" in x) { if (Number(x.ownerId) === COACH) out.push(String(x.title)); } else Object.values(x).forEach(walk); } }; walk(r.body); return { n: out.length, titles: out }; };
const params = (d: Record<string, unknown>): string => ((d.parameters as Array<Record<string, unknown>>) ?? []).map((p) => `${String(p.parameter)}:${String(p.id)}`).join(",");

if (args.includes("--probe")) {
  gate("ПРОБА ВИДЕО");
  const A = "https://youtu.be/Zw6z2oXWfGA", B = "https://www.youtube.com/shorts/EotSw18oR9w";
  const before = await ownCount(); console.log(`0. своих упражнений у тренера: ${before.n}`);
  let id: string | null = null;
  try {
    const m = await tp.newStrengthExerciseModel();
    const created = await tp.createStrengthExercise({ ...m, title: "ПРОБА ВИДЕО", ownerId: COACH, instructions: "", videoUrl: A, parameters: [] });
    id = String(created.id); const g1 = await getEx(id); console.log(`1. создано id=${id}: «${String(g1.d.title)}», videoUrl=${JSON.stringify(g1.d.videoUrl)} (ждали A)`);
    const upd = await tp.createStrengthExercise({ ...g1.d, videoUrl: B }); const g2 = await getEx(id);
    console.log(`2. PUT с id (видео B): ответ id=${String(upd.id)}; GET: id=${String(g2.d.id)}, videoUrl=${JSON.stringify(g2.d.videoUrl)} (ждали B), название «${String(g2.d.title)}»`);
    const mid = await ownCount(); console.log(`3. своих упражнений: ${mid.n} (ждали ${before.n + 1}; «ПРОБА ВИДЕО» — ${mid.titles.filter((t) => t === "ПРОБА ВИДЕО").length} шт.)`);
  } catch (e) { console.log(`ОШИБКА: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`); }
  const after0 = await ownCount(); const extra = after0.titles.filter((t) => t === "ПРОБА ВИДЕО").length;
  if (id) { const d = await tp.deleteStrengthExercise(id); const g = await getEx(id); console.log(`4. DELETE exercises/${id}: HTTP ${d.status}; GET после: HTTP ${g.status}`); }
  const after = await ownCount(); console.log(`5. своих упражнений после: ${after.n} (ждали ${before.n}); «ПРОБА ВИДЕО» осталось: ${after.titles.filter((t) => t === "ПРОБА ВИДЕО").length}${extra > 1 ? " — БЫЛ ДУБЛЬ, удалить вручную" : ""}`);
  process.exit(0);
}

if (args.includes("--apply")) {
  gate("ВИДЕО К УПРАЖНЕНИЯМ");
  const before = await ownCount();
  for (const [id, url] of Object.entries(MAP)) {
    const g0 = await getEx(id); if (g0.status !== 200 || Number(g0.d.ownerId) !== COACH) { console.error(`СТОП: ${id} не своё упражнение тренера или не читается (HTTP ${g0.status})`); process.exit(3); }
    if (g0.d.videoUrl === url) { console.log(`${id} «${String(g0.d.title)}»: видео уже стоит`); continue; }
    await tp.createStrengthExercise({ ...g0.d, videoUrl: url }); const g1 = await getEx(id);
    const ok = g1.d.videoUrl === url && g1.d.title === g0.d.title && params(g1.d) === params(g0.d) && String(g1.d.id) === id;
    console.log(`${id} «${String(g1.d.title)}»: videoUrl=${JSON.stringify(g1.d.videoUrl)}; параметры ${params(g1.d)} (были ${params(g0.d)}) → ${ok ? "сверка совпала" : "РАСХОЖДЕНИЕ — СТОП"}`);
    if (!ok) process.exit(4);
    const raw = await tp.getTpApiJsonRaw("strength", `/rx/activity/v1/exercises/${id}`); writeFileSync(path.join(CANON, "reports", "strength", "exercises", `${id}.json`), JSON.stringify(raw, null, 2));
  }
  const after = await ownCount(); console.log(`своих упражнений: было ${before.n}, стало ${after.n} (дублей быть не должно)`);
  process.exit(0);
}
console.log("сухо: укажи --probe или --apply (см. шапку)"); console.log(JSON.stringify(MAP, null, 1));
