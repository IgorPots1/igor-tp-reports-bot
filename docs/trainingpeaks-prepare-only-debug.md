# TrainingPeaks prepare-only debug loop

## Goal

Stabilize the Playwright-only TrainingPeaks move_workout prepare-only probe.

The goal is NOT to move a workout.
The goal is to reach a safe prepare-only state:

- revalidationPassed = true
- athleteIdentityOk = true
- candidateFingerprintOk = true
- datePickerOpened = true
- targetDateVisible = true
- targetDateClickCandidateFound = true if possible
- targetDateSelectionAttempted = true only if the target-day candidate is unambiguous
- targetDateSelectionConfirmed = true only if visible evidence confirms target date selection
- mutationOccurred = false
- executePreparedMove remains blocked

Best outcome:

status = "ready_to_save"

Acceptable intermediate outcome:

status = "needs_manual" with a clear failureReason and complete diagnostics.

## Current known state

The TrainingPeaks flow already works through:

- Telegram action creation
- coach approve
- dry-run
- execute_pending
- real-mode revalidation
- athlete identity validation
- candidate fingerprint validation
- opening workout modal
- clicking the date header
- detecting the datepicker via body_text_multisignal_fallback

Known latest successful signals:

- datePickerOpened = true
- targetDateVisible = true
- datePickerDetectionStrategy = "body_text_multisignal_fallback"
- visibleMonth = "May"
- visibleYear = "2026"
- selectedSourceDayVisible = true
- datepickerDomDebugPath is non-null
- mutationOccurred = false

Recent problems:

- close datepicker must not be a blocking step
- targetDateClickCandidateFound may still be false
- DOM debug / candidate extraction must stay lightweight and non-fatal
- page/context closed errors must not crash the probe
- no Save path may ever be added

## Hard safety rules

Never do any of the following:

- Do NOT click Save
- Do NOT click Save & Close
- Do NOT click Delete
- Do NOT click Cut
- Do NOT drag/drop workout cards
- Do NOT mutate TrainingPeaks
- Do NOT transition actions to completed
- Do NOT manually edit Supabase statuses
- Do NOT add Stagehand
- Do NOT add Browser Use
- Do NOT add Hermes
- Do NOT add OpenAI Computer Use
- Do NOT add Claude Computer Use
- Do NOT change Telegram flow
- Do NOT change parser behavior
- Do NOT change reports
- Do NOT change Supabase schema
- Do NOT change student linking

executePreparedMove must remain blocked with the exact message:

"Real move execution remains blocked until prepareMoveWorkout has stable ready_to_save validation."

## Allowed changes

You may change only:

- tools/trainingpeaks-export/scripts/tp-actions-once.ts
- tools/trainingpeaks-export/scripts/lib/playwright-only-trainingpeaks-driver.ts
- tools/trainingpeaks-export/scripts/lib/trainingpeaks-driver.ts

Only if needed.

Allowed areas:

- Playwright prepare-only probe logic
- datepicker detection
- DOM debug extraction
- target-day click-candidate detection
- non-mutating target-day click inside unsaved datepicker UI, only if unambiguous
- diagnostics and artifact logging
- failure reason cleanup
- minimal smoke/debug helpers

## Runtime command

Use this command for prepare-only runtime validation:

cd tools/trainingpeaks-export
TP_ACTIONS_REAL_EXECUTION=true npm run tp-actions-once -- --execute-real --prepare-only

If it says:

No execute_pending TrainingPeaks actions ready for real-mode revalidation.

then stop and report that user must create a fresh Telegram move action, approve it, run dry-run, and click "✅ Выполнить перенос".

Do NOT manually edit database statuses.

## Lint/build commands

Run from repo root:

npm run lint
npm run build

## Runtime artifacts to inspect

After each prepare-only run, inspect:

- prepareOnlySummary
- datepicker_dom_debug.json
- probe2_datepicker_opened.png
- probe2_after_target_day_click.png if created
- probe_timeout.png if created

## Iteration loop

You may run up to 5 iterations.

Each iteration:

1. Read prepareOnlySummary.
2. Identify the first real blocker.
3. Make the smallest safe code change.
4. Run lint/build.
5. Run prepare-only if execute_pending exists.
6. Inspect artifacts.
7. Continue only if the next fix is clearly within allowed scope.

Stop immediately if:

- Save / Save & Close would be needed
- TrainingPeaks mutation would be required
- action could become completed
- the next fix requires Stagehand/Browser Use/Hermes
- no execute_pending action exists
- you hit 5 iterations

## Success criteria

Best success:

- status = "ready_to_save"
- datePickerOpened = true
- targetDateVisible = true
- targetDateClickCandidateFound = true
- targetDateSelectionAttempted = true
- targetDateSelectionConfirmed = true
- mutationOccurred = false
- executePreparedMove.blocked = true

Acceptable success:

- datePickerOpened = true
- targetDateVisible = true
- targetDateClickCandidateFound = true
- targetDateSelectionAttempted = false
- mutationOccurred = false
- clear failureReason explaining why click was not attempted

## Final report format

Report:

- files changed
- exact commands run
- lint/build status
- exact prepareOnlySummary if runtime ran
- whether close datepicker can still cause timeout
- whether targetDateClickCandidateFound is true
- whether targetDateSelectionAttempted is true
- whether targetDateSelectionConfirmed is true
- whether mutationOccurred is false
- whether Save / Save & Close remain impossible
- recommended next step
