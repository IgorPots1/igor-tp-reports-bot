// Детектор смещения порога (рост/падение) — сосед структурного пересчёта в ночном джобе.
// НЕ мутирует TP и НЕ применяет порог: только ЧИТАЕТ (забеги, последние пробежки, лёгкий якорь) и
// ПРЕДЛАГАЕТ тренеру ОДНО решение на атлета (правка Игоря: забег + лёгкий + перерыв — одна история про
// форму, не три; все сработавшие сигналы кладём в story.signals). Применяет тренер копи-блоком через
// tp-threshold-restore (его гейты целы) — здесь только предложение.
//
// Чекпоинт 1: ПЕРЕРЫВ (первым — самый дешёвый и опасный: вернулся под старый порог → слишком тяжело) +
// ЗАБЕГ (E-Predictor, свежесть асимметрична). Интервалы (4 из 6) и лёгкий якорь — следующий чекпоинт;
// инфраструктура агрегации/лога/анти-спама/сводки уже здесь.
//
// Числа триггеров — приняты Игорем (план 2026-08-05):
//   рост:    proposed ≤ порог−12с при свежести <6нед; ≤−18с при 6нед–6мес; >6мес рост НЕ предлагаем
//            (форма могла просесть — урок Ларионовой). Старый забег для роста НЕ берём.
//   падение: proposed ≥ порог+10с при любой свежести (слишком тяжело = риск → флагим раньше). Старый
//            быстрый забег для падения НАОБОРОТ усиливает («полгода назад бежал быстрее»).
//   перерыв: нет пробежек 10–60 дней (дольше 60 — не пауза, а прекращение тренировок; не будим).
import type { SupabaseClient } from "@supabase/supabase-js";
import { ftpaSecPerKm, vdotFromRace } from "../../../../src/app/tools/plan/vdot.ts";

// ── пороги срабатывания ──────────────────────────────────────────────────────
const BREAK_GAP_DAYS = 10;
const BREAK_GAP_MAX = 60; // дольше 60д — не пауза, а прекращение тренировок; порог там не главный вопрос → не будим
const RACE_WINDOW_DAYS = 365;
const RACE_MIN_KM = 3, RACE_MAX_KM = 15; // FTPa (0.913×VDOT) валиден как порог только для ~10к; полу/
// марафон/ультра дают FTPa СИЛЬНО медленнее порога by design → ложные «падения» (урок dry-run 08-05).
const GROWTH_FRESH_DAYS = 42; // <6 нед
const GROWTH_MID_DAYS = 182; // 6 нед – 6 мес
const GROWTH_DELTA_FRESH = 12; // с/км: свежий забег
const GROWTH_DELTA_MID = 18; // с/км: 6 нед – 6 мес (нужен больший запас)
const DROP_DELTA = 10; // с/км: падение флагим раньше роста
const DROP_FRESH_DAYS = 42; // падение ведёт только СВЕЖИЙ забег (≤6 нед); старый лишь усиливает, не будит
const PACE_MIN = 150, PACE_MAX = 540; // гейт разумности предложенного темпа (как в candidates)
const MEAS_MIN = 120, MEAS_MAX = 600; // гейт измеренного темпа забега
// полоса «якорь/порог» (median 1.257) — быстрая проверка тренера на разумность
const RATIO_BAND_LO = 1.20, RATIO_BAND_HI = 1.38;
// жёсткий гейт: предложенный порог, дающий отношение якорь/порог < этого, — НЕ порог (медленный/длинный
// забег, плохой матч, «порог» медленнее лёгкого физически невозможен). Числовое предложение отбрасываем.
const RATIO_REJECT_LO = 1.12;
// анти-спам
const COOLDOWN_DAYS = 14; // не чаще раза в N дней по человеку+направлению
const DECLINE_SUPPRESS_DAYS = 45; // отклонённое молчит, пока магнитуда не вырастет
const DECLINE_MAG_GROW = 6; // с/км: насколько должно усилиться, чтобы предложить снова

