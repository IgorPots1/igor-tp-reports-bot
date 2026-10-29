/**
 * Ручные старты календаря /races: единственный путь, которым еженедельный
 * агент трогает базу.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ШЛЮЗ. Агент (claude -p) ищет старты в интернете и
 * ПРЕДЛАГАЕТ изменения файлом. Прямого доступа к базе у него нет: Supabase-MCP
 * выключен, из Bash разрешён только этот скрипт. Правила записи живут здесь, в
 * коде, а не в тексте задания, потому что текст агент может понять не так:
 *   — пишем только в public.race_events и только в строки source = 'manual'
 *     (каждый update фильтруется .eq("source", "manual"), insert обязан
 *     нести source = 'manual' и id с префиксом manual:);
 *   — ничего не удаляем: убрать старт значит status = 'removed' с причиной;
 *   — insert проходит проверку дубля по view race_calendar (дата ±2 дня И
 *     похожее название ИЛИ тот же город и тип), и при дубле отказ;
 *   — только Россия по смыслу (проверяет агент), дата от сегодня до 31.12
 *     следующего года (проверяет код);
 *   — предохранитель: не больше MAX_INSERTS вставок и MAX_UPDATES правок за
 *     прогон. Сорвавшийся агент не перепишет базу.
 * По умолчанию всё холостое; запись только с флагом --apply.
 *
 * Команды:
 *   npx tsx scripts/races-manual.ts list                     активные ручные старты с датой от сегодня
 *   npx tsx scripts/races-manual.ts read <url>               текст страницы из настоящего браузера
 *   npx tsx scripts/races-manual.ts gateway-check [--no-notify]  шлюз жив? (браузер открывает известную страницу; нет — Telegram тренеру, код 3)
 *   npx tsx scripts/races-manual.ts dup <proposal.json>      проверка дублей для вставок
 *   npx tsx scripts/races-manual.ts dedupe [--apply]         ручные, появившиеся в основном потоке, и только плавание → removed
 *   npx tsx scripts/races-manual.ts recheck                  старты «под вопросом» (race_overrides), у которых подошла перепроверка
 *   npx tsx scripts/races-manual.ts tracks-due               старты в ближайшие 21 день без трека (race_details track = «нет данных»)
 *   npx tsx scripts/races-manual.ts details-due              старты в ближайшие 60 дней: регистрация, время, номера, лимиты на перепроверку
 *   npx tsx scripts/races-manual.ts announce <exp_id>=<race_id>,… [--apply]   ожидаемые, чьё проведение уже в
 *                                                            календаре, а робот не узнал (решение тренера) → announced
 *   npx tsx scripts/races-manual.ts apply <proposal.json> [--apply]   итог недели пишется в ops-log
 *   npx tsx scripts/races-manual.ts sources [all]           реестр источников (active, или все)
 *   npx tsx scripts/races-manual.ts sources-seed [--apply]  стартовое наполнение реестра
 *   npx tsx scripts/races-manual.ts sources-tiers [--apply] разовая разметка уровней A/B/C по календарю
 *
 * РЕЕСТР ИСТОЧНИКОВ живёт вне репозитория: ~/ops-log/races/sources.json. Его ведёт
 * этот скрипт, агент только предлагает новые сайты и смену статуса. Сайты,
 * которые уже собирает edge-функция race-calendar-sync, в реестр не попадают:
 * по ним ходит робот, а не агент.
 *
 * Формат proposal.json:
 *   { "checked": ["manual:..."],                         что сверено и совпало
 *     "update": [{ "id": "manual:...", "date_start": "...", "date_end": "...", "reason": "..." , ...поля }],
 *     "remove": [{ "id": "manual:...", "reason": "..." }],
 *     "insert": [{ "name": "...", "date_start": "...", ... , "source_url": "...", "reason": "..." }],
 *     "expected": [{ "name": "...", "city": "...", "last_date": "2026-08-15", "last_url": "...", "race_type": "trail", "reason": "..." }],
 *                    регулярный старт без даты следующего года → race_expected (source manual, status expected)
 *     "sources": [{ "url": "...", "name": "...", "kind": "organizer", ... }],     новые сайты и правки статуса
 *     "candidates": [{ "url": "...", "races": 40, "dated_with_year": true, "note": "..." }],  кандидаты в автосбор
 *     "queries": ["триатлон Казань 2027", ...] }                               поисковые запросы недели
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";
import { nameKey } from "../supabase/functions/race-calendar-sync/expected";
import { isSwimOnly } from "../supabase/functions/race-calendar-sync/match";
import { subjectFor, type GeoSubjectRow } from "../supabase/functions/race-calendar-sync/geo";
import { assertRobotsAllowed, politeFetch } from "./lib/polite-fetch";

export const MAX_INSERTS = 40;
export const MAX_UPDATES = 60;
const RACE_TYPES = new Set(["road", "trail", "tri", "track"]);
const TAGS = new Set(["ultra", "night", "fest", "marathon", "half"]);
const UPDATE_FIELDS = new Set([
  "name", "date_start", "date_end", "date_text", "city", "region", "location",
  "distances", "dist_km", "race_type", "tags", "site_url", "reg_url", "vk_url", "source_url",
]);

export type RaceInsert = {
  name: string;
  date_start: string;
  date_end?: string | null;
  city: string;
  region?: string | null;
  location?: string | null;
  race_type: string;
  distances?: string[];
  dist_km?: number[];
  tags?: string[];
  site_url?: string | null;
  reg_url?: string | null;
  vk_url?: string | null;
  source_url: string;
  reason?: string;
};
export type RaceUpdate = { id: string; reason: string } & Partial<Omit<RaceInsert, "reason">>;
/**
 * Регулярный старт, у которого дата следующего проведения ещё не объявлена: в race_expected
 * (source manual, status expected). Прошлое проведение — дата и ссылка на организатора, где оно
 * подтверждено. Когда дата появится в календаре, edge-функция (стадия expected) сама переведёт
 * строку в announced, как и строки probeg.
 */
export type ExpectedInsert = {
  name: string;
  city: string;
  region?: string | null;
  race_type: string;
  distances?: string[];
  /** Прошлое проведение, YYYY-MM-DD: в прошлом и не старше EXPECTED_MAX_AGE_DAYS. */
  last_date: string;
  /** Где прошлое проведение подтверждено (организатор, ВК, протокол). */
  last_url: string;
  site_url?: string | null;
  reason: string;
};
/** Старше — edge-функция всё равно уведёт в dropped (400 дней): не вносим. */
export const EXPECTED_MAX_AGE_DAYS = 380;
export type SourceKind = "organizer" | "series" | "federation" | "calendar" | "registration" | "vk";
/** ok: живой; dead: не открывается, пуст или зеркало; blocked: robots.txt, капча, бан (не обходим). */
export type SourceStatus = "ok" | "dead" | "blocked";
/**
 * Уровни (решение Игоря 12.10.2026):
 *   A — агрегаторы, их собирает робот race-calendar-sync; агент по ним не ходит, а смотрит race_sync_runs;
 *   B — организаторы и серии с несколькими стартами: проверка каждую неделю;
 *   C — сайт одного старта: раз в месяц, а за 3 месяца до прошлогодней даты (race_expected) каждую неделю.
 */
export type SourceTier = "A" | "B" | "C";
export type Source = {
  url: string;
  name: string;
  kind: SourceKind;
  region: string | null;
  race_types: string[];
  found_at: string;
  last_checked: string | null;
  status: SourceStatus;
  note: string;
  tier: SourceTier;
  /** Когда агенту идти сюда снова. null: сразу (или уровень A, по нему не ходят). */
  next_check: string | null;
  /** Сколько будущих стартов календаря ссылаются на источник (пересчёт каждую неделю). У A: rows последнего сбора. */
  races_found_total: number;
  /** Сколько новых стартов дал последний прогон. */
  races_new_last: number;
  /** Только A: ключ источника в race-calendar-sync (stats в race_sync_runs). */
  robot?: string;
  /** Когда источник B впервые предложен Игорю в робота: пишем один раз. */
  robot_candidate_at?: string;
  /** Свой порог «стартов в календаре» для предложения в робота (по умолчанию 10). */
  robot_candidate_min?: number;
};
export type Candidate = { url: string; races: number; dated_with_year: boolean; note?: string };
/** Вердикт агента по заявке с сайта. added требует insert: старт идёт через тот же шлюз. */
export type SuggestionVerdict = { id: string; status: "added" | "duplicate" | "rejected"; note: string; insert?: RaceInsert };
export type SuggestionOutcome = { id: string; status: string; note: string; url?: string };

export function validateSuggestionVerdict(v: SuggestionVerdict): string | null {
  if (!/^[0-9a-f-]{36}$/i.test(v.id || "")) return "id заявки не uuid";
  if (!["added", "duplicate", "rejected"].includes(v.status)) return `статус ${v.status} не из added|duplicate|rejected`;
  if (!v.note?.trim()) return "нет причины";
  if (v.status === "added" && !v.insert) return "added без insert";
  return null;
}

export type Proposal = {
  /** Ставит обёртка раннера, если агент не оставил предложения: в итоге это видно явно. */
  agent_failed?: string;
  /** Ставит обёртка раннера, если проверка шлюза чтения страниц упала (29.10.2026): агент не запускался. */
  gateway_down?: string;
  checked?: string[];
  sources?: Partial<Source>[];
  candidates?: Candidate[];
  queries?: string[];
  /** Вердикты по заявкам с сайта (race_suggestions, status = new). */
  suggestions?: SuggestionVerdict[];
  /** Точки обхода, по которым агент искал на этой неделе: у них обновится last_searched. */
  cities_searched?: string[];
  /** Сколько запросов ушло в ВК (если есть VK_SERVICE_TOKEN). */
  vk_queries?: string[];
  update?: RaceUpdate[];
  remove?: { id: string; reason: string }[];
  insert?: RaceInsert[];
  expected?: ExpectedInsert[];
  /** Перепроверка стартов «под вопросом» из recheck.json: вердикт агента, решает тренер. */
  recheck?: RecheckVerdict[];
  /** Найденные треки для стартов из tracks-due.json (ближайшие 21 день, трека «нет данных»). */
  tracks?: TrackFind[];
  /** Перепроверка выжимки по details-due.json (ближайшие 60 дней): текущее значение поля у организатора. */
  details?: DetailCheck[];
};

/**
 * Обновление выжимки (наряд 16.10.2026): раз в неделю у стартов на ближайшие 60 дней агент заново
 * смотрит у организатора статус регистрации, время старта, выдачу номеров и лимиты. Шлюз сам решает,
 * что изменилось: то же значение — только новая дата проверки; другое — старое в снимок
 * ~/ops-log/races/details-snapshot-<дата>.json, новое с новой датой проверки, строка в итог недели
 * «изменилось: старт, поле, было, стало». Ничего не удаляется; «нет данных» старое значение не затирает.
 */
export const DETAIL_REFRESH_FIELDS = ["registration_status", "start_time", "packet_pickup", "cutoff"] as const;
export const DETAIL_WINDOW_DAYS = 60;
/** Старты на ближайшие 14 дней проверяются КАЖДУЮ неделю, все (решение Игоря 16.10.2026: было общее
 *  ограничение 40 в неделю, а в ближайших 14 днях 111 стартов — неделя не успевала бы их обойти). */
export const DETAIL_ALWAYS_DAYS = 14;
/** Дальше (15–60 дней) — не больше стольких за неделю, ближайшие первыми. Проверенные за 3 дня пропускаются. */
export const DETAIL_PER_WEEK = 40;

/** Кого перепроверять на этой неделе: всё в ближайшие 14 дней, затем до DETAIL_PER_WEEK из 15–60 дней,
 *  ближайшие первыми; без выжимки и проверенные за последние 3 дня — пропуск. Чистая, её стережёт check. */
export function pickDetailsDue<T extends { date_start: string; fields: { checked_at: string }[] }>(cands: T[], today: string): T[] {
  const near = addDays(today, DETAIL_ALWAYS_DAYS);
  const fresh = addDays(today, -3);
  const ok = [...cands]
    .filter((c) => c.date_start >= today && c.date_start <= addDays(today, DETAIL_WINDOW_DAYS) && c.fields.length)
    .filter((c) => c.fields.map((x) => x.checked_at).sort().at(-1)! <= fresh)
    .sort((a, b) => a.date_start.localeCompare(b.date_start));
  const always = ok.filter((c) => c.date_start <= near);
  return [...always, ...ok.filter((c) => c.date_start > near).slice(0, DETAIL_PER_WEEK)];
}
const FIELD_RU: Record<string, string> = { registration_status: "регистрация", start_time: "время старта", packet_pickup: "выдача номеров", cutoff: "лимиты" };
export type DetailCheck = { race_id: string; distance: number | null; field: string; value: string; source_url: string };
export type DetailRowDb = { race_id: string; distance: number | null; field: string; value: string; source_url: string | null; checked_at: string };
export type DetailsDue = { id: string; name: string; date_start: string; site_url: string | null; reg_url: string | null; vk_url: string | null; dist_km: number[] | null; fields: DetailRowDb[] };

const normV = (v: string) => v.replace(/\s+/g, " ").trim();
const cut = (v: string, n = 80) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

