# Operational Signals AI Review Layer v0

Date: 2026-06-10
Project: `igor-tp-reports-bot` / TrainingPeaks Coach OS
Status: design only, read-only first

## Goal

AI Signal Review Layer v0 is a read-only reviewer for `/tp_signals` and operational signals. It should improve quality control for ambiguous Telegram observations, stale schedule signals, illness recovery, category mismatch, duplicate episodes, and weak summaries, but it must not execute lifecycle actions itself.

The execution model is:

```text
deterministic pipeline creates candidates/signals
AI reviews evidence and suggests what to do
deterministic safety layer decides what is allowed
coach confirms risky actions
```

AI must not write to the database, send Telegram messages, mutate TrainingPeaks, close signals directly, or override deterministic high-risk safety.

## Current Pipeline

The current operational-signal path is deterministic:

```text
Telegram observations
  -> classifier
  -> inline operational-signal persistence
  -> operational signals DB
  -> lifecycle/display evidence
  -> /tp_signals snapshot
  -> Telegram rendering
```

Relevant code:

- `src/features/trainingpeaks/coach-operational-signals.ts`: rule classifier. It classifies `ObservationLike` into `OperationalClassification` / candidates, including health, pain/injury, schedule, move, race/load context, family illness stripping, completed-run reflection suppression, visibility hints, summaries, and coach-review flags.
- `src/features/trainingpeaks/operational-signals-inline.ts`: write path. It calls `classifyCoachOperationalSignals`, keeps actionable and persistable signal types, chooses the richest candidate per signal type, builds a dedupe key, upserts `trainingpeaks_student_operational_signals`, and consumes superseded health lifecycle signals.
- `src/features/trainingpeaks/repository.ts`: DB access for operational signals, observations, lifecycle transitions, false-positive suppression, recovery updates, and TrainingPeaks workout cache.
- `src/features/trainingpeaks/service.ts`: read/display path. It loads active signals, students, move actions, recent observations, and TP workout cache; builds display evidence; evaluates lifecycle/display state; applies deterministic display suppression; builds the `/tp_signals` snapshot; formats Telegram text.
- `src/features/trainingpeaks/operational-signal-false-positive-suppression.ts`: guarded suppression precedent. It uses inferred false-positive reasons, dry-run fingerprints, safety validation, and apply tokens, with coach actor semantics.
- `scripts/diagnose-trainingpeaks-signals-live-expanded.ts`: read-oriented triage precedent. It joins signals, observations, TP evidence, lifecycle evaluation, display output, hidden reasons, and proposed fixes.
- `scripts/check-coach-operational-signals.ts` and `scripts/check-trainingpeaks-operational-signals-simple-output.ts`: deterministic regression checks for classifier and compact `/tp_signals` output.

The important design constraint is that the inline write path should remain deterministic in v0. The AI reviewer should sit on the read/review side, after evidence construction and before a review surface.

## Proposed Architecture

### Layer 0: Deterministic Parser

The existing parser stays authoritative for cheap detection, source attribution, dedupe keys, hard exclusions, lifecycle checks, and TP completion evidence.

It should continue to own:

- keyword and rule detection;
- source observation attribution;
- dedupe key construction;
- family-member illness exclusions;
- completed-run reflection versus future schedule constraint checks;
- pain/injury separation from illness;
- stale schedule and clean recovery display suppression;
- lifecycle state and TP completion checks.

### Layer 1: Evidence Pack Builder

Add a read-only helper that builds a complete evidence pack for each signal or candidate. It should reuse the same source data as display/lifecycle code and should prefer full normalized text when available, not only the current `text_preview` / 120-char preview.

Recommended type:

```ts
export type OperationalSignalAiEvidencePack = {
  student: {
    id: string;
    name: string;
    slug: string;
  };
  currentSignal?: {
    id: string;
    type: string;
    status: string;
    lifecycleState?: string | null;
    displaySummary?: string | null;
    latestSummary?: string | null;
    createdAt: string;
    updatedAt: string;
    validFrom?: string | null;
    validUntil?: string | null;
  };
  recentObservations: Array<{
    observationId: string;
    observedAt: string;
    sourceType: string;
    text: string;
    labels?: string[];
    isAfterCompletion?: boolean;
  }>;
  tpEvidence: {
    latestRunningCompletionAfterOpen?: {
      workoutId: string;
      date: string;
      title: string;
      completedAt?: string | null;
      confidence: "low" | "medium" | "high";
    };
    plannedWorkouts?: Array<{
      workoutId: string;
      date: string;
      title: string;
      isCompleted: boolean;
    }>;
  };
  deterministicVerdict: {
    category: string;
    visibleInTpSignals: boolean;
    hiddenReason?: string;
    lifecycleRecommendation?: string;
    reasonCodes?: string[];
  };
};
```

Recommended sources:

- signal row: `TrainingPeaksStudentOperationalSignal`;
- effective display fields: `resolveEffectiveOperationalSignalForDisplay`;
- final display item / hidden reason: `buildTrainingPeaksOperationalSignalsSnapshotFromSignals` and `buildOperationalSignalItemFromSignal` behavior;
- display evidence: `buildOperationalSignalDisplayEvidenceMap`;
- recent observations: `listTrainingPeaksTelegramContextObservationsForStudent`;
- TP evidence: `listTrainingPeaksWorkoutCacheForStudentDateRange`;
- deterministic lifecycle: existing lifecycle runtime and service helpers.

The pack should include enough context for the reviewer to decide between `none`, illness, pain/injury, schedule, completed workout reflection, and load adjustment request. It should also include whether an observation happened after a reliable TP completion because this is central to clean-recovery versus post-run negative cases.

### Layer 2: AI Reviewer

The AI reviewer receives one evidence pack and returns JSON only. It should not receive credentials, mutable DB handles, Telegram bot clients, or TrainingPeaks writer APIs.

Recommended output:

```ts
export type OperationalSignalAiReview = {
  recommendedCategory:
    | "illness_recovery"
    | "pain_injury"
    | "schedule_constraint"
    | "completed_workout_reflection"
    | "load_adjustment_request"
    | "nutrition"
    | "none";

  severity: "low" | "medium" | "high";

  shouldShowInTpSignals: boolean;

  summaryRu: string;

  coachActionRu: string;

  lifecycleRecommendation:
    | "keep_visible"
    | "hide_as_false_positive"
    | "close_candidate"
    | "monitoring"
    | "reclassify"
    | "needs_manual_review";

  confidence: number;

  reasons: string[];

  sourceObservationIds: string[];

  safetyFlags: Array<
    | "medical_context"
    | "pregnancy_context"
    | "post_run_negative"
    | "injury_pain"
    | "ambiguous_source"
    | "truncated_source"
    | "missing_tp_evidence"
  >;
};
```

Validation rules:

- parse as JSON only;
- validate by schema before use;
- reject unknown categories, lifecycle recommendations, severity values, and safety flags;
- require `sourceObservationIds` to be non-empty unless category is `none` and the evidence pack has no current signal;
- clamp or reject confidence outside `0..1`;
- require short, coach-facing Russian strings for `summaryRu` and `coachActionRu`;
- mark `truncated_source` when only previews were available.

### Layer 3: Deterministic Safety Layer

AI can recommend `hide`, `close`, `reclassify`, or `monitoring`, but deterministic safety decides what can be auto-applied or shown as a coach-confirmable action.

Allowed in v0:

- AI suggests hide/close and deterministic rules confirm a known false positive.
- AI suggests close illness recovery and deterministic evidence confirms a clean running completion after signal open, no negative observation after completion, not pain/injury, not schedule pause, not return-to-run, and not stale-needs-review.
- AI suggests stale generic schedule hide and deterministic display already hides it as `stale_generic_schedule_unavailability` or expired schedule.
- AI suggests family-member illness false positive and deterministic `isFamilyMemberIllnessOnlyContext` confirms athlete is not sick.
- AI suggests completed-run reflection instead of schedule constraint and deterministic `isCompletedRunReflectionNotScheduleConstraint` confirms it.

Forbidden in v0:

- auto-close pain/injury;
- auto-hide pain/injury;
- auto-close pregnancy, surgery, acute medical, fever-after-run, or ambiguous medical contexts;
- use AI as the only evidence for closing, hiding, or reclassifying;
- mutate DB, Telegram, or TrainingPeaks from the AI review step;
- apply an AI suggestion when confidence is low, source text is truncated, TP evidence is missing for a recovery decision, or source observation ids are absent.

Manual coach review required:

- pain/injury evidence exists, even if AI says low severity;
- fever, weakness, dizziness, worsening, post-run negative, or negative observation after completion;
- pregnancy, surgery, doctor/medical context;
- ambiguous source attribution or mixed family/athlete illness;
- category mismatch between deterministic and AI review;
- load adjustment request that implies changing plan intensity/volume;
- duplicate illness episodes where the correct merge target is unclear;
- stale schedule where the dates cannot be deterministically resolved.

### Layer 4: Review Surface

Do not overload `/tp_signals` in v0. Keep `/tp_signals` as the compact deterministic morning summary.

Possible review surfaces:

- `/tp_signals_review`;
- admin tab `Operational Signals QA`;
- generated diagnostic report under `reports/operational-signals-ai-review/<timestamp>/`.

Recommended sections:

- AI close candidates;
- possible false positives;
- stale schedule signals;
- category mismatch;
- duplicate illness episodes;
- weak or ambiguous signals;
- load adjustment requests;
- pain/injury manual-review queue.

Each review item should show the current deterministic display, source observations, TP evidence, AI recommendation, safety verdict, and whether any action is auto-eligible or coach-confirm-only.

## First Read-Only Diagnostic

First implementation should be a diagnostic script, not production AI:

```bash
npm run diagnose:operational-signals-ai-review -- --limit 20
npm run diagnose:operational-signals-ai-review -- --student Vasileva
```