// ── типы ─────────────────────────────────────────────────────────────────────
export type Signal = {
  type: "break" | "race" | "intervals" | "easy_anchor";
  direction: "up" | "down";
  proposed_sec: number | null;
  magnitude_sec: number | null;
  evidence: string; // человекочитаемое основание
  features: Record<string, unknown>; // структурировано для анализа
};
export type AthleteCtx = { id: number; name: string; thrSec: number; anchor: number | null };
export type Proposal = {
  athleteId: number; name: string; direction: "up" | "down";
  currentSec: number; proposedSec: number | null; anchorSec: number | null;
  projectedRatio: number | null; ratioInBand: boolean | null;
  confidence: "strong" | "medium" | "weak";
  signals: Signal[]; summaryLine: string;
};

// ── формат ────────────────────────────────────────────────────────────────────
export const fpSec = (s: number): string => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const RU_MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
// год показываем, только если забег НЕ этого года — иначе «10 авг» скрывает, что это прошлогодний забег.
const ruDate = (iso: string, todayIso: string): string => { const d = new Date(iso + "T00:00:00Z"); const yr = d.getUTCFullYear(); const curYr = new Date(todayIso + "T00:00:00Z").getUTCFullYear(); return `${d.getUTCDate()} ${RU_MON[d.getUTCMonth()]}${yr !== curYr ? ` ${String(yr).slice(2)}` : ""}`; };
const daysBetween = (fromIso: string, toIso: string): number => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
const daysAgoIso = (n: number, todayIso: string): string => new Date(Date.parse(todayIso) - n * 86400000).toISOString().slice(0, 10);
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

type UsableRace = { date: string; officialKm: number; measM: number; finishSec: number; proposedSec: number; measuredSec: number; freshnessDays: number };

/** Active holds — атлеты на ручном удержании (Бучкина 5475792): предложений им НЕ шлём. Fail-open,
 *  если таблицы нет (миграция не применена): без hold-фильтра, но с явным предупреждением. */
export async function loadHeldAthletes(sb: SupabaseClient): Promise<Set<number>> {
  const held = new Set<number>();
  const { data, error } = await sb.from("tp_threshold_holds").select("trainingpeaks_athlete_id").eq("active", true);
  if (error) { console.warn(`  (holds не прочитаны — таблица tp_threshold_holds применена? ${error.message}) — сигналы порога БЕЗ hold-фильтра`); return held; }
  for (const r of data ?? []) held.add(Number(r.trainingpeaks_athlete_id));
  return held;
}

/** Пороги, подтверждённые 30-мин тестом (прямое измерение). Для них ЗАБЕГОВЫЙ сигнал НЕ поднимается —
 *  забег лишь оценка через конверсию, спорить с прямым тестом нельзя. Прочие сигналы (перерыв) остаются.
 *  Fail-open, если таблицы нет (миграция не применена). */
export async function loadTestConfirmed(sb: SupabaseClient): Promise<Set<number>> {
  const s = new Set<number>();
  const { data, error } = await sb.from("tp_threshold_test_confirmed").select("trainingpeaks_athlete_id").eq("active", true);
  if (error) { console.warn(`  (test-confirmed не прочитаны — таблица tp_threshold_test_confirmed применена? ${error.message})`); return s; }
  for (const r of data ?? []) s.add(Number(r.trainingpeaks_athlete_id));
  return s;
}

/** Одно решение на атлета: собирает перерыв+забег, агрегирует в story, считает проекцию отношения,
 *  фильтрует анти-спамом. TP не читается напрямую — thrSec/anchor приходят из джоба (уже посчитаны). */
