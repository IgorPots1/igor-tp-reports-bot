// Comparison key — a canonical token for a run's interval STRUCTURE, derived
// from the plan's repeated blocks. It is the class label the comparison base
// groups on ("same session" is decided by STRUCTURE, never by the workout
// title: coaches write "7х5", "7 х 5 мин", "5 х 5 + 1,5 мин" for the same
// session — titles differ, structure matches).
//
// Same "repeat >= 2" rule as countRepeatedActiveSteps() in
// tools/.../lib/fit-lap-work-detection.ts: warm-up / cool-down / standalone
// steps carry a repetition count of 1 and are excluded on that basis alone — no
// name matching, no intensityClass guessing beyond "is this step active work".
// That rule is validated at 92% against titled workouts; this module reuses the
// rule but produces a KEY rather than a count. The two live apart on purpose:
// the count is a plan cross-check inside the FIT ingest (tools/), the key is a
// serverless comparison concern (src/), and src/ must not depend on tools/.
//
// Format (design doc "2. A. Матчер сравнимых"):
//   one active step per cycle   -> "7x[300second]"
//   several active per cycle     -> "7x[400meter/200meter]"
//   several repeated blocks      -> "3x[400meter]+4x[200meter]" (structure order)
//   no repeated block            -> null (not an interval workout — matcher is silent)
//
// Any active work step inside a repeated block that lacks a usable plan length
// (value + unit) makes the structure non-keyable -> null. That is deliberate:
// without the step length we cannot form the ±10% length equivalence tier 2
// needs, and a guessed key would compare unlike sessions. "Сомневаешься → молчи."

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// source_snapshot.structure is either the parsed TP structure object
// ({structure: [...], ...}), a bare array, or a {summaryOnly:true} fallback when
// parsing failed. Only the first two are usable. (Mirrors extractStructureArray
// in fit-lap-work-detection.ts.)
function extractStructureArray(structureSnapshot: unknown): unknown[] | null {
  if (Array.isArray(structureSnapshot)) return structureSnapshot;
  if (isRecord(structureSnapshot) && Array.isArray(structureSnapshot.structure)) {
    return structureSnapshot.structure;
  }
  return null;
}

export type ComparisonStep = { len: number; unit: string };
export type ComparisonBlock = { repeat: number; steps: ComparisonStep[] };
export type ParsedComparisonKey = { blocks: ComparisonBlock[] };

// Rep lengths in TP structure are whole seconds or whole meters; rounding keeps
// the exact-match key stable (300 vs 300.0) and makes the tier-2 ±10% band
// robust. A `null` return anywhere below means "not deterministically keyable".
function collectBlocks(nodes: unknown[]): ComparisonBlock[] | null {
  const blocks: ComparisonBlock[] = [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const repeat = toPositiveInt(isRecord(node.length) ? node.length.value : null) ?? 1;
    if (repeat < 2) continue; // warm-up / cool-down / standalone — never a rep

    const innerSteps = Array.isArray(node.steps) ? node.steps : [];
    const steps: ComparisonStep[] = [];
    for (const inner of innerSteps) {
      if (!isRecord(inner)) continue;

      // Nested repetition block (a repeat inside a repeat). Rare, but represent
      // it faithfully: append it as its own block with the repeats multiplied,
      // in structure order.
      if (Array.isArray(inner.steps)) {
        const nested = collectBlocks([inner]);
        if (nested === null) return null;
        for (const nestedBlock of nested) {
          blocks.push({ repeat: nestedBlock.repeat * repeat, steps: nestedBlock.steps });
        }
        continue;
      }

      const intensityClass = typeof inner.intensityClass === "string" ? inner.intensityClass.toLowerCase() : null;
      if (intensityClass !== "active") continue; // recovery/rest steps don't define the work class

      const innerLength = isRecord(inner.length) ? inner.length : null;
      const unit = innerLength && typeof innerLength.unit === "string" ? innerLength.unit : null;
      const value = innerLength ? toFiniteNumber(innerLength.value) : null;
      if (unit === null || value === null || value <= 0) {
        // An active work step with no usable plan length — the structure can't
        // be keyed without inventing a length. Bail to null (matcher stays silent).
        return null;
      }
      steps.push({ len: Math.round(value), unit });
    }

    if (steps.length > 0) blocks.push({ repeat, steps });
  }
  return blocks;
}

function formatBlock(block: ComparisonBlock): string {
  const inner = block.steps.map((step) => `${step.len}${step.unit}`).join("/");
  return `${block.repeat}x[${inner}]`;
}

/**
 * Canonical structure key for a run, or null if the plan has no repeated block
 * (or a rep without a usable length). Pure — safe to call from both the FIT
 * ingest (tools/) and the serverless matcher (src/).
 */
export function computeComparisonKey(structureSnapshot: unknown): string | null {
  const structureArray = extractStructureArray(structureSnapshot);
  if (!structureArray || structureArray.length === 0) return null;
  const blocks = collectBlocks(structureArray);
  if (blocks === null || blocks.length === 0) return null;
  return blocks.map(formatBlock).join("+");
}

const BLOCK_RE = /^(\d+)x\[([^\]]+)\]$/;
const STEP_RE = /^(\d+)([a-zA-Z]+)$/;

/**
 * Inverse of computeComparisonKey: parses a key string back into its blocks so
 * the matcher can compare counts/lengths numerically (tier 2 = ±10% length,
 * ±1 count). Returns null on any malformed token.
 */
export function parseComparisonKey(key: string | null | undefined): ParsedComparisonKey | null {
  if (!key) return null;
  const blocks: ComparisonBlock[] = [];
  for (const blockToken of key.split("+")) {
    const blockMatch = BLOCK_RE.exec(blockToken);
    if (!blockMatch) return null;
    const repeat = Number.parseInt(blockMatch[1]!, 10);
    if (!Number.isFinite(repeat) || repeat < 2) return null;
    const steps: ComparisonStep[] = [];
    for (const stepToken of blockMatch[2]!.split("/")) {
      const stepMatch = STEP_RE.exec(stepToken);
      if (!stepMatch) return null;
      const len = Number.parseInt(stepMatch[1]!, 10);
      if (!Number.isFinite(len) || len <= 0) return null;
      steps.push({ len, unit: stepMatch[2]! });
    }
    if (steps.length === 0) return null;
    blocks.push({ repeat, steps });
  }
  return blocks.length > 0 ? { blocks } : null;
}

/** A single-block key is exactly one repeated block with exactly one active step. */
export function isSingleBlockKey(parsed: ParsedComparisonKey | null): boolean {
  return parsed !== null && parsed.blocks.length === 1 && parsed.blocks[0]!.steps.length === 1;
}
