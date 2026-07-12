import type { BatchAggregateStats, BatchAnomaly, BatchAnomalyKind } from "@/features/trainingpeaks/batch-preview";
import type { TrainingPeaksActionType } from "@/features/trainingpeaks/repository";
import type { BatchChildSpec } from "@/features/trainingpeaks/tp-write-action-types";

/**
 * PR4 -- coach-facing Telegram copy for the 5 NEW action types
 * (create_workout, update_workout, delete_workout, strength_workout, batch).
 * Parallel to (not a replacement for) move_workout's existing copy in
 * action-list-telegram-copy.ts / action-execute-telegram-copy.ts /
 * action-dry-run-telegram-copy.ts, which stays untouched in its own file.
 * Kept separate on purpose: move's payload shape (source/target) and these
 * 5 types' payload shapes have nothing in common, so sharing one file would
 * just mean type-testing every function for "which shape am I looking at".
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function formatCoachDateShort(value: string | null): string {
  if (!value) return "?";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

const RUSSIAN_ACTION_TYPE_LABEL: Record<Exclude<TrainingPeaksActionType, "move_workout">, string> = {
  create_workout: "Создание тренировки",
  update_workout: "Изменение тренировки",
  delete_workout: "Удаление тренировки",
  strength_workout: "Создание силовой тренировки",
  batch: "Пакет действий",
};

/**
 * Best-effort human summary of a cardio TP "structure" object (the wire
 * format PR1's running-workout-renderer.ts builds): { structure: [
 * {type:"step", steps:[{name,length:{value,unit},targets:[{minValue,maxValue}]}]}
 * | {type:"repetition", length:{value:repeatCount}, steps:[...]} ] }.
 * Payloads that don't match this shape (or have no structure at all) fall
 * back to a plain duration/distance line -- never throws on an unfamiliar
 * shape, just says less.
 */
function summarizeCardioStructure(structure: unknown): string[] {
  const record = asRecord(structure);
  const nodes = record ? asArray(record.structure) : null;
  if (!nodes || nodes.length === 0) return [];

  const lines: string[] = [];
  for (const rawNode of nodes) {
    const node = asRecord(rawNode);
    if (!node) continue;
    const steps = asArray(node.steps) ?? [];
    const stepSummaries = steps
      .map((rawStep) => {
        const step = asRecord(rawStep);
        if (!step) return null;
        const name = asString(step.name) ?? "шаг";
        const length = asRecord(step.length);
        const durationSeconds = length ? asNumber(length.value) : null;
        const durationText = durationSeconds ? `${Math.round(durationSeconds / 60)} мин` : null;
        const targets = asArray(step.targets);
        const firstTarget = targets && targets.length > 0 ? asRecord(targets[0]) : null;
        const min = firstTarget ? asNumber(firstTarget.minValue) : null;
        const max = firstTarget ? asNumber(firstTarget.maxValue) : null;
        const rangeText = min !== null && max !== null ? `${min}-${max}%` : null;
        return [name, durationText, rangeText].filter(Boolean).join(", ");
      })
      .filter((value): value is string => Boolean(value));

    if (node.type === "repetition") {
      const length = asRecord(node.length);
      const repeatCount = length ? asNumber(length.value) : null;
      lines.push(`${repeatCount ?? "?"}× [${stepSummaries.join(" + ")}]`);
    } else if (stepSummaries.length > 0) {
      lines.push(stepSummaries[0]);
    }
  }
  return lines;
}

/** Best-effort human summary of StructuredStrength blocks (PR1-proven /save shape). */
function summarizeStrengthBlocks(blocks: unknown): string[] {
  const list = asArray(blocks);
  if (!list) return [];
  return list
    .map((rawBlock) => {
      const block = asRecord(rawBlock);
      if (!block) return null;
      const title = asString(block.title) ?? "упражнение";
      const prescriptions = asArray(block.prescriptions) ?? [];
      const setCount = prescriptions.reduce((acc: number, rawPrescription) => {
        const prescription = asRecord(rawPrescription);
        const sets = prescription ? asArray(prescription.sets) : null;
        return acc + (sets?.length ?? 0);
      }, 0);
      const firstPrescription = prescriptions.length > 0 ? asRecord(prescriptions[0]) : null;
      const firstSet = firstPrescription ? asArray(firstPrescription.sets)?.[0] : null;
      const firstSetRecord = asRecord(firstSet);
      const firstValue = firstSetRecord ? asArray(firstSetRecord.parameterValues)?.[0] : null;
      const firstValueRecord = asRecord(firstValue);
      const prescribedValue = firstValueRecord ? asString(firstValueRecord.prescribedValue) : null;
      const parameter = firstValueRecord ? asString(firstValueRecord.parameter) : null;
      const valueText = prescribedValue && parameter ? `${prescribedValue} ${parameter}` : null;
      return [title, setCount > 0 ? `${setCount} подход(ов)` : null, valueText].filter(Boolean).join(" — ");
    })
    .filter((value): value is string => Boolean(value));
}