export async function detectThresholdSignals(sb: SupabaseClient, ctx: AthleteCtx[], opts: { runId: string | null }): Promise<Proposal[]> {
  void opts; // runId прокидывает джоб при записи строк
  if (!ctx.length) return [];
  const today = new Date().toISOString().slice(0, 10);
  const ids = ctx.map((c) => c.id);
  const held = await loadHeldAthletes(sb);
  const testConfirmed = await loadTestConfirmed(sb); // порог с 30-мин теста → забеговый сигнал не поднимаем
  const active = ctx.filter((c) => !held.has(c.id));
  const byId = new Map(active.map((c) => [c.id, c]));

  // ── (A) ПЕРЕРЫВ: последняя завершённая пробежка на атлета ─────────────────────
  // ОТДЕЛЬНЫМ запросом order desc limit 1 на атлета. Батч на 50 с дефолтным лимитом 1000 БЕЗ order
  // молча обрезал часть атлетов → ложные «перерывы» у половины ростера (урок dry-run 08-05).
  const breakSig = new Map<number, Signal>();
  for (const c of active) {
    const { data } = await sb.from("trainingpeaks_workout_cache").select("workout_date").eq("trainingpeaks_athlete_id", c.id).eq("workout_type_value_id", 3).gt("completed_time_raw", 0).order("workout_date", { ascending: false }).limit(1);
    const lr = data?.[0]?.workout_date ? String(data[0].workout_date).slice(0, 10) : null;
    if (!lr) continue; // нет завершённых пробежек — спящий/новый, не наш сигнал (шум)
    const gap = daysBetween(lr, today);
    if (gap >= BREAK_GAP_DAYS && gap <= BREAK_GAP_MAX) breakSig.set(c.id, { type: "break", direction: "down", proposed_sec: null, magnitude_sec: null, evidence: `нет пробежек ${gap} дней (последняя ${ruDate(lr, today)})`, features: { gap_days: gap, last_run: lr } });
  }

  // ── (B) ЗАБЕГ: E-Predictor proposed vs текущий, свежесть асимметрична ─────────
  const racesByAth = new Map<number, { date: string; km: number }[]>();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from("trainingpeaks_race_events")
      .select("trainingpeaks_athlete_id, event_date, distance_km")
      .in("trainingpeaks_athlete_id", ids.slice(i, i + 50))
      .gte("event_date", daysAgoIso(RACE_WINDOW_DAYS, today)).lte("event_date", today)
      .order("event_date", { ascending: false });
    for (const r of data ?? []) { const km = typeof r.distance_km === "number" ? r.distance_km : 0; if (km <= 0) continue; const aid = Number(r.trainingpeaks_athlete_id); (racesByAth.get(aid) ?? racesByAth.set(aid, []).get(aid)!).push({ date: String(r.event_date).slice(0, 10), km }); }
  }
  const raceSig = new Map<number, Signal>();
  for (const [aid, races] of racesByAth) {
    const c = byId.get(aid); if (!c) continue; // held/inactive
    if (testConfirmed.has(aid)) continue; // порог подтверждён 30-мин тестом → забег (оценка) сигнал не поднимает
    const cur = c.thrSec;
    const usable: UsableRace[] = [];
    for (const r of races) {
      if (r.km < RACE_MIN_KM || r.km > RACE_MAX_KM) continue; // FTPa как порог валиден только для ~10к
      const officialM = r.km * 1000;
      const { data: wc } = await sb.from("trainingpeaks_workout_cache").select("completed_distance_raw, completed_time_raw").eq("trainingpeaks_athlete_id", aid).eq("workout_date", r.date);
      let best: { measM: number; timeSec: number } | null = null;
      for (const w of wc ?? []) {
        const measM = typeof w.completed_distance_raw === "number" ? w.completed_distance_raw : 0;
        const tH = typeof w.completed_time_raw === "number" ? w.completed_time_raw : 0;
        if (measM <= 0 || tH <= 0) continue;
        if (Math.abs(measM - officialM) / officialM > 0.15) continue; // не тот воркаут (разминка и т.п.)
        const cand = { measM, timeSec: tH * 3600 };
        if (!best || Math.abs(cand.measM - officialM) < Math.abs(best.measM - officialM)) best = cand;
      }
      if (!best) continue;
      const proposedSec = ftpaSecPerKm(vdotFromRace(best.measM, best.timeSec));
      const measuredSec = best.timeSec / (best.measM / 1000);
      if (!(proposedSec > PACE_MIN && proposedSec < PACE_MAX) || !(measuredSec > MEAS_MIN && measuredSec < MEAS_MAX)) continue;
      usable.push({ date: r.date, officialKm: r.km, measM: best.measM, finishSec: best.timeSec, proposedSec, measuredSec, freshnessDays: daysBetween(r.date, today) });
    }
    if (!usable.length) continue;
    // Отношение якорь/порог правдоподобно? (порог медленнее лёгкого = не порог). Гейтит ложные падения.
    const ratioOk = (proposedSec: number): boolean => c.anchor == null || c.anchor / proposedSec >= RATIO_REJECT_LO;
    // РОСТ: самый быстрый proposed среди забегов в окне роста, прошедший свой порог дельты
    let growth: UsableRace | null = null;
    for (const u of usable) {
      const delta = u.freshnessDays < GROWTH_FRESH_DAYS ? GROWTH_DELTA_FRESH : u.freshnessDays <= GROWTH_MID_DAYS ? GROWTH_DELTA_MID : null;
      if (delta == null) continue; // >6мес → рост не предлагаем
      if (u.proposedSec <= cur - delta && (!growth || u.proposedSec < growth.proposedSec)) growth = u;
    }
    // ПАДЕНИЕ: ведёт только СВЕЖИЙ забег (≤6 нед) медленнее текущего+DROP (usable уже по дате desc)
    let drop: UsableRace | null = null;
    for (const u of usable) { if (u.freshnessDays <= DROP_FRESH_DAYS && u.proposedSec >= cur + DROP_DELTA) { drop = u; break; } }
    // ПАДЕНИЕ приоритетно над ростом (свежий медленный забег = история про просадку).
    if (drop && ratioOk(drop.proposedSec)) {
      const older = usable.filter((u) => u.date < drop!.date && u.proposedSec < cur).sort((a, b) => a.proposedSec - b.proposedSec)[0];
      const reinforce = older ? ` — ${Math.max(1, Math.round(older.freshnessDays / 30))} мес назад забег был быстрее (${fpSec(older.proposedSec)})` : "";
      raceSig.set(aid, { type: "race", direction: "down", proposed_sec: Math.round(drop.proposedSec), magnitude_sec: Math.round(drop.proposedSec - cur), evidence: `${drop.officialKm}к ${ruDate(drop.date, today)} по ${fpSec(drop.measuredSec)} (медленнее прогноза)${reinforce}`, features: { race_date: drop.date, dist_km: drop.officialKm, measured_sec: Math.round(drop.measuredSec), proposed_sec: Math.round(drop.proposedSec), freshness_days: drop.freshnessDays, reinforced_by_older: older ? { date: older.date, proposed_sec: Math.round(older.proposedSec) } : null } });
    } else if (growth && ratioOk(growth.proposedSec)) {
      raceSig.set(aid, { type: "race", direction: "up", proposed_sec: Math.round(growth.proposedSec), magnitude_sec: Math.round(cur - growth.proposedSec), evidence: `${growth.officialKm}к ${ruDate(growth.date, today)} по ${fpSec(growth.measuredSec)}`, features: { race_date: growth.date, dist_km: growth.officialKm, measured_sec: Math.round(growth.measuredSec), proposed_sec: Math.round(growth.proposedSec), freshness_days: growth.freshnessDays } });
    }
  }

  // ── (C) АГРЕГАЦИЯ: одно решение на атлета ────────────────────────────────────
  const proposals: Proposal[] = [];
  for (const c of active) {
    const sigs: Signal[] = [];
    const r = raceSig.get(c.id); const b = breakSig.get(c.id);
    if (r) sigs.push(r);
    if (b) sigs.push(b);
    if (!sigs.length) continue;
    const direction: "up" | "down" = sigs.some((s) => s.direction === "down") ? "down" : "up"; // падение приоритетно (безопасность)
    const numeric = sigs.find((s) => s.direction === direction && s.proposed_sec != null) ?? null;
    const proposedSec = numeric?.proposed_sec ?? null;
    const projRatio = c.anchor != null ? c.anchor / (proposedSec ?? c.thrSec) : null;
    const ratioInBand = projRatio != null ? projRatio >= RATIO_BAND_LO && projRatio <= RATIO_BAND_HI : null;
    const summaryLine = buildLine(c, direction, proposedSec, sigs, projRatio, ratioInBand);
    proposals.push({ athleteId: c.id, name: c.name, direction, currentSec: Math.round(c.thrSec), proposedSec: proposedSec != null ? Math.round(proposedSec) : null, anchorSec: c.anchor != null ? Math.round(c.anchor) : null, projectedRatio: projRatio, ratioInBand, confidence: "strong", signals: sigs, summaryLine });
  }

  // ── (D) АНТИ-СПАМ ────────────────────────────────────────────────────────────
  const kept: Proposal[] = [];
  for (const p of proposals) { if (!(await isSuppressed(sb, p, today))) kept.push(p); }
  return kept;
}

