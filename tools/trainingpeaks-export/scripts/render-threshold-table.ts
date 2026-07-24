// One-off renderer: results.json -> a human-readable markdown table.
// Read-only against the JSON already produced by tp-threshold-estimation.ts.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { toolRoot } from "./lib/paths.ts";

const inPath = path.join(toolRoot, "action-artifacts", "threshold-estimation", "results.json");
const outPath = path.join(toolRoot, "action-artifacts", "threshold-estimation", "results-table.md");

function fmtPace(secPerKm: number | null): string {
  if (secPerKm === null) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}
function fmtPct(pct: number | null): string {
  return pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

const data = JSON.parse(readFileSync(inPath, "utf8"));
const rows = data.rows as Array<{
  athlete_id: number;
  current_pace_sec_per_km: number | null;
  estimate_pace_sec_per_km: number | null;
  pace_discrepancy_pct: number | null;
  current_hr_bpm: number | null;
  estimate_hr_bpm: number | null;
  hr_discrepancy_pct: number | null;
  evidence_tier: string | null;
  n_workouts: number;
}>;

const lines: string[] = [];
lines.push(`# Threshold estimation — results (window from ${data.generated_window_from})`);
lines.push("");
lines.push("READ-ONLY analysis. athlete_id only — no names. See docs/threshold-estimation-method.md for tiers/formulas.");
lines.push("");
lines.push("| athlete_id | current pace | est. pace | pace Δ% | current HR | est. HR | HR Δ% | tier | n |");
lines.push("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  lines.push(
    `| ${r.athlete_id} | ${fmtPace(r.current_pace_sec_per_km)} | ${fmtPace(r.estimate_pace_sec_per_km)} | ${fmtPct(r.pace_discrepancy_pct)} | ${
      r.current_hr_bpm ?? "—"
    } | ${r.estimate_hr_bpm ?? "—"} | ${fmtPct(r.hr_discrepancy_pct)} | ${r.evidence_tier ?? "—"} | ${r.n_workouts} |`,
  );
}
lines.push("");
lines.push("## Aggregates");
lines.push("");
const a = data.aggregates;
lines.push(`- Athletes covered: ${a.athletes_total}`);
lines.push(`- No evidence at all: ${a.no_evidence_at_all}`);
lines.push(`- Pace estimate but no HR estimate: ${a.pace_only_no_hr}`);
lines.push(`- Both pace and HR estimate: ${a.both_pace_and_hr}`);
lines.push(`- Pace discrepancy <5%: ${a.pace_discrepancy_buckets.under5}`);
lines.push(`- Pace discrepancy 5–15%: ${a.pace_discrepancy_buckets.from5to15}`);
lines.push(`- Pace discrepancy >15%: ${a.pace_discrepancy_buckets.over15}`);
lines.push(`- No current threshold to compare against: ${a.pace_discrepancy_buckets.noCompare}`);
lines.push(`- HR evidence points discarded (hr_trusted=false): ${a.hr_quality_filtered.not_trusted}`);
lines.push(`- HR evidence points discarded (suspiciously flat): ${a.hr_quality_filtered.suspiciously_flat}`);
lines.push(`- Pace evidence points discarded (implausible, outside 3:00–9:30/km): ${a.pace_sanity_filtered}`);
lines.push(`- Interval workouts discarded (rep-block reconstruction index mismatch): ${a.rep_block_index_mismatch_discarded}`);
lines.push("");

writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
console.log(`table written: ${outPath}`);