/**
 * One-line summary for the coach action list (mirrors move's "перенос: DD.MM
 * -> DD.MM" line). Never throws on a malformed payload -- returns a plain
 * fallback line instead, since this renders inside a list of many actions.
 */
export function buildWriteActionSummaryLine(actionType: Exclude<TrainingPeaksActionType, "move_workout">, parsedPayload: unknown): string {
  const payload = asRecord(parsedPayload);
  if (!payload) return RUSSIAN_ACTION_TYPE_LABEL[actionType];

  switch (actionType) {
    case "create_workout": {
      const title = asString(payload.title) ?? "тренировка";
      const date = formatCoachDateShort(asString(payload.workoutDay));
      return `создать «${title}» на ${date}`;
    }
    case "strength_workout": {
      const title = asString(payload.title) ?? "силовая тренировка";
      const date = formatCoachDateShort(asString(payload.prescribedDate));
      return `создать силовую «${title}» на ${date}`;
    }
    case "update_workout": {
      const fields = asRecord(payload.fields);
      const fieldNames = fields ? Object.keys(fields).join(", ") : "?";
      return `изменить тренировку ${payload.workoutId ?? "?"}: ${fieldNames}`;
    }
    case "delete_workout":
      return `удалить тренировку ${payload.workoutId ?? "?"}`;
    case "batch": {
      const children = asArray(payload.children);
      return `пакет из ${children?.length ?? "?"} действий`;
    }
    default: {
      const exhaustive: never = actionType;
      return String(exhaustive);
    }
  }
}

/**
 * Multi-line confirm-card content: who (athlete), what (type), when (date),
 * structure (intervals / exercises). This is what the coach reads BEFORE
 * pressing tp:ta:x: -- per naryad, it must be enough to decide without
 * opening TrainingPeaks.
 */
export function buildWriteActionDetailCard(
  actionType: Exclude<TrainingPeaksActionType, "move_workout">,
  parsedPayload: unknown,
  studentName: string | null,
): string {
  const payload = asRecord(parsedPayload) ?? {};
  const lines: string[] = [RUSSIAN_ACTION_TYPE_LABEL[actionType]];
  const athleteLine = studentName ? `Атлет: ${studentName}` : payload.athleteId ? `Атлет ID: ${payload.athleteId}` : null;
  if (athleteLine) lines.push(athleteLine);

  switch (actionType) {
    case "create_workout": {
      lines.push(`Название: ${asString(payload.title) ?? "?"}`);
      lines.push(`Дата: ${formatCoachDateShort(asString(payload.workoutDay))}`);
      const totalTime = asNumber(payload.totalTimePlanned);
      const distance = asNumber(payload.distancePlanned);
      if (totalTime) lines.push(`Длительность: ${Math.round(totalTime * 60)} мин`);
      if (distance) lines.push(`Дистанция: ${distance} м`);
      const structureLines = summarizeCardioStructure(payload.structure);
      if (structureLines.length > 0) {
        lines.push("Структура:");
        structureLines.forEach((line) => lines.push(`  ${line}`));
      }
      break;
    }
    case "strength_workout": {
      lines.push(`Название: ${asString(payload.title) ?? "?"}`);
      lines.push(`Дата: ${formatCoachDateShort(asString(payload.prescribedDate))}`);
      const blockLines = summarizeStrengthBlocks(payload.blocks);
      if (blockLines.length > 0) {
        lines.push("Упражнения:");
        blockLines.forEach((line, index) => lines.push(`  ${index + 1}. ${line}`));
      }
      break;
    }
    case "update_workout": {
      lines.push(`Тренировка: ${payload.workoutId ?? "?"}`);
      const fields = asRecord(payload.fields) ?? {};
      lines.push("Изменения:");
      for (const [key, value] of Object.entries(fields)) {
        lines.push(`  ${key} → ${JSON.stringify(value)}`);
      }
      break;
    }
    case "delete_workout":
      lines.push(`Тренировка: ${payload.workoutId ?? "?"}`);
      lines.push("⚠️ Откат недоступен -- удаление необратимо.");
      break;
    case "batch": {
      const children = asArray(payload.children) ?? [];
      lines.push(`Действий в пакете: ${children.length}`);
      children.forEach((rawChild, index) => {
        const child = asRecord(rawChild);
        const label = child ? asString(child.label) : null;
        lines.push(`  ${index + 1}. ${label ?? "?"}`);
      });
      break;
    }
    default: {
      const exhaustive: never = actionType;
      throw new Error(`Unhandled action type in buildWriteActionDetailCard: ${String(exhaustive)}`);
    }
  }
  return lines.join("\n");
}