/** Строка тренеру: направление + текущий→предложенный + ОСНОВАНИЕ (забег/перерыв) + ЯКОРЬ и проекция
 *  отношения (обязательно — быстрая проверка Игоря на разумность), с флагом «вне полосы 1.20–1.38». */
function buildLine(c: AthleteCtx, direction: "up" | "down", proposedSec: number | null, sigs: Signal[], projRatio: number | null, ratioInBand: boolean | null): string {
  const arrow = direction === "up" ? "⬆️" : "⬇️";
  const race = sigs.find((s) => s.type === "race");
  const brk = sigs.find((s) => s.type === "break");
  const anchorPart = c.anchor != null && projRatio != null
    ? `Лёгкий якорь ${fpSec(c.anchor)}, отношение ${proposedSec != null ? "станет" : "сейчас"} ${projRatio.toFixed(2)}${ratioInBand === false ? " ⚠ вне 1.20–1.38" : ""}.`
    : `Якорь н/д — отношение не проверить.`;
  if (proposedSec != null) {
    const verb = direction === "up" ? "предлагаю" : "предлагаю (порог мог УПАСТЬ)";
    const basis = race ? `Основание: ${race.evidence}.` : "";
    const brkNote = brk ? ` ${cap(brk.evidence)}.` : "";
    return `${arrow} ${c.name} (${c.id}): сейчас ${fpSec(c.thrSec)} → ${verb} ${fpSec(proposedSec)}. ${basis}${brkNote} ${anchorPart}`;
  }
  return `${arrow} ${c.name} (${c.id}): проверь порог — ${brk?.evidence ?? "сигнал"}. ${anchorPart}`;
}

