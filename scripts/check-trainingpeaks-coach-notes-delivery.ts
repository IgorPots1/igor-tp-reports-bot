import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function run(): void {
  const reportDeliverySource = readRepoFile("src/features/trainingpeaks/report-delivery.ts");
  const serviceSource = readRepoFile("src/features/trainingpeaks/service.ts");

  assert(
    !reportDeliverySource.includes("coachNotesJson") && !reportDeliverySource.includes("coach_notes_json"),
    "report-delivery must not reference coach_notes_json."
  );

  assert(
    reportDeliverySource.includes('Pick<TrainingPeaksWeeklyReport, "reportMarkdown" | "editedReportMarkdown">'),
    "getFinalTrainingPeaksReportMarkdown must only depend on athlete-facing markdown fields."
  );

  const getFinalBody =
    reportDeliverySource.match(
      /export function getFinalTrainingPeaksReportMarkdown\([\s\S]*?\n\}/
    )?.[0] ?? null;
  assert(getFinalBody, "getFinalTrainingPeaksReportMarkdown definition not found.");
  assert(!getFinalBody.includes("coach"), "getFinalTrainingPeaksReportMarkdown must not read coach notes.");

  const sendBody =
    reportDeliverySource.match(
      /export async function sendTrainingPeaksWeeklyReportToStudent\([\s\S]*?\n\}/
    )?.[0] ?? null;
  assert(sendBody, "sendTrainingPeaksWeeklyReportToStudent definition not found.");
  assert(!sendBody.includes("coach"), "sendTrainingPeaksWeeklyReportToStudent must not append coach notes.");

  const snapshotBody =
    serviceSource.match(/export async function getTrainingPeaksReportSnapshot\([\s\S]*?\n\}/)?.[0] ?? null;
  assert(snapshotBody, "getTrainingPeaksReportSnapshot definition not found.");
  assert(
    snapshotBody.includes("reportMarkdown") && !snapshotBody.includes("coachNotesJson"),
    "/tp_report snapshot must use reportMarkdown only."
  );

  console.log("check-trainingpeaks-coach-notes-delivery: ok");
}

run();
