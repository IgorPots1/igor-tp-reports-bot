import process from "node:process";

import { formatTrainingPeaksAttentionSnapshotMessage } from "@/features/trainingpeaks/attention-telegram";
import {
  normalizeOperationalSignalFollowUp,
  type OperationalSignalFollowUpNormalized,
} from "@/features/trainingpeaks/operational-follow-up";
import type { TrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";

type SignalInput = {
  id: string;
  studentId: string;
  studentName: string | null;
  signalType: string;
  status: string;
  metadata: Record<string, unknown>;
};

type FollowUpAttentionItem = {
  signalId: string;
  studentId: string;
  studentName: string | null;
  episodeKey: string | null;
  state: "pending_due" | "pending_overdue";
  dueDate: string | null;
  daysOverdue: number;
  reason: string;
};

const LOG_PREFIX = "[check-trainingpeaks-attention-operational-signals]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function readMetaString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function compactHealthFollowUpReason(rawReason: string | null): string | null {
  if (!rawReason) {
    return null;
  }
  const normalized = rawReason.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length <= 70 ? normalized : `${normalized.slice(0, 67).trimEnd()}...`;
}

function isHealthOperationalSignalType(signalType: string): boolean {
  return (
    signalType === "health_issue_started" ||
    signalType === "health_issue_improving" ||
    signalType === "pause_training" ||
    signalType === "resume_training"
  );
}

function formatReason(
  normalized: OperationalSignalFollowUpNormalized,
  reasonRaw: string | null
): string {
  const base = compactHealthFollowUpReason(reasonRaw) ?? "проверить самочувствие после болезни/паузы";
  if (normalized.state === "pending_overdue") {
    return normalized.days_overdue > 0
      ? `просрочено ${normalized.days_overdue} дн.: ${base}`
      : `просрочено: ${base}`;
  }
  return `${base}. Срок сегодня`;
}

function sortKey(item: Pick<FollowUpAttentionItem, "state" | "dueDate" | "studentName">): string {
  const statePriority = item.state === "pending_overdue" ? "0" : "1";
  const dueDate = item.dueDate ?? "9999-12-31";
  const name = (item.studentName ?? "").toLocaleLowerCase("ru-RU");
  return `${statePriority}:${dueDate}:${name}`;
}

function collectAttentionFollowUps(
  signals: SignalInput[],
  asOfDate: string,
  maxItems: number
): { items: FollowUpAttentionItem[]; overflowCount: number } {
  const dedupedByEpisode = new Map<string, FollowUpAttentionItem>();
  const fallbackItems: FollowUpAttentionItem[] = [];

  for (const signal of signals) {
    if (signal.status !== "active") {
      continue;
    }
    if (!isHealthOperationalSignalType(signal.signalType)) {
      continue;
    }

    const normalized = normalizeOperationalSignalFollowUp(signal.metadata, {
      asOfDate,
      timeZone: "Europe/Belgrade",
    });
    if (normalized.state !== "pending_due" && normalized.state !== "pending_overdue") {
      continue;
    }

    const item: FollowUpAttentionItem = {
      signalId: signal.id,
      studentId: signal.studentId,
      studentName: signal.studentName,
      episodeKey: readMetaString(signal.metadata, "episode_key"),
      state: normalized.state,
      dueDate: normalized.due_date,
      daysOverdue: normalized.days_overdue,
      reason: formatReason(normalized, readMetaString(signal.metadata, "follow_up_reason")),
    };

    if (!item.episodeKey) {
      fallbackItems.push(item);
      continue;
    }

    const dedupeKey = `${item.studentId}:${item.episodeKey}`;
    const existing = dedupedByEpisode.get(dedupeKey);
    if (!existing) {
      dedupedByEpisode.set(dedupeKey, item);
      continue;
    }

    const existingKey = sortKey(existing);
    const nextKey = sortKey(item);
    if (nextKey < existingKey || (nextKey === existingKey && item.signalId < existing.signalId)) {
      dedupedByEpisode.set(dedupeKey, item);
    }
  }

  const merged = [...dedupedByEpisode.values(), ...fallbackItems];
  merged.sort((a, b) => {
    const left = sortKey(a);
    const right = sortKey(b);
    if (left !== right) {
      return left.localeCompare(right);
    }
    return a.signalId.localeCompare(b.signalId);
  });

  return {
    items: merged.slice(0, maxItems),
    overflowCount: Math.max(0, merged.length - maxItems),
  };
}

