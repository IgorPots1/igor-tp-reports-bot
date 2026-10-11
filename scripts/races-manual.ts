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
 *   npx tsx scripts/races-manual.ts dup <proposal.json>      проверка дублей для вставок
 *   npx tsx scripts/races-manual.ts dedupe [--apply]         ручные, появившиеся в основном потоке → removed
 *   npx tsx scripts/races-manual.ts apply <proposal.json> [--apply]   итог недели пишется в ops-log
 *   npx tsx scripts/races-manual.ts sources [all]           реестр источников (active, или все)
 *   npx tsx scripts/races-manual.ts sources-seed [--apply]  стартовое наполнение реестра
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
export type SourceKind = "organizer" | "series" | "federation" | "calendar" | "registration" | "vk";
export type SourceStatus = "active" | "dead" | "mirror" | "js_only";
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
};
export type Candidate = { url: string; races: number; dated_with_year: boolean; note?: string };
export type Proposal = {
  /** Ставит обёртка раннера, если агент не оставил предложения: в итоге это видно явно. */
  agent_failed?: string;
  checked?: string[];
  sources?: Partial<Source>[];
  candidates?: Candidate[];
  queries?: string[];
  update?: RaceUpdate[];
  remove?: { id: string; reason: string }[];
  insert?: RaceInsert[];
};
export type CalendarRow = { id: string; name: string; date_start: string; date_end: string | null; city: string | null; race_type: string | null };

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
export function isTwin(m: { name: string; date_start: string; city: string | null }, x: { name: string; date_start: string; city: string | null }): boolean {
  if (m.date_start !== x.date_start || !nameSimilar(m.name, x.name)) return false;
  const sameCity = Boolean(norm(m.city)) && norm(m.city) === norm(x.city);
  return sameCity || commonTokens(m.name, x.name) >= 2;
}

/** Двойник ручного старта среди строк, видимых во view под чужим (не manual:) id. */
export function findVisibleTwin<T extends { id: string; name: string; date_start: string; city: string | null }>(
  m: { name: string; date_start: string; city: string | null },
  visible: T[],
): T | null {
  return visible.find((x) => !x.id.startsWith("manual:") && isTwin(m, x)) ?? null;
}

function dayDiff(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
}

/** Дубль по правилу тренера: дата ±2 дня И (похожее название ИЛИ тот же город и тип). */
export function findDuplicate(r: Pick<RaceInsert, "name" | "date_start" | "city" | "race_type">, rows: CalendarRow[]): CalendarRow | null {
  for (const x of rows) {
    if (dayDiff(r.date_start, x.date_start) > 2) continue;
    if (nameSimilar(r.name, x.name)) return x;
    if (norm(r.city) && norm(r.city) === norm(x.city) && r.race_type === x.race_type) return x;
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
  return e;
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

/** Их собирает edge-функция race-calendar-sync: в реестр не кладём, агент по ним не ходит. */
export const AUTO_COLLECTED = [
  "probeg.org", "marathonec.ru", "iron-star.com", "orgeo.ru", "where2run.ru",
  "myrace.info", "sportsauce.ru", "racetime.online", "reg.place",
];
const KINDS = new Set(["organizer", "series", "federation", "calendar", "registration", "vk"]);
const STATUSES = new Set(["active", "dead", "mirror", "js_only"]);

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
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as Source[];
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
      const status = x.status && STATUSES.has(x.status) ? x.status : prev.status;
      const next = { ...prev, status, last_checked: x.last_checked || todayIso, note: x.note ?? prev.note };
      if (next.status !== prev.status || next.note !== prev.note) changed.push(next);
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
      status: x.status && STATUSES.has(x.status) ? x.status : "active",
      note: x.note || "",
    };
    byKey.set(sourceKey(s.url), s);
    reg.push(s);
    added.push(s);
  }
  return { reg, added, changed, rejected };
}

