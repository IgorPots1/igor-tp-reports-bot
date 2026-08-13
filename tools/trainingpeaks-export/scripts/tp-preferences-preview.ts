/**
 * tp-preferences-preview — КАК ПОЖЕЛАНИЕ МЕНЯЕТ НЕДЕЛЮ. READ-ONLY, ничего не пишет.
 *
 * ЗАЧЕМ. Таблица athlete_week_preferences кладётся файлом и Игорем ещё не применена, а
 * проверить контракт надо СЕЙЧАС и на живых людях, а не на заглушке. Скрипт собирает неделю
 * дважды — без пожеланий и с пожеланиями, заданными прямо здесь, — и показывает разницу.
 *
 * ЭТО НЕ БОЕВОЕ ЗАВЕДЕНИЕ ПОЖЕЛАНИЙ. В базу ничего не пишется, в TP тем более. Пожелания
 * ниже взяты из РЕАЛЬНЫХ записей памяти (см. docs/athlete-preferences-inventory.md) —
 * именно чтобы проверять контракт на том, что тренер действительно говорил, а не на выдумке.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-preferences-preview.ts
 */
import process from "node:process";

import { loadLocalEnv } from "./lib/local-env.ts";
loadLocalEnv();

import { createSupabaseServerClient } from "../../../src/features/supabase/server.ts";
import { loadAthleteContexts, mondayOf } from "./lib/autoplanner-context.ts";
import { loadCatalog } from "./lib/autoplanner-catalog.ts";
import { buildWeek, DAY_RU, type CycleWeekTarget, type Week } from "./lib/autoplanner-week.ts";
import { buildDrafts } from "./lib/cycle-drafts.ts";
import { forecast } from "./lib/training-cycle.ts";
import type { AthletePreference } from "./lib/athlete-preferences.ts";

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);

/**
 * ПОЖЕЛАНИЯ ВЗЯТЫ ИЗ ПАМЯТИ, А НЕ ПРИДУМАНЫ. Слева — что реально записано.
 * Столова и Богачев — прямые цитаты; Панина — случай из наряда про день длительной.
 */
const CASES: Array<{ aid: number; why: string; prefs: AthletePreference[] }> = [
  {
    aid: 6290336,
    why: "память: «Интервалы не ставить на вторник и пятницу» (availability_preference)",
    prefs: [
      { kind: "day_unavailable", dayOfWeek: 1, reason: "интервалы не ставить на вторник" },
      { kind: "day_unavailable", dayOfWeek: 4, reason: "интервалы не ставить на пятницу" },
    ],
  },
  {
    aid: 5733446,
    why: "память: «Предпочитает длительные тренировки проводить на субботу» (planning_preference)",
    prefs: [{ kind: "role_day", role: "long", dayOfWeek: 5, reason: "длительные на субботу" }],
  },
  {
    aid: 5931798,
    why: "случай наряда: её длительные по заголовку 4 Сб против 1 Вс, но общая концентрация 43% — порог не пускает",
    prefs: [{ kind: "role_day", role: "long", dayOfWeek: 5, reason: "длинное в субботу" }],
  },
];

function line(w: Week): string {
  return w.sessions.filter((s) => !s.deferred)
    .map((s) => `${DAY_RU[s.dayIdx]}:${s.role === "quality" ? "К" : s.role === "long" ? "Д" : "л"}${s.minutes}`).join("  ");
}