export function buildWriteActionQueuedMessage(actionType: Exclude<TrainingPeaksActionType, "move_workout">): string {
  return [`✅ ${RUSSIAN_ACTION_TYPE_LABEL[actionType]} поставлено в очередь.`, "TrainingPeaks пока не изменён."].join("\n");
}

export function buildWriteActionBlockedMessage(actionType: Exclude<TrainingPeaksActionType, "move_workout">, reason: string | null): string {
  const lines = [`${RUSSIAN_ACTION_TYPE_LABEL[actionType]}: выполнение заблокировано.`];
  if (reason) lines.push(reason);
  return lines.join("\n");
}

export function buildWriteActionResultMessage(
  actionType: Exclude<TrainingPeaksActionType, "move_workout">,
  outcome: { ok: true } | { ok: false; errorMessage: string },
): string {
  if (outcome.ok) {
    return `✅ ${RUSSIAN_ACTION_TYPE_LABEL[actionType]} выполнено. TrainingPeaks изменён.`;
  }
  return [`❌ ${RUSSIAN_ACTION_TYPE_LABEL[actionType]}: ошибка выполнения.`, outcome.errorMessage].join("\n");
}

// ─── batch preview (PR4 step 4) ────────────────────────────────────────────────

const RUSSIAN_ANOMALY_LABEL: Record<BatchAnomalyKind, string> = {
  race_proximity: "близко к старту",
  existing_workout_collision: "уже есть тренировка",
  volume_spike: "выше лимита объёма",
  active_health_signal: "активный health-сигнал",
};

const RUSSIAN_CHILD_TYPE_LABEL: Record<Exclude<TrainingPeaksActionType, "move_workout" | "batch">, string> = {
  create_workout: "создание",
  update_workout: "изменение",
  delete_workout: "удаление",
  strength_workout: "силовая",
};

const BATCH_PREVIEW_MAX_ITEMS_SHOWN = 10;

/**
 * The batch confirm card: aggregate first, anomalies as their OWN prominent
 * block, per-item list last and capped -- per naryad, the coach decides from
 * the aggregate + anomalies, the item list is supplementary detail, not a
 * 100-line wall the coach has to read to find the one thing that matters.
 */
export function buildBatchPreviewCard(aggregate: BatchAggregateStats, anomalies: BatchAnomaly[], children: BatchChildSpec[]): string {
  const lines: string[] = ["📦 Пакет действий TrainingPeaks", ""];

  lines.push("Итого:");
  lines.push(`  Атлетов: ${aggregate.athleteCount}`);
  lines.push(`  Действий: ${aggregate.totalActions}`);
  const typeBreakdown = Object.entries(aggregate.countByType)
    .map(([type, count]) => `${RUSSIAN_CHILD_TYPE_LABEL[type as keyof typeof RUSSIAN_CHILD_TYPE_LABEL] ?? type} × ${count}`)
    .join(", ");
  if (typeBreakdown) lines.push(`  По типам: ${typeBreakdown}`);
  if (aggregate.totalPlannedMinutes > 0) lines.push(`  Суммарно: ${Math.round((aggregate.totalPlannedMinutes / 60) * 10) / 10} ч`);
  if (aggregate.totalPlannedDistanceMeters > 0) {
    lines.push(`  Дистанция: ${Math.round((aggregate.totalPlannedDistanceMeters / 1000) * 10) / 10} км`);
  }

  lines.push("");
  if (anomalies.length > 0) {
    lines.push(`⚠️ Аномалии (${anomalies.length}):`);
    for (const anomaly of anomalies) {
      const who = anomaly.studentName ?? `атлет ${anomaly.athleteId}`;
      lines.push(`  • ${who} — ${RUSSIAN_ANOMALY_LABEL[anomaly.kind]}: ${anomaly.detail}`);
    }
  } else {
    lines.push("Аномалий не обнаружено.");
  }

  lines.push("");
  lines.push(`Состав (${children.length}):`);
  children.slice(0, BATCH_PREVIEW_MAX_ITEMS_SHOWN).forEach((child, index) => {
    lines.push(`  ${index + 1}. ${child.label}`);
  });
  if (children.length > BATCH_PREVIEW_MAX_ITEMS_SHOWN) {
    lines.push(`  ...и ещё ${children.length - BATCH_PREVIEW_MAX_ITEMS_SHOWN}`);
  }

  return lines.join("\n");
}