function buildFixtureSignals(): SignalInput[] {
  return [
    {
      id: "sig-overdue-1",
      studentId: "student-a",
      studentName: "Viktoria Sergeeva",
      signalType: "health_issue_started",
      status: "active",
      metadata: {
        episode_key: "episode-health-a",
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-02T08:30:00.000+02:00",
        follow_up_reason: "спросить, как самочувствие",
      },
    },
    {
      id: "sig-due-today-1",
      studentId: "student-b",
      studentName: "Alex Petrov",
      signalType: "health_issue_improving",
      status: "active",
      metadata: {
        episode_key: "episode-health-b",
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-03T09:00:00.000+02:00",
        follow_up_reason: "после простуды",
      },
    },
    {
      id: "sig-future-1",
      studentId: "student-c",
      studentName: "Future Athlete",
      signalType: "health_issue_started",
      status: "active",
      metadata: {
        episode_key: "episode-health-c",
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-04T09:00:00.000+02:00",
      },
    },
    {
      id: "sig-resolved-1",
      studentId: "student-d",
      studentName: "Resolved Athlete",
      signalType: "pause_training",
      status: "active",
      metadata: {
        episode_key: "episode-health-d",
        follow_up_status: "resolved",
        follow_up_due_at: "2026-06-02T10:00:00.000+02:00",
      },
    },
    {
      id: "sig-duplicate-episode-old",
      studentId: "student-e",
      studentName: "Episode Duplicate",
      signalType: "health_issue_started",
      status: "active",
      metadata: {
        episode_key: "episode-dup",
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-01T09:00:00.000+02:00",
        follow_up_reason: "первая версия эпизода",
      },
    },
    {
      id: "sig-duplicate-episode-new",
      studentId: "student-e",
      studentName: "Episode Duplicate",
      signalType: "health_issue_improving",
      status: "active",
      metadata: {
        episode_key: "episode-dup",
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-03T11:00:00.000+02:00",
        follow_up_reason: "вторая версия эпизода",
      },
    },
    {
      id: "sig-non-health-1",
      studentId: "student-f",
      studentName: "Schedule Athlete",
      signalType: "schedule_unavailability_window",
      status: "active",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-03T08:00:00.000+02:00",
      },
    },
    {
      id: "sig-cancelled-1",
      studentId: "student-g",
      studentName: "Inactive Status Athlete",
      signalType: "health_issue_started",
      status: "cancelled",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-02T08:00:00.000+02:00",
      },
    },
    {
      id: "sig-overdue-extra-1",
      studentId: "student-h",
      studentName: "Overflow One",
      signalType: "health_issue_started",
      status: "active",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-01T10:00:00.000+02:00",
      },
    },
    {
      id: "sig-overdue-extra-2",
      studentId: "student-i",
      studentName: "Overflow Two",
      signalType: "health_issue_started",
      status: "active",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-02T11:00:00.000+02:00",
      },
    },
    {
      id: "sig-due-extra-1",
      studentId: "student-j",
      studentName: "Overflow Three",
      signalType: "resume_training",
      status: "active",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-03T12:00:00.000+02:00",
      },
    },
  ];
}

