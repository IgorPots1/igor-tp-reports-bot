// Feedback safety-net + recall monitor (once a day). The report-triggered enqueue only drafts a
// run once a report is RECOGNISED — but the label is ~92%, so some real reports slip. This catches
// the slip: runs with NO draft where the student DID write something around them. So a missed
// report doesn't vanish silently — it lands in a daily Telegram line "глянь вручную". The same two
// counts (drafted vs possibly-missed) are the recall monitor: a rising miss-ratio = degradation.
//
// READ-ONLY (no DB writes, no generation, no auto-send to students). Sends ONE coach line.
// Run: tsx scripts/tp-feedback-safety-net.ts [--dry-run]

import { loadLocalEnv } from "./lib/local-env.ts";
loadLocalEnv();

import { createSupabaseServerClient } from "../../../src/features/supabase/server.ts";
import { sendCoachTelegramMessage } from "./lib/coach-telegram-notify.ts";

// Runs this many days old are "settled" — the hourly sweep has definitely run, so a missing draft
// is a real gap, not just timing. Today's runs are excluded (a report may still arrive).
const WINDOW_DAYS = 3;
const MAX_LIST = 12; // cap the digest so it stays one glanceable message

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const shift = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const ddmm = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sb = createSupabaseServerClient();

  const today = ymd(new Date());
  const from = shift(today, -WINDOW_DAYS); // inclusive
  const to = shift(today, -1); // inclusive (exclude today)

  const { data: studs } = await sb.from("trainingpeaks_students").select("id, student_name, is_active, is_service_account");
  const studentRows = (studs as Array<{ id: string; student_name: string | null; is_active: boolean | null; is_service_account: boolean | null }>) ?? [];
  const nameById = new Map(studentRows.map((s) => [s.id, s.student_name]));
  const activeIds = new Set(studentRows.filter((s) => s.is_active && !s.is_service_account).map((s) => s.id));

  // Run workouts in the settled window (run-only, same gate as the sweep).
  const { data: runsRaw } = await sb.from("trainingpeaks_workout_derived_metrics")
    .select("student_id, workout_cache_id, workout_date, workout_type")
    .eq("workout_type", "run").gte("workout_date", from).lte("workout_date", to).limit(4000);
  const runs = ((runsRaw as Array<{ student_id: string; workout_cache_id: string; workout_date: string }>) ?? []).filter((r) => activeIds.has(r.student_id));

  // Per student, dates that carry a RECOGNISED report and dates with a substantive (non-ack,
  // non-third-party, non-URL) inbound message. "Recognised" is the actual signal the sweep acts on
  // — NOT "has a job", which is polluted by the old model's legacy jobs (drafted every run).
  const studentIds = [...new Set(runs.map((r) => r.student_id))];
  const reportDates = new Map<string, Set<string>>();
  const msgsByStudent = new Map<string, Array<{ date: string; text: string }>>();
  const sinceIso = new Date(`${from}T00:00:00Z`).toISOString();
  for (let i = 0; i < studentIds.length; i += 150) {
    const part = studentIds.slice(i, i + 150);
    const { data } = await sb.from("trainingpeaks_telegram_context_observations")
      .select("student_id, observed_at, labels, text_preview").in("student_id", part).gte("observed_at", sinceIso).limit(8000);
    const obsRows = (data as Array<{ student_id: string; observed_at: string; labels: unknown; text_preview: string | null }>) ?? [];
    for (const o of obsRows) {
      const labels = Array.isArray(o.labels) ? o.labels.map(String) : [];
      const date = o.observed_at.slice(0, 10);
      if (labels.includes("report_like")) {
        const set = reportDates.get(o.student_id) ?? new Set<string>();
        set.add(date);
        reportDates.set(o.student_id, set);
      }
      const text = (o.text_preview ?? "").trim();
      if (text.length <= 12) continue;
      if (/^https?:\/\/\S+$/iu.test(text)) continue;
      if (labels.length > 0 && labels.every((l: string) => l === "ack_or_noise" || l === "third_party_in_linked_topic")) continue;
      const list = msgsByStudent.get(o.student_id) ?? [];
      list.push({ date, text });
      msgsByStudent.set(o.student_id, list);
    }
  }

  const hasReport = (studentId: string, wd: string) => {
    const dates = reportDates.get(studentId);
    return !!dates && (dates.has(wd) || dates.has(shift(wd, 1)));
  };

  // Recognised = run with a report_like in [wd, wd+1] (the sweep drafts it). Candidate (possibly
  // missed) = NO recognised report, but the student DID write something substantive in the window.
  const recognised = runs.filter((r) => hasReport(r.student_id, r.workout_date as string));
  const candidates: Array<{ studentId: string; wd: string; snippet: string }> = [];
  for (const r of runs) {
    const wd = r.workout_date as string;
    if (hasReport(r.student_id, wd)) continue;
    const msgs = (msgsByStudent.get(r.student_id) ?? []).filter((m) => m.date === wd || m.date === shift(wd, 1));
    if (msgs.length === 0) continue; // silent run around this workout → intentionally not drafted
    const best = msgs.sort((a, b) => b.text.length - a.text.length)[0];
    candidates.push({ studentId: r.student_id, wd, snippet: best.text.slice(0, 80) });
  }
  // one row per student (a student may have several) — keep the freshest run
  const byStudent = new Map<string, { wd: string; snippet: string }>();
  for (const c of candidates.sort((a, b) => b.wd.localeCompare(a.wd))) {
    if (!byStudent.has(c.studentId)) byStudent.set(c.studentId, { wd: c.wd, snippet: c.snippet });
  }
  const rows = [...byStudent.entries()];

  const total = recognised.length + rows.length;
  const missRatio = total > 0 ? Math.round((rows.length / total) * 100) : 0;
  const hot = rows.length >= 5 && missRatio >= 40; // degradation smell

  // Build the one-message digest.
  const lines: string[] = [];
  lines.push(`📋 Сетка отчётов (${WINDOW_DAYS} дн): распознано ${recognised.length}, возможно пропущено ${rows.length}${hot ? " ⚠️" : ""}`);
  if (rows.length === 0) {
    lines.push("Пропущенных нет ✓");
  } else {
    lines.push("Написали про пробежку, черновика нет — глянь:");
    for (const [sid, r] of rows.slice(0, MAX_LIST)) {
      lines.push(`• ${nameById.get(sid) ?? "Ученик"} — ${ddmm(r.wd)}: «${r.snippet}»`);
    }
    if (rows.length > MAX_LIST) lines.push(`…и ещё ${rows.length - MAX_LIST}`);
  }
  const message = lines.join("\n");

  // Monitoring line to the log (LaunchAgent .out.log) for trend.
  console.log(`[tp-feedback-safety-net] ${JSON.stringify({ window: `${from}..${to}`, recognised: recognised.length, possiblyMissed: rows.length, missRatioPct: missRatio, hot })}`);
  console.log("─── digest ───\n" + message + "\n──────────────");

  if (dryRun) {
    console.log("[tp-feedback-safety-net] --dry-run: не отправляю");
    return;
  }
  await sendCoachTelegramMessage(message);
}

main().then(() => process.exit(0)).catch((e) => { console.error(`[tp-feedback-safety-net] failed: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
