/**
 * АУДИТ АКТИВНЫХ СИГНАЛОВ ЗДОРОВЬЯ. READ-ONLY: ничего не закрывает.
 *
 * Почему сигнал не закрывается (разбор 15.10, Хоффман):
 *  - у health/pain сигналов нет срока: valid_until = NULL почти всегда (дату модель извлечь не смогла);
 *  - закрытия по событию нет: прошедший старт сигнал не трогает;
 *  - уборка зомби (src/features/trainingpeaks/signal-zombie-cleanup.ts) по принципу НЕ трогает
 *    pain_injury и health-сигналы — «травмы закрываются руками»;
 *  - ответ ученика («отёк уменьшился, боли нет») рождает НОВЫЙ сигнал рядом, а старый не трогает.
 * Генератор при этом поле status не читает: окно = created_at … +7 дней +3 хвоста (pullIllness).
 *
 * Протухший = статус active, и выполнено хоть одно:
 *   (а) после начала сигнала у атлета ПРОШЁЛ СТАРТ (race_events, дата < сегодня) — бежал гонку;
 *   (б) старше срока по типу (SIGNAL_TTL_DAYS ниже, замер — в отчёте).
 * Ответ ученика в переписке — подсказка тренеру (последняя реплика после сигнала), не автозакрытие.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/signals-audit.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { sbc } from "./dump-corpus.ts";
import { OUT_DIR } from "./load.ts";
import { iso } from "./corpus.ts";
import { SIGNAL_TTL_DAYS, ILLNESS_SIGNAL_TYPES, staleReason, signalStart } from "../lib/signal-closure.ts";

async function main(): Promise<void> {
  const sb = sbc();
  const today = iso(Date.now());
  const { data: sig, error } = await sb.from("trainingpeaks_student_operational_signals")
    .select("id,student_id,signal_type,status,valid_from,valid_until,source_date,target_date,created_at,resolved_at,structured_payload")
    .in("signal_type", ILLNESS_SIGNAL_TYPES).eq("status", "active");
  if (error) throw error;
  const { data: st } = await sb.from("trainingpeaks_students").select("id,student_name,trainingpeaks_athlete_url");
  const aidBySid = new Map<string, number>(); const nameBySid = new Map<string, string>();
  for (const s of (st ?? []) as Array<Record<string, string | null>>) { const m = /athletes?\/(\d+)/.exec(s.trainingpeaks_athlete_url ?? ""); if (m) aidBySid.set(String(s.id), Number(m[1])); nameBySid.set(String(s.id), String(s.student_name ?? s.id)); }
  const { data: races } = await sb.from("trainingpeaks_race_events").select("trainingpeaks_athlete_id,event_date,distance_km");
  const raceBy = new Map<number, string[]>();
  for (const r of (races ?? []) as Array<{ trainingpeaks_athlete_id: number; event_date: string }>) (raceBy.get(r.trainingpeaks_athlete_id) ?? raceBy.set(r.trainingpeaks_athlete_id, []).get(r.trainingpeaks_athlete_id)!).push(r.event_date);
  // последняя реплика ученика ПОСЛЕ сигнала — из более поздних сигналов того же ученика (latest_summary = текст)
  const sids = [...new Set(((sig ?? []) as Array<{ student_id: string }>).map((s) => s.student_id))];
  const { data: later } = await sb.from("trainingpeaks_student_operational_signals")
    .select("student_id,created_at,signal_type,structured_payload").in("student_id", sids).order("created_at", { ascending: false });

  const rows = ((sig ?? []) as Array<Record<string, unknown>>).map((s) => {
    const sid = String(s.student_id); const aid = aidBySid.get(sid) ?? null;
    const start = signalStart(s);
    const reason = staleReason({ type: String(s.signal_type), start, validUntil: (s.valid_until as string | null) ?? null, races: aid ? raceBy.get(aid) ?? [] : [], today });
    const reply = ((later ?? []) as Array<Record<string, unknown>>).find((x) => x.student_id === sid && String(x.created_at) > String(s.created_at)
      // дословная реплика, а не ярлык модели («боль / стоп»): ярлыки короткие и со слешем
      && String((x.structured_payload as Record<string, unknown>)?.latest_summary ?? "").length > 40
      && !String((x.structured_payload as Record<string, unknown>)?.latest_summary ?? "").includes(" / "));
    return { sid, name: nameBySid.get(sid) ?? sid, aid, type: String(s.signal_type), start, ageDays: Math.round((Date.parse(today) - Date.parse(start)) / 86400000),
      summary: String((s.structured_payload as Record<string, unknown>)?.latest_summary ?? "").slice(0, 60), reason,
      reply: reply ? `${String(reply.created_at).slice(0, 10)}: «${String((reply.structured_payload as Record<string, unknown>).latest_summary).slice(0, 90)}»` : "" };
  }).sort((a, b) => b.ageDays - a.ageDays);

  const out: string[] = [];
  out.push(`# Активные сигналы здоровья на ${today}`);
  out.push("");
  out.push(`Всего активных (status=active, типы ${ILLNESS_SIGNAL_TYPES.join(", ")}): **${rows.length}**, у ${new Set(rows.map((r) => r.sid)).size} учеников.`);
  out.push(`Протухших по правилу (прошёл старт ИЛИ старше срока ${Object.entries(SIGNAL_TTL_DAYS).map(([k, v]) => `${k} ${v} дн`).join(", ")}): **${rows.filter((r) => r.reason).length}**.`);
  out.push(`  - из них по прошедшему старту: ${rows.filter((r) => r.reason?.startsWith("старт")).length}; по сроку: ${rows.filter((r) => r.reason?.startsWith("срок")).length}`);
  out.push(`С репликой ученика после сигнала (последняя дословная, подсказка тренеру, не автозакрытие): ${rows.filter((r) => r.reply).length}.`);
  out.push(`Возраст активных: медиана ${rows.map((r) => r.ageDays).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0} дн, старше 30 дн — ${rows.filter((r) => r.ageDays > 30).length}.`);
  out.push("");
  out.push(`| ученик | тип | с | дней | что | протух | последняя реплика ученика после |`);
  out.push(`|---|---|---|---:|---|---|---|`);
  for (const r of rows) out.push(`| ${r.name} | ${r.type} | ${r.start} | ${r.ageDays} | ${r.summary} | ${r.reason ?? "—"} | ${r.reply || "—"} |`);
  writeFileSync(path.join(OUT_DIR, "r0-signals-audit.md"), out.join("\n") + "\n");
  console.log(out.slice(0, 8).join("\n"));
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