function run(): void {
  const asOfDate = "2026-06-03";
  const fixture = buildFixtureSignals();
  const collected = collectAttentionFollowUps(fixture, asOfDate, 5);

  // A: due today appears
  assert(
    collected.items.some((item) => item.signalId === "sig-due-today-1"),
    "A failed: due-today follow-up should appear."
  );

  // B: overdue appears before due
  const firstDueIdx = collected.items.findIndex((item) => item.state === "pending_due");
  const firstOverdueIdx = collected.items.findIndex((item) => item.state === "pending_overdue");
  assert(firstOverdueIdx >= 0, "B failed: expected overdue item.");
  assert(firstDueIdx >= 0, "B failed: expected due item.");
  assert(firstOverdueIdx < firstDueIdx, "B failed: overdue must be listed before due.");

  // C: future pending does not appear
  assert(
    !collected.items.some((item) => item.signalId === "sig-future-1"),
    "C failed: future pending should not appear."
  );

  // D: resolved/non-pending does not appear
  assert(
    !collected.items.some((item) => item.signalId === "sig-resolved-1"),
    "D failed: resolved/non-pending should not appear."
  );

  // E: duplicate episode rows collapse to one item
  const duplicateEpisodeRows = collected.items.filter((item) => item.studentId === "student-e");
  assert(
    duplicateEpisodeRows.length === 1,
    `E failed: duplicate episode should produce one item, got ${duplicateEpisodeRows.length}.`
  );

  // F: formatting contains friendly text and no raw metadata keys
  const vika = collected.items.find((item) => item.signalId === "sig-overdue-1");
  assert(Boolean(vika), "F failed: missing overdue fixture item.");
  assert(
    (vika as FollowUpAttentionItem).reason.includes("просрочено"),
    "F failed: overdue reason should mention просрочено."
  );
  assert(
    !collected.items.some((item) => item.reason.includes("follow_up_status")),
    "F failed: raw metadata keys leaked to output reason."
  );

  // cap + overflow behavior
  assert(collected.items.length === 5, `Expected max 5 items, got ${collected.items.length}.`);
  assert(collected.overflowCount > 0, "Expected overflow count when fixture exceeds cap.");

  // G: empty table/missing rows equivalent should not crash
  const empty = collectAttentionFollowUps([], asOfDate, 5);
  assert(empty.items.length === 0, "G failed: empty list should produce zero items.");
  assert(empty.overflowCount === 0, "G failed: empty list should have zero overflow.");

  const attentionSnapshot: TrainingPeaksAttentionSnapshot = {
    urgent: [],
    today: [],
    observe: [],
    fyi: [],
    noContact5Days: [],
    followUpToday: collected.items.map((item) => ({
      level: "today",
      studentName: item.studentName,
      studentId: item.studentId,
      reason: item.reason,
      signalKind: "operational_follow_up",
    })),
    followUpOverflowCount: collected.overflowCount,
    planConstraintsToday: [
      {
        level: "today",
        studentName: "Sofia Vlasova",
        studentId: "student-schedule",
        reason: "доступна: вт 02.06, чт 04.06; недоступна: 05.06—08.06",
        signalKind: "operational_schedule",
      },
      {
        level: "today",
        studentName: "Sofia Vlasova",
        studentId: "student-schedule",
        reason: "недоступность",
        signalKind: "operational_schedule",
      },
    ],
    planConstraintsOverflowCount: 0,
    movesToday: [
      {
        level: "today",
        studentName: "Ilya Bogdanov",
        studentId: "student-move",
        reason: "кандидат переноса 2026-06-05 → 2026-06-04",
        signalKind: "operational_move",
      },
    ],
    movesOverflowCount: 0,
  };
  const attentionMessage = formatTrainingPeaksAttentionSnapshotMessage(attentionSnapshot, "Утренний обзор");
  assert(attentionMessage.includes("📅 Учесть в плане"), "Attention digest should include planning section.");
  assert(attentionMessage.includes("🔁 Переносы"), "Attention digest should include move section.");
  assert(
    attentionMessage.includes("Sofia Vlasova") && attentionMessage.includes("вт 02.06"),
    "Attention digest should include schedule planning context with dates."
  );
  assert(
    !attentionMessage.includes("• Sofia Vlasova — недоступность"),
    "Attention digest should suppress legacy unavailability duplicate."
  );
  assert(
    attentionMessage.includes("Ilya Bogdanov") && attentionMessage.includes("2026-06-05"),
    "Attention digest should include move candidate context."
  );
  assert(!attentionMessage.includes("Future Athlete"), "Attention digest must not include future follow-up athlete.");

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
