import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Locator } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const STRENGTH_WORKOUT_FIELD_WRITER_BROWSER_SCRIPT_PATH = path.join(
  __dirname,
  "strength-workout-field-writer.browser.js"
);

const STRENGTH_WORKOUT_FIELD_WRITER_BROWSER_SCRIPT = readFileSync(
  STRENGTH_WORKOUT_FIELD_WRITER_BROWSER_SCRIPT_PATH,
  "utf8"
);

export function assertStrengthWorkoutFieldWriterBrowserScriptIsSafe(): void {
  if (!STRENGTH_WORKOUT_FIELD_WRITER_BROWSER_SCRIPT.includes("function browserStrengthFieldAction")) {
    throw new Error("Strength field writer browser script must define browserStrengthFieldAction.");
  }
  if (/\b__name\s*\(/.test(STRENGTH_WORKOUT_FIELD_WRITER_BROWSER_SCRIPT)) {
    throw new Error("Strength field writer browser script must not call bundler __name helper.");
  }
}

export type StrengthWriterBrowserWritePayload = {
  kind: "sets" | "reps" | "duration" | "coachNote";
  value: string;
  labelTokens: string[];
  placeholderTokens: string[];
  ariaTokens: string[];
  inputTypeAllowList?: string[];
  allowTextarea?: boolean;
  allowContentEditable?: boolean;
};

export type StrengthWriterBrowserWriteResult = {
  ok: boolean;
  detail?: string;
  readBack?: string;
  selectorHint?: string;
};

export async function browserWriteSemanticField(
  scope: Locator,
  payload: StrengthWriterBrowserWritePayload
): Promise<StrengthWriterBrowserWriteResult> {
  return scope.evaluate(
    (host, input) => {
      const runner = new Function(
        "element",
        "input",
        `${input.script}\nreturn browserStrengthFieldAction(element, input);`
      );
      return runner(host, { action: "write", payload: input.payload }) as StrengthWriterBrowserWriteResult;
    },
    { script: STRENGTH_WORKOUT_FIELD_WRITER_BROWSER_SCRIPT, payload }
  );
}

export async function browserIsValueVisibleInBlock(
  scope: Locator,
  expectedVariants: string[]
): Promise<boolean> {
  const result = await scope.evaluate(
    (host, input) => {
      const runner = new Function(
        "element",
        "input",
        `${input.script}\nreturn browserStrengthFieldAction(element, input);`
      );
      return runner(host, { action: "isVisible", payload: { expectedVariants: input.expectedVariants } }) as {
        ok: boolean;
        visible?: boolean;
      };
    },
    { script: STRENGTH_WORKOUT_FIELD_WRITER_BROWSER_SCRIPT, expectedVariants }
  );
  return Boolean(result?.visible);
}