async function main(): Promise<void> {
  const sb = createSupabaseServerClient();
  const today = iso(Date.now());
  const weekStart = addDays(mondayOf(today), 7);
  const ctx = await loadAthleteContexts(sb);
  const cat = await loadCatalog(sb);
  const drafts = await buildDrafts(sb, ctx, today);
  const { data: st } = await sb.from("trainingpeaks_students").select("student_name, trainingpeaks_athlete_url");
  const names = new Map<number, string>();
  for (const r of (st ?? []) as Array<Record<string, unknown>>) {
    const hit = /athletes?\/(\d+)/.exec(String(r.trainingpeaks_athlete_url ?? ""));
    if (hit && r.student_name) names.set(Number(hit[1]), String(r.student_name));
  }

  console.log(`ПОЖЕЛАНИЕ ПРОТИВ РАСЧЁТА · неделя ${weekStart}`);
  console.log("Пожелания заданы В КОДЕ этого скрипта, в базу не пишутся. В TP не пишется ничего.\n");

  for (const c of CASES) {
    const a = ctx.get(c.aid);
    if (!a) { console.log(`${c.aid}: контекста нет\n`); continue; }
    const d = drafts.get(c.aid);
    const target = (): CycleWeekTarget | null => {
      if (!d) return null;
      const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(weekStart)) / (7 * 86400000)) + 1 : 8;
      const f = forecast(d, weekStart, Math.max(1, w2r))[0];
      if (!f) return null;
      return { weekIndex: 1, totalWeeks: 8, role: f.role, aerobicMin: f.aerobicMin, qualityMin: f.qualityMin,
        days: f.days, baseWeekMin: d.baseAerobicMin + d.baseQualityMin, hasTargetRace: d.targetDate != null, intent: d.intent };
    };
    const t = target();
    const before = buildWeek(a, a.envelope, cat, weekStart, a.hasActiveIllness, a.tierNote, t);
    const after = buildWeek(a, a.envelope, cat, weekStart, a.hasActiveIllness, a.tierNote, t, c.prefs);

    console.log("═".repeat(104));
    console.log(`${names.get(c.aid) ?? c.aid} (${c.aid})`);
    console.log(`  откуда пожелание: ${c.why}`);
    console.log(`  задано: ${c.prefs.map((p) => JSON.stringify({ ...p, reason: undefined })).join(" ")}`);
    console.log("═".repeat(104));
    console.log(`  БЕЗ ПОЖЕЛАНИЯ  ${line(before)}   = ${before.plannedMinutes} мин`);
    console.log(`  С ПОЖЕЛАНИЕМ   ${line(after)}   = ${after.plannedMinutes} мин`);
    const newNotes = after.notes.filter((n) => !before.notes.includes(n));
    if (newNotes.length) {
      console.log("  что сборщик сказал тренеру:");
      for (const n of newNotes) console.log(`    · ${n}`);
    } else console.log("  новых пометок нет");
    if (after.refused) console.log(`  ОТКАЗ: ${after.refused}`);
    console.log("");
  }

  // ── СПОР ПОЖЕЛАНИЯ С ИНВАРИАНТОМ НА ЖИВОМ ──
  // Просим качественную ровно в тот день, который смежен с её длительной. Инвариант обязан
  // выстоять, а тренер — увидеть, что пожелание не исполнено и почему.
  const a2 = ctx.get(5905779);
  if (a2) {
    const d2 = drafts.get(5905779);
    let t2: CycleWeekTarget | null = null;
    if (d2) {
      const f = forecast(d2, weekStart, 8)[0];
      if (f) t2 = { weekIndex: 1, totalWeeks: 8, role: f.role, aerobicMin: f.aerobicMin, qualityMin: f.qualityMin,
        days: f.days, baseWeekMin: d2.baseAerobicMin + d2.baseQualityMin, hasTargetRace: d2.targetDate != null, intent: d2.intent };
    }
    const base = buildWeek(a2, a2.envelope, cat, weekStart, a2.hasActiveIllness, a2.tierNote, t2);
    const longDay = base.sessions.find((s) => s.role === "long")?.dayIdx ?? 6;
    const clash = (longDay + 6) % 7; // день ПЕРЕД длительной — заведомо смежный
    const conflicted = buildWeek(a2, a2.envelope, cat, weekStart, a2.hasActiveIllness, a2.tierNote, t2,
      [{ kind: "role_day", role: "quality", dayOfWeek: clash, reason: "проверка спора с инвариантом" }]);
    console.log("═".repeat(104));
    console.log(`${names.get(5905779) ?? 5905779} (5905779) — СПОР ПОЖЕЛАНИЯ С ИНВАРИАНТОМ`);
    console.log(`  просим качественную в ${DAY_RU[clash]}, а длительная у неё в ${DAY_RU[longDay]} — это смежные дни`);
    console.log("═".repeat(104));
    console.log(`  БЕЗ ПОЖЕЛАНИЯ  ${line(base)}`);
    console.log(`  С ПОЖЕЛАНИЕМ   ${line(conflicted)}`);
    for (const n of conflicted.notes.filter((n) => !base.notes.includes(n))) console.log(`    · ${n}`);
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
