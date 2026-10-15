// Склейка дублей между источниками календаря: чистый модуль без Deno и Node API.
// Его зовёт edge-функция (стадия ?stage=merge) и держит npm run check:races (случаи склеек и не-склеек).

/** Поля строки, которые нужны склейке (Race из index.ts — надмножество). */
export type MatchRow = {
  id: string; source: string; name: string; date_start: string; date_end: string;
  city: string; region: string; location: string | null; race_type: string;
  site_url?: string | null; reg_url?: string | null;
};

// Ссылка на страницу конкретного события (регистрация, карточка старта), без схемы, www, query, хвостового слэша.
// Голые домены, паблики и общие страницы календарей - не событие: «key-run.ru/», «vk.com/группа», «orgeo.ru».
const EVENT_PATH = /^\/(event|events|race|races|start|starts|competition|competitions)\/[^/]+/i;
const NOT_EVENT_HOST = /(^|\.)(vk\.com|vk\.ru|t\.me|instagram\.com|ok\.ru|youtube\.com|facebook\.com)$/;
export function eventLink(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch (_) { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, "");
  if (NOT_EVENT_HOST.test(host) || !EVENT_PATH.test(path)) return null;
  return `${host}${path.toLowerCase()}`;
}
const links = (r: MatchRow) => [eventLink(r.reg_url), eventLink(r.site_url)].filter((x): x is string => !!x);
const STOP = new Set(["забег", "пробег", "трейл", "trail", "марафон", "полумарафон", "кросс", "race", "run", "фестиваль", "бега", "по", "на", "и", "в", "the", "открытый", "чемпионат", "этап", "кубок", "2026", "2027", "г"]);
const tokCache = new Map<string, Set<string>>();
export function tokens(s: string): Set<string> {
  const hit = tokCache.get(s); if (hit) return hit;
  const t = tokens0(s); tokCache.set(s, t); return t;
}
function tokens0(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/ё/g, "е").replace(/[«»"'.,:;!?()|—–\-\/]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^[ivxlc]+$/.test(w)));
}
export function sim(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if ([...B].some((x) => sameWord(w, x))) inter++;
  return inter / Math.min(A.size, B.size);
}
const TR: Record<string, string> = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
const latCache = new Map<string, string>();
export const lat = (s: string) => { const h = latCache.get(s); if (h !== undefined) return h; const v = lat0(s); latCache.set(s, v); return v; };
const lat0 = (s: string) => s.toLowerCase().split("").map((c) => TR[c] ?? c).join("").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
// Одно слово = другое: точно, или в транслитерации («ВОЛЫНЬ» = «VOLYN'»), или общая основа из 7+ букв
// («Карстовый» = «Карстового»). Было (до 12.10.2026): общие первые 5 букв — и «Покровские Пруды»
// склеивались с «Покровское-Стрешнево», «Осенний» с «Осенняя».
const STEM = 7;
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const x = lat(a), y = lat(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // окончание: «жуков» = «жукова», «карстовый» = «карстового» (короткое - начало длинного, разница до 2 букв)
  const [sh, lo] = x.length <= y.length ? [x, y] : [y, x];
  if (sh.length >= 5 && lo.length - sh.length <= 2 && lo.startsWith(sh)) return true;
  if (x.length < STEM || y.length < STEM) return false;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i >= STEM;
}
// transliterated substring overlap: catches "O-Trail FerrumFest" vs "О-Трейл Феррум Фест"
// words shorter than 5 letters are ignored: "osen" is a substring of "osenniy" but «ОСЕНЬ трейл» is not «Осенний кросс»
// strict: без общих слов («осенний», «ультра») - для склейки разных дат: «Мама, я бегу (Осенний забег)» ≠ «Осенний кросс МАИ».
// Для одной даты общие слова оставлены: «Backyard Ultra Istra» = «Бэкъярд УльтраИстра» держится на «ultra».
export function simLatin(a: string, b: string, strict = false): number {
  const ok = (w: string) => w.length >= 5 && !/^(treil|trail|zabeg|probeg|marafon|race|fest|festival|kross|cross)$/.test(w) && !(strict && GENERIC_LAT.test(w));
  const ta = lat(a).split(" ").filter(ok);
  const tb = lat(b).split(" ").filter(ok);
  const ca = lat(a).replace(/ /g, ""), cb = lat(b).replace(/ /g, "");
  const [short, longC] = ta.length <= tb.length ? [ta, cb] : [tb, ca];
  if (!short.length) return 0;
  return short.filter((w) => longC.includes(w)).length / short.length;
}
// generic words that say nothing about which race it is: never enough on their own to glue two places together
// Праздничные «день народного единства», «здравствуй» тоже общие: 12.10.2026 «ДЕНЬ НАРОДНОГО ЕДИНСТВА» 31.10
// (серия «А побегать?») склеился с «Покровские Пруды — День Народного Единства» 04.11.
const GENERIC_STEMS = "осен|весен|весна|зимн|зима|летн|лето|новогод|рождеств|старт|город|соревнован|первенств|ночн|детск|семейн|открыт|областн|легкоатлет|всероссийск|парк|ультра|трейлов|гонка|выходн|дня|памяти|бег|забег|кросс|пробег|фестивал|серия|кубок|чемпионат|этап|день|народн|единств|здравствуй|super|run|race";
const GENERIC = new RegExp(`^(${GENERIC_STEMS})`);
// те же основы в транслитерации: значимые слова сравниваются и кириллицей, и латиницей
const GENERIC_LAT = new RegExp(`^(${GENERIC_STEMS.split("|").map((w) => lat(w)).join("|")})`);
const isGeneric = (w: string) => GENERIC.test(w) || GENERIC_LAT.test(lat(w));
export const distinct = (s: string) => new Set([...tokens(s)].filter((w) => !isGeneric(w)));
export function simSets(A: Set<string>, B: Set<string>): number {
  let inter = 0;
  for (const w of A) if ([...B].some((x) => sameWord(w, x))) inter++;
  return inter / Math.min(A.size, B.size);
}
/** Значимые слова двух названий: сколько общих и есть ли у каждого свои, которых нет у другого. */
export function wordOverlap(A: Set<string>, B: Set<string>, ignore: string[] = []): { ratio: number; exact: number; leftA: number; leftB: number; sameScript: boolean } {
  const cyr = (w: string) => /[а-я]/.test(w);
  const all = [...A, ...B];
  const sameScript = all.every(cyr) || !all.some(cyr);
  // «свои» слова, которые на деле название города («Ночной забег Красноярск»), своими не считаются
  const own = (w: string, other: Set<string>) => ![...other].some((x) => sameWord(w, x)) && !ignore.some((c) => sameWord(w, c));
  const leftA = [...A].filter((w) => own(w, B)).length, leftB = [...B].filter((w) => own(w, A)).length;
  if (!A.size || !B.size) return { ratio: 0, exact: 0, leftA, leftB, sameScript };
  const mA = [...A].filter((w) => [...B].some((x) => sameWord(w, x))).length;
  const mB = [...B].filter((w) => [...A].some((x) => sameWord(w, x))).length;
  // точные совпадения (в т.ч. в транслитерации), без общей основы: «покровские» и «покровское» тут разные
  const eq = (w: string, x: string) => w === x || lat(w) === lat(x);
  const eA = [...A].filter((w) => [...B].some((x) => eq(w, x))).length;
  const eB = [...B].filter((w) => [...A].some((x) => eq(w, x))).length;
  const small = A.size <= B.size;
  return { ratio: small ? mA / A.size : mB / B.size, exact: small ? eA / A.size : eB / B.size, leftA, leftB, sameScript };
}
// Регион строки: поле region или первый сегмент location, если это регион. «Республика X» -> «x»
// (раньше брали первое слово, и любая республика совпадала с любой).
const REGIONISH = /(област|край|республик|респ\.|автономн|округ|^москва$|^санкт-петербург$|^севастополь$)/;
export function regionKey(r: string | null | undefined): string {
  const t = norm(r).replace(/^(г\.|город)\s*/, "");
  // «Дмитровский район (Московская область)» -> «московская», а не первое слово
  const m = t.match(/([а-я-]+)\s+(область|край|автономный округ)/) || t.match(/(?:республика|респ\.)\s+([а-я-]+)/);
  if (m) return m[1];
  return t.split(/[\s,]+/).filter(Boolean)[0] || "";
}
export function rowRegion(r: MatchRow): string {
  if (r.region && REGIONISH.test(norm(r.region))) return regionKey(r.region);
  const first = norm(r.location).split(",")[0].trim();
  return REGIONISH.test(first) ? regionKey(first) : "";
}
// соседи, которые источники путают: старт в Новой Москве или под Петербургом пишут то так, то так
const NEIGHBOURS: [string, string][] = [["москва", "московская"], ["санкт-петербург", "ленинградская"], ["севастополь", "крым"]];
const sameRegion = (a: string, b: string) => a === b || NEIGHBOURS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
// null-safe: у ручных строк location бывает пустым (шлюз не требовал его до 12.10.2026),
// и склейка падала на первом же сравнении с таким стартом.
const norm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/ё/g, "е").trim();
const BIG_CITY = /^(москва|санкт-петербург|екатеринбург|новосибирск|казань|нижний новгород|краснодар|самара|ростов-на-дону|уфа|пермь|челябинск|воронеж|красноярск|сочи)$/i;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
// 0 = no match, 1 = same race on overlapping dates, 2 = same race but sources disagree on the date (<= 7 days apart)
export function sameRace(p: MatchRow, s: MatchRow): 0 | 1 | 2 {
  // одна и та же ссылка на событие и даты рядом (пересекаются или расходятся не больше чем на день) - один старт,
  // как бы ни назывался: «Трейлфест МинВоды» и «Змейка Трейл» - одна регистрация reg.russiarunning.com/event/TreylfestZmeyka2026
  const lp = links(p), ls = links(s);
  if (lp.length && ls.length && lp.some((l) => ls.includes(l))) {
    const near = s.date_start <= p.date_end && p.date_start <= s.date_end
      || Math.abs(dayDiff(s.date_start, p.date_start)) <= 1 || Math.abs(dayDiff(s.date_end, p.date_end)) <= 1;
    if (near) return 1;
  }
  // разные регионы - разные старты, как бы ни совпали слова: «Кросс лыжников» в Гатчине (Ленинградская)
  // и «Кросс лыжников МГУ» в Красногорске (Московская) склеились 12.10.2026 по одному слову «лыжников»
  const rp = rowRegion(p), rs = rowRegion(s);
  if (rp && rs && !sameRegion(rp, rs)) return 0;
  const cityMatch = !s.city || !p.city || norm(p.location).includes(norm(s.city)) || norm(s.city).includes(norm(p.city));
  const score = Math.max(sim(p.name, s.name), simLatin(p.name, s.name));
  const overlap = s.date_start <= p.date_end && p.date_start <= s.date_end;
  const smallTown = !!s.city && !BIG_CITY.test(norm(s.city));
  const sk = regionKey(s.region);
  const regionMatch = !!sk && norm(p.location).includes(sk);
  const w = wordOverlap(distinct(p.name), distinct(s.name), [...tokens(p.city || ""), ...tokens(s.city || "")]);
  // both places known and different: only a match on meaningful words of the name counts
  // (one shared word such as "осенний" or "старт" glued races from different cities together)
  // («Вьюнок трейл» in Гарболово and in Куйвози is one race; «Осенний кросс» in Талдом and Североморск are two)
  // значимые слова сравниваются и кириллицей, и в транслитерации: «ВОЛЫНЬ» = «VOLYN'» (sameWord)
  if (s.city && p.city && !cityMatch && !regionMatch) {
    if (w.ratio < 0.8 && w.exact < 0.5) return 0;
  }
  // у обоих названий есть свои значимые слова, а общих мало: два разных старта в одном месте
  // («Покровское-Стрешнево» ≠ «Покровские Пруды»; «Окская тропа» ≠ «Семья на спорте» в один день в Сысоевке)
  // только на одном алфавите: «Mad Fox Ultra» и «Бешеная Лиса Ультра» - перевод, а не разные слова
  if (w.leftA && w.leftB && w.exact === 0 && w.sameScript && score < 0.8) return 0;
  if (overlap) {
    if (score >= 0.8) return 1;
    if (regionMatch && score >= 0.4) return 1;
    if (cityMatch && score >= 0.5) return 1;
    if (cityMatch && smallTown && score >= 0.25) return 1;
    // same day, same small town, same kind of race: almost always one event listed under two names
    if (cityMatch && smallTown && s.city && p.city && p.race_type === s.race_type && p.race_type !== "track") return 1;
    return 0;
  }
  // разные даты: только по общим значимым словам (было: хватало «осенний» или «день народного единства»)
  if (Math.abs(dayDiff(s.date_start, p.date_start)) <= 7 && cityMatch && score >= 0.6 && (w.ratio >= 0.6 || simLatin(p.name, s.name, true) >= 0.8)) return 2;
  return 0;
}
const dayNum = (d: string) => Math.floor(Date.parse(d) / 864e5);
export function findMatch<T extends MatchRow>(pool: T[], s: MatchRow): [T | undefined, 0 | 1 | 2] {
  let near: T | undefined;
  const a = dayNum(s.date_start) - 7, b = dayNum(s.date_end) + 7;
  for (const x of pool) {
    if (dayNum(x.date_end) < a || dayNum(x.date_start) > b) continue;
    const r = sameRace(x, s);
    if (r === 1) return [x, 1];
    if (r === 2 && !near) near = x;
  }
  return near ? [near, 2] : [undefined, 0];
}

// Только плавание (заплывы, open water, X-WATERS без бега) — не беговой старт. Общий фильтр
// сборщика (okRace) и шлюза races-manual. Триатлон, акватлон, свимран и всё, где в названии или
// дистанциях есть бег, остаются. Было (15.10.2026, первый вариант): серия X-WATERS снималась по
// одному названию; отменено решением тренера: у X-WATERS Урал и Руза в дистанциях акватлон
// (плавание + бег), это триатлонный старт и остаётся в календаре.
const SWIM = /заплыв|плаван|\bswim|open[- ]?water|открыт(ой|ая|ую) вод|на воде|[xх][- ]?waters/i;
const WITH_RUN = /бег|трейл|trail|кросс|\brun\b|swim ?run|свимран|триатлон|дуатлон|акватлон|(tri|aqua|du)athlon|ironstar|iron ?man|ironlady|manstar/i;
export function isSwimOnly(name: string, distances: string[] = []): boolean {
  const text = `${name} ${distances.join(" ")}`;
  return SWIM.test(text) && !WITH_RUN.test(text);
}
