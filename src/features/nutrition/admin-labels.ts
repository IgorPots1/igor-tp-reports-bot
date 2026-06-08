import type { ResolvedCommunicationProfileSource } from "@/features/trainingpeaks/communication-profile";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import type { NutritionContextItemType } from "@/features/nutrition/repository";

export const NUTRITION_REPORT_STATUS_LABELS: Record<string, string> = {
  received: "получен",
  parsed: "разобран",
  insufficient: "мало данных",
  needs_review: "нужна проверка",
  ready_for_analysis: "готово к разбору",
  approved_for_copy: "одобрен для копии",
};

export const NUTRITION_ANALYSIS_STATUS_LABELS: Record<string, string> = {
  needs_review: "нужна проверка",
  draft_generated: "черновик готов",
  approved_for_copy: "одобрен для копии",
  blocked_safety: "блок безопасности",
  insufficient: "мало данных",
};

export const NUTRITION_NEXT_ACTION_LABELS: Record<string, string> = {
  "Enable nutrition profile": "Включить профиль питания",
  "Add manual report": "Добавить отчёт вручную",
  "Parse and review macros": "Разобрать и проверить макросы",
  "Fix report data quality": "Исправить качество отчёта",
  "Manual safety review required": "Ручная проверка безопасности",
  "Generate weekly nutrition review": "Сгенерировать недельный обзор",
  "Review draft and mark approved": "Проверить черновик и одобрить",
  "Up to date": "Актуально",
};

export const NUTRITION_FORMALITY_LABELS: Record<TrainingPeaksTelegramFormality, string> = {
  ty: "ты",
  vy: "вы",
  unknown: "не задано",
};

export const NUTRITION_FORMALITY_SOURCE_LABELS: Record<ResolvedCommunicationProfileSource, string> = {
  manual: "вручную",
  communication_style_memory: "из памяти стиля",
  unknown: "не задано",
};

export const NUTRITION_TONE_LABELS: Record<string, string> = {
  warm: "тёплый",
  neutral: "нейтральный",
  direct: "прямой",
  formal: "формальный",
};

export const NUTRITION_CONFLICT_FLAG_LABELS: Record<string, string> = {
  formality_mismatch_manual_vs_memory: "расхождение формальности (ручная vs память)",
  preferred_greeting_conflicts_with_manual_formality: "приветствие конфликтует с формальностью",
};

export const NUTRITION_CONTEXT_ITEM_TYPE_LABELS: Record<NutritionContextItemType, string> = {
  preference: "предпочтение",
  dislike: "не любит",
  tolerance: "переносимость",
  energy: "энергия",
  hunger: "голод",
  gi: "ЖКТ",
  training_food_experience: "еда на тренировке",
  note: "заметка",
};

export const NUTRITION_TP_CACHE_STATUS_LABELS: Record<"ok" | "empty" | "stale", string> = {
  ok: "актуален",
  empty: "пусто",
  stale: "устарел",
};

export function formatNutritionStatus(status: string | null | undefined, kind: "report" | "analysis"): string {
  if (!status) {
    return kind === "report" ? "нет отчёта" : "—";
  }
  const labels = kind === "report" ? NUTRITION_REPORT_STATUS_LABELS : NUTRITION_ANALYSIS_STATUS_LABELS;
  return labels[status] ?? status;
}

export function formatNutritionCohortStatus(enabled: boolean): string {
  return enabled ? "в тесте питания" : "не включён";
}

export function formatNutritionNextAction(action: string): string {
  return NUTRITION_NEXT_ACTION_LABELS[action] ?? action;
}

export function formatNutritionYesNo(value: boolean): string {
  return value ? "Да" : "Нет";
}

export function formatNutritionEnabled(value: boolean): string {
  return value ? "Включено" : "Выключено";
}

export function formatNutritionSafetyFlag(hasFlag: boolean): string {
  return hasFlag ? "Блок" : "Ок";
}

export function formatNutritionFormality(value: TrainingPeaksTelegramFormality): string {
  return NUTRITION_FORMALITY_LABELS[value] ?? value;
}

export function formatNutritionFormalitySource(value: ResolvedCommunicationProfileSource): string {
  return NUTRITION_FORMALITY_SOURCE_LABELS[value] ?? value;
}

export function formatNutritionTone(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return NUTRITION_TONE_LABELS[value] ?? value;
}

export function formatNutritionConflictFlags(flags: string[]): string {
  if (flags.length === 0) {
    return "нет";
  }
  return flags.map((flag) => NUTRITION_CONFLICT_FLAG_LABELS[flag] ?? flag).join(", ");
}

export function formatNutritionContextItemType(value: NutritionContextItemType | string): string {
  return NUTRITION_CONTEXT_ITEM_TYPE_LABELS[value as NutritionContextItemType] ?? value;
}

export function formatNutritionTpCacheStatus(value: "ok" | "empty" | "stale"): string {
  return NUTRITION_TP_CACHE_STATUS_LABELS[value] ?? value;
}

export function formatNutritionTpCacheNote(note: string): string {
  if (note.startsWith("TrainingPeaks workout cache is empty")) {
    return "Кэш тренировок TP пуст для выбранного периода.";
  }
  if (note.startsWith("TrainingPeaks workout cache has no scanned_at")) {
    return "В кэше TP нет меток scanned_at.";
  }
  if (note.startsWith("TrainingPeaks workout cache is stale")) {
    const match = note.match(/last scanned (.+)\)\.$/);
    return match ? `Кэш TP устарел (последнее сканирование: ${match[1]}).` : "Кэш TP устарел.";
  }
  if (note.startsWith("TrainingPeaks cache freshness is OK")) {
    const match = note.match(/last scanned (.+)\)\.$/);
    return match ? `Кэш TP актуален (последнее сканирование: ${match[1]}).` : "Кэш TP актуален.";
  }
  return note;
}

export function formatNutritionDoNotSendReason(reason: string): string {
  if (reason.startsWith("manual_review_required:")) {
    const flag = reason.slice("manual_review_required:".length);
    return `нужна ручная проверка: ${flag}`;
  }
  return reason;
}