export function detailsPlan(due: DetailsDue[], checks: DetailCheck[], today: string): { rows: DetailRowDb[]; snapshot: DetailRowDb[]; lines: string[]; rejected: string[] } {
  const byId = new Map(due.map((r) => [r.id, r]));
  const rows: DetailRowDb[] = [], snapshot: DetailRowDb[] = [], changes: string[] = [], rejected: string[] = [];
  const seen = new Set<string>();
  let confirmed = 0;
  for (const c of checks) {
    const r = byId.get(c.race_id);
    const value = normV(c.value ?? "");
    if (!r) { rejected.push(`${c.race_id}: не в списке перепроверки выжимки`); continue; }
    if (!(DETAIL_REFRESH_FIELDS as readonly string[]).includes(c.field)) { rejected.push(`${c.race_id}: поле «${c.field}» не перепроверяется`); continue; }
    if (!value || /^нет данных/i.test(value)) { rejected.push(`${c.race_id}: ${c.field} пустое — старое значение оставлено`); continue; }
    if (!/^https?:\/\/\S+$/.test(c.source_url ?? "") || /(yandex\.ru|ya\.ru|google\.[a-z]+)\/search|[?&](text|q)=/.test(c.source_url)) {
      rejected.push(`${c.race_id}: ${c.field} — источник не страница организатора`);
      continue;
    }
    const d = c.distance == null ? null : Number(c.distance);
    const old = r.fields.find((x) => x.field === c.field && (x.distance ?? null) === d);
    if (!old && d !== null && !(r.dist_km ?? []).some((k) => Math.abs(k - d) <= Math.max(0.5, k * 0.1))) {
      rejected.push(`${c.race_id}: ${c.field} — дистанции ${d} км у старта нет`);
      continue;
    }
    const key = `${r.id}|${d}|${c.field}`;
    if (seen.has(key)) { rejected.push(`${c.race_id}: ${c.field} — повтор`); continue; }
    seen.add(key);
    const row: DetailRowDb = { race_id: r.id, distance: d, field: c.field, value: value.slice(0, 400), source_url: c.source_url, checked_at: today };
    if (old && normV(old.value) === normV(row.value)) {
      confirmed++;
      rows.push({ ...row, value: old.value }); // то же — только новая дата проверки
      continue;
    }
    if (old) snapshot.push(old);
    rows.push(row);
    const dist = d === null ? "" : ` ${String(d).replace(".", ",")} км`;
    changes.push(`изменилось: «${r.name}», ${FIELD_RU[c.field]}${dist}, было «${old ? cut(old.value) : "нет данных"}», стало «${cut(row.value)}»`);
  }
  const lines = due.length
    ? [`Выжимка (старты в ближайшие ${DETAIL_WINDOW_DAYS} дней): к перепроверке ${due.length}, подтверждено полей ${confirmed}, изменилось ${changes.length}`, ...changes]
    : [];
  return { rows, snapshot, lines, rejected };
}

/**
 * Повторный поиск треков (наряд 15.10.2026): у стартов в ближайшие 21 день с track = «нет данных»
 * агент раз в неделю заново смотрит сайт организатора, положение и ВК (только через шлюз: read
 * и vk, robots.txt соблюдается). Найденное — в race_details (поле track) и строкой в итог недели
 * «новый трек: старт, дистанция, источник». Фрагменты поисковой выдачи значением не бывают.
 */
export type TrackFind = { race_id: string; distance: number | null; value: string; source_url: string };
export type TrackDue = { id: string; name: string; date_start: string; site_url: string | null; reg_url: string | null; vk_url: string | null; dist_km: number[] | null };
export type TrackRow = { race_id: string; distance: number | null; field: "track"; value: string; source_url: string; checked_at: string };
export const TRACK_WINDOW_DAYS = 21;

const kmRu = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");

export function tracksPlan(due: TrackDue[], finds: TrackFind[], today: string): { rows: TrackRow[]; lines: string[]; rejected: string[] } {
  const byId = new Map(due.map((r) => [r.id, r]));
  const rows: TrackRow[] = [], lines: string[] = [], rejected: string[] = [];
  const perDistance = new Map<string, number[]>();
  for (const f of finds) {
    const r = byId.get(f.race_id);
    const value = (f.value ?? "").replace(/\s+/g, " ").trim();
    if (!r) { rejected.push(`${f.race_id}: не в списке поиска треков`); continue; }
    if (!value || /^нет данных/i.test(value)) { rejected.push(`${f.race_id}: пустое значение`); continue; }
    if (!/^https?:\/\/\S+$/.test(f.source_url ?? "")) { rejected.push(`${f.race_id}: нет ссылки на источник`); continue; }
    if (/(yandex\.ru|ya\.ru|google\.[a-z]+)\/search|[?&](text|q)=/.test(f.source_url)) { rejected.push(`${f.race_id}: источник — поисковая выдача, а не страница организатора`); continue; }
    const d = f.distance == null ? null : Number(f.distance);
    if (d !== null && !(d > 0)) { rejected.push(`${f.race_id}: дистанция «${f.distance}»`); continue; }
    if (d !== null && r.dist_km?.length && !r.dist_km.some((k) => Math.abs(k - d) <= Math.max(0.5, k * 0.1))) {
      rejected.push(`${f.race_id}: дистанции ${kmRu(d)} км у старта нет (${r.dist_km.map(kmRu).join("/")})`);
      continue;
    }
    rows.push({ race_id: r.id, distance: d, field: "track", value: value.slice(0, 400), source_url: f.source_url, checked_at: today });
    if (d !== null) perDistance.set(r.id, [...(perDistance.get(r.id) ?? []), d]);
    lines.push(`новый трек: «${r.name}» ${r.date_start}, ${d === null ? "все дистанции" : `${kmRu(d)} км`}, ${f.source_url}`);
  }
  // Трек нашёлся только по дистанциям — строка старта целиком больше не «нет данных».
  for (const [id, ds] of perDistance) {
    if (rows.some((x) => x.race_id === id && x.distance === null)) continue;
    const first = rows.find((x) => x.race_id === id)!;
    rows.push({ race_id: id, distance: null, field: "track", value: `трек есть по дистанциям: ${[...new Set(ds)].sort((a, b) => b - a).map((x) => `${kmRu(x)} км`).join(", ")}`, source_url: first.source_url, checked_at: today });
  }
  if (due.length) lines.unshift(`Треки (старты в ближайшие ${TRACK_WINDOW_DAYS} дней без трека): искали ${due.length}, нашли ${new Set(rows.map((x) => x.race_id)).size}`);
  return { rows, lines, rejected };
}

/**
 * Старты «под вопросом» (race_overrides.status = 'questionable', наряд 15.10.2026): раз в неделю агент
 * смотрит их снова. Шлюз сам статус НЕ меняет (отменить или вернуть старт — решение тренера):
 * только сдвигает recheck_after на неделю и пишет вердикты в итог недели.
 *
 * Вторая группа — перепроверка ДАННЫХ (status пуст, recheck_after задан; 15.10.2026): источники
 * расходятся в дистанциях или дате, правки нет. В календаре старт без пометки, в reason — что сверить.
 * Вердикт: confirmed — какой источник прав (в note), questionable — по-прежнему расходятся,
 * cancelled — отменён. Значение правит тренер, шлюз ничего не исправляет.
 */
export type RecheckVerdict = { id: string; verdict: "confirmed" | "questionable" | "cancelled"; note: string; source_url?: string };
export type RecheckRow = {
  id: string; name: string; date_start: string; note: string | null; site_url: string | null; reg_url: string | null; recheck_after: string | null;
  /** questionable — под вопросом сам старт; data — расходятся источники (что сверить — в note). */
  kind?: "questionable" | "data";
};

export function recheckPlan(due: RecheckRow[], verdicts: RecheckVerdict[], today: string): { bump: string[]; lines: string[]; rejected: string[] } {
  const byId = new Map(due.map((r) => [r.id, r]));
  const bump: string[] = [], rejected: string[] = [];
  const group: Record<RecheckVerdict["verdict"], string[]> = { confirmed: [], questionable: [], cancelled: [] };
  const data: Record<RecheckVerdict["verdict"], string[]> = { confirmed: [], questionable: [], cancelled: [] };
  for (const v of verdicts) {
    const r = byId.get(v.id);
    if (!r) { rejected.push(`${v.id}: не в списке перепроверки`); continue; }
    if (!["confirmed", "questionable", "cancelled"].includes(v.verdict)) { rejected.push(`${v.id}: вердикт «${v.verdict}»`); continue; }
    if (!v.note?.trim()) { rejected.push(`${v.id}: нет пояснения`); continue; }
    bump.push(v.id);
    (r.kind === "data" ? data : group)[v.verdict].push(`«${r.name}» ${r.date_start}: ${v.note.trim()}${v.source_url ? ` (${v.source_url})` : ""}`);
    byId.delete(v.id);
  }
  const lines: string[] = [];
  if (due.length) {
    lines.push(`Перепроверка (под вопросом и расходящиеся данные): ${due.length}, проверено ${bump.length}; срок следующей — ${addDays(today, 7)}`);
    if (group.confirmed.length) lines.push(`  РЕШИТЬ — организатор подтвердил: ${group.confirmed.join("; ")}`);
    if (group.cancelled.length) lines.push(`  РЕШИТЬ — похоже, отменён: ${group.cancelled.join("; ")}`);
    if (group.questionable.length) lines.push(`  по-прежнему под вопросом: ${group.questionable.join("; ")}`);
    if (data.confirmed.length) lines.push(`  РЕШИТЬ — данные, источник нашёлся: ${data.confirmed.join("; ")}`);
    if (data.cancelled.length) lines.push(`  РЕШИТЬ — данные, похоже, отменён: ${data.cancelled.join("; ")}`);
    if (data.questionable.length) lines.push(`  данные по-прежнему расходятся: ${data.questionable.join("; ")}`);
    if (byId.size) lines.push(`  агент не проверил: ${[...byId.values()].map((r) => `«${r.name}»`).join(", ")}`);
  }
  return { bump, lines, rejected };
}
export type CalendarRow = { id: string; name: string; date_start: string; date_end: string | null; city: string | null; region?: string | null; race_type: string | null };

// ── чистая логика (её держит check:races-manual) ─────────────────────────────

export function norm(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'“”„()\[\].,:;!?_]/g, " ")
    .replace(/[—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Слова, по которым два разных старта «похожи» всегда: их не считаем.
const STOP = new Set(
  "забег пробег марафон полумарафон трейл трейла кросс триатлон дуатлон акватлон ультра ультрамарафон этап кубок чемпионат первенство серия серии фестиваль открытый открытое в и на по г км м x 2026 2027 2028".split(" "),
);

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+(й|я|е|ый|ой)?$/.test(w)));
}

/** Похожесть названий: доля общих значимых слов от меньшего набора. */
export function nameSimilar(a: string, b: string): boolean {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return false;
  let common = 0;
  for (const w of A) if (B.has(w)) common += 1;
  return common / Math.min(A.size, B.size) >= 0.5;
}

// Слова, которые не говорят, КАКОЙ это старт: сезон, время суток, жанр, формат. Как GENERIC
// в edge-функции race-calendar-sync (sameRace). Сравнение по началу слова: «осен» ловит и
// «осенний», и «осенняя». Между разными местами одних таких слов мало для дубля: 12.10.2026
// «Лесландия. Night» (Мяглово) склеилась с «DAB Vertical Autumn Night» (Москва) одним «night».
const GENERIC = /^(осен|весен|весна|зимн|зима|летн|лето|новогод|рождеств|ночн|night|autumn|spring|winter|summer|старт|город|соревнован|первенств|детск|семейн|открыт|областн|легкоатлет|всероссийск|парк|ультра|ultra|трейл|trail|гонка|выходн|памяти|бег|забег|кросс|пробег|фестивал|fest|серия|кубок|чемпионат|этап|city|run|race|super)/;

/** Значимые слова названия: без служебных (STOP) и без общих (GENERIC). */
export function meaningfulTokens(s: string): Set<string> {
  return new Set([...tokens(s)].filter((w) => !GENERIC.test(w)));
}

/** Доля совпавших значимых слов (точно или по первым 5 буквам) от меньшего набора — как simSets в edge-функции. */
function overlapShare(A: Set<string>, B: Set<string>): number {
  let inter = 0;
  for (const w of A) {
    if ([...B].some((x) => x === w || (w.length > 4 && x.length > 4 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))))) inter += 1;
  }
  return inter / Math.min(A.size, B.size);
}

/** Оба места известны и разные: город не совпадает (ни вхождением) и регион не совпадает. */
export function placesDiffer(a: { city: string | null; region?: string | null }, b: { city: string | null; region?: string | null }): boolean {
  const ca = norm(a.city);
  const cb = norm(b.city);
  if (!ca || !cb || ca.includes(cb) || cb.includes(ca)) return false;
  const ra = norm(a.region).split(" ")[0];
  const rb = norm(b.region).split(" ")[0];
  return !(ra && rb && ra === rb);
}

/** Между разными местами название совпадает, только если совпали значимые слова. Нет значимых — не дубль. */
export function meaningfulMatch(a: string, b: string): boolean {
  const A = meaningfulTokens(a);
  const B = meaningfulTokens(b);
  if (!A.size || !B.size) return false;
  return overlapShare(A, B) >= 0.8;
}

function commonTokens(a: string, b: string): number {
  const B = tokens(b);
  let n = 0;
  for (const w of tokens(a)) if (B.has(w)) n += 1;
  return n;
}

/** Ручной старт уже есть в основном потоке: тот же день, похожее имя И (тот же город ИЛИ два общих значимых слова).
 *  Строже, чем дубль при вставке: здесь ошибка снимает живой старт. На 11.10.2026 одно похожее имя
 *  без города дало 3 ложных из 4: «Осенний кросс» Запрудня ~ Североморск, «Новогодний дуатлон-кросс»
 *  Красноярск ~ «Новогодний хоровод» Обнинск, «Рождественский забег» Москва ~ Ростов. */
