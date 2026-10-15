/**
 * Загрузка выгрузок (dump-corpus.ts) из каталога данных. Данные с ПДн живут вне git:
 * по умолчанию в /Users/igor/igor-tp-reports-bot/reports/precedent/data (reports/ в .gitignore).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildCorpus, mondayOf, iso, type CWeek, type RawRow, type Race, type Signal } from "./corpus.ts";

export const OUT_DIR = process.env.PRECEDENT_OUT ?? "/Users/igor/igor-tp-reports-bot/reports/precedent";
export const DATA_DIR = path.join(OUT_DIR, "data");

export type Loaded = {
  rows: RawRow[]; races: Race[]; sig: Signal[];
  students: Array<{ id: string; student_name: string | null; trainingpeaks_athlete_url: string | null }>;
  rosterActive: number[]; names: Map<number, string>; corpus: CWeek[]; thisMonday: string;
};

export function load(): Loaded {
  const rows = JSON.parse(readFileSync(path.join(DATA_DIR, "corpus.json"), "utf8")) as RawRow[];
  const aux = JSON.parse(readFileSync(path.join(DATA_DIR, "aux.json"), "utf8")) as {
    races: Race[]; sig: Signal[]; st: Loaded["students"]; rosterActive: number[];
  };
  const names = new Map<number, string>();
  for (const s of aux.st) { const m = /athletes?\/(\d+)/.exec(s.trainingpeaks_athlete_url ?? ""); if (m && s.student_name) names.set(Number(m[1]), s.student_name); }
  for (const r of rows) if (!names.has(r.trainingpeaks_athlete_id) && r.student_name) names.set(r.trainingpeaks_athlete_id, r.student_name);
  const thisMonday = mondayOf(iso(Date.now()));
  const corpus = buildCorpus(rows, aux.races, aux.sig, aux.st, thisMonday);
  return { rows, races: aux.races, sig: aux.sig, students: aux.st, rosterActive: aux.rosterActive, names, corpus, thisMonday };
}
