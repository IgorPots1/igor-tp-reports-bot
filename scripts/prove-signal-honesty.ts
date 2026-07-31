// READ-ONLY proof of the signal-honesty fix. OLD arc = first rep >5% slower than the fastest-so-far
// fires «темп просел / к концу тяжелее». NEW = isHonestFade (back-half vs front-half ≥8 s/km,
// sustained) + hrClimbed. Shows: the false negative-split narratives (incl Olga) go silent, genuine
// fades stay. Plus the pulse trigger: decoupling no longer says «выше обычного» (Mariyet).
//
// Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs --env-file=.env.local scripts/prove-signal-honesty.ts
import { createSupabaseServerClient } from "@/features/supabase/server";
import { isHonestFade, robustFadeSecPerKm, hrClimbed } from "@/features/trainingpeaks/feedback/signal-honesty";

const pace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// OLD arc break: first rep >5% slower than the running-minimum → narrate a decline.
function oldArcFired(paces: number[]): boolean {
  if (paces.length < 3) return false;
  let best = paces[0]!;
  for (let i = 1; i < paces.length; i += 1) {
    if (paces[i]! > best * 1.05) return true;
    best = Math.min(best, paces[i]!);
  }
  return false;
}

type Sb = ReturnType<typeof createSupabaseServerClient>;
async function pageAll<T>(sb: Sb, table: string, cols: string, sinceIso: string, runOnly = false): Promise<T[]> {
  const out: T[] = []; let from = 0;
  for (;;) {
    let q = sb.from(table).select(cols).gte("workout_date", sinceIso).range(from, from + 999);
    if (runOnly) q = q.eq("workout_type", "run");
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data as T[]) ?? []; out.push(...rows);
    if (rows.length < 1000) break; from += 1000;
  }
  return out;
}

async function main() {
  const sb = createSupabaseServerClient();
  const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const ders = await pageAll<{ student_id: string; workout_date: string; rep_paces: number[] | null; rep_peak_hrs: number[] | null; hr_trusted: boolean | null; reps_detected_count: number | null; avg_hr: number | null }>(
    sb, "trainingpeaks_workout_derived_metrics", "student_id, workout_date, rep_paces, rep_peak_hrs, hr_trusted, reps_detected_count, avg_hr", since, true);
  const sids = [...new Set(ders.map((d) => d.student_id))];
  const nm = new Map<string, string>();
  for (let i = 0; i < sids.length; i += 300) {
    const { data } = await sb.from("trainingpeaks_students").select("id, student_name").in("id", sids.slice(i, i + 300));
    for (const s of (data as Array<{ id: string; student_name: string }> | null) ?? []) nm.set(s.id, s.student_name);
  }

  // ── Interval fade: OLD vs NEW ──
  const intervals = ders.filter((d) => (d.reps_detected_count ?? 0) >= 3 && (d.rep_paces ?? []).filter((p) => p != null).length >= 3);
  let oldFires = 0, newFires = 0, silenced = 0;
  const silencedRows: string[] = []; const keptRows: string[] = [];
  for (const d of intervals) {
    const paces = (d.rep_paces ?? []).filter((p): p is number => p != null && p > 0);
    const oldF = oldArcFired(paces);
    const newF = isHonestFade(d.rep_paces);
    if (oldF) oldFires++;
    if (newF) newFires++;
    if (oldF && !newF) {
      silenced++;
      const fade = robustFadeSecPerKm(d.rep_paces);
      const line = `  ${d.workout_date} ${(nm.get(d.student_id) ?? d.student_id).slice(0, 22).padEnd(22)} reps=${paces.length} rep1=${pace(paces[0]!)} last=${pace(paces[paces.length - 1]!)} realFade=${fade?.toFixed(0)}с/км hrClimb=${hrClimbed(d.rep_peak_hrs, d.hr_trusted)}`;
      silencedRows.push(line);
    } else if (newF) {
      const fade = robustFadeSecPerKm(d.rep_paces);
      keptRows.push(`  ${d.workout_date} ${(nm.get(d.student_id) ?? "").slice(0, 22).padEnd(22)} realFade=+${fade?.toFixed(0)}с/км hrClimb=${hrClimbed(d.rep_peak_hrs, d.hr_trusted)}`);
    }
  }
  console.log(`ИНТЕРВАЛЫ за 45д: ${intervals.length}. Старая дуга кричала «просел»: ${oldFires}. Новая (честная): ${newFires}. ЗАМОЛЧАЛО ложных: ${silenced}`);
  console.log(`\n=== ЗАМОЛЧАЛИ (старое врало, новое молчит) ===`);
  console.log(silencedRows.slice(0, 20).join("\n"));
  console.log(`\n=== ОСТАЛИСЬ (настоящий fade ≥8с/км, back-half медленнее) ===`);
  console.log(keptRows.length ? keptRows.join("\n") : "  (нет)");

  // Olga highlight
  const olga = intervals.filter((d) => /olga|ольга/i.test(nm.get(d.student_id) ?? "")).sort((a, b) => b.workout_date.localeCompare(a.workout_date));
  console.log(`\n=== ОЛЬГА (флагманский ложняк) ===`);
  for (const d of olga.slice(0, 3)) {
    const paces = (d.rep_paces ?? []).filter((p): p is number => p != null);
    console.log(`  ${d.workout_date} reps=${paces.length} rep1=${pace(paces[0]!)} last=${pace(paces[paces.length - 1]!)} realFade=${robustFadeSecPerKm(d.rep_paces)?.toFixed(0)}с/км → старое=${oldArcFired(paces) ? "«просел»" : "молчит"} новое=${isHonestFade(d.rep_paces) ? "«просел»" : "МОЛЧИТ"}`);
  }

  // ── Mariyet pulse: decoupling no longer says «выше обычного» ──
  const mariyet = ders.filter((d) => /mariyet|марьят|мариям|мариат/i.test(nm.get(d.student_id) ?? ""));
  console.log(`\n=== МАРИЯМ — пульс «выше обычного» после фикса ===`);
  if (mariyet.length) {
    const sid = mariyet[0]!.student_id;
    const easy = ders.filter((d) => d.student_id === sid && (d.reps_detected_count ?? 0) <= 1 && d.avg_hr != null && d.hr_trusted).map((d) => d.avg_hr!) .sort((a, b) => a - b);
    const median = easy.length ? easy[Math.floor(easy.length / 2)]! : null;
    const flagged = mariyet.filter((d) => (d.reps_detected_count ?? 0) <= 1 && d.avg_hr != null).sort((a, b) => b.workout_date.localeCompare(a.workout_date))[0];
    if (flagged && median != null) {
      const delta = flagged.avg_hr! - median;
      console.log(`  флаг-тренировка ${flagged.workout_date}: avg_hr=${flagged.avg_hr!.toFixed(1)} · её easy-медиана=${median.toFixed(1)} · дельта=${delta.toFixed(1)} bpm`);
      console.log(`  СТАРОЕ: decoupling запускал «выше обычного» независимо → ЛОЖЬ. НОВОЕ: только avg_hr≥медиана+8 → дельта ${delta.toFixed(1)} < 8 → МОЛЧИТ ✅`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
