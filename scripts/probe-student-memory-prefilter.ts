/**
 * Probe: student memory pre-filter quality check.
 * Shows how many recent observations pass the new pre-filter and what facts the extractor
 * would insert. Dry-run only — no DB writes.
 *
 * Usage:
 *   npx tsx scripts/probe-student-memory-prefilter.ts [--days 14] [--sample 10] [--student <name>]
 *
 * Env required:
 *   OPENAI_API_KEY — from .env.local (loaded automatically)
 *   No COACH_MEMORY_EXTRACTION_ENABLED needed (probe bypasses the flag).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { processCoachMemoryForObservation } from "@/features/trainingpeaks/coach-memory-extraction";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { listActiveTrainingPeaksStudentMemoryItems } from "@/features/trainingpeaks/repository";

// ── env loading ────────────────────────────────────────────────────────────────

function loadLocalEnv(): void {
  const root = path.resolve(process.cwd());
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const sep = line.indexOf("=");
      if (sep <= 0) continue;
      const key = line.slice(0, sep).trim();
      if (!key || process.env[key] !== undefined) continue;
      let val = line.slice(sep + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

loadLocalEnv();

// Force the extraction enabled flag so processCoachMemoryForObservation doesn't early-return.
// applyWrites=false prevents any DB writes.
process.env.COACH_MEMORY_EXTRACTION_ENABLED = "true";

// ── pre-filter (mirrors context-observer.ts shouldExtractMemoryForLabels) ─────

type PersistedObservationLabel = string;

function shouldExtractMemoryForLabels(labels: PersistedObservationLabel[]): boolean {
  return labels.some((l) => l !== "ack_or_noise" && l !== "third_party_in_linked_topic");
}

// ── args ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  let days = 14;
  let sample = 10;
  let studentQuery: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days" && argv[i + 1]) days = parseInt(argv[++i], 10);
    if (argv[i] === "--sample" && argv[i + 1]) sample = parseInt(argv[++i], 10);
    if (argv[i] === "--student" && argv[i + 1]) studentQuery = argv[++i].toLowerCase();
  }

  return { days, sample, studentQuery };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { days, sample, studentQuery } = parseArgs();

  console.log(`\n=== PROBE: student memory pre-filter (last ${days} days, sample=${sample}) ===\n`);

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("ABORT: ANTHROPIC_API_KEY is missing or empty. Check .env.local.");
    process.exit(1);
  }

  const supabase = createSupabaseServerClient();

  // Fetch recent observations
  const sinceDate = new Date(Date.now() - days * 86400_000).toISOString();

  const { data: rows, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, source_type, labels, text_preview, observed_at")
    .gte("observed_at", sinceDate)
    .not("student_id", "is", null)
    .order("observed_at", { ascending: false })
    .limit(2000);

  if (error || !rows) {
    console.error("DB error:", error?.message ?? "no rows");
    process.exit(1);
  }

  type ObsRow = {
    id: string;
    student_id: string | null;
    source_type: string | null;
    labels: unknown;
    text_preview: string | null;
    observed_at: string;
  };

  const allRows = rows as ObsRow[];

  // Filter by student name if requested
  let filtered = allRows;
  if (studentQuery) {
    // We'll need to join student name — for now filter by student_id substring
    console.log(`[Note] --student filter applied to student_id prefix: ${studentQuery}`);
    filtered = allRows.filter((r) => r.student_id?.toLowerCase().includes(studentQuery ?? ""));
  }

  // Label distribution
  const labelCounts: Record<string, number> = {};
  for (const row of filtered) {
    const labels = Array.isArray(row.labels) ? (row.labels as string[]) : ["unknown"];
    const key = [...labels].sort().join("+");
    labelCounts[key] = (labelCounts[key] ?? 0) + 1;
  }

  console.log(`Total observations in last ${days} days: ${filtered.length}`);
  console.log("\nLabel breakdown (sorted by count):");
  for (const [combo, cnt] of Object.entries(labelCounts).sort(([, a], [, b]) => b - a).slice(0, 20)) {
    const labels = combo.split("+") as PersistedObservationLabel[];
    const passes = shouldExtractMemoryForLabels(labels);
    console.log(`  ${passes ? "✓" : "✗"} [${combo}]: ${cnt}`);
  }

  // Pre-filter split
  const passing = filtered.filter((r) => {
    const labels = Array.isArray(r.labels) ? (r.labels as PersistedObservationLabel[]) : ["unknown"];
    return shouldExtractMemoryForLabels(labels);
  });
  const blocked = filtered.length - passing.length;

  console.log(`\nPre-filter result: ${passing.length} PASS / ${blocked} BLOCKED (${Math.round((blocked / filtered.length) * 100)}% cut)`);

  // Sample extraction (dry-run, no writes)
  const sampleRows = passing.slice(0, sample);

  console.log(`\n--- Dry-run extraction on ${sampleRows.length} sampled observations ---`);

  let totalInserted = 0;
  let totalTouched = 0;
  let totalSkipped = 0;
  let totalNoMemory = 0;
  let errors = 0;
  const extractedFacts: Array<{ obs: string; text: string; facts: string[] }> = [];

  for (const row of sampleRows) {
    if (!row.student_id) continue;

    const labels = Array.isArray(row.labels) ? (row.labels as string[]) : ["unknown"];
    const textPreview = row.text_preview ?? "";

    let activeItems: Awaited<ReturnType<typeof listActiveTrainingPeaksStudentMemoryItems>> = [];
    try {
      activeItems = await listActiveTrainingPeaksStudentMemoryItems(row.student_id, { limit: 50 });
    } catch {
      // ignore — empty active items still works
    }

    try {
      const result = await processCoachMemoryForObservation({
        observationId: row.id,
        studentId: row.student_id,
        studentName: "probe_student",
        textPreview,
        labels,
        sourceType: row.source_type,
        observedAt: row.observed_at,
        applyWrites: false,
        currentActiveMemoryItems: activeItems.map((i) => ({
          id: i.id,
          memoryType: i.memoryType,
          summaryText: i.summaryText,
          structured: i.structured,
          validUntil: i.validUntil,
        })),
      });

      if (result.status === "processed") {
        totalInserted += result.inserted;
        totalTouched += result.touched;
        totalSkipped += result.skipped;
        if (result.inserted > 0 || result.touched > 0) {
          extractedFacts.push({
            obs: row.id.slice(0, 8),
            text: textPreview.slice(0, 80),
            facts: [`inserted=${result.inserted} touched=${result.touched} skipped=${result.skipped}`],
          });
        }
      } else if (result.status === "no_memory") {
        totalNoMemory += 1;
      }
    } catch (err) {
      errors += 1;
      console.warn(`  ERR obs ${row.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nExtraction results (${sampleRows.length} sampled, applyWrites=false):`);
  console.log(`  Would insert: ${totalInserted}`);
  console.log(`  Would touch (dedup refresh): ${totalTouched}`);
  console.log(`  Skipped by guards/confidence: ${totalSkipped}`);
  console.log(`  No memory needed: ${totalNoMemory}`);
  console.log(`  Errors: ${errors}`);

  if (extractedFacts.length > 0) {
    console.log(`\nObservations with extracted facts:`);
    for (const f of extractedFacts) {
      console.log(`  [${f.obs}] "${f.text}" → ${f.facts.join(", ")}`);
    }
  } else {
    console.log("\nNo facts extracted in sample (all filtered as no_memory or errored).");
  }

  console.log("\n=== DONE (no DB writes) ===\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
