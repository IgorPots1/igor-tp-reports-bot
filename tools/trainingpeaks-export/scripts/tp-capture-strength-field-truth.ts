import process from "node:process";

import { chromium } from "playwright";

import {
  type FinishedReason,
  REQUIRED_SAVE_CONFIRMATION,
  attachNetworkCapture,
  buildCheckpointPlan,
  buildHelpText,
  buildRunSummaryMarkdown,
  captureDomArtifact,
  deriveVerdict,
  ensureRunArtifacts,
  getRepoRelativePath,
  parseTruthCaptureArgs,
  profileDir,
  saveCheckpointScreenshot,
  saveDomArtifact,
  saveJson,
  saveText,
  sanitizeAthleteUrl,
  waitForCheckpointAction,
  waitForTypedConfirmation,
  type DomCaptureArtifact,
  type TruthCaptureLog,
} from "./lib/strength-field-truth-capture.ts";

function isDurationExceededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("timed out");
}

function isFatalBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("target page, context or browser has been closed") ||
    normalized.includes("browser has been closed") ||
    normalized.includes("context closed")
  );
}

async function main(): Promise<void> {
  const args = parseTruthCaptureArgs(process.argv.slice(2));
  if (args.help) {
    console.log(buildHelpText());
    return;
  }

  const artifacts = await ensureRunArtifacts();
  const deadlineAtMs = Date.now() + args.durationSeconds * 1000;
  const networkState = {
    currentCheckpoint: "startup",
    events: [] as TruthCaptureLog["networkEvents"],
  };
  const checkpointRecords: TruthCaptureLog["checkpoints"] = [];
  const domArtifacts: DomCaptureArtifact[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  let finishedReason: FinishedReason = "completed_all_checkpoints";

  console.log("[tp-capture-strength-field-truth] mode: diagnostic-only truth capture");
  console.log(`[tp-capture-strength-field-truth] athlete: ${sanitizeAthleteUrl(args.athleteUrl)}`);
  console.log(`[tp-capture-strength-field-truth] date: ${args.date}`);
  console.log(`[tp-capture-strength-field-truth] run dir: ${artifacts.runDir}`);
  console.log("[tp-capture-strength-field-truth] no field writing and no Save click will be performed by automation.");
  console.log("");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });
  attachNetworkCapture(context, networkState);

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(args.athleteUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.bringToFront();
    await page.waitForTimeout(1500);

    const checkpoints = buildCheckpointPlan(args.allowSaveCapture);
    for (const [index, checkpoint] of checkpoints.entries()) {
      if (Date.now() > deadlineAtMs) {
        finishedReason = "duration_exceeded";
        notes.push(`Stopped before ${checkpoint.id}: total duration budget exceeded.`);
        break;
      }
      networkState.currentCheckpoint = checkpoint.id;
      const record = {
        id: checkpoint.id,
        prompt: checkpoint.prompt,
        startedAt: new Date().toISOString(),
        required: !checkpoint.optional,
        optional: Boolean(checkpoint.optional),
        attemptCount: 0,
        errors: [] as string[],
      };
      checkpointRecords.push(record);

      if (checkpoint.id === "checkpoint-07-after-save") {
        console.log("");
        console.log("[tp-capture-strength-field-truth] save-capture phase requested.");
        await waitForTypedConfirmation(
          `Type exactly "${REQUIRED_SAVE_CONFIRMATION}" to confirm that you want to capture a manual Save phase.`,
          REQUIRED_SAVE_CONFIRMATION,
          deadlineAtMs
        );
      }

      let moveToNextCheckpoint = false;
      while (!moveToNextCheckpoint) {
        if (Date.now() > deadlineAtMs) {
          finishedReason = "duration_exceeded";
          notes.push(`Stopped during ${checkpoint.id}: total duration budget exceeded.`);
          moveToNextCheckpoint = true;
          break;
        }
        record.attemptCount = (record.attemptCount ?? 0) + 1;
        const action = await waitForCheckpointAction(checkpoint.prompt, deadlineAtMs);

        if (action === "retry") {
          console.log(`[tp-capture-strength-field-truth] retry ${checkpoint.id}`);
          continue;
        }

        if (action === "quit") {
          record.action = "quit";
          record.completedAt = new Date().toISOString();
          finishedReason = "user_quit";
          moveToNextCheckpoint = true;
          break;
        }

        if (action === "skip") {
          if (!checkpoint.optional) {
            console.log(`[tp-capture-strength-field-truth] ${checkpoint.id} is required. Skip is not allowed.`);
            continue;
          }
          record.action = "skipped";
          record.skipped = true;
          record.completedAt = new Date().toISOString();
          moveToNextCheckpoint = true;
          console.log(`Checkpoint ${index + 1} skipped (optional).`);
          console.log(`- next: ${checkpoints[index + 1]?.id ?? "run summary"}`);
          break;
        }

        try {
          await page.waitForTimeout(600);
          const screenshotAbsolute = await saveCheckpointScreenshot(page, artifacts.screenshotsDir, checkpoint.screenshotName);
          record.screenshotPath = getRepoRelativePath(screenshotAbsolute);
          record.domStatus = "not_attempted";
          let domArtifact: DomCaptureArtifact | undefined;
          let domAbsolute: string | undefined;
          try {
            domArtifact = await captureDomArtifact(page, checkpoint.id);
            domAbsolute = await saveDomArtifact(artifacts.domDir, checkpoint.domFileName, domArtifact);
            record.domStatus = "captured";
          } catch (domError) {
            const domMessage = domError instanceof Error ? domError.message : String(domError);
            record.domStatus = "failed";
            record.errors?.push(`DOM capture failed: ${domMessage}`);
            errors.push(`${checkpoint.id}: DOM capture failed: ${domMessage}`);
          }

          record.action = record.screenshotPath || domAbsolute ? "captured" : undefined;
          record.completedAt = new Date().toISOString();
          record.domPath = domAbsolute ? getRepoRelativePath(domAbsolute) : undefined;
          if (domArtifact) {
            domArtifacts.push(domArtifact);
            record.dialogFound = domArtifact.dialogFound;
            record.exerciseOccurrenceCount = domArtifact.dialogs.reduce(
              (sum, dialog) => sum + dialog.exactExerciseNameOccurrences.length + dialog.exactValueTokenOccurrences.length,
              0
            );
            record.inputControlCount = domArtifact.dialogs.reduce(
              (sum, dialog) => sum + dialog.inputs.length + dialog.textareas.length,
              0
            );
          } else {
            record.dialogFound = undefined;
            record.exerciseOccurrenceCount = 0;
            record.inputControlCount = 0;
          }
          record.networkEventCount = networkState.events.length;

          if (!domArtifact) {
            notes.push(`${checkpoint.id}: screenshot captured but DOM capture failed.`);
          } else if (!domArtifact.dialogFound) {
            notes.push(`${checkpoint.id}: visible [role="dialog"] was not detected at capture time.`);
          }
          if (domArtifact?.focusedControl?.value) {
            notes.push(`${checkpoint.id}: focused control value="${domArtifact.focusedControl.value}".`);
          }

          console.log(`Checkpoint ${index + 1} captured.`);
          console.log(`- dialogFound: ${domArtifact ? (domArtifact.dialogFound ? "yes" : "no") : "n/a (dom failed)"}`);
          console.log(`- domStatus: ${record.domStatus}`);
          console.log(`- exercise occurrences: ${record.exerciseOccurrenceCount}`);
          console.log(`- screenshots: ${record.screenshotPath}`);
          console.log(`- dom: ${record.domPath ?? "n/a"}`);
          console.log(`- next: ${checkpoints[index + 1]?.id ?? "run summary"}`);
          moveToNextCheckpoint = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          record.errors?.push(message);
          errors.push(`${checkpoint.id}: ${message}`);
          record.completedAt = new Date().toISOString();
          record.action = undefined;
          record.domStatus = "failed";
          record.networkEventCount = networkState.events.length;
          console.log(`Checkpoint ${index + 1} capture failed: ${message}`);
          console.log(`- next: ${checkpoints[index + 1]?.id ?? "run summary"}`);
          if (isFatalBrowserError(error)) {
            finishedReason = "fatal_error";
            moveToNextCheckpoint = true;
            break;
          }
          if (isDurationExceededError(error)) {
            finishedReason = "duration_exceeded";
            moveToNextCheckpoint = true;
            break;
          }
          // Non-fatal Playwright errors must not stop the checkpoint flow.
          moveToNextCheckpoint = true;
        }
      }

      if (finishedReason === "user_quit" || finishedReason === "duration_exceeded" || finishedReason === "fatal_error") {
        break;
      }
    }

    await page.waitForTimeout(1000);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    if (isDurationExceededError(error)) {
      finishedReason = "duration_exceeded";
    } else {
      finishedReason = "fatal_error";
    }
  } finally {
    await context.close().catch(() => {});
  }

  await saveJson(artifacts.networkEventsPath, {
    runAt: new Date().toISOString(),
    redactedHeaders: true,
    events: networkState.events,
  });

  const initialLog: TruthCaptureLog = {
    runAt: new Date().toISOString(),
    runDir: getRepoRelativePath(artifacts.runDir),
    athleteUrlRedacted: sanitizeAthleteUrl(args.athleteUrl),
    date: args.date,
    manual: args.manual,
    allowSaveCapture: args.allowSaveCapture,
    finishedReason,
    liveCaptureRan: checkpointRecords.length > 0,
    checkpoints: checkpointRecords,
    screenshots: checkpointRecords
      .map((record) => record.screenshotPath)
      .filter((entry): entry is string => Boolean(entry)),
    domArtifacts: checkpointRecords
      .map((record) => record.domPath)
      .filter((entry): entry is string => Boolean(entry)),
    networkEventsPath: getRepoRelativePath(artifacts.networkEventsPath),
    networkEventCount: networkState.events.length,
    networkEvents: networkState.events,
    verdict: "capture_incomplete",
    notes,
    errors,
  };

  const verdict = deriveVerdict(initialLog, domArtifacts);
  const finalLog: TruthCaptureLog = { ...initialLog, verdict };
  const summaryMarkdown = buildRunSummaryMarkdown(finalLog, domArtifacts);

  await saveText(artifacts.summaryPath, summaryMarkdown);
  await saveJson(artifacts.logPath, finalLog);

  console.log("");
  console.log("[tp-capture-strength-field-truth] complete.");
  console.log(`- summary: ${getRepoRelativePath(artifacts.summaryPath)}`);
  console.log(`- log: ${getRepoRelativePath(artifacts.logPath)}`);
  console.log(`- screenshots: ${getRepoRelativePath(artifacts.screenshotsDir)}`);
  console.log(`- dom: ${getRepoRelativePath(artifacts.domDir)}`);
  console.log(`- network: ${getRepoRelativePath(artifacts.networkEventsPath)}`);
  console.log(`- verdict: ${verdict}`);
}

main().catch((error: unknown) => {
  console.error("tp-capture-strength-field-truth failed.");
  console.error(error);
  process.exit(1);
});