/** Анти-спам: молчим, если по человеку+направлению уже был сигнал < COOLDOWN дней назад, или недавнее
 *  отклонение того же направления, магнитуда которого не выросла на DECLINE_MAG_GROW. Таблицы нет /
 *  пусто → не подавляем (fail-open). */
async function isSuppressed(sb: SupabaseClient, p: Proposal, today: string): Promise<boolean> {
  const { data, error } = await sb.from("tp_threshold_signals").select("detected_at, status, magnitude_sec").eq("trainingpeaks_athlete_id", p.athleteId).eq("direction", p.direction).order("detected_at", { ascending: false }).limit(5);
  if (error) return false;
  const rows = data ?? []; if (!rows.length) return false;
  if (daysBetween(String(rows[0].detected_at).slice(0, 10), today) < COOLDOWN_DAYS) return true; // кулдаун
  const declined = rows.find((x) => x.status === "declined" || x.status === "expired");
  if (declined) {
    const dAge = daysBetween(String(declined.detected_at).slice(0, 10), today);
    const pMag = p.signals.reduce((m, s) => Math.max(m, s.magnitude_sec ?? 0), 0);
    const prevMag = Number(declined.magnitude_sec ?? 0);
    if (dAge < DECLINE_SUPPRESS_DAYS && pMag < prevMag + DECLINE_MAG_GROW) return true;
  }
  return false;
}

/** Proposal → строка tp_threshold_signals. armed → notified_at=now (шлём в тот же прогон). */
export function proposalToRow(p: Proposal, runId: string | null, armed: boolean): Record<string, unknown> {
  return {
    trainingpeaks_athlete_id: p.athleteId, athlete_name: p.name, run_id: runId,
    direction: p.direction, current_sec: p.currentSec, proposed_sec: p.proposedSec, confidence: p.confidence,
    anchor_sec: p.anchorSec, projected_ratio: p.projectedRatio != null ? Number(p.projectedRatio.toFixed(4)) : null, ratio_in_band: p.ratioInBand,
    signals: p.signals, summary_line: p.summaryLine, status: "proposed", notified_at: armed ? new Date().toISOString() : null,
  };
}