export function isTwin(
  m: { name: string; date_start: string; city: string | null; region?: string | null },
  x: { name: string; date_start: string; city: string | null; region?: string | null },
): boolean {
  if (m.date_start !== x.date_start || !nameSimilar(m.name, x.name)) return false;
  if (placesDiffer(m, x) && !meaningfulMatch(m.name, x.name)) return false;
  const sameCity = Boolean(norm(m.city)) && norm(m.city) === norm(x.city);
  return sameCity || commonTokens(m.name, x.name) >= 2;
}

/** Двойник ручного старта среди строк, видимых во view под чужим (не manual:) id. */
export function findVisibleTwin<T extends { id: string; name: string; date_start: string; city: string | null; region?: string | null }>(
  m: { name: string; date_start: string; city: string | null; region?: string | null },
  visible: T[],
): T | null {
  return visible.find((x) => !x.id.startsWith("manual:") && isTwin(m, x)) ?? null;
}

function dayDiff(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
}

// Крупные города: в одни выходные там идёт несколько разных стартов одного типа, поэтому
// «тот же город и тип» там дублем не считается. Список тот же, что BIG_CITY в sameRace
// edge-функции race-calendar-sync; дефис допускается и пробелом, потому что norm() его так заменяет.
export const BIG_CITY = /^(москва|санкт[- ]петербург|екатеринбург|новосибирск|казань|нижний новгород|краснодар|самара|ростов[- ]на[- ]дону|уфа|пермь|челябинск|воронеж|красноярск|сочи)$/i;

/** Дубль по правилу тренера: дата ±2 дня И (похожее название ИЛИ тот же НЕБОЛЬШОЙ город и тип).
 *  Если города и регионы разные, «похожее название» считается только по значимым словам
 *  (meaningfulMatch) — как sameRace в edge-функции race-calendar-sync. «Тот же город и тип»
 *  в крупных городах (BIG_CITY) не срабатывает: давало ложные дубли в Москве (12.10.2026). */
export function findDuplicate(r: Pick<RaceInsert, "name" | "date_start" | "city" | "race_type"> & { region?: string | null }, rows: CalendarRow[]): CalendarRow | null {
  for (const x of rows) {
    if (dayDiff(r.date_start, x.date_start) > 2) continue;
    if (nameSimilar(r.name, x.name) && (!placesDiffer(r, x) || meaningfulMatch(r.name, x.name))) return x;
    if (norm(r.city) && !BIG_CITY.test(norm(r.city)) && norm(r.city) === norm(x.city) && r.race_type === x.race_type) return x;
  }
  return null;
}

