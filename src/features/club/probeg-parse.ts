// PURE parsing + matching for probeg protocol rows (Фаза 10.3). No DB, no network, no side effects —
// so the probe (scripts/probeg-people-probe.ts) and the unit tests share ONE implementation.
//
// A probeg /results/<Фамилия>/<Имя>/ page is an HTML table; each finish row (<tr>) carries: date,
// event (name + a distance descriptor after <br/>), city, result time, place, age, finisher NAME, club.
// The search is by surname PREFIX and MIXES namesakes, so the NAME never decides a link. A finish is
// tied to one of our races ONLY by DATE + DISTANCE + TIME. Distance is the fix for the Малык bug: a
// surname-only pool (e.g. фамилия=Антон) drops dozens of same-date finishers across every distance;
// without a distance gate a 5-hour marathon looked like a candidate for a 46-minute 10k.

import { isKnownGivenName } from "./name-translit.ts";

export type ProbegFinish = {
  date: string; // ISO yyyy-mm-dd
  seconds: number; // finish time
  distanceKm: number | null; // parsed from the descriptor; null when probeg gives none we can read
  name: string; // finisher as shown — for the coach's confirmation card + namesake eyeballing
  place: string | null; // e.g. "247" (из 259)
  city: string | null;
  event: string; // event name (descriptor stripped)
};

export function toIsoDate(s: string): string | null {
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

export function hmsToSeconds(hms: string): number | null {
  const p = hms.split(":").map((x) => Number(x));
  if (p.some((n) => !Number.isFinite(n))) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return null;
}

export function fmtHms(sec: number | null): string {
  if (sec == null) return "?";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Our-side distance → km. race_events.distance_raw / workout completed_distance_raw is meters OR km
 *  (same >100 ⇒ meters heuristic as club/service.ts normalizeDistanceKm). */
export function normalizeKm(raw: number | string | null | undefined): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n > 100 ? Number((n / 1000).toFixed(3)) : Number(n.toFixed(3));
}

const stripTags = (s: string): string => s.replace(/<[^>]+>/gu, " ");
const collapse = (s: string): string => s.replace(/&nbsp;/gu, " ").replace(/\s+/gu, " ").trim();

/** A probeg distance descriptor (the text after <br/> in the event cell) → km. Handles "5 км",
 *  "21.1 км", "10550 м", and the WORD form marathons use: "марафон" (42.2), "полумарафон" (21.1). */
export function descriptorToKm(descriptor: string): number | null {
  const s = collapse(descriptor).toLowerCase();
  let m = s.match(/([\d]+(?:[.,]\d+)?)\s*км/u);
  if (m) { const n = Number(m[1].replace(",", ".")); return n > 0 ? Number(n.toFixed(3)) : null; }
  m = s.match(/([\d]+(?:[.,]\d+)?)\s*м(?![а-яa-z])/u); // meters — not "марафон"/"миля"
  if (m) { const n = Number(m[1].replace(",", ".")); return n > 0 ? Number((n / 1000).toFixed(3)) : null; }
  if (s.includes("полумарафон")) return 21.1; // check BEFORE марафон (substring)
  if (s.includes("марафон")) return 42.2;
  return null;
}

/** Same-distance? Absolute band max(1 km, 10%): 10 vs 10.55 ✓, 42.2 vs GPS 44 ✓, 10 vs 15 ✗, 5 vs 3 ✗. */
export function distanceMatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= Math.max(1.0, 0.1 * Math.max(a, b));
}

/**
 * Extract every finish row from a results page. Row-based (not a sliding window): each <tr> yields one
 * finish. The date cell and the event cell are BOTH /race/<id>/ anchors — the event one is the anchor
 * containing <br/> (name <br/> descriptor); the date is the first dd.mm.yyyy in the row; the time is the
 * first h:mm:ss (dates use dots, places have no colon, so it is unambiguous). Deduped. PURE.
 */
