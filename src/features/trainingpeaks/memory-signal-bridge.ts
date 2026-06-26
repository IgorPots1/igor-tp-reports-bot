import { createHash } from "node:crypto";

import type { CoachMemoryInsertedItem } from "@/features/trainingpeaks/coach-memory-extraction";
import type {
  TrainingPeaksOperationalSignalType,
  TrainingPeaksStudentMemoryType,
} from "@/features/trainingpeaks/repository";

// Слой 2 bridge: a memory fact (caught by Haiku) → an operational-signal candidate.
// Only health/injury facts bridge in v1 — these are the largest recall holes of the keyword
// classifier (pain_or_health 70% miss). Goals/availability/travel are intentionally out of v1.
const BRIDGEABLE_MEMORY_TYPES: ReadonlySet<TrainingPeaksStudentMemoryType> = new Set([
  "pain_or_injury",
  "health_status",
]);

export type MemorySignalBridgePlan = {
  signalType: TrainingPeaksOperationalSignalType;
  validUntil: string;
  requiresCoachClose: boolean;
  confidence: number;
  structuredPayload: Record<string, unknown>;
  dedupeKey: string;
  signalKindLabel: string; // human label for the confirmation message ("травма" / "болезнь")
};

function addDaysIso(nowIso: string, days: number): string {
  const base = new Date(nowIso);
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  const copy = new Date(safeBase.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy.toISOString().slice(0, 10);
}

export function isBridgeableMemoryType(memoryType: TrainingPeaksStudentMemoryType): boolean {
  return BRIDGEABLE_MEMORY_TYPES.has(memoryType);
}

export function mapMemoryTypeToSignalType(
  memoryType: TrainingPeaksStudentMemoryType
): TrainingPeaksOperationalSignalType | null {
  if (memoryType === "pain_or_injury") {
    return "pain_injury";
  }
  if (memoryType === "health_status") {
    return "health_issue_started";
  }
  return null;
}

function signalKindLabel(signalType: TrainingPeaksOperationalSignalType): string {
  return signalType === "pain_injury" ? "травма" : "болезнь";
}

function buildStructuredPayload(input: {
  signalType: TrainingPeaksOperationalSignalType;
  summaryText: string;
}): Record<string, unknown> {
  const isInjury = input.signalType === "pain_injury";
  return {
    latest_summary: input.summaryText,
    display_summary: input.summaryText,
    health_issue_kind: isInjury ? "pain_or_injury" : "illness",
    activity_domain: isInjury ? "injury" : "health",
    planning_effect: "safety_review",
    evidence_level: isInjury ? "explicit_pain_or_injury" : "explicit_illness",
    requires_coach_review: true,
    visible_in_tp_signals: true,
    source: "memory_signal_bridge",
  };
}

// Deterministic dedupe key so re-confirming the same memory item is idempotent (→ "existing").
export function buildMemorySignalDedupeKey(input: {
  studentId: string;
  signalType: TrainingPeaksOperationalSignalType;
  memoryItemId: string;
}): string {
  return createHash("sha256")
    .update(`memory_bridge|${input.studentId}|${input.signalType}|${input.memoryItemId}`)
    .digest("hex");
}

// Build the plan from the lightweight inserted-item view (used at send time).
export function planMemorySignalFromInsertedItem(
  item: Pick<CoachMemoryInsertedItem, "id" | "memoryType" | "summaryText" | "validUntil">,
  studentId: string,
  nowIso: string
): MemorySignalBridgePlan | null {
  const signalType = mapMemoryTypeToSignalType(item.memoryType);
  if (!signalType) {
    return null;
  }
  // Injury closes by coach in the Слой 1 admin; +14d is a safety net so it can't hang forever.
  // Illness gets a shorter, self-expiring TTL (matches keyword health_issue_started convention).
  const requiresCoachClose = signalType === "pain_injury";
  const validUntil =
    item.validUntil ?? addDaysIso(nowIso, signalType === "pain_injury" ? 14 : 5);
  return {
    signalType,
    validUntil,
    requiresCoachClose,
    confidence: 0.8,
    structuredPayload: buildStructuredPayload({ signalType, summaryText: item.summaryText }),
    dedupeKey: buildMemorySignalDedupeKey({ studentId, signalType, memoryItemId: item.id }),
    signalKindLabel: signalKindLabel(signalType),
  };
}