export function slug(s: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return s
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function manualId(name: string, dateStart: string): string {
  const year = dateStart.slice(0, 4);
  const base = slug(name).replace(new RegExp(`-?${year}$`), "");
  return `manual:${base}-${year}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function dateText(start: string, end: string): string {
  const [y, m, d] = start.split("-");
  if (start === end) return `${d}.${m}.${y}`;
  const [y2, m2, d2] = end.split("-");
  if (y === y2 && m === m2) return `${d}-${d2}.${m}.${y}`;
  return `${d}.${m}.${y}-${d2}.${m2}.${y2}`;
}

/** Окно ручных стартов: от сегодня до 31.12 следующего года. */
export function inWindow(dateStart: string, todayIso: string): boolean {
  const lastDay = `${Number(todayIso.slice(0, 4)) + 1}-12-31`;
  return ISO.test(dateStart) && dateStart >= todayIso && dateStart <= lastDay;
}

const httpUrl = (u: unknown) => typeof u === "string" && /^https?:\/\/\S+$/.test(u);

/** Ошибки строки для вставки; пустой список значит годится. */
export function validateInsert(r: RaceInsert, todayIso: string): string[] {
  const e: string[] = [];
  if (!r.name?.trim()) e.push("нет названия");
  if (!inWindow(r.date_start, todayIso)) e.push(`дата ${r.date_start} вне окна`);
  const end = r.date_end || r.date_start;
  if (!ISO.test(end) || end < r.date_start) e.push(`дата конца ${end} неверна`);
  if (!r.city?.trim()) e.push("нет города");
  if (!RACE_TYPES.has(r.race_type)) e.push(`race_type ${r.race_type}`);
  for (const t of r.tags || []) if (!TAGS.has(t)) e.push(`тег ${t}`);
  if (!httpUrl(r.source_url)) e.push("нет source_url, где подтверждена дата");
  for (const k of ["site_url", "reg_url", "vk_url"] as const) if (r[k] && !httpUrl(r[k])) e.push(`${k} не ссылка`);
  if ((r.dist_km || []).some((x) => typeof x !== "number" || !Number.isFinite(x) || x <= 0)) e.push("dist_km не числа");
  if (/онлайн|online|виртуал|абонемент|кэмп|кемп|camp|тренировк|детск|kids|велогонк|заплыв без/i.test(r.name)) {
    e.push("по названию похоже на онлайн, абонемент, кемп, тренировку, детский старт или велогонку");
  }
  if (isSwimOnly(r.name, r.distances)) e.push(SWIM_ONLY_REASON);
  return e;
}

/** Причина отказа и снятия для стартов только с плаванием (isSwimOnly, общий с роботом). */
export const SWIM_ONLY_REASON = "только плавание (заплыв, open water, X-WATERS без бега): не беговой старт";

export function validateExpected(r: ExpectedInsert, todayIso: string): string[] {
  const e: string[] = [];
  if (!r.name?.trim()) e.push("нет названия");
  if (!r.city?.trim()) e.push("нет города");
  if (!RACE_TYPES.has(r.race_type)) e.push(`race_type ${r.race_type}`);
  if (!ISO.test(r.last_date || "")) e.push(`прошлая дата ${r.last_date} не YYYY-MM-DD`);
  else if (r.last_date >= todayIso) e.push(`прошлая дата ${r.last_date} не в прошлом: с датой старт идёт в insert`);
  else if (Date.parse(todayIso) - Date.parse(r.last_date) > EXPECTED_MAX_AGE_DAYS * 864e5) e.push(`прошлая дата ${r.last_date} старше ${EXPECTED_MAX_AGE_DAYS} дней`);
  if (!httpUrl(r.last_url)) e.push("нет last_url, где подтверждено прошлое проведение");
  if (r.site_url && !httpUrl(r.site_url)) e.push("site_url не ссылка");
  if (!r.reason?.trim()) e.push("нет причины");
  if (/онлайн|online|виртуал|абонемент|кэмп|кемп|camp|тренировк|детск|kids|велогонк/i.test(r.name)) {
    e.push("по названию похоже на онлайн, абонемент, кемп, тренировку, детский старт или велогонку");
  }
  if (isSwimOnly(r.name, r.distances)) e.push(SWIM_ONLY_REASON);
  return e;
}

export type ExpectedRowLite = { id: string; name: string; city: string | null; status: string };

/**
 * То же событие для ожидаемых: значимые слова названий совпадают (meaningfulMatch), и слова-топонимы
 * города в счёт не идут. Было (12.10.2026, первый прогон): «Тверской бег. Весенний кросс на Дорошихе»
 * считался дублем «Тверского полумарафона» по одному «тверской», «Трейл Завидово» — дублем
 * «Ironlady и Manstar Завидово» по «завидово».
 */
export function sameExpectedEvent(a: string, b: string, city: string | null): boolean {
  if (norm(a) === norm(b)) return true;
  const stems = norm(city).split(" ").filter((w) => w.length >= 4).map((w) => w.slice(0, Math.max(4, w.length - 2)));
  const strip = (s: string) => norm(s).split(" ").filter((w) => !stems.some((st) => w.startsWith(st))).join(" ");
  return meaningfulMatch(strip(a), strip(b));
}

/** Уже есть в ожидаемых (expected или announced): то же событие в том же городе. */
export function findExpectedDuplicate(r: ExpectedInsert, rows: ExpectedRowLite[]): ExpectedRowLite | null {
  return rows.find((x) => x.status !== "dropped" && norm(x.city) === norm(r.city) && sameExpectedEvent(x.name, r.name, r.city)) ?? null;
}

/** Следующее проведение уже в календаре: то же событие, тот же город, дата позже прошлой. */
export function findAnnounced(r: ExpectedInsert, calendar: CalendarRow[]): CalendarRow | null {
  return calendar.find((x) => x.date_start > r.last_date && norm(x.city) === norm(r.city) && sameExpectedEvent(x.name, r.name, r.city)) ?? null;
}

export function validateUpdate(u: RaceUpdate, todayIso: string): string[] {
  const e: string[] = [];
  if (!u.id?.startsWith("manual:")) e.push(`id ${u.id} не ручной`);
  if (!u.reason?.trim()) e.push("нет причины");
  for (const k of Object.keys(u)) if (k !== "id" && k !== "reason" && !UPDATE_FIELDS.has(k)) e.push(`поле ${k} менять нельзя`);
  if (u.date_start !== undefined && !inWindow(u.date_start, todayIso)) e.push(`дата ${u.date_start} вне окна`);
  if (u.date_end && u.date_start && u.date_end < u.date_start) e.push("конец раньше начала");
  if (u.race_type !== undefined && !RACE_TYPES.has(u.race_type)) e.push(`race_type ${u.race_type}`);
  for (const t of u.tags || []) if (!TAGS.has(t)) e.push(`тег ${t}`);
  return e;
}

export function todayBelgrade(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(now);
}

// ── реестр источников ────────────────────────────────────────────────────────

/**
 * Уровень A: их собирает edge-функция race-calendar-sync (ключ — как в её SCRAPERS). Агент по ним
 * не ходит и не предлагает их в реестр; в реестре у каждого одна запись tier A.
 */
export const ROBOTS: Record<string, string> = {
  probeg: "https://probeg.org", marathonec: "https://marathonec.ru", ironstar: "https://iron-star.com",
  orgeo: "https://orgeo.ru", where2run: "https://where2run.ru", myrace: "https://myrace.info",
  sportsauce: "https://sportsauce.ru", racetime: "https://racetime.online", regplace: "https://reg.place",
  otime: "https://reg.o-time.ru", heroleague: "https://heroleague.ru",
  // Беговое сообщество (29.10.2026): Московский марафон, полумарафон, «Белые ночи» и др.
  runc: "https://runc.run",
};
/** Сезонные роботы: ноль предстоящих стартов между сезонами — норма, не тревога (вёрстку стережёт сам робот). */
const SEASONAL_ROBOTS = new Set(["runc"]);
/** Сайты, которые робот покрывает через другой адрес: забег.рф отдаёт данные heroleague.ru. */
const ROBOT_ALIASES = ["xn--80acghh.xn--p1ai"];
export const AUTO_COLLECTED = [...Object.values(ROBOTS).map((u) => new URL(u).hostname), ...ROBOT_ALIASES];
/** Серии и организаторы с несколькими стартами (наряд 12.10.2026): уровень B без подсчёта. */
const NAMED_B = ["startrail.ru", "goldenultra.ru", "edge-ultra.ru", "heroleague.ru", "xn--80acghh.xn--p1ai", "x-waters.com", "wildtrail.ru"];
const KINDS = new Set(["organizer", "series", "federation", "calendar", "registration", "vk"]);
const STATUSES = new Set(["ok", "dead", "blocked"]);
/** Старые статусы реестра (до 12.10.2026) и из старых предложений агента. */
const LEGACY_STATUS: Record<string, SourceStatus> = { active: "ok", js_only: "ok", mirror: "dead" };

export function normStatus(x: string | null | undefined): SourceStatus | null {
  if (!x) return null;
  if (STATUSES.has(x)) return x as SourceStatus;
  return LEGACY_STATUS[x] ?? null;
}

export function addDays(isoDate: string, n: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

/** Уровень по виду, пока нет подсчёта: сайт организатора и страница регистрации — C, остальное (серии, календари, паблики) — B. */
export function defaultTier(url: string, kind: SourceKind): SourceTier {
  if (isAutoCollected(url)) return "A";
  const h = hostOf(url);
  if (NAMED_B.some((d) => h === d || h.endsWith(`.${d}`))) return "B";
  return kind === "organizer" || kind === "registration" ? "C" : "B";
}

/**
 * Когда снова проверять. A: никогда (смотрим race_sync_runs). dead и blocked: через 90 дней.
 * B: через неделю. C: через месяц, а если близко прошлогодняя дата старта (expectedSoon) — через неделю.
 */
export function nextCheck(s: Pick<Source, "tier" | "status" | "last_checked">, expectedSoon = false): string | null {
  if (s.tier === "A") return null;
  if (!s.last_checked) return null;
  const days = s.status !== "ok" ? 90 : s.tier === "B" || expectedSoon ? 7 : 30;
  return addDays(s.last_checked, days);
}

/** Прошлогодний старт близко: от 90 дней до годовщины и до 14 дней после неё. */
export function expectedIsSoon(lastDate: string, todayIso: string): boolean {
  const anniv = addDays(lastDate, 365);
  return todayIso >= addDays(anniv, -90) && todayIso <= addDays(anniv, 14);
}

/**
 * Ссылка относится к источнику: у корня сайта — тот же хост, у источника с путём (паблик ВК,
 * страница события на площадке регистрации) — ссылка начинается с его пути.
 */
export function sourceMatches(sourceUrl: string, url: string | null | undefined): boolean {
  if (!url) return false;
  const vk = (k: string) => k.replace(/^vk\.ru\//, "vk.com/").replace(/^m\.vk\.com\//, "vk.com/");
  const sk = vk(sourceKey(sourceUrl));
  const uk = vk(sourceKey(url));
  if (!sk || !uk) return false;
  return uk === sk || uk.startsWith(`${sk}/`);
}

/** Реестр из файла к нынешнему виду: старые статусы, уровни, счётчики, запись A на каждого робота. */
export function normalizeRegistry(raw: Partial<Source>[]): Source[] {
  const out: Source[] = [];
  for (const x of raw) {
    if (!x.url) continue;
    // Сайты робота живут одной записью A на источник (ниже); старые записи агента по ним не нужны.
    if (isAutoCollected(x.url) && x.tier !== "A") continue;
    const kind = (x.kind && KINDS.has(x.kind) ? x.kind : "organizer") as SourceKind;
    const legacyMirror = x.status === "mirror" && !/зеркало/i.test(x.note || "");
    const s: Source = {
      url: x.url,
      name: x.name || hostOf(x.url),
      kind,
      region: x.region ?? null,
      race_types: x.race_types || [],
      found_at: x.found_at || x.last_checked || "",
      last_checked: x.last_checked ?? null,
      status: normStatus(x.status) ?? "ok",
      note: legacyMirror ? `зеркало${x.note ? `: ${x.note}` : ""}` : x.note || "",
      tier: x.tier === "A" || x.tier === "B" || x.tier === "C" ? x.tier : defaultTier(x.url, kind),
      next_check: x.next_check ?? null,
      races_found_total: x.races_found_total ?? 0,
      races_new_last: x.races_new_last ?? 0,
    };
    if (x.robot) s.robot = x.robot;
    if (x.robot_candidate_at) s.robot_candidate_at = x.robot_candidate_at;
    if (x.robot_candidate_min) s.robot_candidate_min = x.robot_candidate_min;
    if (x.next_check === undefined) s.next_check = nextCheck(s);
    out.push(s);
  }
  for (const [key, url] of Object.entries(ROBOTS)) {
    if (out.some((s) => s.robot === key)) continue;
    out.push({
      url, name: hostOf(url), kind: "calendar", region: null, race_types: [], found_at: "", last_checked: null,
      status: "ok", note: "собирает робот race-calendar-sync", tier: "A", next_check: null,
      races_found_total: 0, races_new_last: 0, robot: key,
    });
  }
  return out;
}

export function registryPath(): string {
  return process.env.RACES_SOURCES_FILE || path.join(os.homedir(), "ops-log", "races", "sources.json");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Ключ сайта: хост плюс путь без хвостового слэша (vk.com/x и vk.com/y разные). */
export function sourceKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

export function isAutoCollected(url: string): boolean {
  const h = hostOf(url);
  return AUTO_COLLECTED.some((d) => h === d || h.endsWith(`.${d}`));
}

export function readRegistry(file = registryPath()): Source[] {
  if (!existsSync(file)) return normalizeRegistry([]);
  return normalizeRegistry(JSON.parse(readFileSync(file, "utf8")) as Partial<Source>[]);
}

/** Слить предложенные сайты в реестр. Новые добавляются, известные обновляют статус и отметку проверки. */
export function mergeSources(reg: Source[], incoming: Partial<Source>[], todayIso: string): { reg: Source[]; added: Source[]; changed: Source[]; rejected: string[] } {
  const byKey = new Map(reg.map((s) => [sourceKey(s.url), s]));
  const added: Source[] = [];
  const changed: Source[] = [];
  const rejected: string[] = [];
  for (const x of incoming) {
    if (!x.url || !/^https?:\/\//.test(x.url)) {
      rejected.push(`${x.url}: не ссылка`);
      continue;
    }
    if (isAutoCollected(x.url)) {
      rejected.push(`${x.url}: собирается автоматически`);
      continue;
    }
    const prev = byKey.get(sourceKey(x.url));
    if (prev) {
      const status = normStatus(x.status) ?? prev.status;
      // Уровень агент может уточнить между B и C; A ставит только робот, повышение — шлюз.
      const tier = (x.tier === "B" || x.tier === "C") && prev.tier !== "A" ? x.tier : prev.tier;
      const next = { ...prev, status, tier, last_checked: x.last_checked || todayIso, note: x.note ?? prev.note };
      next.next_check = nextCheck(next);
      if (next.status !== prev.status || next.note !== prev.note || next.tier !== prev.tier) changed.push(next);
      Object.assign(prev, next);
      continue;
    }
    const s: Source = {
      url: x.url,
      name: x.name || hostOf(x.url),
      kind: x.kind && KINDS.has(x.kind) ? x.kind : "organizer",
      region: x.region ?? null,
      race_types: (x.race_types || []).filter((t) => RACE_TYPES.has(t)),
      found_at: x.found_at || todayIso,
      last_checked: x.last_checked || todayIso,
      status: normStatus(x.status) ?? "ok",
      note: x.note || "",
      tier: "C",
      next_check: null,
      races_found_total: 0,
      races_new_last: 0,
    };
    s.tier = x.tier === "B" || x.tier === "C" ? x.tier : defaultTier(s.url, s.kind);
    s.next_check = nextCheck(s);
    byKey.set(sourceKey(s.url), s);
    reg.push(s);
    added.push(s);
  }
  return { reg, added, changed, rejected };
}

/**
 * Что агенту обходить на этой неделе: B и C, у кого подошёл срок; dead и blocked раз в 90 дней.
 * A не обходится никогда. soon: ключи источников C, у которых близко прошлогодняя дата старта.
 * Было до 12.10.2026: все active каждую неделю (228 сайтов, большинство одного старта).
 */
export function dueSources(reg: Source[], todayIso: string, soon: Set<string> = new Set()): Source[] {
  return reg.filter((s) => {
    if (s.tier === "A") return false;
    const next = nextCheck(s, soon.has(sourceKey(s.url)));
    return !next || next <= todayIso;
  });
}

export type RobotRun = { started_at: string; stats: Record<string, unknown> | null; error: string | null };
export type RobotHealth = { robot: string; rows: number | null; new: number | null; prevRows: number | null; ranAt: string | null; alert: string | null };

/**
 * Уровень A по race_sync_runs (самые свежие сначала): тревога при ошибке, нуле строк, падении больше
 * чем вдвое против прошлого сбора и если источник не собирался 8 дней. Ни разу не собиравшийся
 * (только что подключён, ещё не задеплоен) — не тревога, а пометка.
 */
export function robotHealth(robots: string[], runs: RobotRun[], todayIso: string): RobotHealth[] {
  return robots.map((robot) => {
    const seen = runs.filter((r) => r.stats && Array.isArray(r.stats.sources) && (r.stats.sources as string[]).includes(robot));
    if (!seen.length) return { robot, rows: null, new: null, prevRows: null, ranAt: null, alert: null };
    const [last, prev] = seen;
    const ranAt = last.started_at.slice(0, 10);
    const st = last.stats![robot];
    const rowsOf = (v: unknown) => (v && typeof v === "object" && typeof (v as { rows?: unknown }).rows === "number" ? (v as { rows: number }).rows : null);
    const rows = rowsOf(st);
    const fresh = st && typeof st === "object" ? ((st as { new?: number }).new ?? null) : null;
    const prevRows = prev ? rowsOf(prev.stats![robot]) : null;
    let alert: string | null = null;
    if (ranAt < addDays(todayIso, -8)) alert = `не собирался с ${ranAt}`;
    else if (last.error || typeof st === "string") alert = `ошибка: ${String(last.error || st).slice(0, 160)}`;
    else if (SEASONAL_ROBOTS.has(robot)) alert = null;
    else if (rows === 0) alert = "0 строк";
    else if (rows !== null && prevRows && rows < prevRows * 0.5) alert = `строк ${rows} против ${prevRows} в прошлый раз (падение больше 50%)`;
    return { robot, rows, new: fresh, prevRows, ranAt, alert };
  });
}

/** Сколько стартов из списка ссылаются на источник (site/source/reg/vk). */
export function countMatches(src: string, rows: { site_url?: string | null; source_url?: string | null; reg_url?: string | null; vk_url?: string | null }[]): number {
  return rows.filter((r) => [r.site_url, r.source_url, r.reg_url, r.vk_url].some((u) => sourceMatches(src, u))).length;
}

/** Повышение C→B: 5+ новых стартов за 30 дней. Возвращает повышенные (меняет записи на месте). */
export function promoteSources(reg: Source[], newLast30: Map<string, number>, todayIso: string): Source[] {
  const up: Source[] = [];
  for (const s of reg) {
    const n = newLast30.get(sourceKey(s.url)) ?? 0;
    if (s.tier === "C" && n >= 5) {
      s.tier = "B";
      s.note = `${s.note ? `${s.note}; ` : ""}повышен C→B ${todayIso}: ${n} новых за 30 дней`;
      s.next_check = nextCheck(s);
      up.push(s);
    }
  }
  return up;
}

/**
 * B с 10+ стартами в календаре — кандидат в робота (A). Отмечается один раз. У источника может быть
 * свой порог robot_candidate_min (goldenultra, begisveterkom, t.me/cityrunrun — 25, решение Игоря 12.10.2026);
 * blocked (robots.txt, как reg.russiarunning.com) не предлагается никогда.
 */
export function robotCandidates(reg: Source[], todayIso: string): Source[] {
  const out: Source[] = [];
  for (const s of reg) if (s.tier === "B" && s.status === "ok" && s.races_found_total >= (s.robot_candidate_min ?? 10) && !s.robot_candidate_at) {
    s.robot_candidate_at = todayIso;
    out.push(s);
  }
  return out;
}

function writeRegistry(reg: Source[], file = registryPath()) {
  mkdirSync(path.dirname(file), { recursive: true });
  reg.sort((a, b) => a.url.localeCompare(b.url));
  writeFileSync(file, `${JSON.stringify(reg, null, 2)}\n`);
}

// ── точки обхода (города и трейловые места) ──────────────────────────────────

export type CityPoint = { name: string; region: string; kind: "city" | "spot"; last_searched: string | null };
/** 35, а не 25 из наряда: точек 208, и при 25 круг шёл бы ~8 недель вместо ~6 (решение Игоря 11.10.2026). */
export const CITIES_PER_WEEK = 35;

export function citiesPath(): string {
  return process.env.RACES_CITIES_FILE || path.join(os.homedir(), "ops-log", "races", "cities.json");
}

export function readCities(file = citiesPath()): CityPoint[] {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as CityPoint[]) : [];
}

/** Точки недели: никогда не проверенные первыми, дальше самые давние. 208 точек по 35: круг около 6 недель. */
export function dueCities(list: CityPoint[], n = CITIES_PER_WEEK): CityPoint[] {
  return [...list]
    .sort((a, b) => (a.last_searched ?? "").localeCompare(b.last_searched ?? "") || a.name.localeCompare(b.name, "ru"))
    .slice(0, n);
}

export function markCities(list: CityPoint[], names: string[], todayIso: string): number {
  const want = new Set(names.map((n) => norm(n)));
  let n = 0;
  for (const c of list) if (want.has(norm(c.name))) {
    c.last_searched = todayIso;
    n += 1;
  }
  return n;
}

// ── база ─────────────────────────────────────────────────────────────────────

/** Пробный прогон из worktree: ключи из .env.local основной папки (RACES_ENV_FILE). Значения не печатаются. */
function loadExtraEnv() {
  const file = process.env.RACES_ENV_FILE;
  if (!file || !existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function db(): SupabaseClient {
  loadExtraEnv();
  loadScriptEnv();
  const env = resolveSupabaseEnv();
  if (!env) throw new Error("нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  // Сверка проекта по ref, а не по имени: запись только в базу этого репозитория.
  if (!env.supabaseUrl.includes("wlbswdnpqrcdaqwlfnoo")) throw new Error(`чужой проект: ${env.supabaseUrl}`);
  return createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });
}

async function calendarRows(sb: SupabaseClient): Promise<CalendarRow[]> {
  const out: CalendarRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("race_calendar")
      .select("id,name,date_start,date_end,city,region,race_type")
      .order("date_start")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data as CalendarRow[]));
    if (!data || data.length < 1000) return out;
  }
}

async function manualRow(sb: SupabaseClient, id: string) {
  const { data, error } = await sb.from("race_events").select("id,source,status,name,date_start,date_end").eq("id", id).eq("source", "manual").maybeSingle();
  if (error) throw error;
  return data;
}

type LinkRow = { source?: string; first_seen?: string; site_url: string | null; source_url: string | null; reg_url: string | null; vk_url: string | null };

/** Будущие активные старты (все источники) со ссылками: для счётчика races_found_total. */
async function futureLinkRows(sb: SupabaseClient, todayIso: string): Promise<LinkRow[]> {
  const out: LinkRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("race_events").select("id,source,first_seen,site_url,source_url,reg_url,vk_url")
      .eq("status", "active").gte("date_end", todayIso).order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...((data || []) as LinkRow[]));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Все строки запроса, страницами по 1000 (29.10.2026). PostgREST молча отдаёт не больше 1000 строк:
 * ожидаемых ~1700, и без страниц проверка дублей в apply не видела старые строки — Полуниха трейл
 * прошла бы вторым ожидаемым при дословно том же названии и городе.
 */
export async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

/** Источники C, у которых близко прошлогодняя дата старта (race_expected): их смотрим каждую неделю. */
async function expectedSoonKeys(sb: SupabaseClient, reg: Source[], todayIso: string): Promise<Set<string>> {
  const data = await selectAll<{ last_date: string | null; site_url: string | null; last_url: string | null }>((a, b) =>
    sb.from("race_expected").select("last_date,site_url,last_url").eq("status", "expected").order("id").range(a, b),
  );
  const soon = new Set<string>();
  for (const e of data) {
    if (!e.last_date || !expectedIsSoon(e.last_date as string, todayIso)) continue;
    for (const s of reg) if (s.tier === "C" && (sourceMatches(s.url, e.site_url as string | null) || sourceMatches(s.url, e.last_url as string | null))) soon.add(sourceKey(s.url));
  }
  return soon;
}

async function syncRuns(sb: SupabaseClient, todayIso: string): Promise<RobotRun[]> {
  const { data, error } = await sb.from("race_sync_runs").select("started_at,stats,error")
    .gte("started_at", `${addDays(todayIso, -45)}T00:00:00Z`).order("started_at", { ascending: false });
  if (error) throw error;
  return (data || []) as RobotRun[];
}

// ── команды ──────────────────────────────────────────────────────────────────

async function cmdList() {
  const sb = db();
  const { data, error } = await sb
    .from("race_events")
    .select("id,name,date_start,date_end,date_text,city,region,race_type,distances,source_url,reg_url,site_url,vk_url")
    .eq("source", "manual")
    .eq("status", "active")
    .gte("date_end", todayBelgrade())
    .order("date_start");
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));
}

async function cmdRead(url: string) {
  if (!httpUrl(url)) throw new Error("нужна http(s) ссылка");
  // Playwright стоит в tools/trainingpeaks-export; в свежем worktree его может не быть, тогда берём из основной папки.
  const local = path.join(process.cwd(), "tools/trainingpeaks-export/node_modules/playwright");
  const base = existsSync(local) ? process.cwd() : path.join(os.homedir(), "igor-tp-reports-bot");
  const require = createRequire(path.join(base, "tools/trainingpeaks-export/package.json"));
  const { chromium } = require("playwright") as typeof import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "ru-RU" });
    // robots.txt сайта — до перехода браузера (браузер ходит мимо politeFetch)
    await assertRobotsAllowed(url);
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    const text = (await page.evaluate(() => document.body.innerText)).replace(/\n{3,}/g, "\n\n");
    console.log(`URL ${url}\nHTTP ${res?.status() ?? 0}\nFINAL ${page.url()}\n\n${text.slice(0, 12000)}`);
  } finally {
    await browser.close();
  }
}

/**
 * Проверка шлюза чтения страниц перед понедельничным прогоном (29.10.2026): настоящий браузер
 * открывает известную страницу. 29.10 кэш браузера Playwright оказался стёрт, и `read` падал на
 * каждом адресе — агент разведки в таком состоянии работает вслепую. Успех — хотя бы одна страница
 * отдала HTTP 200 с текстом. Провал — причина в stdout, сообщение тренеру в Telegram (без
 * --no-notify) и код выхода 3.
 */
export const GATEWAY_CHECK_URLS = ["https://probeg.org/", "https://igorp.run/races"];

async function cmdGatewayCheck(notify: boolean) {
  loadScriptEnv();
  const local = path.join(process.cwd(), "tools/trainingpeaks-export/node_modules/playwright");
  const base = existsSync(local) ? process.cwd() : path.join(os.homedir(), "igor-tp-reports-bot");
  const errors: string[] = [];
  try {
    const require = createRequire(path.join(base, "tools/trainingpeaks-export/package.json"));
    const { chromium } = require("playwright") as typeof import("playwright");
    const browser = await chromium.launch();
    try {
      for (const url of GATEWAY_CHECK_URLS) {
        try {
          await assertRobotsAllowed(url);
          const page = await browser.newPage({ locale: "ru-RU" });
          const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
          const text = (await page.evaluate(() => document.body.innerText)).trim();
          await page.close();
          if (res?.status() === 200 && text.length > 200) {
            console.log(`шлюз работает: ${url} HTTP 200, ${text.length} знаков`);
            return;
          }
          errors.push(`${url}: HTTP ${res?.status() ?? 0}, ${text.length} знаков`);
        } catch (e) {
          errors.push(`${url}: ${e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : String(e)}`);
        }
      }
    } finally {
      await browser.close();
    }
  } catch (e) {
    errors.push(`браузер не запустился: ${e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : String(e)}`);
  }
  const reason = errors.join("; ");
  console.log(`ШЛЮЗ НЕ РАБОТАЕТ: ${reason}`);
  if (notify) {
    const { sendCoachTelegramMessage } = await import("../tools/trainingpeaks-export/scripts/lib/coach-telegram-notify.ts");
    await sendCoachTelegramMessage(
      `Календарь /races: шлюз чтения страниц не работает, понедельничная разведка не проводилась.\n${reason}\nПочинить: cd ~/igor-tp-reports-bot/tools/trainingpeaks-export && npx playwright install chromium-headless-shell`,
    );
  }
  process.exit(3);
}

function readProposal(file: string): Proposal {
  if (!existsSync(file)) throw new Error(`нет файла ${file}`);
  return JSON.parse(readFileSync(file, "utf8")) as Proposal;
}

async function cmdDup(file: string) {
  const p = readProposal(file);
  const rows = await calendarRows(db());
  for (const r of p.insert || []) {
    const d = findDuplicate(r, rows);
    console.log(`${d ? "ДУБЛЬ" : "новый"}  ${r.date_start} ${r.name}${d ? `  ~ ${d.date_start} ${d.name} (${d.id})` : ""}`);
  }
}

async function cmdDedupe(apply: boolean, quiet = false) {
  const sb = db();
  const { data: manual, error } = await sb.from("race_events").select("id,name,date_start,city,region,distances").eq("source", "manual").eq("status", "active");
  if (error) throw error;
  // Двойник ищется во VIEW race_calendar, то есть среди того, что реально видно на
  // странице, а не в сырых строках race_events. 11.10.2026 пробный прогон снял «ОСЕНЬ
  // трейл»: двойник myrace:2152 был в race_events, но робот ошибочно склеил его с
  // «Осенним кроссом» в Североморске (merged_into = probeg:85636), во view его не было,
  // и старт пропал с сайта совсем. Строка, видимая во view под чужим id, такого не даст.
  const visible = (await calendarRows(sb)).filter((x) => !x.id.startsWith("manual:") && x.date_start >= todayBelgrade());
  const hits: { id: string; reason: string }[] = [];
  for (const m of manual || []) {
    // Только плавание снимается тем же прогоном: так шлюз чистит и то, что вставлено до фильтра.
    if (isSwimOnly(m.name, (m.distances as string[] | null) ?? [])) {
      hits.push({ id: m.id, reason: `${SWIM_ONLY_REASON}: «${m.name}»` });
      continue;
    }
    const twin = findVisibleTwin(m, visible);
    if (twin) hits.push({ id: m.id, reason: `появился в основном потоке: ${twin.id} «${twin.name}»` });
  }
  if (!quiet) console.log(JSON.stringify(hits, null, 2));
  if (apply) {
    for (const h of hits) {
      const { error: ue } = await sb.from("race_events").update({ status: "removed", updated_at: new Date().toISOString() }).eq("id", h.id).eq("source", "manual");
      if (ue) throw ue;
    }
  }
  return hits;
}

/** Старты на перепроверку выжимки (выбор — pickDetailsDue). Выжимка читается пачками по 200 стартов. */
async function detailsDue(sb: SupabaseClient, today: string): Promise<DetailsDue[]> {
  const { data: cal, error } = await sb.from("race_calendar").select("id,name,date_start,site_url,reg_url,vk_url,dist_km")
    .gte("date_start", today).lte("date_start", addDays(today, DETAIL_WINDOW_DAYS)).order("date_start").order("id");
  if (error) throw error;
  const races = (cal || []) as Omit<DetailsDue, "fields">[];
  const byRace = new Map<string, DetailRowDb[]>();
  for (let i = 0; i < races.length; i += 200) {
    const { data: det, error: de } = await sb.from("race_details").select("race_id,distance,field,value,source_url,checked_at")
      .in("race_id", races.slice(i, i + 200).map((r) => r.id)).in("field", [...DETAIL_REFRESH_FIELDS]).order("id").limit(5000);
    if (de) throw de;
    for (const x of (det || []) as DetailRowDb[]) byRace.set(x.race_id, [...(byRace.get(x.race_id) ?? []), { ...x, distance: x.distance == null ? null : Number(x.distance) }]);
  }
  return pickDetailsDue(races.map((r) => ({ ...r, fields: byRace.get(r.id) ?? [] })), today);
}

async function cmdDetailsDue() {
  console.log(JSON.stringify(await detailsDue(db(), todayBelgrade()), null, 2));
}

/** Старты в ближайшие 21 день, у которых в выжимке трек «нет данных». */
async function tracksDue(sb: SupabaseClient, today: string): Promise<TrackDue[]> {
  const { data: det, error } = await sb.from("race_details").select("race_id").eq("field", "track").is("distance", null).ilike("value", "нет данных%");
  if (error) throw error;
  const ids = [...new Set((det || []).map((d) => d.race_id as string))];
  if (!ids.length) return [];
  const out: TrackDue[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: cal, error: ce } = await sb.from("race_calendar").select("id,name,date_start,site_url,reg_url,vk_url,dist_km")
      .in("id", ids.slice(i, i + 200)).gte("date_start", today).lte("date_start", addDays(today, TRACK_WINDOW_DAYS));
    if (ce) throw ce;
    out.push(...((cal || []) as TrackDue[]));
  }
  return out.sort((a, b) => a.date_start.localeCompare(b.date_start));
}

async function cmdTracksDue() {
  console.log(JSON.stringify(await tracksDue(db(), todayBelgrade()), null, 2));
}

/** Старты «под вопросом» и с расходящимися данными, у которых подошла перепроверка. */
async function recheckDue(sb: SupabaseClient, today: string): Promise<RecheckRow[]> {
  const { data: ov, error } = await sb.from("race_overrides").select("id,status,note,reason,recheck_after")
    .or("status.eq.questionable,and(status.is.null,recheck_after.not.is.null)");
  if (error) throw error;
  const due = (ov || []).filter((o) => !o.recheck_after || (o.recheck_after as string) <= today);
  if (!due.length) return [];
  const { data: cal, error: ce } = await sb.from("race_calendar").select("id,name,date_start,site_url,reg_url").in("id", due.map((o) => o.id as string));
  if (ce) throw ce;
  const byId = new Map((cal || []).map((c) => [c.id as string, c]));
  return due.filter((o) => byId.has(o.id as string)).map((o) => {
    const c = byId.get(o.id as string)!;
    const kind = o.status === "questionable" ? "questionable" as const : "data" as const;
    return { id: o.id as string, name: c.name as string, date_start: c.date_start as string, note: (kind === "data" ? o.reason : o.note) as string | null, site_url: c.site_url as string | null, reg_url: c.reg_url as string | null, recheck_after: o.recheck_after as string | null, kind };
  });
}

async function cmdRecheck() {
  console.log(JSON.stringify(await recheckDue(db(), todayBelgrade()), null, 2));
}

/**
 * Ожидаемый старт → «объявлен» по решению тренера: робот (стадия expected) пару не узнал, а без
 * этого в боте один старт виден дважды, ожидаемым и объявленным. Правила в коде, как у остальных
 * команд: только строки со status = 'expected'; race_id обязан быть видимым стартом календаря;
 * меняются только status, race_id, announced_at; не больше MAX_ANNOUNCE за прогон; по умолчанию
 * холостой прогон. Обратимо: status = 'expected', race_id = null.
 */
const MAX_ANNOUNCE = 10;
export async function cmdAnnounce(pairsArg: string, apply: boolean) {
  const pairs = (pairsArg || "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => p.split("="));
  if (!pairs.length || pairs.some((p) => p.length !== 2 || !p[0] || !p[1])) throw new Error("announce <exp_id>=<race_id>,…");
  if (pairs.length > MAX_ANNOUNCE) throw new Error(`не больше ${MAX_ANNOUNCE} за прогон`);
  const sb = db();
  const { data: exp, error } = await sb.from("race_expected").select("id,name,city,status,last_date").in("id", pairs.map((p) => p[0]));
  if (error) throw error;
  const visible = new Map((await calendarRows(sb)).map((r) => [r.id, r]));
  const out: { id: string; race_id: string; ok: boolean; text: string }[] = [];
  for (const [id, raceId] of pairs) {
    const e = (exp || []).find((x) => x.id === id);
    const r = visible.get(raceId);
    if (!e) out.push({ id, race_id: raceId, ok: false, text: "нет в race_expected" });
    else if (e.status !== "expected") out.push({ id, race_id: raceId, ok: false, text: `статус ${e.status}, не expected` });
    else if (!r) out.push({ id, race_id: raceId, ok: false, text: "старта нет в календаре (race_calendar)" });
    else if (r.date_start <= (e.last_date as string)) out.push({ id, race_id: raceId, ok: false, text: "дата старта не позже прошлого проведения" });
    else out.push({ id, race_id: raceId, ok: true, text: `«${e.name}» (${e.city}, ${e.last_date}) → «${r.name}» ${r.date_start}` });
  }
  console.log(JSON.stringify(out, null, 2));
  if (apply) {
    for (const o of out.filter((x) => x.ok)) {
      const { error: ue } = await sb.from("race_expected")
        .update({ status: "announced", race_id: o.race_id, announced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", o.id).eq("status", "expected");
      if (ue) throw ue;
    }
  }
  return out;
}

type Outcome = { kind: "fixed" | "removed" | "added" | "expected" | "skipped"; id: string; text: string; link?: string; tri?: boolean };

async function cmdApply(file: string, apply: boolean) {
  const sb = db();
  const p = readProposal(file);
  const today = todayBelgrade();
  const updates = p.update || [];
  const removes = p.remove || [];
  const inserts = p.insert || [];
  const expected = p.expected || [];
  // Ожидаемые — тоже вставки: общий предохранитель.
  if (inserts.length + expected.length > MAX_INSERTS) throw new Error(`вставок ${inserts.length + expected.length} > ${MAX_INSERTS}: прогон остановлен`);
  if (updates.length + removes.length > MAX_UPDATES) throw new Error(`правок ${updates.length + removes.length} > ${MAX_UPDATES}: прогон остановлен`);

  const out: Outcome[] = [];
  const suggestionsOut: SuggestionOutcome[] = [];
  const now = new Date().toISOString();

  for (const u of updates) {
    const errs = validateUpdate(u, today);
    const row = errs.length ? null : await manualRow(sb, u.id);
    if (errs.length || !row) {
      out.push({ kind: "skipped", id: u.id, text: errs.join("; ") || "нет такой ручной строки" });
      continue;
    }
    const patch: Record<string, unknown> = { updated_at: now };
    for (const [k, v] of Object.entries(u)) if (UPDATE_FIELDS.has(k)) patch[k] = v;
    if (u.date_start) {
      patch.date_end = u.date_end || u.date_start;
      patch.date_text = dateText(u.date_start, patch.date_end as string);
    }
    if (apply) {
      const { error } = await sb.from("race_events").update(patch).eq("id", u.id).eq("source", "manual");
      if (error) throw error;
    }
    out.push({ kind: "fixed", id: u.id, text: `${row.date_start} → ${u.date_start ?? row.date_start}: ${u.reason}`, link: u.source_url ?? undefined });
  }

  for (const r of removes) {
    const row = r.id?.startsWith("manual:") && r.reason?.trim() ? await manualRow(sb, r.id) : null;
    if (!row) {
      out.push({ kind: "skipped", id: r.id, text: "не ручная строка или нет причины" });
      continue;
    }
    if (apply) {
      const { error } = await sb.from("race_events").update({ status: "removed", updated_at: now }).eq("id", r.id).eq("source", "manual");
      if (error) throw error;
    }
    out.push({ kind: "removed", id: r.id, text: `${row.name}: ${r.reason}` });
  }

  const calendar = await calendarRows(sb);
  const addedRows: RaceInsert[] = [];
  // Пустой регион — субъектом из race_geo (город не меняется); не прочиталось — как есть.
  const geoRows: GeoSubjectRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("race_geo").select("key,city,subject").range(from, from + 999);
    if (error) break;
    geoRows.push(...((data || []) as GeoSubjectRow[]));
    if (!data || data.length < 1000) break;
  }
  const regionOf = (city: string, region: string | null | undefined) => (region && region.trim() ? region : subjectFor(geoRows, city, region) ?? null);
  /** Одна вставка с полной проверкой: окно, правила, дубль, занятый id. */
  async function tryInsert(r: RaceInsert): Promise<{ ok: true; id: string } | { ok: false; id: string; dup: CalendarRow | null; reason: string }> {
    const errs = validateInsert(r, today);
    const dup = errs.length ? null : findDuplicate(r, calendar);
    const id = manualId(r.name, r.date_start);
    if (errs.length || dup) {
      const reason = errs.join("; ") || `дубль ${dup!.id} «${dup!.name}»`;
      out.push({ kind: "skipped", id, text: reason });
      return { ok: false, id, dup, reason };
    }
    if (await manualRow(sb, id)) {
      out.push({ kind: "skipped", id, text: "такой id уже есть" });
      return { ok: false, id, dup: null, reason: "такой id уже есть" };
    }
    const end = r.date_end || r.date_start;
    const row = {
      id,
      source: "manual",
      source_id: id.slice("manual:".length),
      source_url: r.source_url,
      name: r.name.trim(),
      date_start: r.date_start,
      date_end: end,
      date_text: dateText(r.date_start, end),
      city: r.city.trim(),
      region: regionOf(r.city, r.region),
      // Склейка edge-функции сравнивает место по location: пустой ломал её (12.10.2026).
      location: r.location?.trim() || [r.region, r.city].filter((x) => x && x.trim()).join(", ") || null,
      distances: r.distances ?? [],
      dist_km: r.dist_km ?? [],
      race_type: r.race_type,
      tags: r.tags ?? [],
      site_url: r.site_url ?? null,
      reg_url: r.reg_url ?? null,
      vk_url: r.vk_url ?? null,
      status: "active",
      first_seen: now,
      last_seen: now,
      updated_at: now,
    };
    if (apply) {
      const { error } = await sb.from("race_events").insert(row);
      if (error) throw error;
      calendar.push({ id, name: row.name, date_start: row.date_start, date_end: end, city: row.city, race_type: row.race_type });
    }
    out.push({ kind: "added", id, text: `${dateText(r.date_start, end)} ${row.name}, ${row.city}${r.reason ? `: ${r.reason}` : ""}`, link: r.source_url, tri: r.race_type === "tri" });
    addedRows.push(r);
    return { ok: true, id };
  }

  for (const r of inserts) await tryInsert(r);

  // Ожидаемые: только race_expected, только новые строки source manual. Существующие (в том
  // числе строки probeg) не трогаем: дубль по названию и городу — отказ; дата уже в календаре —
  // отказ (это не ожидаемый, а объявленный старт).
  if (expected.length) {
    const known = await selectAll<ExpectedRowLite>((a, b) => sb.from("race_expected").select("id,name,city,status").order("id").range(a, b));
    for (const r of expected) {
      const errs = validateExpected(r, today);
      const id = manualId(r.name, r.last_date);
      const dup = errs.length ? null : findExpectedDuplicate(r, known);
      const next = errs.length || dup ? null : findAnnounced(r, calendar);
      if (errs.length || dup || next || known.some((x) => x.id === id)) {
        const why = errs.join("; ") || (dup ? `уже в ожидаемых: ${dup.id} «${dup.name}» (${dup.status})` : next ? `дата уже в календаре: ${next.id} ${next.date_start} «${next.name}»` : "такой id уже есть");
        out.push({ kind: "skipped", id, text: why });
        continue;
      }
      const row = {
        id,
        source: "manual",
        name: r.name.trim(),
        name_key: nameKey(r.name),
        city: r.city.trim(),
        region: regionOf(r.city, r.region),
        race_type: r.race_type,
        distances: r.distances ?? [],
        last_date: r.last_date,
        last_month: Number(r.last_date.slice(5, 7)),
        last_url: r.last_url,
        site_url: r.site_url ?? null,
        last_finishers: null,
        status: "expected",
        seen_at: now,
        updated_at: now,
      };
      if (apply) {
        const { error } = await sb.from("race_expected").insert(row);
        if (error) throw error;
      }
      known.push({ id, name: row.name, city: row.city, status: "expected" });
      out.push({ kind: "expected", id, text: `прошлый ${r.last_date} ${row.name}, ${row.city}: ${r.reason}`, link: r.last_url });
    }
  }

  // Заявки с сайта (race_suggestions). Меняются только status, note, race_id и только
  // у заявок в статусе new: разобранную повторно не перепишешь.
  const sugg = p.suggestions || [];
  if (sugg.length > MAX_UPDATES) throw new Error(`заявок ${sugg.length} > ${MAX_UPDATES}: прогон остановлен`);
  for (const sgn of sugg) {
    const verdict = validateSuggestionVerdict(sgn);
    if (verdict) {
      suggestionsOut.push({ id: sgn.id, status: "skipped", note: verdict });
      continue;
    }
    const { data: cur, error: ce } = await sb.from("race_suggestions").select("id,status,url").eq("id", sgn.id).maybeSingle();
    if (ce) throw ce;
    if (!cur || cur.status !== "new") {
      suggestionsOut.push({ id: sgn.id, status: "skipped", note: "нет такой заявки или уже разобрана" });
      continue;
    }
    let status = sgn.status;
    let note = sgn.note.trim();
    let raceId: string | null = null;
    if (sgn.status === "added") {
      const res = await tryInsert(sgn.insert!);
      if (res.ok) raceId = res.id;
      else if (res.dup) {
        status = "duplicate";
        note = `уже в календаре: ${res.dup.id} «${res.dup.name}»`;
        raceId = res.dup.id;
      } else {
        status = "rejected";
        note = `шлюз отклонил: ${res.reason}`;
      }
    }
    if (apply) {
      const { error: ue } = await sb
        .from("race_suggestions")
        .update({ status, note: note.slice(0, 500), race_id: raceId, reviewed_at: now })
        .eq("id", sgn.id)
        .eq("status", "new");
      if (ue) throw ue;
    }
    suggestionsOut.push({ id: sgn.id, status, note, url: cur.url });
  }

  // Дубли с основным потоком снимаются тем же прогоном и попадают в тот же итог.
  for (const h of await cmdDedupe(apply, true)) out.push({ kind: "removed", id: h.id, text: h.reason });

  // Реестр источников: новые сайты и смена статуса.
  const reg = readRegistry();
  const merged = mergeSources(reg, p.sources || [], today);
  const tiers = await tierStats(sb, merged.reg, p, addedRows, today);
  if (apply) writeRegistry(merged.reg);

  // Под вопросом и расходящиеся данные: шлюз только сдвигает срок перепроверки; статус и значения меняет тренер.
  const due = await recheckDue(sb, today);
  const recheck = recheckPlan(due, p.recheck || [], today);
  for (const r of recheck.rejected) out.push({ kind: "skipped", id: r.split(":")[0], text: `перепроверка: ${r}` });
  if (apply) {
    for (const id of recheck.bump) {
      const { error: re } = await sb.from("race_overrides").update({ recheck_after: addDays(today, 7), updated_at: new Date().toISOString() })
        .eq("id", id).or("status.eq.questionable,status.is.null");
      if (re) throw re;
    }
  }

  // Треки: найденное агентом пишется в race_details; срок и окно — у шлюза, не у агента.
  const trackDue = await tracksDue(sb, today);
  const tracks = tracksPlan(trackDue, p.tracks || [], today);
  for (const r of tracks.rejected) out.push({ kind: "skipped", id: r.split(":")[0], text: `трек: ${r}` });
  if (apply && tracks.rows.length) {
    const { error: te } = await sb.from("race_details").upsert(tracks.rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: "race_id,distance,field" });
    if (te) throw te;
  }

  // Выжимка: шлюз сам решает, что изменилось; старое значение — в снимок до записи, ничего не удаляем.
  const detDue = await detailsDue(sb, today);
  const det = detailsPlan(detDue, p.details || [], today);
  for (const r of det.rejected) out.push({ kind: "skipped", id: r.split(":")[0], text: `выжимка: ${r}` });
  if (apply && det.rows.length) {
    if (det.snapshot.length) {
      const file = path.join(os.homedir(), "ops-log", "races", `details-snapshot-${today}.json`);
      mkdirSync(path.dirname(file), { recursive: true });
      const prev = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as unknown[]) : [];
      writeFileSync(file, `${JSON.stringify([...prev, ...det.snapshot.map((x) => ({ ...x, replaced_at: today }))], null, 1)}\n`);
    }
    const { error: de } = await sb.from("race_details").upsert(det.rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: "race_id,distance,field" });
    if (de) throw de;
  }

  // Точки обхода: у проверенных на этой неделе обновится last_searched.
  const cityList = readCities();
  const citiesMarked = markCities(cityList, p.cities_searched || [], today);
  if (apply && citiesMarked) writeFileSync(citiesPath(), `${JSON.stringify(cityList, null, 2)}\n`);

  const summary = weeklySummary({
    apply,
    today,
    proposal: p,
    out,
    merged,
    activeTotal: merged.reg.filter((x) => x.status === "ok" && x.tier !== "A").length,
    suggestions: suggestionsOut,
    citiesMarked,
    citiesTotal: cityList.length,
    tiers,
    recheckLines: recheck.lines,
    trackLines: tracks.lines,
    detailLines: det.lines,
  });
  console.log(summary);
  // Игорю сразу, а не только в ops-log: сбой робота, повышение уровня, кандидат в робота.
  const alert = tierAlert(tiers);
  if (apply && alert) {
    const { sendCoachTelegramMessage } = await import("../tools/trainingpeaks-export/scripts/lib/coach-telegram-notify.ts");
    await sendCoachTelegramMessage(alert);
  }
  if (apply) {
    const dir = process.env.RACES_OPS_LOG_DIR || path.join(os.homedir(), "ops-log", "igor-tp-reports-bot");
    mkdirSync(dir, { recursive: true });
    const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .format(new Date())
      .replace(" ", "-")
      .replace(":", "");
    const file = path.join(dir, `${stamp}-races-weekly.md`);
    // Только новый файл, существующий не перезаписываем.
    if (!existsSync(file)) writeFileSync(file, summary);
    console.log(`\nops-log: ${file}`);
  }
  return out;
}

export type TierStats = {
  /** Новые старты недели: робот (A, из race_sync_runs), B, C и «рыбалка» (ВК, поиск, заявки — без источника в реестре). */
  byTier: { A: number; B: number; C: number; fishing: number };
  robots: RobotHealth[];
  promoted: Source[];
  candidates: Source[];
  /** Источники B/C, которые на этой неделе стали dead или blocked. */
  broken: Source[];
  failed?: string;
};

/** Счётчики уровней, здоровье робота, повышения. Меняет записи реестра на месте; сбой базы не роняет apply. */
async function tierStats(sb: SupabaseClient, reg: Source[], p: Proposal, added: RaceInsert[], today: string): Promise<TierStats> {
  const t: TierStats = { byTier: { A: 0, B: 0, C: 0, fishing: 0 }, robots: [], promoted: [], candidates: [], broken: [] };
  const checked = new Set((p.sources || []).filter((x) => x.url).map((x) => sourceKey(x.url!)));
  for (const r of added) {
    const tiersHit = reg.filter((s) => s.tier !== "A" && countMatches(s.url, [r])).map((s) => s.tier);
    if (tiersHit.includes("B")) t.byTier.B += 1;
    else if (tiersHit.includes("C")) t.byTier.C += 1;
    else t.byTier.fishing += 1;
  }
  for (const s of reg) {
    if (s.tier === "A") continue;
    const n = countMatches(s.url, added);
    if (n || checked.has(sourceKey(s.url))) s.races_new_last = n;
    if (checked.has(sourceKey(s.url)) && s.status !== "ok") t.broken.push(s);
  }
  try {
    const rows = await futureLinkRows(sb, today);
    const since = addDays(today, -30);
    const recent = rows.filter((r) => r.source === "manual" && (r.first_seen || "") >= since);
    const last30 = new Map<string, number>();
    for (const s of reg) if (s.tier !== "A") {
      s.races_found_total = countMatches(s.url, rows);
      last30.set(sourceKey(s.url), countMatches(s.url, recent));
    }
    t.promoted = promoteSources(reg, last30, today);
    t.candidates = robotCandidates(reg, today);
    t.robots = robotHealth(Object.keys(ROBOTS), await syncRuns(sb, today), today);
    for (const h of t.robots) {
      const s = reg.find((x) => x.robot === h.robot);
      if (!s || !h.ranAt) continue;
      Object.assign(s, { last_checked: h.ranAt, races_found_total: h.rows ?? s.races_found_total, races_new_last: h.new ?? 0 });
      t.byTier.A += h.new ?? 0;
    }
    const soon = await expectedSoonKeys(sb, reg, today);
    for (const s of reg) s.next_check = nextCheck(s, soon.has(sourceKey(s.url)));
  } catch (e) {
    t.failed = e instanceof Error ? e.message : String(e);
  }
  return t;
}

/** Текст тревоги Игорю или null, если писать не о чем. */
export function tierAlert(t: TierStats | undefined): string | null {
  if (!t) return null;
  const lines: string[] = [];
  for (const h of t.robots) if (h.alert) lines.push(`робот ${h.robot}: ${h.alert}`);
  if (t.failed) lines.push(`уровни не посчитаны: ${t.failed.slice(0, 160)}`);
  for (const s of t.promoted) lines.push(`повышен C→B: ${s.url} (${s.name})`);
  for (const s of t.candidates) lines.push(`кандидат в робота (B, ${s.races_found_total} стартов в календаре): ${s.url}; проверь вёрстку`);
  return lines.length ? `Календарь /races, еженедельный прогон:\n${lines.map((l) => `- ${l}`).join("\n")}` : null;
}

export function weeklySummary(a: {
  apply: boolean;
  today: string;
  proposal: Proposal;
  out: Outcome[];
  merged: { added: Source[]; changed: Source[]; rejected: string[] };
  activeTotal: number;
  suggestions?: SuggestionOutcome[];
  citiesMarked?: number;
  citiesTotal?: number;
  tiers?: TierStats;
  recheckLines?: string[];
  trackLines?: string[];
  detailLines?: string[];
}): string {
  const n = (k: Outcome["kind"]) => a.out.filter((o) => o.kind === k).length;
  const tri = a.out.filter((o) => o.kind === "added" && o.tri).length;
  const checked = (a.proposal.checked || []).length + n("fixed") + a.out.filter((o) => o.kind === "removed" && !o.text.startsWith("появился в основном потоке") && !o.text.startsWith(SWIM_ONLY_REASON)).length;
  const lines = [
    `Дата: ${a.today}`,
    `Задача: еженедельное обновление ручных стартов /races${a.apply ? "" : " (ХОЛОСТОЙ ПРОГОН, в базу ничего не записано)"}`,
    `Итог: проверено ${checked}, исправлено ${n("fixed")}, убрано ${n("removed")}, добавлено ${n("added")} (из них триатлонов ${tri}), в ожидаемые ${n("expected")}, отклонено шлюзом ${n("skipped")}`,
    `Источники: новых в реестре ${a.merged.added.length}, сменили статус ${a.merged.changed.length}, всего в работе (ok, B и C) ${a.activeTotal}; поисковых запросов ${(a.proposal.queries || []).length}`,
  ];
  const t = a.tiers;
  if (t) {
    lines.push(`Новые старты по уровням: робот A ${t.byTier.A}, B ${t.byTier.B}, C ${t.byTier.C}, рыбалка (ВК, поиск, заявки) ${t.byTier.fishing}`);
    const bad = t.robots.filter((h) => h.alert);
    const quiet = t.robots.filter((h) => !h.ranAt).map((h) => h.robot);
    lines.push(`Робот (уровень A): ${bad.length ? `ТРЕВОГА ${bad.map((h) => `${h.robot}: ${h.alert}`).join("; ")}` : "без тревог"}${quiet.length ? `; ещё не собирался: ${quiet.join(", ")}` : ""}`);
    if (t.broken.length) lines.push(`Источники с ошибками: ${t.broken.map((s) => `${s.url} (${s.status}${s.note ? `: ${s.note.slice(0, 80)}` : ""})`).join("; ")}`);
    if (t.promoted.length) lines.push(`Повышены C→B: ${t.promoted.map((s) => s.url).join(", ")}`);
    if (t.candidates.length) lines.push(`Кандидаты в робота (B, 10+ стартов): ${t.candidates.map((s) => `${s.url} (${s.races_found_total})`).join(", ")}`);
    if (t.failed) lines.push(`Уровни: не посчитаны, ${t.failed.slice(0, 160)}`);
  }
  if (a.proposal.agent_failed) lines.splice(2, 0, `АГЕНТ НЕ ДАЛ ПРЕДЛОЖЕНИЯ: ${a.proposal.agent_failed}. Проверки и поиск этой недели не сделаны, сняты только дубли с основным потоком.`);
  // Первой строкой итога — чтобы слепую неделю нельзя было принять за спокойную (29.10.2026).
  if (a.proposal.gateway_down) lines.unshift(`ШЛЮЗ НЕ РАБОТАЛ, разведка не проводилась: ${a.proposal.gateway_down}`);
  const sg = a.suggestions || [];
  const sgn = (st: string) => sg.filter((x) => x.status === st).length;
  lines.push(`Заявки с сайта: разобрано ${sg.length - sgn("skipped")} (добавлено ${sgn("added")}, дубль ${sgn("duplicate")}, отклонено ${sgn("rejected")})${sgn("skipped") ? `, не принято шлюзом ${sgn("skipped")}` : ""}`);
  if (a.recheckLines?.length) lines.push(...a.recheckLines);
  if (a.trackLines?.length) lines.push(...a.trackLines);
  if (a.detailLines?.length) lines.push(...a.detailLines);
  lines.push(`Обход по городам: ${a.citiesMarked ?? 0} точек на этой неделе из ${a.citiesTotal ?? 0}; ВК: ${a.proposal.vk_queries?.length ? `${a.proposal.vk_queries.length} запросов` : "не искали"}`);
  const cands = a.proposal.candidates || [];
  lines.push(cands.length ? "Кандидаты в автосбор:" : "Кандидаты в автосбор: нет");
  for (const c of cands) lines.push(`- ${c.url}: около ${c.races} стартов, даты с годом: ${c.dated_with_year ? "да" : "нет"}${c.note ? `; ${c.note}` : ""}`);
  lines.push("Изменения:");
  for (const o of a.out) lines.push(`- ${o.kind}: ${o.id}: ${o.text}${o.link ? ` (${o.link})` : ""}`);
  for (const s of a.merged.added) lines.push(`- источник добавлен: ${s.url} (уровень ${s.tier}, ${s.kind}${s.region ? `, ${s.region}` : ""})`);
  for (const s of a.merged.changed) lines.push(`- источник ${s.status}: ${s.url}${s.note ? `: ${s.note}` : ""}`);
  for (const r of a.merged.rejected) lines.push(`- источник отклонён: ${r}`);
  for (const x of sg) lines.push(`- заявка ${x.status}: ${x.id}${x.url ? ` (${x.url})` : ""}: ${x.note}`);
  if (a.proposal.queries?.length) lines.push(`Запросы: ${a.proposal.queries.join("; ")}`);
  return `${lines.join("\n")}\n`;
}

async function cmdSources(all: boolean) {
  const reg = readRegistry();
  if (all) return void console.log(JSON.stringify(reg, null, 2));
  const today = todayBelgrade();
  let soon = new Set<string>();
  try {
    soon = await expectedSoonKeys(db(), reg, today);
  } catch (e) {
    // Без базы C идут по месячному сроку: лучше так, чем без списка.
    console.error(`[races-manual] race_expected не прочитан: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(JSON.stringify(dueSources(reg, today, soon), null, 2));
}

/**
 * Разовая разметка уровней по данным (наряд 12.10.2026): у кого в файле ещё нет tier, уровень
 * B, если не сайт организатора, в списке серий или 2+ будущих стартов календаря ссылаются на него;
 * иначе C. Записи A по роботам добавляет normalizeRegistry. Уже размеченные не трогает.
 */
async function cmdSourcesTiers(apply: boolean) {
  const file = registryPath();
  const raw = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Partial<Source>[]) : [];
  const untiered = new Set(raw.filter((x) => x.url && !x.tier).map((x) => sourceKey(x.url!)));
  const reg = readRegistry(file);
  const today = todayBelgrade();
  const rows = await futureLinkRows(db(), today);
  const tally: Record<string, number> = {};
  for (const s of reg) {
    if (s.tier !== "A") s.races_found_total = countMatches(s.url, rows);
    if (s.tier !== "A" && untiered.has(sourceKey(s.url))) {
      if (s.tier === "C" && s.races_found_total >= 2) s.tier = "B";
      s.next_check = nextCheck(s);
    }
    tally[`${s.tier}/${s.status}`] = (tally[`${s.tier}/${s.status}`] ?? 0) + 1;
  }
  console.log(`записей ${reg.length} (в файле было ${raw.length}): ${Object.entries(tally).sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`к обходу на этой неделе: ${dueSources(reg, today).length}`);
  if (apply) {
    writeRegistry(reg, file);
    console.log(`записано: ${file}`);
  }
}

/** Стартовое наполнение: сайты из docs/races-missing.md и ссылки ручных стартов. */
async function cmdSourcesSeed(apply: boolean) {
  const sb = db();
  const { data, error } = await sb.from("race_events").select("name,city,region,race_type,site_url,reg_url,vk_url,source_url").eq("source", "manual");
  if (error) throw error;
  const today = todayBelgrade();
  const incoming: Partial<Source>[] = [];
  for (const r of data || []) {
    for (const [field, kind] of [["site_url", "organizer"], ["reg_url", "registration"], ["vk_url", "vk"], ["source_url", "organizer"]] as const) {
      const url = r[field] as string | null;
      if (url) incoming.push({ url, name: r.name, kind, region: r.region, race_types: r.race_type ? [r.race_type] : [], note: "из ручных стартов" });
    }
  }
  const md = path.join(process.cwd(), "docs", "races-missing.md");
  if (existsSync(md)) {
    // Таблица «| сайт (пояснение) | итог |»: в первой колонке голый домен, а не ссылка.
    for (const line of readFileSync(md, "utf8").split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length < 4 || /^-+$/.test(cells[1]) || /источник/i.test(cells[1])) continue;
      const m = /^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s(),]*)?)/i.exec(cells[1]);
      if (!m) continue;
      const verdict = cells[2].toLowerCase();
      // js_only больше не статус: read шлюза — настоящий браузер, такие сайты читаются.
      const status: SourceStatus = /закрыт|не существует|не отвечает|не резолв|спам|захвачен/.test(verdict) ? "dead" : "ok";
      incoming.push({ url: `https://${m[1]}`, name: cells[1].replace(/^\S+\s*/, "").replace(/^\(|\)$/g, "") || m[1], note: `из docs/races-missing.md: ${cells[2].slice(0, 120)}`, kind: "calendar", status });
    }
  }
  const merged = mergeSources(readRegistry(), incoming, today);
  console.log(`новых ${merged.added.length}, отклонено ${merged.rejected.length}, всего ${merged.reg.length}`);
  for (const s of merged.added) console.log(`+ ${s.url}`);
  for (const r of merged.rejected) console.log(`- ${r}`);
  if (apply) {
    writeRegistry(merged.reg);
    console.log(`записано: ${registryPath()}`);
  }
}