export function extractFinishes(html: string): ProbegFinish[] {
  const out: ProbegFinish[] = [];
  const seen = new Set<string>();
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gu) ?? [];
  for (const row of rows) {
    const dm = row.match(/(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})/u);
    if (!dm) continue;
    const iso = toIsoDate(dm[1]);
    if (!iso) continue;
    const tm = row.match(/\b(\d{1,2}:\d{2}:\d{2})\b/u);
    if (!tm) continue;
    const sec = hmsToSeconds(tm[1]);
    if (sec == null || sec <= 0) continue;

    let distanceKm: number | null = null;
    let event = "";
    const anchorRe = /\/race\/\d+\/">([\s\S]*?)<\/a>/gu;
    let am: RegExpExecArray | null;
    while ((am = anchorRe.exec(row)) !== null) {
      const content = am[1];
      if (!/<br/iu.test(content)) continue; // the date anchor has no <br/> — skip it
      const parts = content.split(/<br\s*\/?>/iu);
      distanceKm = descriptorToKm(parts[parts.length - 1]);
      event = collapse(stripTags(parts.slice(0, -1).join(" ")));
      break;
    }

    const pm = row.match(/(\d+)\s*(?:из|&nbsp;из)/u);
    const cm = row.match(/\/races\/city\/\d+\/">([^<]+)<\/a>/u);
    // Finisher name comes from the «Имя» COLUMN, not a free-text scan: the event cell can hold two
    // capitalised words («Арена Марафон») that a global regex mistakes for a name. Columns are stable
    // (№, Дата, Забег, Город, Результат, Место, Группа, Возраст, Имя, Город, Клуб) — «Имя» is 3rd from
    // the end. Empty/unreadable → name "" (treated as "unrecognised", NOT a foreign name — never a hard reject).
    const cells = row.match(/<td\b[^>]*>[\s\S]*?<\/td>/giu) ?? [];
    let name = "";
    if (cells.length >= 3) {
      const cand = collapse(stripTags(cells[cells.length - 3]));
      if (/[а-яё]{2}/iu.test(cand) && !/[,]/u.test(cand)) name = cand;
    }

    const key = `${iso}|${sec}|${distanceKm ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date: iso, seconds: sec, distanceKm, name, place: pm ? pm[1] : null, city: cm ? collapse(cm[1]) : null, event });
  }
  return out;
}

/** Fold away the differences the coach said to tolerate on a surname: ё/е and the soft sign ь. Input is
 *  already lowercased. So Василева≡Васильева, Королев≡Королёв. */
function softName(s: string): string {
  return s.replace(/ё/gu, "е").replace(/ь/gu, "");
}

/** Levenshtein distance ≤ 1 (the coach's "one letter" tolerance)? Early-outs on a length gap > 1. */
function within1Edit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    if (++edits > 1) return false;
    if (la > lb) i += 1; else if (lb > la) j += 1; else { i += 1; j += 1; }
  }
  return true; // any leftover tail is the single trailing edit
}

/** One student token (its Cyrillic variants) vs one finisher token, after softening ь/ё.
 *  "exact"  — equal (auto-link strength; covers Василева≡Васильева, Королев≡Королёв).
 *  "fuzzy"  — differ by ≤1 letter, both ≥4 chars, and NEITHER is a known given name — the coach's
 *             one-letter tolerance is for SURNAMES; on first names it would merge Лилия/Лидия.
 *  "prefix" — finisher is a SHORTENING of the roster token (Хади⊂Хадижат), never the reverse: a foreign
 *             surname that merely EXTENDS ours (Малык→Малыков/Малыкцев) is a different person. */
function relToken(variants: string[], f: string): "exact" | "fuzzy" | "prefix" | "none" {
  const nf = softName(f);
  for (const v of variants) if (softName(v) === nf) return "exact";
  if (!isKnownGivenName(nf)) {
    for (const v of variants) { const nv = softName(v); if (!isKnownGivenName(nv) && Math.min(nv.length, nf.length) >= 4 && within1Edit(nv, nf)) return "fuzzy"; }
  }
  for (const v of variants) { const nv = softName(v); if (nf.length >= 3 && nv.length > nf.length && nv.startsWith(nf)) return "prefix"; }
  return "none";
}

/**
 * Does the finisher name belong to this student? A date+distance+time hit proves the RESULT; the name
 * proves the PERSON — a 27k mass start makes a same-minute same-distance coincidence common, so a
 * foreign surname must be rejected even on a perfect time. Order-agnostic (unknown on both sides): find
 * an injective assignment of EVERY roster token to a distinct finisher token, each compatible, with at
 * least one STRONG (exact|fuzzy) anchor. `strict` (auto-link gate) allows only exact — no fuzzy, no
 * prefix — so a shortened or one-letter-off name goes to PROBABLE (the coach confirms it once and the
 * confirmed spelling then auto-links).
 *   Павлова Кристина vs {Кристина,Пампарайте}: only the given «Кристина» overlaps → rejected.
 *   Роман Антонов vs {Антон,Малык}: surname Малык matches nothing → rejected.
 *   Татьяна Бучкина vs {Бучкина,Татьяна}: both exact via the given-name dictionary → passes.
 *   Хади Муртазалиева vs {Хадижат,Муртазалиева}: surname exact + given prefix → passes (non-strict).
 */
export function nameGate(studentVariants: string[][], finisherName: string, opts: { strict?: boolean } = {}): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/ё/gu, "е");
  const fTokens = norm(finisherName).split(/\s+/u).map((t) => t.replace(/[^a-zа-яё-]/gu, "")).filter((t) => t.length >= 2);
  const sTokens = studentVariants.map((vs) => vs.map(norm).filter((v) => v.length >= 2)).filter((vs) => vs.length > 0);
  if (sTokens.length === 0 || fTokens.length === 0) return false;
  const used = new Array<boolean>(fTokens.length).fill(false);
  const assign = (i: number, hasStrong: boolean): boolean => {
    if (i === sTokens.length) return hasStrong;
    for (let j = 0; j < fTokens.length; j++) {
      if (used[j]) continue;
      const r = relToken(sTokens[i], fTokens[j]);
      if (r === "none" || (opts.strict && r !== "exact")) continue;
      used[j] = true;
      if (assign(i + 1, hasStrong || r === "exact" || r === "fuzzy")) return true;
      used[j] = false;
    }
    return false;
  };
  return assign(0, false);
}

/** Canonical key for a finisher name: lowercase, ё→е, collapsed spaces. The same normalization backs
 *  the confirmed-spelling memory (club_probeg_athlete_links.confirmed_name_normalized). */
export function normalizeFinisherName(name: string): string {
  return name.toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
}

// probeg covers Russia + CIS only. A race abroad (Montenegro, UAE, USA, …) will NEVER have a protocol
// there, so it must be excluded from the coverage denominator, not counted as a miss. Detected by the
// title (race_events has no city). Non-CIS countries + distinctive foreign host cities. Best-effort —
// the report prints the flagged list so the coach can eyeball it. CIS (RU/BY/KZ/AM/KG/UZ/TJ/AZ) is NOT
// foreign; those races ARE on probeg.
const FOREIGN_KEYWORDS = [
  "черногор", "montenegro", "podgorica", "подгориц", "budva", "будва", "kotor", "котор", "tivat", "тиват", "herceg", "cetinje",
  "оаэ", " uae", "дубай", "dubai", "abu dhabi", "абу-даби", "эмират", "emirates", "ras al khaimah",
  "сша", " usa", "америк", "america", "нью-йорк", "new york", "бостон", "boston", "chicago", "чикаго", "los angeles", "майами", "miami",
  "турци", "turkey", "antalya", "анталия", "istanbul", "стамбул",
  "грузи", "georgia", "тбилиси", "tbilisi", "батуми", "batumi",
  "латви", "рига", "riga", "эстони", "таллин", "tallinn", "литв", "вильнюс", "vilnius",
  "berlin", "берлин", "london", "лондон", "париж", "paris", "valencia", "валенси", "barcelona", "барселон",
  "amsterdam", "prague", "прага", "budapest", "будапешт", "варшав", "warsaw", "хельсинки", "helsinki",
  "финлянди", "finland", "герман", "germany", "испани", "spain", "итали", "italy", "франци", "france",
  "кипр", "cyprus", "bangkok", "бангкок", "tokyo", "токио", "singapore", "сингапур",
];

/** True when a race title points abroad (outside Russia/CIS) — no probeg protocol will ever exist. */
export function isForeignRace(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return FOREIGN_KEYWORDS.some((k) => t.includes(k));
}

export type MatchVerdict = "exact" | "probable" | "none";
export type OurRaceInput = { date: string; ourSeconds: number | null; ourKm: number | null };
export type MatchResult = { verdict: MatchVerdict; finish: ProbegFinish | null; deltaSeconds: number | null; sameDate: ProbegFinish[]; nameRejected: ProbegFinish | null; nameUnrecognized: boolean; byConfirmedName: boolean };

/**
 * Classify one of our races against a person's probeg finishes. Requires BOTH a result match (date +
 * distance + time) AND a person match — either alone is not enough on a 27k mass start.
 *   EXACT    — |Δtime| ≤ exactTol, distance corroborates (or one side has none), name is KNOWN and
 *              STRICT (all tokens exact): auto-linkable.
 *   PROBABLE — |Δtime| ≤ probableTol, distance matches on BOTH sides, AND either the name matches
 *              (surname exact, given may be a shortening) OR the name could NOT be read at all. An
 *              unreadable name is NOT a reason to drop — the coach decides. Needs coach confirmation.
 *   NONE     — otherwise. `nameRejected` carries a same-date time+distance hit whose name was PRESENT
 *              but FOREIGN, so the report shows why it was dropped. `nameUnrecognized` flags a probable
 *              whose finisher name was blank (shown to the coach as «имя не распозналось»).
 *
 * `confirmedSpellings` is the identifier memory: finisher spellings the coach has already confirmed
 * belong to THIS student (club_probeg_athlete_links). A confirmed spelling counts as name-EXACT, so a
 * shortened name like «Хади Муртазалиева» — forever PROBABLE on its own — auto-links once confirmed and
 * never returns to the queue. `byConfirmedName` marks such a match.
 */
export function matchRace(race: OurRaceInput, finishes: ProbegFinish[], studentVariants: string[][], tol: { exact: number; probable: number } = { exact: 60, probable: 900 }, confirmedSpellings: string[] = []): MatchResult {
  const confirmedSet = new Set(confirmedSpellings.map(normalizeFinisherName).filter((s) => s.length > 0));
  const sameDate = finishes.filter((f) => f.date === race.date);
  if (race.ourSeconds == null) return { verdict: "none", finish: null, deltaSeconds: null, sameDate, nameRejected: null, nameUnrecognized: false, byConfirmedName: false };
  const scored = sameDate
    .map((f) => {
      const dt = Math.abs(f.seconds - race.ourSeconds!);
      const bothKnown = race.ourKm != null && f.distanceKm != null;
      const nameKnown = f.name.trim().length > 0;
      const confirmed = nameKnown && confirmedSet.has(normalizeFinisherName(f.name));
      return {
        f, dt, nameKnown, confirmed,
        distOk: !bothKnown || distanceMatch(race.ourKm, f.distanceKm),
        distMatch: bothKnown && distanceMatch(race.ourKm, f.distanceKm),
        nameStrict: confirmed || (nameKnown && nameGate(studentVariants, f.name, { strict: true })),
        nameOk: confirmed || (nameKnown && nameGate(studentVariants, f.name)),
      };
    })
    .sort((a, b) => a.dt - b.dt);
  const exact = scored.find((c) => c.dt <= tol.exact && c.distOk && c.nameStrict);
  if (exact) return { verdict: "exact", finish: exact.f, deltaSeconds: exact.dt, sameDate, nameRejected: null, nameUnrecognized: false, byConfirmedName: exact.confirmed };
  const probable = scored.find((c) => c.dt <= tol.probable && c.distMatch && (c.nameOk || !c.nameKnown));
  if (probable) return { verdict: "probable", finish: probable.f, deltaSeconds: probable.dt, sameDate, nameRejected: null, nameUnrecognized: !probable.nameKnown, byConfirmedName: false };
  const nameRejected = scored.find((c) => c.dt <= tol.probable && (c.distMatch || c.distOk) && c.nameKnown && !c.nameOk)?.f ?? null;
  return { verdict: "none", finish: null, deltaSeconds: null, sameDate, nameRejected, nameUnrecognized: false, byConfirmedName: false };
}
