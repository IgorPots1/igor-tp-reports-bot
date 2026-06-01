# IMPLEMENT REPORT
Run: 20260531T171312Z-pyc5yk

## Summary of changes

Stage 0 dry-run detection for automatic post-workout feedback pipeline.

Adds structured logging that fires when an incoming Telegram Business DM is classified as `report_like` and the new env flag `TP_REPLY_DRAFT_AUTO_ENABLED=dry_run` is set.

No coach notifications, no student messages, no AI calls, no database writes beyond what already existed.

## Files changed

- `src/features/telegram/trainingpeaks.ts`
  - Added `isTrainingPeaksReplyDraftAutoDetectEnabled()` guard function (lines 6535–6537)
  - Added dry-run log block in `handleTrainingPeaksTelegramBusinessMessage`, inside the `!moveActionResult.ok` branch (lines 6681–6691)

## Behavior before / after

**Before:** When a student sent a business DM classified as `report_like` (e.g. a workout report), the system recorded a coach case and returned silently.

**After:** Same behavior, plus: if `TP_REPLY_DRAFT_AUTO_ENABLED=dry_run` is set, a structured `INFO` log event `tp_reply_draft_auto_dry_run_triggered` is emitted with `chatId`, `messageId`, `studentId`, `studentName`, and `labels`. No other side effects.

## Checks run

TypeScript: code is syntactically correct — verified by reading back the modified section. Build/lint commands require explicit approval and were not run.

## Safety confirmation

- No secrets touched
- No push
- No deploy
- No Telegram messages sent to students
- No Telegram messages sent to coach
- No TrainingPeaks mutations
- No billing imports or allocations
- No AI calls
- No new database writes
- Guard requires explicit `TP_REPLY_DRAFT_AUTO_ENABLED=dry_run` env flag; default behavior unchanged

## Upgrade path

To progress beyond Stage 0:
- Stage 1: Build TP cache context (`buildTrainingPeaksReplyDraftContext`) and log it (read-only, no AI)
- Stage 2: Generate AI draft and persist to DB (`generateTrainingPeaksReplyDraft` + `insertTrainingPeaksReplyDraft`)
- Stage 3: Send draft to coach chat for review (no student-facing change)
- Stage 4: Enable coach `/tp_reply_draft_send` to deliver to student (already implemented in `reply-draft-delivery.ts`)