/** Корень репозитория: от него читаются .env.local, docs/ и Playwright, откуда бы ни звали. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function cmdCities(n: number) {
  console.log(JSON.stringify(dueCities(readCities(), n), null, 2));
}

/** Стартовое наполнение точек обхода из scripts/races-cities.json; уже известные не трогает. */
async function cmdCitiesSeed(apply: boolean) {
  const seed = JSON.parse(readFileSync(path.join(process.cwd(), "scripts", "races-cities.json"), "utf8")) as Omit<CityPoint, "last_searched">[];
  const list = readCities();
  const known = new Set(list.map((c) => norm(c.name)));
  const added = seed.filter((c) => !known.has(norm(c.name))).map((c) => ({ ...c, last_searched: null }));
  list.push(...added);
  console.log(`новых точек ${added.length}, всего ${list.length}`);
  if (apply) {
    mkdirSync(path.dirname(citiesPath()), { recursive: true });
    writeFileSync(citiesPath(), `${JSON.stringify(list, null, 2)}\n`);
    console.log(`записано: ${citiesPath()}`);
  }
}

/** Заявки с сайта в статусе new: что агенту разобрать первым делом. */
async function cmdSuggestions() {
  const { data, error } = await db()
    .from("race_suggestions")
    .select("id,url,name,city,date_text,contact,is_organizer,created_at")
    .eq("status", "new")
    .order("created_at");
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Поиск во ВКонтакте сервисным ключом. Только чтение.
 *
 * groups.search с сервисным ключом недоступен (ВК отвечает 15 Access denied, проверено 12.10),
 * поэтому: newsfeed.search по словам + wall.get по уже найденной группе организатора.
 * Берём только ОТКРЫТЫЕ СООБЩЕСТВА: посты частных людей (owner_id > 0) отбрасываются до вывода,
 * закрытые группы тоже. Из поста наружу идут только дата, группа, ссылка и текст объявления —
 * без автора, подписи, лайков и прочего: сохраняется сам старт и ссылка-подтверждение.
 */
export const VK_METHODS = new Set(["newsfeed.search", "wall.get"]);
/** Лимит ВК для ключа — 3 запроса в секунду; держим не чаще одного в 400 мс. */
export const VK_MIN_INTERVAL_MS = 400;
export const VK_SEARCH_WORDS = ["трейл", "забег", "полумарафон", "марафон", "триатлон", "акватлон", "скайраннинг", "ультра"];

/** Запросы недели для одной точки: слово + город + год. */
export function vkQueriesForCity(city: string, year: number): string[] {
  return VK_SEARCH_WORDS.map((w) => `${w} ${city} ${year}`);
}

type VkPost = { id?: unknown; owner_id?: unknown; from_id?: unknown; date?: unknown; text?: unknown };
type VkGroup = { id?: unknown; name?: unknown; screen_name?: unknown; is_closed?: unknown };

/**
 * Посты только открытых сообществ, в узком виде. fromGroupOnly — для wall.get: на стене группы
 * бывают посты участников, берём только посты от имени самой группы.
 */
export function slimVkCommunityPosts(posts: VkPost[], groups: VkGroup[], opts: { fromGroupOnly?: boolean } = {}) {
  const open = new Map<number, VkGroup>();
  for (const g of groups) if (Number(g.is_closed) === 0) open.set(Number(g.id), g);
  return posts
    .filter((p) => Number(p.owner_id) < 0 && open.has(-Number(p.owner_id)))
    .filter((p) => !opts.fromGroupOnly || Number(p.from_id) === Number(p.owner_id))
    .map((p) => {
      const g = open.get(-Number(p.owner_id))!;
      return {
        date: new Date(Number(p.date) * 1000).toISOString().slice(0, 10),
        group: String(g.name ?? ""),
        group_url: `https://vk.com/${String(g.screen_name ?? `club${g.id}`)}`,
        url: `https://vk.com/wall${p.owner_id}_${p.id}`,
        text: String(p.text || "").slice(0, 600),
      };
    });
}

let vkLastCallAt = 0;
async function vkCall(method: string, params: Record<string, string>, token: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = vkLastCallAt + VK_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    vkLastCallAt = Date.now();
    // Ключ в теле POST, не в адресе: не оседает в логах прокси и в истории.
    const res = await politeFetch(`https://api.vk.com/method/${method}`, {
      method: "POST",
      body: new URLSearchParams({ ...params, v: "5.199", access_token: token }),
    });
    const body = (await res.json()) as { error?: { error_code: number; error_msg: string }; response?: Record<string, unknown> };
    if (body.error?.error_code === 6) {
      // «Too many requests per second» — подождать и повторить, не падать.
      await new Promise((r) => setTimeout(r, 1100));
      continue;
    }
    // 29 — «Rate limit reached»: суточный лимит метода, повторять сегодня бесполезно.
    if (body.error?.error_code === 29) throw new VkLimitError(`ВК ${method}: 29 ${body.error.error_msg}`);
    if (body.error) throw new Error(`ВК ${method}: ${body.error.error_code} ${body.error.error_msg}`);
    return body.response ?? {};
  }
  throw new VkLimitError(`ВК ${method}: 6 слишком много запросов, три попытки`);
}

