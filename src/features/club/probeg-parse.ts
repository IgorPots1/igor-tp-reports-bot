// PURE parsing + matching for probeg protocol rows (Фаза 10.3). No DB, no network, no side effects —
// so the probe (scripts/probeg-people-probe.ts) and the unit tests share ONE implementation.
//
// A probeg /results/<Фамилия>/<Имя>/ page is an HTML table; each finish row (<tr>) carries: date,
// event (name + a distance descriptor after <br/>), city, result time, place, age, finisher NAME, club.
// The search is by surname PREFIX and MIXES namesakes, so the NAME never decides a link. A finish is
// tied to one of our races ONLY by DATE + DISTANCE + TIME. Distance is the fix for the Малык bug: a
// surname-only pool (e.g. фамилия=Антон) drops dozens of same-date finishers across every distance;
// without a distance gate a 5-hour marathon looked like a candidate for a 46-minute 10k.

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
    const names = [...row.matchAll(/>\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё.]+)+)\s*</gu)]
      .map((x) => collapse(x[1])).filter((n) => !n.includes(",") && !/\d/u.test(n));

    const key = `${iso}|${sec}|${distanceKm ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date: iso, seconds: sec, distanceKm, name: names[0] ?? "", place: pm ? pm[1] : null, city: cm ? collapse(cm[1]) : null, event });
  }
  return out;
}

/** One student token (its Cyrillic variants) vs one finisher token. "prefix" is a given-name SHORTENING
 *  and is directional ON PURPOSE: only when the FINISHER token is a shortening of the roster variant
 *  (Хади⊂Хадижат), never the reverse — otherwise a foreign surname that merely EXTENDS ours would pass
 *  (Малык→Малыков, Малык→Малыкцев are different people). The surname, being roster-length or longer on
 *  probeg, must therefore match EXACTLY. */
function relToken(variants: string[], f: string): "exact" | "prefix" | "none" {
  if (variants.includes(f)) return "exact";
  if (f.length >= 3) {
    for (const v of variants) if (v.length > f.length && v.startsWith(f)) return "prefix"; // finisher is a shortening of roster
  }
  return "none";
}

/**
 * Does the finisher name belong to this student? A date+distance+time hit proves the RESULT; the name
 * proves the PERSON — a 27k mass start makes a same-minute same-distance coincidence common, so a
 * foreign surname must be rejected even on a perfect time. Order-agnostic (unknown on both sides): find
 * an injective assignment of EVERY roster token to a distinct finisher token, each compatible, with at
 * least one EXACT anchor. `strict` (auto-link gate) forbids prefixes — every token must be exact.
 *   Павлова Кристина vs {Кристина,Пампарайте}: only the given «Кристина» overlaps → rejected.
 *   Роман Антонов vs {Антон,Малык}: surname Малык matches nothing → rejected.
 *   Хади Муртазалиева vs {Хадижат,Муртазалиева}: surname exact + given prefix → passes (non-strict).
 *   Надежда Муртазалиева vs {Хадижат,Муртазалиева}: given incompatible → rejected (namesake).
 */
export function nameGate(studentVariants: string[][], finisherName: string, opts: { strict?: boolean } = {}): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/ё/gu, "е");
  const fTokens = norm(finisherName).split(/\s+/u).map((t) => t.replace(/[^a-zа-яё-]/gu, "")).filter((t) => t.length >= 2);
  const sTokens = studentVariants.map((vs) => vs.map(norm).filter((v) => v.length >= 2)).filter((vs) => vs.length > 0);
  if (sTokens.length === 0 || fTokens.length === 0) return false;
  const used = new Array<boolean>(fTokens.length).fill(false);
  const assign = (i: number, hasExact: boolean): boolean => {
    if (i === sTokens.length) return hasExact;
    for (let j = 0; j < fTokens.length; j++) {
      if (used[j]) continue;
      const r = relToken(sTokens[i], fTokens[j]);
      if (r === "none" || (opts.strict && r !== "exact")) continue;
      used[j] = true;
      if (assign(i + 1, hasExact || r === "exact")) return true;
      used[j] = false;
    }
    return false;
  };
  return assign(0, false);
}

export type MatchVerdict = "exact" | "probable" | "none";
export type OurRaceInput = { date: string; ourSeconds: number | null; ourKm: number | null };
export type MatchResult = { verdict: MatchVerdict; finish: ProbegFinish | null; deltaSeconds: number | null; sameDate: ProbegFinish[]; nameRejected: ProbegFinish | null };

/**
 * Classify one of our races against a person's probeg finishes. Requires BOTH a result match (date +
 * distance + time) AND a person match (name gate) — either alone is not enough.
 *   EXACT    — |Δtime| ≤ exactTol, distance corroborates (or one side has none), name STRICT (all
 *              tokens exact): auto-linkable.
 *   PROBABLE — |Δtime| ≤ probableTol, distance matches on BOTH sides, name matches (surname exact,
 *              given may be a shortening). Needs coach confirmation.
 *   NONE     — otherwise. `nameRejected` carries a same-date time+distance hit that FAILED the name
 *              gate, so the report can show WHY it was dropped (foreign surname).
 */
export function matchRace(race: OurRaceInput, finishes: ProbegFinish[], studentVariants: string[][], tol: { exact: number; probable: number } = { exact: 60, probable: 900 }): MatchResult {
  const sameDate = finishes.filter((f) => f.date === race.date);
  if (race.ourSeconds == null) return { verdict: "none", finish: null, deltaSeconds: null, sameDate, nameRejected: null };
  const scored = sameDate
    .map((f) => {
      const dt = Math.abs(f.seconds - race.ourSeconds!);
      const bothKnown = race.ourKm != null && f.distanceKm != null;
      return {
        f, dt,
        distOk: !bothKnown || distanceMatch(race.ourKm, f.distanceKm),
        distMatch: bothKnown && distanceMatch(race.ourKm, f.distanceKm),
        nameStrict: nameGate(studentVariants, f.name, { strict: true }),
        nameOk: nameGate(studentVariants, f.name),
      };
    })
    .sort((a, b) => a.dt - b.dt);
  const exact = scored.find((c) => c.dt <= tol.exact && c.distOk && c.nameStrict);
  if (exact) return { verdict: "exact", finish: exact.f, deltaSeconds: exact.dt, sameDate, nameRejected: null };
  const probable = scored.find((c) => c.dt <= tol.probable && c.distMatch && c.nameOk);
  if (probable) return { verdict: "probable", finish: probable.f, deltaSeconds: probable.dt, sameDate, nameRejected: null };
  const nameRejected = scored.find((c) => c.dt <= tol.probable && (c.distMatch || c.distOk) && !c.nameOk)?.f ?? null;
  return { verdict: "none", finish: null, deltaSeconds: null, sameDate, nameRejected };
}
