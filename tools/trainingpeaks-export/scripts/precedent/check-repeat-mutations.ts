/**
 * МУТАЦИОННЫЙ ПРОГОН check-repeat.ts — тот же приём, что tp-mutation-harness.ts для сборщика.
 * Каждая мутация портит ровно одно правило нового пути; проверки обязаны это заметить.
 * Файлы восстанавливаются в finally. Мутация, которую никто не заметил, роняет прогон (exit 1).
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/check-repeat-mutations.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E = path.join(HERE, "plan-edits.ts"), O = path.join(HERE, "week-ops.ts");
const MR = path.join(HERE, "main-race.ts");
const WC = path.join(HERE, "week-core.ts"), WO = path.join(HERE, "week-ops.ts"), DS = path.join(HERE, "donor-style.ts"), PC = path.join(HERE, "precedent.ts"), BW = path.join(HERE, "build-week.ts"), CO = path.join(HERE, "corpus.ts"), RL = path.join(HERE, "recent-level.ts");
const HF = path.join(HERE, "hidden-flow.ts"), PB = path.join(HERE, "probe-hidden-via-client.ts");
const PR = path.join(HERE, "post-race.ts");
const R = path.join(HERE, "repeat.ts"), P = path.join(HERE, "precedent.ts"), V = path.join(HERE, "validate.ts"), S = path.join(HERE, "..", "lib", "signal-closure.ts");
type M = { id: string; file: string; find: string; replace: string; what: string };
const MUT: M[] = [
  { id: "no-skip", file: R, find: "    if (!why || !SKIP_REASONS.has(why)) { base = own[i]; break; }", replace: "    if (true) { base = own[i]; break; }", what: "ненормальная неделя снова берётся формой" },
  { id: "quality-scaled", file: R, find: "    minutes: s.kind === \"quality\" ? s.minutes : round5(s.minutes * delta),", replace: "    minutes: round5(s.minutes * delta),", what: "дельта масштабирует и качественную" },
  { id: "race-repeat", file: R, find: "  if (t.phase === \"race\") return { kind: \"precedent\", why: \"неделя старта\" };", replace: "", what: "неделю старта повторяем, а не берём прецедент" },
  { id: "gap-repeat", file: R, find: "  if (gap >= RETURN_GAP_WEEKS)", replace: "  if (false && gap >= RETURN_GAP_WEEKS)", what: "после паузы повторяем неделю до паузы" },
  { id: "no-align", file: P, find: "    const shift = t.raceDayIdx - p.raceDayIdx;", replace: "    const shift = 0;", what: "неделя старта не выравнивается по дню гонки" },
  { id: "no-ban", file: P, find: "    if (off >= 1 && off <= PRE_RACE_DAYS && heavyBeforeRace(s)) {", replace: "    if (false) {", what: "тяжёлое перед стартом не снимается" },
  { id: "ban-1day", file: V, find: "export const PRE_RACE_DAYS = 2;", replace: "export const PRE_RACE_DAYS = 1;", what: "запрет только на один день" },
  { id: "activation-100", file: V, find: "export const PRE_RACE_ACTIVATION_MAX_MIN = 40;", replace: "export const PRE_RACE_ACTIVATION_MAX_MIN = 100;", what: "«короткая активация» до 100 мин" },
  { id: "race-warn", file: V, find: "bad.map((s) => `${s.title} ${s.minutes} мин`).join(\"; \"), \"hard\");", replace: "bad.map((s) => `${s.title} ${s.minutes} мин`).join(\"; \"), \"warn\");", what: "предстартовый запрет понижен до предупреждения" },
  { id: "cap-hard", file: V, find: "l.every((x) => x.minutes <= o.windowCaps!.long!), `потолок ${o.windowCaps.long}`);", replace: "l.every((x) => x.minutes <= o.windowCaps!.long!), `потолок ${o.windowCaps.long}`, \"hard\");", what: "потолок длительной снова жёсткий" },
  { id: "easy-floor-10", file: V, find: "export const HARD_EASY_MIN = 20;", replace: "export const HARD_EASY_MIN = 10;", what: "жёсткий пол лёгкой 10 мин" },
  { id: "sig-no-race", file: S, find: "  if (raced.length) return", replace: "  if (false) return", what: "прошедший старт сигнал не закрывает" },
  { id: "sig-ttl-7", file: S, find: "pain_injury: 24,", replace: "pain_injury: 7,", what: "срок pain_injury 7 вместо 24" },
  { id: "sig-window-race", file: S, find: "  if (race && race < to) to = race;", replace: "", what: "окно сигнала не обрывается стартом" },
  { id: "heavy-by-label", file: V, find: "  return s.kind === \"quality\" || s.minutes > PRE_RACE_ACTIVATION_MAX_MIN;", replace: "  return s.kind === \"quality\" || s.kind === \"long\" || s.minutes > PRE_RACE_ACTIVATION_MAX_MIN;", what: "тяжёлое снова определяется по ярлыку «длительная»" },
  { id: "taper-sample", file: R, find: '  if (w.phase === "taper" && w.nextRaceIsMain) return "подводка";', replace: "", what: "предстартовая неделя снова годится образцом" },
  { id: "taper-minor", file: R, find: '  if (w.phase === "taper" && w.nextRaceIsMain) return "подводка";', replace: '  if (w.phase === "taper") return "подводка";', what: "подводка пропускается и перед проходным стартом" },
  { id: "ban-all-races", file: R, find: "  const removed = enforcePreRace(sessions, t.nextRaceIsMain ? t.raceDayIdx : null);", replace: "  const removed = enforcePreRace(sessions, t.raceDayIdx);", what: "запрет снова и перед проходными стартами" },
  { id: "ban-no-races", file: R, find: "  const removed = enforcePreRace(sessions, t.nextRaceIsMain ? t.raceDayIdx : null);", replace: "  const removed = enforcePreRace(sessions, null);", what: "запрет не действует и перед главными" },
  { id: "main-all", file: MR, find: "      if (pickTargetRace(races, m)?.id === r.id) { out.add(r.id); break; }", replace: "      out.add(r.id); break;", what: "любой старт считается главным" },
  { id: "main-none", file: MR, find: "      if (pickTargetRace(races, m)?.id === r.id) { out.add(r.id); break; }", replace: "      void m;", what: "ни один старт не главный" },
  { id: "sample-in-corpus", file: CO, find: " && !/sample workout/i.test(String(r.title ?? \"\")))", replace: ")", what: "шаблонные английские тренировки снова попадают в корпус" },
  { id: "flow-no-assert", file: HF, find: "back.isHidden === hidden,", replace: "true,", what: "GET после PUT не сверяется с ожидаемым isHidden" },
  { id: "flow-no-fallback", file: HF, find: "await setHiddenVerified(tp, res, aid, created.workoutId, true, \"скрытие отдельным PUT\");", replace: "", what: "при игнорировании isHidden в POST не скрываем PUT-ом" },
  { id: "flow-no-cleanup", file: HF, find: "try { await deleteVerified(tp, { ...res, steps: res.steps }, aid, res.workoutId); res.cleanedUp = true; }", replace: "try { res.cleanedUp = true; }", what: "при стопе созданное не удаляется" },
  { id: "flow-no-preexisting", file: HF, find: "before.length === 0,", replace: "true,", what: "чужая тренировка на дате не останавливает прогон" },
  { id: "flow-no-gone", file: HF, find: "del.status === 200 && gone,", replace: "del.status === 200,", what: "удаление не проверяется чтением" },
  { id: "flow-silent-discrepancy", file: HF, find: "res.discrepancies.push(", replace: "void (", what: "расхождение «POST игнорирует isHidden» не записывается" },
  { id: "flow-no-post-hidden", file: HF, find: "createWorkout({ ...body, isHidden: true })", replace: "createWorkout({ ...body })", what: "в POST не уходит isHidden:true" },
  { id: "probe-gate-athlete", file: PB, find: "if (g.athleteId !== PROBE_ATHLETE_ID) return", replace: "if (false) return", what: "пробник пишет не только тестовому атлету" },
  { id: "probe-gate-date", file: PB, find: "if (g.date < addDays(g.today, PROBE_MIN_DAYS_AHEAD)) return", replace: "if (false) return", what: "пробник пишет на ближайшие дни" },
  { id: "proof-no-path", file: O, find: "/^\\s*-\\s*path:\\s*`tp-api-client`\\s*$/m.test(t) && ", replace: "", what: "доказательством считается и отчёт старого Playwright-пробника" },
  { id: "proof-no-delete", file: O, find: " && pass(\"deleted_verify_pass\")", replace: "", what: "доказательство не требует подтверждённого удаления" },
  { id: "proof-hidden-only", file: O, find: " && pass(\"unhidden_verify_pass\")", replace: "", what: "доказательство не требует подтверждённого открытия" },
  { id: "proof-unanchored", file: O, find: "new RegExp(`^\\\\s*-?\\\\s*${k}:", replace: "new RegExp(`${k}:", what: "якорь снят: «hidden» находится внутри «unhidden»" },
  { id: "strip-week3", file: V, find: "export const POST_MARATHON_NO_QUALITY_WEEKS = 3;", replace: "export const POST_MARATHON_NO_QUALITY_WEEKS = 1;", what: "запрет качества после марафона только на 1-й неделе" },
  { id: "strip-content", file: V, find: "RACE_PACE_BLOCK_RE.test(s.title) || RACE_PACE_BLOCK_RE.test(s.description) || ", replace: "", what: "качеством считается только ярлык, блок в темпе марафона — нет" },
  { id: "peak-off", file: R, find: "    if (isPeak(prior.map((x) => x.total), w.total)) return \"пик\";", replace: "", what: "класс «пик» не работает" },
  { id: "peak-ratio-2", file: R, find: "export let PEAK_RATIO = 1.5;", replace: "export let PEAK_RATIO = 2.5;", what: "порог пика 2.5 вместо 1.5" },
  { id: "peak-ratio-old", file: R, find: "export let PEAK_RATIO = 1.5;", replace: "export let PEAK_RATIO = 1.25;", what: "порог пика снова 1.25 — без зазора (Ярулина 12.10)" },
  { id: "peak-ge", file: R, find: "total > PEAK_RATIO * med(prior)", replace: "total >= PEAK_RATIO * med(prior) * 0.99", what: "граница включительно/ужесточена" },
  { id: "refuse-no-history", file: R, find: "  if (!rec.ok) return { kind: \"refuse\", why: `нет недавней истории: ${rec.why}` };", replace: "", what: "нет недавней истории — больше не отказ" },
  { id: "gap-99", file: RL, find: "export let MAX_GAP_WEEKS = 4;", replace: "export let MAX_GAP_WEEKS = 99;", what: "пауза любой длины не лишает истории" },
  { id: "min-weeks-1", file: RL, find: "export const MIN_RECENT_WEEKS = 3;", replace: "export const MIN_RECENT_WEEKS = 1;", what: "достаточно одной недели истории" },
  { id: "level-ratio-99", file: RL, find: "export let LEVEL_MAX_RATIO = 1.5;", replace: "export let LEVEL_MAX_RATIO = 99;", what: "порог «выше уровня» снят" },
  { id: "level-median", file: RL, find: "s[Math.floor(0.75 * (s.length - 1))]", replace: "s[Math.floor(0.5 * (s.length - 1))]", what: "уровень считается по медиане, а не по p75" },
  { id: "hard-level-soft", file: V, find: "total <= LEVEL_MAX_RATIO * o.recent.level, `${total} при уровне ${Math.round(o.recent.level)} (порог ${Math.round(LEVEL_MAX_RATIO * o.recent.level)})`, \"hard\");", replace: "total <= LEVEL_MAX_RATIO * o.recent.level, `${total} при уровне ${Math.round(o.recent.level)} (порог ${Math.round(LEVEL_MAX_RATIO * o.recent.level)})`, \"warn\");", what: "граница по уровню — снова предупреждение" },
  { id: "hard-history-soft", file: V, find: "o.recent.ok, o.recent.why, \"hard\");", replace: "o.recent.ok, o.recent.why, \"warn\");", what: "нет истории — снова предупреждение" },
  { id: "hard-marathon-soft", file: V, find: "bad.map((x) => `${x.title} ${x.minutes} мин`).join(\"; \"), \"hard\");\n  }\n  if (o.raceDayIdx != null)", replace: "bad.map((x) => `${x.title} ${x.minutes} мин`).join(\"; \"), \"warn\");\n  }\n  if (o.raceDayIdx != null)", what: "качество после марафона — снова предупреждение" },
  { id: "build-ignores-refuse", file: BW, find: "  if (plan.kind === \"refuse\") {", replace: "  if (false) {", what: "сборка не передаёт отказ планировщика" },
  { id: "no-clamp", file: R, find: "delta = Math.min(DELTA_MAX, Math.max(DELTA_MIN, cycle.target / cycle.base));", replace: "delta = cycle.target / cycle.base;", what: "дельта цикла не зажата" },
  { id: "skip-with-signal", file: R, find: 'new Set(["старт", "после старта", "подводка", "пик", "провал объёма"])', replace: 'new Set(["старт", "после старта", "подводка", "пик", "провал объёма", "сигнал здоровья"])', what: "сигнал здоровья снова делает неделю не-образцом" },
  { id: "skip-without-peak", file: R, find: 'new Set(["старт", "после старта", "подводка", "пик", "провал объёма"])', replace: 'new Set(["старт", "после старта", "подводка", "провал объёма"])', what: "«пик» выпал из боевого списка не-образцов" },
  { id: "lookback-6", file: R, find: "export let LOOKBACK_WEEKS = 10;", replace: "export let LOOKBACK_WEEKS = 6;", what: "окно поиска образца 6 недель вместо 10" },
  { id: "rec-table-marathon2", file: PR, find: "marathon: [0.39, 0.71, 0.77, 0.81, 0.82, 0.82, 0.94],", replace: "marathon: [0.39, 1.0, 0.77, 0.81, 0.82, 0.82, 0.94],", what: "таблица: марафон +2 = 1.0 вместо 0.71" },
  { id: "rec-table-marathon7", file: PR, find: "marathon: [0.39, 0.71, 0.77, 0.81, 0.82, 0.82, 0.94],", replace: "marathon: [0.39, 0.71, 0.77, 0.81, 0.82, 0.82, 1.0],", what: "таблица: марафон +7 = 1.0" },
  { id: "rec-table-half1", file: PR, find: "half: [0.59, 0.99, 0.99],", replace: "half: [0.39, 0.99, 0.99],", what: "таблица: половинка +1 берётся по марафону" },
  { id: "rec-table-short", file: PR, find: "short: [0.74, 1.0, 1.0],", replace: "short: [0.86, 1.0, 1.0],", what: "таблица: до 15 км по полному корпусу, а не по обучающему" },
  { id: "rec-off", file: PR, find: "  if (!RECOVERY_ON || lastRaceKm == null", replace: "  if (true || lastRaceKm == null", what: "восстановление после старта не действует" },
  { id: "rec-nocap", file: PR, find: "return Math.min(1, row[weeksSinceRace - 1]);", replace: "return row[weeksSinceRace - 1];", what: "множитель восстановления может поднять нагрузку выше 1" },
  { id: "rec-bucket-km", file: PR, find: "lastRaceKm >= 30 ? RECOVERY.marathon", replace: "lastRaceKm >= 15 ? RECOVERY.marathon", what: "половинка считается как марафон" },
  { id: "rec-row-end", file: PR, find: "  if (weeksSinceRace > row.length) return null;\n", replace: "", what: "строка таблицы не кончается: за краем множитель NaN" },
  { id: "strip-off", file: PR, find: "  if (t.lastRaceKm != null && t.lastRaceKm >= 30 && t.weeksSinceRace != null && t.weeksSinceRace <= POST_MARATHON_NO_QUALITY_WEEKS) {", replace: "  if (false && t.lastRaceKm != null && t.lastRaceKm >= 30 && t.weeksSinceRace != null && t.weeksSinceRace <= POST_MARATHON_NO_QUALITY_WEEKS) {", what: "после марафона качество не снимается (ни в одной ветке)" },
  { id: "strip-half", file: PR, find: "  if (t.lastRaceKm != null && t.lastRaceKm >= 30 && t.weeksSinceRace != null && t.weeksSinceRace <= POST_MARATHON_NO_QUALITY_WEEKS) {", replace: "  if (t.lastRaceKm != null && t.lastRaceKm >= 15 && t.weeksSinceRace != null && t.weeksSinceRace <= POST_MARATHON_NO_QUALITY_WEEKS) {", what: "качество снимается и после половинки" },
  { id: "adjust-raises", file: PR, find: "const rel = Math.min(1, Math.max(RECOVERY_DELTA_MIN, rf) / Math.max(RECOVERY_DELTA_MIN, alreadyFactor));", replace: "const rel = Math.max(RECOVERY_DELTA_MIN, rf) / Math.max(RECOVERY_DELTA_MIN, alreadyFactor);", what: "множитель может ПОВЫСИТЬ нагрузку, если донор был ниже" },
  { id: "prec-no-post-flag", file: BW, find: "const a = adapt(ix, t, f, true);", replace: "const a = adapt(ix, t, f);", what: "сборка не включает «после старта» в ветке прецедента" },
  { id: "prec-double-factor", file: PC, find: "recoveryFactor(p.lastRaceKm, p.weeksSinceRace) ?? 1)", replace: "1)", what: "множитель недели-донора не учитывается: двойное снижение" },
  { id: "no-drop-day", file: R, find: "  } else if (delta < DROP_DAY_BELOW) {", replace: "  } else if (false) {", what: "глубокая разгрузка цикла не снимает день" },
  { id: "no-drop-day-recovery", file: PR, find: "if (t.lastRaceKm != null && t.lastRaceKm >= 30 && t.weeksSinceRace === 1) {\n    const easy", replace: "if (false) {\n    const easy", what: "1-я неделя после марафона не снимает день" },
  { id: "donor-hook-dead", file: PC, find: "    if (exclude?.(p)) continue;\n", replace: "", what: "findPrecedent не применяет исключение доноров" },
  { id: "donor-wrong-class", file: R, find: "export function donorExcluded(ix: Index, p: CWeek): boolean { return abnormalReason(ix, p) === \"пик\"; }", replace: "export function donorExcluded(ix: Index, p: CWeek): boolean { return abnormalReason(ix, p) === \"провал объёма\"; }", what: "исключаются провалы вместо пиков" },
  { id: "drop-day-by-threshold", file: PR, find: "if (t.lastRaceKm != null && t.lastRaceKm >= 30 && t.weeksSinceRace === 1) {\n    const easy", replace: "if (rel < DROP_DAY_BELOW) {\n    const easy", what: "день снимается по порогу множителя (двойной счёт), а не только на +1 после марафона" },
  { id: "donor-filter-unwired", file: BW, find: "return findPrecedent(ix, t, W, mode, DONOR_PEAK_FILTER ? (p) => donorExcluded(ix, p) : undefined);", replace: "return findPrecedent(ix, t, W, mode);", what: "боевой выбор донора не исключает пики" },
  { id: "donor-filter-default-off", file: BW, find: "export let DONOR_PEAK_FILTER = true;", replace: "export let DONOR_PEAK_FILTER = false;", what: "фильтр доноров-пиков выключен по умолчанию" },
  { id: "style-off", file: PC, find: "    const st = substituteDonorStyle(ix, t, sessions, p.aid);", replace: "    const st = { considered: 0, sessions, notes: [] as string[] };", what: "подмена названий донора не действует" },
  { id: "style-own-donor", file: DS, find: "  if (donorAid === t.aid) return { sessions, replaced: 0, considered: 0, notes: [] };", replace: "", what: "подмена применяется и к своему донору" },
  { id: "style-quality", file: DS, find: "    if (s.kind === \"quality\" || hasQualityContent({ kind: s.kind, title: s.title, description: s.src.desc })) return s;", replace: "", what: "подмена затрагивает и качественные сессии донора" },
  { id: "style-farthest", file: DS, find: "const d = Math.abs(s.minutes - minutes);", replace: "const d = -Math.abs(s.minutes - minutes);", what: "берётся шаблон, самый далёкий по минутам" },
  { id: "style-minutes", file: DS, find: "return { ...s, title: tpl.title, src: tpl } as PSess;", replace: "return { ...s, title: tpl.title, src: tpl, minutes: tpl.minutes } as PSess;", what: "подмена переписывает и минуты донора" },
  { id: "style-racepace-tpl", file: DS, find: "      if (s.race || s.kind !== k || hasQualityContent({ kind: s.kind, title: s.title, description: s.desc })) continue;", replace: "      if (s.race || s.kind !== k) continue;", what: "шаблоном может стать блок «в темпе марафона»" },
  { id: "prec-no-adjust", file: PC, find: "  if (prod) {\n    const adj = postRaceAdjust", replace: "  if (false) {\n    const adj = postRaceAdjust", what: "прецедент не применяет «после старта»" },
  { id: "rec-table-short2", file: PR, find: "short: [0.74, 1.0, 1.0],", replace: "short: [0.74, 0.76, 0.94],", what: "до 15 км снова понижается на +2 и +3 (разброс накрывает единицу)" },
  { id: "style-warmup-tpl", file: DS, find: "      if (WARMUP_TITLE_RE.test(s.title) !== wantWarmup) continue;\n", replace: "", what: "разминка может стать шаблоном лёгкого бега" },
  { id: "plain-warmup-tpl", file: PR, find: "!s.race && s.kind === k && !WARMUP_TITLE_RE.test(s.title) && !hasQualityContent", replace: "!s.race && s.kind === k && !hasQualityContent", what: "разминка может заменить снятое качество" },
  { id: "place-no-precheck", file: WC, find: "    if (exist.length) return { ok: false, stopped:", replace: "    if (false) return { ok: false, stopped:", what: "постановка не проверяет, что неделя у атлета пуста" },
  { id: "rollback-only-last", file: WC, find: "for (const it of m.items.filter((x) => x.workoutId != null && !m.deleted.includes(x.workoutId!))) {\n      try { await deleteVerified(tp, emptyFlow(), it.aid, it.workoutId!); m.deleted.push(it.workoutId!); save(m); lines.push(`откат", replace: "for (const it of m.items.filter((x) => x.workoutId != null && !m.deleted.includes(x.workoutId!)).slice(-1)) {\n      try { await deleteVerified(tp, emptyFlow(), it.aid, it.workoutId!); m.deleted.push(it.workoutId!); save(m); lines.push(`откат", what: "откат убирает только последнюю тренировку, а не всю постановку" },
  { id: "verify-no-hidden", file: WC, find: "if (d.isHidden !== true) bad.push(", replace: "if (false) bad.push(", what: "итоговая проверка не смотрит на isHidden" },
  { id: "verify-no-day", file: WC, find: "if (String(d.workoutDay).slice(0, 10) !== it.date) bad.push(", replace: "if (false) bad.push(", what: "итоговая проверка не смотрит на день" },
  { id: "verify-no-extra", file: WC, find: "    if (extra.length) problems.push(", replace: "    if (false) problems.push(", what: "итоговая проверка не видит лишнего в календаре" },
  { id: "verify-not-enforced", file: WC, find: "    if (!v.ok) throw new FlowStop(", replace: "    if (false) throw new FlowStop(", what: "провал итоговой проверки не останавливает постановку" },
  { id: "snesti-dry-writes", file: WC, find: "  if (o.dryRun) return { lines, wouldDelete, deleted: [],", replace: "  if (false) return { lines, wouldDelete, deleted: [],", what: "сухое «снести» удаляет" },
  { id: "snesti-published", file: WC, find: "    if (visible && !o.includePublished) {", replace: "    if (false) {", what: "«снести» удаляет и открытые ученику" },
  { id: "snesti-others-blind", file: WC, find: "const same = before.length === after.length && before.every((id) => after.includes(id));", replace: "const same = true;", what: "«снести» не проверяет, что чужое осталось" },
  { id: "pub-dry-writes", file: WC, find: "  if (o.dryRun) return { edits, wouldPublish: pub.map((x) => x.workoutId), published: [], goneByCoach, lines };", replace: "", what: "сухое «публикуй» пишет и публикует" },
  { id: "pub-republish-visible", file: WC, find: "  const pub = toPublish(placed, cur).filter((x) => cur.get(x.workoutId)?.isHidden !== false);", replace: "  const pub = toPublish(placed, cur);", what: "«публикуй» трогает уже открытые" },
  { id: "pub-no-edits", file: WC, find: "  if (edits.length && o.insertEdits) await o.insertEdits(edits);", replace: "", what: "правки тренера не пишутся в базу" },
  { id: "gate-many", file: WO, find: "export const MAX_REAL_ATHLETES = 1;", replace: "export const MAX_REAL_ATHLETES = 12;", what: "первая живая постановка уже не ограничена одним человеком" },
  { id: "isdry-off", file: WO, find: "export const isDry = (gate: string | null): boolean => gate !== null;", replace: "export const isDry = (gate: string | null): boolean => false;", what: "ворота закрыты, а прогон считается реальным" },
  { id: "mayplace-open", file: WO, find: "export const mayPlace = (gate: string | null, nItems: number): boolean => gate === null && nItems > 0;", replace: "export const mayPlace = (gate: string | null, nItems: number): boolean => nItems > 0;", what: "пишем в TP при закрытых воротах" },
  { id: "publish-deleted", file: E, find: "  return placed.filter((p) => current.get(p.workoutId) != null)", replace: "  return placed.filter(() => true)", what: "публикуется и удалённое тренером" },
  { id: "no-minutes-diff", file: E, find: "  if (Math.round(c.minutes) !== Math.round(p.minutes))", replace: "  if (false)", what: "правка длительности не пишется" },
  { id: "gate-no-proof", file: O, find: "    if (!g.proof.ok) return", replace: "    if (false) return", what: "раскидать пишет без доказанного скрытия" },
  { id: "gate-no-group", file: O, find: "  const out = aids.filter((a) => !GROUP12.includes(a)); if (out.length) return", replace: "  const out = aids.filter((a) => !GROUP12.includes(a)); if (false) return", what: "пишет атлетам вне группы 12" },
];

const run = (): string[] => {
  try { execFileSync(process.execPath, [...process.execArgv, path.join(HERE, "check-repeat.ts")], { encoding: "utf8", stdio: "pipe" }); return []; }
  catch (e) { const out = String((e as { stdout?: string }).stdout ?? ""); return out.split("\n").filter((l) => l.includes("FAIL")).map((l) => l.replace(/^\s*FAIL\s+/, "").split("  —")[0]); }
};
let survivors = 0;
for (const m of MUT) {
  const orig = readFileSync(m.file, "utf8");
  if (!orig.includes(m.find)) { console.log(`  ?  ${m.id.padEnd(16)} НЕ ПРИМЕНИЛАСЬ — строка не найдена (каталог отстал от кода)`); survivors++; continue; }
  try { writeFileSync(m.file, orig.replace(m.find, m.replace)); const f = run(); if (f.length === 0) survivors++;
    console.log(`  ${f.length ? "✓" : "✗"}  ${m.id.padEnd(16)} ${f.length ? `уронила ${f.length}` : "НИКТО НЕ ЗАМЕТИЛ"} · ${m.what}${f.length ? ` (${f[0].slice(0, 70)})` : ""}`); }
  finally { writeFileSync(m.file, orig); }
}
console.log(`\nИТОГ: ${MUT.length - survivors} из ${MUT.length} мутаций пойманы${survivors ? `, НЕ ПОЙМАНО ${survivors}` : ""}`);
process.exit(survivors ? 1 : 0);