/** Упёрлись в лимит ВК (ошибка 6 после повторов или 29): обход останавливается и продолжается позже. */
export class VkLimitError extends Error {}

// ── полный обход ВК по всем точкам (vk-sweep) ────────────────────────────────
//
// 1664 поиска (208 точек × 8 слов) агенту поштучно не по силам, поэтому обход детерминированный:
// шлюз сам ищет, отбрасывает людей и закрытые группы (slimVkCommunityPosts), оставляет посты с
// датой и словом про бег и пишет кандидатов в файл. Агент только проверяет кандидатов по
// правилам. Лимит ВК — остановка с записью, где остановились; следующий запуск продолжает.

export type VkSweepState = {
  cycle: string; // дата начала круга
  next: number; // индекс следующей точки
  total: number;
  out: string; // файл кандидатов этого круга
  queries: number;
  posts: number;
  candidates: number;
  stopped?: string | null;
  done_at?: string | null;
};

export function vkSweepStatePath(): string {
  return process.env.RACES_VK_SWEEP_STATE || path.join(os.homedir(), "ops-log", "races", "vk-sweep.json");
}

/** Год в запросе: с сентября ищем уже следующий сезон. */
export function vkSweepYear(todayIso: string): number {
  const [y, m] = todayIso.split("-").map(Number);
  return m >= 9 ? y + 1 : y;
}