/** Что агенту обходить на этой неделе: active, плюс dead старше 90 дней на перепроверку. */
export function dueSources(reg: Source[], todayIso: string): Source[] {
  const t = Date.parse(`${todayIso}T00:00:00Z`);
  return reg.filter((s) => {
    if (s.status === "active") return true;
    if (s.status === "dead") {
      const last = s.last_checked ? Date.parse(`${s.last_checked}T00:00:00Z`) : 0;
      return t - last >= 90 * 864e5;
    }
    return false;
  });
}

function writeRegistry(reg: Source[], file = registryPath()) {
  mkdirSync(path.dirname(file), { recursive: true });
  reg.sort((a, b) => a.url.localeCompare(b.url));
  writeFileSync(file, `${JSON.stringify(reg, null, 2)}\n`);
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
      .select("id,name,date_start,date_end,city,race_type")
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
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    const text = (await page.evaluate(() => document.body.innerText)).replace(/\n{3,}/g, "\n\n");
    console.log(`URL ${url}\nHTTP ${res?.status() ?? 0}\nFINAL ${page.url()}\n\n${text.slice(0, 12000)}`);
  } finally {
    await browser.close();
  }
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
  const { data: manual, error } = await sb.from("race_events").select("id,name,date_start,city").eq("source", "manual").eq("status", "active");
  if (error) throw error;
  // Двойник ищется во VIEW race_calendar, то есть среди того, что реально видно на
  // странице, а не в сырых строках race_events. 11.10.2026 пробный прогон снял «ОСЕНЬ
  // трейл»: двойник myrace:2152 был в race_events, но робот ошибочно склеил его с
  // «Осенним кроссом» в Североморске (merged_into = probeg:85636), во view его не было,
  // и старт пропал с сайта совсем. Строка, видимая во view под чужим id, такого не даст.
  const visible = (await calendarRows(sb)).filter((x) => !x.id.startsWith("manual:") && x.date_start >= todayBelgrade());
  const hits: { id: string; reason: string }[] = [];
  for (const m of manual || []) {
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

type Outcome = { kind: "fixed" | "removed" | "added" | "skipped"; id: string; text: string; link?: string; tri?: boolean };

async function cmdApply(file: string, apply: boolean) {
  const sb = db();
  const p = readProposal(file);
  const today = todayBelgrade();
  const updates = p.update || [];
  const removes = p.remove || [];
  const inserts = p.insert || [];
  if (inserts.length > MAX_INSERTS) throw new Error(`вставок ${inserts.length} > ${MAX_INSERTS}: прогон остановлен`);
  if (updates.length + removes.length > MAX_UPDATES) throw new Error(`правок ${updates.length + removes.length} > ${MAX_UPDATES}: прогон остановлен`);

  const out: Outcome[] = [];
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
  for (const r of inserts) {
    const errs = validateInsert(r, today);
    const dup = errs.length ? null : findDuplicate(r, calendar);
    const id = manualId(r.name, r.date_start);
    if (errs.length || dup) {
      out.push({ kind: "skipped", id, text: errs.join("; ") || `дубль ${dup!.id} «${dup!.name}»` });
      continue;
    }
    if (await manualRow(sb, id)) {
      out.push({ kind: "skipped", id, text: "такой id уже есть" });
      continue;
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
      region: r.region ?? null,
      location: r.location ?? null,
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
  }

  // Дубли с основным потоком снимаются тем же прогоном и попадают в тот же итог.
  for (const h of await cmdDedupe(apply, true)) out.push({ kind: "removed", id: h.id, text: h.reason });

  // Реестр источников: новые сайты и смена статуса.
  const reg = readRegistry();
  const merged = mergeSources(reg, p.sources || [], today);
  if (apply) writeRegistry(merged.reg);

  const summary = weeklySummary({ apply, today, proposal: p, out, merged, activeTotal: merged.reg.filter((x) => x.status === "active").length });
  console.log(summary);
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

export function weeklySummary(a: {
  apply: boolean;
  today: string;
  proposal: Proposal;
  out: Outcome[];
  merged: { added: Source[]; changed: Source[]; rejected: string[] };
  activeTotal: number;
}): string {
  const n = (k: Outcome["kind"]) => a.out.filter((o) => o.kind === k).length;
  const tri = a.out.filter((o) => o.kind === "added" && o.tri).length;
  const checked = (a.proposal.checked || []).length + n("fixed") + a.out.filter((o) => o.kind === "removed" && !o.text.startsWith("появился в основном потоке")).length;
  const lines = [
    `Дата: ${a.today}`,
    `Задача: еженедельное обновление ручных стартов /races${a.apply ? "" : " (ХОЛОСТОЙ ПРОГОН, в базу ничего не записано)"}`,
    `Итог: проверено ${checked}, исправлено ${n("fixed")}, убрано ${n("removed")}, добавлено ${n("added")} (из них триатлонов ${tri}), отклонено шлюзом ${n("skipped")}`,
    `Источники: новых в реестре ${a.merged.added.length}, сменили статус ${a.merged.changed.length}, всего active ${a.activeTotal}; поисковых запросов ${(a.proposal.queries || []).length}`,
  ];
  if (a.proposal.agent_failed) lines.splice(2, 0, `АГЕНТ НЕ ДАЛ ПРЕДЛОЖЕНИЯ: ${a.proposal.agent_failed}. Проверки и поиск этой недели не сделаны, сняты только дубли с основным потоком.`);
  const cands = a.proposal.candidates || [];
  lines.push(cands.length ? "Кандидаты в автосбор:" : "Кандидаты в автосбор: нет");
  for (const c of cands) lines.push(`- ${c.url}: около ${c.races} стартов, даты с годом: ${c.dated_with_year ? "да" : "нет"}${c.note ? `; ${c.note}` : ""}`);
  lines.push("Изменения:");
  for (const o of a.out) lines.push(`- ${o.kind}: ${o.id}: ${o.text}${o.link ? ` (${o.link})` : ""}`);
  for (const s of a.merged.added) lines.push(`- источник добавлен: ${s.url} (${s.kind}${s.region ? `, ${s.region}` : ""})`);
  for (const s of a.merged.changed) lines.push(`- источник ${s.status}: ${s.url}${s.note ? `: ${s.note}` : ""}`);
  for (const r of a.merged.rejected) lines.push(`- источник отклонён: ${r}`);
  if (a.proposal.queries?.length) lines.push(`Запросы: ${a.proposal.queries.join("; ")}`);
  return `${lines.join("\n")}\n`;
}

async function cmdSources(all: boolean) {
  const reg = readRegistry();
  const list = all ? reg : dueSources(reg, todayBelgrade());
  console.log(JSON.stringify(list, null, 2));
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
      const status: SourceStatus = /закрыт|не существует|не отвечает|не резолв|спам|захвачен/.test(verdict)
        ? "dead"
        : /только js|js/.test(verdict)
          ? "js_only"
          : "active";
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

async function main() {
  const [cmd, rawArg] = process.argv.slice(2);
  // Путь к файлу предложения агент даёт от своей рабочей папки: делаем его абсолютным до смены папки.
  const arg = rawArg && (cmd === "dup" || cmd === "apply") ? path.resolve(rawArg) : rawArg;
  process.chdir(REPO_ROOT);
  const apply = process.argv.includes("--apply");
  if (cmd === "list") return cmdList();
  if (cmd === "read" && arg) return cmdRead(arg);
  if (cmd === "dup" && arg) return cmdDup(arg);
  if (cmd === "dedupe") return void (await cmdDedupe(apply));
  if (cmd === "apply" && arg) return void (await cmdApply(arg, apply));
  if (cmd === "sources") return cmdSources(arg === "all");
  if (cmd === "sources-seed") return cmdSourcesSeed(apply);
  console.error("команды: list | read <url> | dup <proposal.json> | dedupe [--apply] | apply <proposal.json> [--apply] | sources [all] | sources-seed [--apply]");
  process.exit(2);
}

// Запуск как скрипта, а не импорт из чека.
if (process.argv[1] && path.basename(process.argv[1]).startsWith("races-manual")) {
  main().catch((e) => {
    console.error(`[races-manual] ОШИБКА: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}

