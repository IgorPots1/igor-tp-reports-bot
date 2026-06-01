import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "playwright";

import type { StrengthWorkoutExerciseSpec, StrengthWorkoutRunSummary } from "./strength-workout-ui-writer.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const VISUAL_FIELD_EVIDENCE_BROWSER_SCRIPT_PATH = path.join(
  __dirname,
  "strength-visual-field-evidence.browser.js"
);

const VISUAL_FIELD_EVIDENCE_BROWSER_SCRIPT = readFileSync(VISUAL_FIELD_EVIDENCE_BROWSER_SCRIPT_PATH, "utf8");

export function assertVisualFieldEvidenceBrowserScriptIsSafe(): void {
  if (!VISUAL_FIELD_EVIDENCE_BROWSER_SCRIPT.includes("function browserCollectVisualFieldEvidence")) {
    throw new Error("Visual field browser script must define browserCollectVisualFieldEvidence.");
  }
  if (/\b__name\s*\(/.test(VISUAL_FIELD_EVIDENCE_BROWSER_SCRIPT)) {
    throw new Error("Visual field browser script must not call bundler __name helper.");
  }
}

type VisualEvidenceDetail = NonNullable<StrengthWorkoutRunSummary["visualFieldVerification"]>["beforeSave"]["details"][number];

export async function collectVisualFieldEvidence(
  page: Page,
  exercises: readonly StrengthWorkoutExerciseSpec[]
): Promise<NonNullable<StrengthWorkoutRunSummary["visualFieldVerification"]>["beforeSave"]> {
  const details = await page.evaluate(
    ({ script, entries }) => {
      const runner = new Function("input", `${script}\nreturn browserCollectVisualFieldEvidence(input);`);
      return runner({ entries }) as VisualEvidenceDetail[];
    },
    {
      script: VISUAL_FIELD_EVIDENCE_BROWSER_SCRIPT,
      entries: exercises,
    }
  );

  const fieldsVisible = details.every((row) => row.setsVisible && row.repsVisible && row.durationVisible);
  const notesVisible = details.every((row) => row.noteVisible);
  return { fieldsVisible, notesVisible, details };
}