Proposed behavior:

1. Load active operational signals, including visible and deterministically hidden items.
2. Build evidence packs from signals, recent observations, display evidence, lifecycle evidence, and TP workout cache.
3. If an API key and explicit opt-in flag are configured, call the model; otherwise output deterministic placeholders.
4. Validate AI JSON when model calls are enabled.
5. Run deterministic safety gating after AI review.
6. Save JSON and Markdown reports under `reports/operational-signals-ai-review/<timestamp>/`.
7. Never write DB.
8. Never send Telegram.
9. Never mutate TrainingPeaks.

Suggested CLI:

```text
--limit 20
--student <query>
--as-of YYYY-MM-DD
--include-hidden
--json
--call-ai
```

`--call-ai` should be explicit. Without it, the script should produce evidence packs and placeholder reviews so that diagnostics remain safe in local and CI contexts.

Suggested report fields:

- student;
- current signal;
- visible/hidden deterministic display verdict;
- recent raw messages;
- TP completion and planned workout evidence;
- deterministic lifecycle recommendation;
- AI recommendation or placeholder;
- safety verdict;
- proposed display text;
- reason codes and source observation ids.

## Cost and Model Routing

Do not call AI for every Telegram message in v0.

Call AI only for:

- visible `/tp_signals` items;
- deterministic close candidates;
- stale generic schedule signals;
- false-positive candidates;
- category mismatch candidates;
- low-confidence classifier outputs;
- duplicate health episodes;
- signals with weak summaries or `requires_coach_review`.

Batching and caching:

- default maximum: 20 signals per diagnostic run;
- cache by `signal.updated_at` plus stable evidence hash;
- invalidate cache when source observations, TP completion evidence, deterministic hidden reason, or lifecycle state changes;
- record model name, prompt version, schema version, evidence hash, and validation result in report output.

## First Test Cases

Use known fixtures/cases as the first acceptance set:

| Student | Expected review |
| --- | --- |
| Naida Volkova | Daughter/family illness is not athlete illness. `recommendedCategory` should be `none` or separate schedule context, and illness should not show in `/tp_signals`. |
| Elena Vasileva | Clean recovery after completed run. `close_candidate` or deterministic clean-recovery hidden state is allowed only when no negative after completion exists. |
| Rizatdinova Elvira | Fever/poor wellbeing after run remains visible. Severity `medium` or `high`, `post_run_negative`, no auto-close. |
| Olga Kogtina | Completed-run reflection and possible load adjustment request, not future schedule constraint. Recommend `completed_workout_reflection` or `load_adjustment_request`; coach action is adjust load or ask wellbeing. |
| Sofia Vlasova | Past travel/unavailability is stale schedule. Should not show in `/tp_signals` when deterministic stale/expired schedule checks confirm it. |
| Anna Denisova | Pain / shin splints. `pain_injury`, keep visible, manual review; no auto-close. |
| Alexander Lavrentyev | Light foot discomfort. `pain_injury`, low severity, keep visible or monitor; no auto-close. |

These should be checked against:

- classifier output;
- evidence pack content;
- AI JSON schema validation;
- deterministic safety verdict;
- final review report rendering.

## Guardrails

Hard requirements:

- AI output must be JSON-schema validated.
- AI cannot mutate DB.
- AI cannot send Telegram.
- AI cannot mutate TrainingPeaks.
- AI cannot override deterministic high-risk safety.
- AI suggestions must include source observation ids.
- If confidence is low or source text is truncated, route to manual review.
- Medical, pregnancy, surgery, and post-run negative contexts route to manual review.
- Pain/injury auto-close is forbidden in v0.
- Auto-hide is allowed only for deterministic-confirmed false positives or clean illness recovery.
- The safety verdict must be computed by deterministic code after AI review.
- The report must clearly distinguish deterministic verdict, AI recommendation, and final safety verdict.

Recommended safety verdict type:

```ts
export type OperationalSignalAiSafetyVerdict = {
  decision:
    | "auto_hide_allowed"
    | "auto_close_candidate_allowed"
    | "coach_review_required"
    | "show_only"
    | "blocked";
  reasonCodes: string[];
  explanationRu: string;
  allowedAction?: "none" | "hide" | "close_candidate" | "reclassify_suggestion";
};
```

## Implementation Order

1. Add shared evidence-pack builder using the existing display/lifecycle read path.
2. Add deterministic placeholder review and safety verdict functions.
3. Add read-only diagnostic script and npm command.
4. Add schema validation for AI output behind explicit `--call-ai`.
5. Add fixture checks for the known students/cases.
6. Add a review surface only after reports prove the recommendations are stable.
7. Consider apply-token flows later, modeled after false-positive suppression, and keep coach confirmation for risky actions.

## Non-Goals for v0

- No production Telegram command that applies AI decisions.
- No automatic DB lifecycle updates from AI.
- No model calls from the inline observation persistence path.
- No TrainingPeaks mutations.
- No student-facing Telegram sends.
- No AI-only medical or injury clearance.