// Без \b после месяца: в JS \b не видит границу у кириллицы, и «18 апреля 2027» не проходил —
// первый полный проход 12.10.2026 нашёл из-за этого только даты цифрами (22 кандидата на 15516 постов).
const VK_DATE_RE = /(?<![\dа-яё])\d{1,2}(?:\s*[-–]\s*\d{1,2})?\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?![а-яё])|(?<!\d)\d{1,2}\.\d{2}\.20\d{2}(?!\d)/i;
const VK_RACE_RE = /трейл|забег|марафон|полумарафон|триатлон|акватлон|дуатлон|скайран|ультра|swimrun|кросс/i;
const VK_NOISE_RE = /бронирован|турагент|туроператор|отель|вылет|ночей|всё включено|все включено|итоги|результаты|протокол|фотоотч[её]т/i;

/** Пост стоит показать агенту: свежий (до 180 дней), есть дата и слово про бег, не реклама туров и не итоги. */
export function isVkRaceCandidate(p: { date: string; text: string }, todayIso: string): boolean {
  const ageDays = (Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${p.date}T00:00:00Z`)) / 864e5;
  if (!(ageDays <= 180)) return false;
  return VK_RACE_RE.test(p.text) && VK_DATE_RE.test(p.text) && !VK_NOISE_RE.test(p.text);
}

async function cmdVkSweep(outArg: string | undefined) {
  loadExtraEnv();
  loadScriptEnv();
  const token = process.env.VK_SERVICE_TOKEN?.trim();
  if (!token) {
    console.log("VK_SERVICE_TOKEN не задан: обход ВК пропущен");
    process.exit(3);
  }
  const cities = readCities();
  if (!cities.length) throw new Error(`нет точек обхода: ${citiesPath()}`);
  const today = todayBelgrade();
  const year = vkSweepYear(today);
  const statePath = vkSweepStatePath();
  const prev = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as VkSweepState) : null;
  // Незаконченный круг продолжаем в тот же файл; законченный — начинаем новый.
  const state: VkSweepState =
    prev && !prev.done_at
      ? { ...prev, stopped: null, total: cities.length }
      : { cycle: today, next: 0, total: cities.length, out: path.resolve(outArg || `vk-candidates-${today}.json`), queries: 0, posts: 0, candidates: 0 };
  const save = () => {
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  };
  const found: Record<string, unknown>[] = existsSync(state.out) ? JSON.parse(readFileSync(state.out, "utf8")) : [];
  const seen = new Set(found.map((c) => String(c.url)));
  console.log(`vk-sweep: круг ${state.cycle}, с точки ${state.next + 1} из ${cities.length}, год ${year}, файл ${state.out}`);
  try {
    for (let i = state.next; i < cities.length; i++) {
      const city = cities[i]!;
      for (const q of vkQueriesForCity(city.name, year)) {
        const r = await vkCall("newsfeed.search", { q, count: "100" }, token);
        state.queries += 1;
        const posts = ((r.items as VkPost[]) || []).filter((p) => Number(p.owner_id) < 0);
        if (!posts.length) continue;
        const ids = [...new Set(posts.map((p) => String(-Number(p.owner_id))))];
        const groups = ((await vkCall("groups.getById", { group_ids: ids.join(",") }, token)).groups as VkGroup[]) || [];
        const slim = slimVkCommunityPosts(posts, groups);
        state.posts += slim.length;
        for (const p of slim) {
          if (seen.has(p.url) || !isVkRaceCandidate(p, today)) continue;
          seen.add(p.url);
          found.push({ point: city.name, region: city.region, query: q, ...p });
        }
      }
      state.next = i + 1;
      state.candidates = found.length;
      writeFileSync(state.out, `${JSON.stringify(found, null, 1)}\n`);
      save();
    }
    state.done_at = new Date().toISOString();
    save();
    console.log(`vk-sweep: круг закончен. Запросов ${state.queries}, постов сообществ ${state.posts}, кандидатов ${found.length}`);
  } catch (error) {
    if (!(error instanceof VkLimitError)) throw error;
    state.stopped = `${new Date().toISOString()} ${error.message}`;
    save();
    console.log(`vk-sweep: ЛИМИТ ВК, остановился на точке ${state.next + 1} из ${cities.length} (${cities[state.next]?.name}). Продолжу при следующем запуске.`);
    process.exit(4);
  }
}

async function cmdVk(method: string, query: string) {
  loadExtraEnv();
  loadScriptEnv();
  const token = process.env.VK_SERVICE_TOKEN?.trim();
  if (!token) {
    console.log("VK_SERVICE_TOKEN не задан: поиск во ВКонтакте пропущен");
    process.exit(3);
  }
  if (!VK_METHODS.has(method) || !query?.trim()) {
    throw new Error("vk: newsfeed.search <запрос> | wall.get <группа: vk.com/имя, имя или club123>");
  }
  let posts: VkPost[];
  let groups: VkGroup[];
  if (method === "newsfeed.search") {
    const r = await vkCall("newsfeed.search", { q: query, count: "100" }, token);
    posts = ((r.items as VkPost[]) || []).filter((p) => Number(p.owner_id) < 0);
    const ids = [...new Set(posts.map((p) => String(-Number(p.owner_id))))];
    groups = ids.length ? (((await vkCall("groups.getById", { group_ids: ids.join(",") }, token)).groups as VkGroup[]) || []) : [];
  } else {
    const ref = query.trim().replace(/^https?:\/\/(m\.)?vk\.com\//, "").replace(/\/$/, "");
    try {
      groups = ((await vkCall("groups.getById", { group_ids: ref.replace(/^(club|public|event)(\d+)$/, "$2") }, token)).groups as VkGroup[]) || [];
    } catch (error) {
      // 100 — такой группы нет (или это страница человека): ответ «не найдено», не падение.
      if (/ВК groups\.getById: 100 /.test(String(error))) {
        console.log(JSON.stringify({ error: "группа не найдена" }));
        return;
      }
      throw error;
    }
    const g = groups[0];
    if (!g || Number(g.is_closed) !== 0) {
      console.log(JSON.stringify({ error: "не открытое сообщество — не читаем" }));
      return;
    }
    posts = ((await vkCall("wall.get", { owner_id: `-${g.id}`, count: "30" }, token)).items as VkPost[]) || [];
  }
  const slim = slimVkCommunityPosts(posts, groups, { fromGroupOnly: method === "wall.get" });
  console.log(JSON.stringify(slim, null, 2));
}

async function main() {
  const [cmd, rawArg] = process.argv.slice(2);
  // Путь к файлу предложения агент даёт от своей рабочей папки: делаем его абсолютным до смены папки.
  const arg = rawArg && (cmd === "dup" || cmd === "apply" || cmd === "vk-sweep") ? path.resolve(rawArg) : rawArg;
  process.chdir(REPO_ROOT);
  const apply = process.argv.includes("--apply");
  if (cmd === "list") return cmdList();
  if (cmd === "read" && arg) return cmdRead(arg);
  if (cmd === "dup" && arg) return cmdDup(arg);
  if (cmd === "dedupe") return void (await cmdDedupe(apply));
  if (cmd === "announce" && arg) return void (await cmdAnnounce(arg, apply));
  if (cmd === "recheck") return cmdRecheck();
  if (cmd === "tracks-due") return cmdTracksDue();
  if (cmd === "details-due") return cmdDetailsDue();
  if (cmd === "apply" && arg) return void (await cmdApply(arg, apply));
  if (cmd === "sources") return cmdSources(arg === "all");
  if (cmd === "sources-seed") return cmdSourcesSeed(apply);
  if (cmd === "sources-tiers") return cmdSourcesTiers(apply);
  if (cmd === "suggestions") return cmdSuggestions();
  if (cmd === "cities") return cmdCities(Number(rawArg) || CITIES_PER_WEEK);
  if (cmd === "cities-seed") return cmdCitiesSeed(apply);
  if (cmd === "vk") return cmdVk(rawArg, process.argv.slice(4).join(" "));
  if (cmd === "gateway-check") return cmdGatewayCheck(!process.argv.includes("--no-notify"));
  if (cmd === "vk-sweep") return void (await cmdVkSweep(arg));
  console.error("команды: list | read <url> | dup <proposal.json> | dedupe [--apply] | recheck | tracks-due | details-due | announce <exp=race,…> [--apply] | apply <proposal.json> [--apply] | sources [all] | sources-seed [--apply] | sources-tiers [--apply] | suggestions | cities [n] | cities-seed [--apply] | vk <groups.search|newsfeed.search> <запрос>");
  process.exit(2);
}

// Запуск как скрипта, а не импорт из чека.
if (process.argv[1] && path.basename(process.argv[1]).startsWith("races-manual")) {
  main().catch((e) => {
    console.error(`[races-manual] ОШИБКА: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}

