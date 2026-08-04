/**
 * ФАЗА 1 — импорт аватаров из Run Club для сопоставленных учеников без нашего фото.
 * По умолчанию DRY-RUN (печатает план, ничего не пишет). Реальная запись — только с --commit.
 *
 * Приоритет Telegram сохраняется: ставим club_avatar_path + club_avatar_checked_at=NULL, поэтому
 * ближайший показ/открытие мини-аппа увидит указатель «протухшим» и перепроверит Telegram
 * (Bot API + initData). Есть фото в Telegram — перекроет импортированное; нет — служит импортированное.
 * Тот же приватный бакет (club-avatars), тот же переключатель (club_avatar_visible), тот же прокси-роут.
 * Ресайз — переиспользуем resizeAvatarBytes из avatars.ts. Fetch только с известного Run Club хоста (SSRF).
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs --env-file=.env.local \
 *     scripts/runclub-avatars-import.ts [--commit]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resizeAvatarBytes } from "@/features/club/avatars";
import { translitVariants } from "@/features/club/name-translit";
import { nameGate, normalizeKm } from "@/features/club/probeg-parse";
import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");
const CLUB_AVATARS_BUCKET = "club-avatars"; // = avatars.ts (единый источник; литерал стабилен)
const RUNCLUB_HOST = "cfwbtyclcxzyprclzufk.supabase.co"; // SSRF-гвард: только сюда ходим за картинкой
const EXPORT = "/Users/igor/runclub-export";
const MAP_OUT = "docs/runclub-people-map.json"; // детерминированный вход для следующих фаз
type Profile = { id: string; name?: string | null; first_name?: string | null; last_name?: string | null; nickname?: string | null; avatar_url?: string | null };
const profiles = JSON.parse(readFileSync(`${EXPORT}/profiles.json`, "utf8")) as Profile[];
const runs = JSON.parse(readFileSync(`${EXPORT}/runs.json`, "utf8")) as Array<{ user_id: string; start_date?: string | null; created_at?: string | null; distance_km?: number | null; average_pace_seconds?: number | null }>;

const TRANSPORT = 150;
const dOnly = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 10) : null);
const kmOf = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const normTok = (s: string): string => s.toLowerCase().replace(/ё/gu, "е");
const enrichedSets = (name: string): string[][] =>
  name.trim().split(/\s+/u).map((t) => t.replace(/[^a-zа-яё]/giu, "")).filter((t) => t.length >= 2)
    .map((t) => [...new Set([normTok(t), ...(/[a-z]/i.test(t) ? translitVariants(t) : [t]).map(normTok)])]);

const rcByUser = new Map<string, Array<{ date: string; km: number }>>();
for (const r of runs) { const p = r.average_pace_seconds; if (typeof p === "number" && p < TRANSPORT) continue;
  const date = dOnly(r.start_date) ?? dOnly(r.created_at); const dkm = kmOf(r.distance_km); if (!date || !dkm) continue;
  (rcByUser.get(r.user_id) ?? rcByUser.set(r.user_id, []).get(r.user_id)!).push({ date, km: dkm }); }

const sb = createSupabaseServerClient();
const { data: studs, error: se } = await sb.from("trainingpeaks_students").select("id, student_name, club_avatar_path");
if (se) throw new Error(`students load: ${se.message}`);
const students = ((studs ?? []) as Array<{ id: string; student_name: string | null; club_avatar_path: string | null }>)
  .filter((s) => s.student_name && s.student_name.trim())
  .map((s) => ({ id: s.id, name: s.student_name as string, avatarPath: s.club_avatar_path, variants: enrichedSets(s.student_name as string) }));
const studentById = new Map(students.map((s) => [s.id, s]));

// наши тренировки: с ретраями + пауза между страницами (мягко к БД), порог чтобы не выдать мусор
const ourByStudent = new Map<string, Map<string, number[]>>();
{ type WR = { student_id: string; workout_date: string | null; completed_distance_raw: number | string | null };
  let off = 0, loaded = 0;
  for (;;) {
    let rows: WR[] | null = null;
    for (let a = 0; a < 5 && rows === null; a++) {
      const { data, error } = await sb.from("trainingpeaks_workout_cache").select("student_id, workout_date, completed_distance_raw").range(off, off + 999);
      if (error) { console.error(`load@${off}: ${error.message} (попытка ${a + 1})`); continue; }
      rows = (data ?? []) as WR[];
    }
    if (rows === null) throw new Error(`workout_cache: страница @${off} не загрузилась`);
    for (const w of rows) { const d = w.workout_date; const k = normalizeKm(w.completed_distance_raw); if (!d || !k) continue;
      const m = ourByStudent.get(w.student_id) ?? ourByStudent.set(w.student_id, new Map()).get(w.student_id)!;
      (m.get(d) ?? m.set(d, []).get(d)!).push(k); }
    loaded += rows.length;
    if (rows.length < 1000) break; off += 1000;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (loaded < 15000) throw new Error(`workout_cache загрузил только ${loaded} строк — прерываю`);
}
const overlap = (rc: Array<{ date: string; km: number }> | undefined, sid: string): number => {
  const om = ourByStudent.get(sid); if (!rc || !om) return 0; let n = 0;
  for (const run of rc) { const day = om.get(run.date); if (day && day.some((k) => Math.abs(k - run.km) <= Math.max(0.3, 0.08 * run.km))) n++; } return n; };

// уверенное сопоставление (exact + доминирующая подсказка), защита коллизии
type Mapped = { userId: string; studentId: string; tier: "exact" | "hint"; overlap: number };
const mapped = new Map<string, Mapped>(); const exactByStudent = new Map<string, Mapped>();
for (const p of profiles) {
  const names = [p.name, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(), p.nickname].filter((x): x is string => Boolean(x && x.trim()));
  const rc = rcByUser.get(p.id) ?? [];
  const strong = students.filter((s) => names.some((nm) => nameGate(s.variants, nm, { exactSurname: true })))
    .map((s) => ({ s, ov: overlap(rc, s.id) })).filter((x) => x.ov >= 1).sort((a, b) => b.ov - a.ov);
  if (strong.length) { const top = strong[0]; const prev = exactByStudent.get(top.s.id);
    if (!prev || top.ov > prev.overlap) { if (prev) mapped.delete(prev.userId); const m: Mapped = { userId: p.id, studentId: top.s.id, tier: "exact", overlap: top.ov }; exactByStudent.set(top.s.id, m); mapped.set(p.id, m); } continue; }
  if (rc.length >= 15) { const sc = students.map((s) => ({ s, ov: overlap(rc, s.id) })).filter((x) => x.ov >= 1).sort((a, b) => b.ov - a.ov);
    if (sc.length && sc[0].ov >= 15 && sc[0].ov >= 2 * (sc[1]?.ov ?? 0) && !mapped.has(p.id)) mapped.set(p.id, { userId: p.id, studentId: sc[0].s.id, tier: "hint", overlap: sc[0].ov }); }
}
// зафиксировать маппинг в data-файл (детерминированный вход для best_efforts/треков)
const mapArr = [...mapped.values()].map((m) => ({ profileId: m.userId, profileName: profiles.find((p) => p.id === m.userId)?.name ?? null, studentId: m.studentId, studentName: studentById.get(m.studentId)?.name ?? null, tier: m.tier, overlap: m.overlap }));
writeFileSync(MAP_OUT, JSON.stringify(mapArr, null, 2) + "\n");
console.log(`маппинг зафиксирован: ${mapArr.length} пар -> ${MAP_OUT}\n`);

// план аватаров: сопоставленные, у кого есть Run Club avatar_url И нет нашего club_avatar_path
const plan = [...mapped.values()].map((m) => {
  const prof = profiles.find((p) => p.id === m.userId); const stu = studentById.get(m.studentId);
  return { m, url: prof?.avatar_url ?? null, has: Boolean(stu?.avatarPath), name: stu?.name ?? m.studentId, profName: prof?.name ?? "?" };
}).filter((x) => x.url && !x.has);

console.log(`=== ПЛАН ИМПОРТА АВАТАРОВ (${plan.length}) ${COMMIT ? "[--commit: ПИШУ]" : "[DRY-RUN]"} ===`);
for (const x of plan) console.log(`  ${x.name}  (${x.m.tier}, профиль «${x.profName}»)  <- ${x.url}`);
const skipHave = [...mapped.values()].filter((m) => studentById.get(m.studentId)?.avatarPath).length;
const skipNoUrl = [...mapped.values()].filter((m) => !profiles.find((p) => p.id === m.userId)?.avatar_url).length;
console.log(`\nпропущено: уже есть наше фото ${skipHave}, у профиля нет avatar_url ${skipNoUrl}`);

if (!COMMIT) { console.log("\nDRY-RUN: ничего не записано. Проверь список, затем повтори с --commit."); process.exit(0); }

let ok = 0, fail = 0;
for (const x of plan) {
  try {
    const u = new URL(x.url!);
    if (u.protocol !== "https:" || u.hostname !== RUNCLUB_HOST) { console.log(`  SKIP ${x.name}: чужой хост ${u.hostname}`); fail++; continue; }
    const resp = await fetch(x.url!);
    if (!resp.ok) { console.log(`  FAIL ${x.name}: HTTP ${resp.status}`); fail++; continue; }
    const original = await resp.arrayBuffer();
    if (original.byteLength === 0) { console.log(`  FAIL ${x.name}: пустой файл`); fail++; continue; }
    const bytes = await resizeAvatarBytes(original);
    const up = await sb.storage.from(CLUB_AVATARS_BUCKET).upload(`${x.m.studentId}.jpg`, bytes, { upsert: true, contentType: "image/jpeg" });
    if (up.error) { console.log(`  FAIL ${x.name}: upload ${up.error.message}`); fail++; continue; }
    // checked_at=NULL -> ближайшая проверка отдаст приоритет Telegram
    const upd = await sb.from("trainingpeaks_students").update({ club_avatar_path: `${x.m.studentId}.jpg`, club_avatar_checked_at: null }).eq("id", x.m.studentId);
    if (upd.error) { console.log(`  FAIL ${x.name}: update ${upd.error.message}`); fail++; continue; }
    ok++; console.log(`  OK ${x.name}`);
  } catch (e) { fail++; console.log(`  FAIL ${x.name}: ${e instanceof Error ? e.message : e}`); }
  await new Promise((r) => setTimeout(r, 150));
}
console.log(`\n=== ИМПОРТ: ${ok} записано, ${fail} ошибок ===`);
