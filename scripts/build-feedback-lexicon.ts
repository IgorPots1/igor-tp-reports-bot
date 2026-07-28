// Блок 2+3 — maintenance script for the feedback voice lexicon. READ-ONLY on the DB (pulls sent_text /
// draft_text); writes only the local JSON artifacts under src/features/trainingpeaks/feedback/lexicon/.
//
//   bootstrap  — (re)build base-lexicon.json from ALL sent_text. Run once / rarely.
//   grow       — weekly: add stems from sent_text of the last N days that occur >=2× and aren't in base,
//                into living-lexicon.json (each dated). Base vs living stay separate for provenance.
//   blacklist  — diff draft_text↔sent_text: words present in the DRAFT but removed in the SENT text,
//                across many cards (systematically cut), become blacklist CANDIDATES (shown, not banned).
//
// Usage: NODE_PATH=.../node_modules npx tsx scripts/build-feedback-lexicon.ts <bootstrap|grow|blacklist> [days]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { stemRu, tokenizeRu } from "../src/features/trainingpeaks/feedback/lexicon/stemmer.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEX_DIR = join(HERE, "../src/features/trainingpeaks/feedback/lexicon");
const TABLE = "trainingpeaks_workout_feedback_jobs";
const GROW_MIN_COUNT = 2; // порог живого роста

function loadEnv(p: string) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    if (!k || process.env[k] !== undefined) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
}
loadEnv("/Users/igor/igor-tp-reports-bot/.env.local");
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const readJson = (name: string) => JSON.parse(readFileSync(join(LEX_DIR, name), "utf8"));
const writeJson = (name: string, obj: unknown) => writeFileSync(join(LEX_DIR, name), JSON.stringify(obj, null, 2) + "\n");
const nowIso = () => new Date().toISOString().slice(0, 10);

async function pullSentText(sinceIso: string | null): Promise<string[]> {
  let q = supabase.from(TABLE).select("sent_text, created_at").not("sent_text", "is", null);
  if (sinceIso) q = q.gte("created_at", sinceIso);
  const { data } = await q.limit(5000);
  return (data ?? []).map((r: { sent_text: string | null }) => r.sent_text ?? "").filter((s: string) => s.trim().length > 0);
}

async function bootstrap() {
  const texts = await pullSentText(null);
  const stems = new Set<string>();
  for (const t of texts) for (const tok of tokenizeRu(t)) stems.add(stemRu(tok));
  const out = { _note: readJson("base-lexicon.json")._note, generatedAt: nowIso(), stems: [...stems].sort() };
  writeJson("base-lexicon.json", out);
  console.log(`bootstrap: ${texts.length} sent-текстов → ${stems.size} стемов в base-lexicon.json`);
}

async function grow(days: number) {
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const base = new Set<string>(readJson("base-lexicon.json").stems ?? []);
  const living = readJson("living-lexicon.json");
  const known = new Set<string>([...base, ...(living.entries ?? []).map((e: { stem: string }) => e.stem)]);
  const texts = await pullSentText(sinceIso);
  const counts = new Map<string, number>();
  for (const t of texts) for (const tok of tokenizeRu(t)) { const s = stemRu(tok); if (!known.has(s)) counts.set(s, (counts.get(s) ?? 0) + 1); }
  const added: Array<{ stem: string; addedAt: string; count: number }> = [];
  for (const [stem, count] of counts) if (count >= GROW_MIN_COUNT) added.push({ stem, addedAt: nowIso(), count });
  living.entries = [...(living.entries ?? []), ...added];
  writeJson("living-lexicon.json", living);
  console.log(`grow(${days}д): ${texts.length} sent-текстов → +${added.length} новых стемов (порог >=${GROW_MIN_COUNT}). Всего living: ${living.entries.length}`);
  for (const a of added.slice(0, 30)) console.log(`   +${a.stem} (${a.count})`);
}

async function blacklistDiff() {
  const { data } = await supabase.from(TABLE).select("draft_text, sent_text").not("draft_text", "is", null).not("sent_text", "is", null).limit(5000);
  const cutCounts = new Map<string, { word: string; count: number }>();
  for (const r of (data ?? []) as Array<{ draft_text: string; sent_text: string }>) {
    const sentStems = new Set<string>(tokenizeRu(r.sent_text).map(stemRu));
    const seenInDraft = new Set<string>();
    for (const tok of tokenizeRu(r.draft_text)) {
      const stem = stemRu(tok);
      if (seenInDraft.has(stem)) continue;
      seenInDraft.add(stem);
      // Candidates are CONTENT words the coach systematically cut (jargon), not rephrasing noise:
      // require a longer word (≥5 chars) so stopwords / negation («не», «что») never become blacklisted.
      if (tok.length < 5) continue;
      if (!sentStems.has(stem)) { // in the draft, gone from the sent version = the coach cut it
        const cur = cutCounts.get(stem);
        if (cur) cur.count += 1; else cutCounts.set(stem, { word: tok, count: 1 });
      }
    }
  }
  const ranked = [...cutCounts.entries()].map(([stem, v]) => ({ stem, word: v.word, cutCount: v.count, addedAt: nowIso() })).sort((a, b) => b.cutCount - a.cutCount);
  const bl = readJson("blacklist.json");
  bl.candidates = ranked.filter((c) => c.cutCount >= 3).slice(0, 100); // systematically cut, shown not banned
  writeJson("blacklist.json", bl);
  console.log(`blacklist: ${(data ?? []).length} пар draft/sent → ${bl.candidates.length} кандидатов (вырезаны >=3 раз). Топ:`);
  for (const c of bl.candidates.slice(0, 25)) console.log(`   ✂︎ ${c.word} (стем ${c.stem}, вырезан ${c.cutCount}×)`);
}

const mode = process.argv[2];
const days = Number(process.argv[3] ?? "7");
const run = mode === "bootstrap" ? bootstrap() : mode === "grow" ? grow(days) : mode === "blacklist" ? blacklistDiff() : Promise.reject(new Error("mode: bootstrap|grow|blacklist"));
run.then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
