import * as actionDryRunTelegramCopyModule from "../../../src/features/trainingpeaks/action-dry-run-telegram-copy";

const actionDryRunTelegramCopy =
  actionDryRunTelegramCopyModule.default ?? actionDryRunTelegramCopyModule;

const buildCoachDryRunFailureNotificationLines =
  actionDryRunTelegramCopy.buildCoachDryRunFailureNotificationLines ??
  actionDryRunTelegramCopyModule.buildCoachDryRunFailureNotificationLines;

if (typeof buildCoachDryRunFailureNotificationLines !== "function") {
  throw new Error("buildCoachDryRunFailureNotificationLines must be available to tp-actions-once.");
}

const ambiguousLines = buildCoachDryRunFailureNotificationLines({
  studentName: "Gudkova Ekaterina",
  route: "13.06 → 14.06",
  dryRunResult: "ambiguous",
  sourceDate: "2026-06-13",
  candidates: [
    {
      title: "5 х 7 мин (на улице)",
      plannedDurationSec: 3600,
      rawTextSnippet: "5 х 7 мин (на улице) 01:00:00 92 TSS",
      sourceDate: "2026-06-13",
      score: 0.95,
    },
    {
      title: "Other",
      plannedDurationSec: 5051,
      plannedDistance: 3.5,
      rawTextSnippet: "Other 01:24:11 3.50 km 139 hrTSS",
      sourceDate: "2026-06-13",
      score: 0.85,
    },
  ],
});

if (!ambiguousLines.some((line) => line.includes("найдено несколько вариантов"))) {
  throw new Error("ambiguous dry-run copy smoke failed.");
}

const notFoundLines = buildCoachDryRunFailureNotificationLines({
  studentName: "Test Athlete",
  route: "13.06 → 14.06",
  dryRunResult: "not_found",
  sourceDate: "2026-06-13",
});

if (!notFoundLines.some((line) => line.includes("не нашёл подходящую тренировку"))) {
  throw new Error("not_found dry-run copy smoke failed.");
}

console.log("check-action-dry-run-telegram-copy-import: ok");
