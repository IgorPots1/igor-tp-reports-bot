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

export type NutritionReportPickCandidate = {
  id: string;
  status: string;
  createdAt: string;
};

export function formatNutritionShortId(id: string | null | undefined): string {
  if (!id) {
    return "—";
  }
  return id.slice(0, 8);
}

export const NUTRITION_SOURCE_TYPE_LABELS: Record<string, string> = {
  pdf: "pdf",
  csv: "csv",
  manual_text: "текст",
  screenshot: "скриншот",
  mixed: "смешанный",
};

export const NUTRITION_CARB_STRATEGY_LABELS: Record<string, string> = {
  maintain: "поддержание",
  small_step: "маленький шаг",
  moderate_step: "умеренный шаг",
  toward_reference_band: "к целевому диапазону",
};

export function formatNutritionGenerationMode(mode: string | null | undefined): string {
  if (mode === "ai") {
    return "AI";
  }
  if (mode === "fallback") {
    return "шаблон";
  }
  return mode ?? "—";
}

export function formatNutritionCompactDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}.${month} ${hours}:${minutes}`;
}

export function formatNutritionSourceType(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return NUTRITION_SOURCE_TYPE_LABELS[value] ?? value;
}

export function formatNutritionCarbStrategy(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return NUTRITION_CARB_STRATEGY_LABELS[value] ?? value;
}

export function formatNutritionDataQualitySummary(input: {
  parsedDays?: number | null;
  lowConfidenceDays?: number | null;
}): string {
  const parsedDays = typeof input.parsedDays === "number" ? input.parsedDays : "—";
  const lowConfidenceDays = typeof input.lowConfidenceDays === "number" ? input.lowConfidenceDays : "—";
  return `${parsedDays} дней распознано, низкая уверенность: ${lowConfidenceDays}`;
}

export function buildNutritionDashboardOpenHref(input: {
  studentId: string;
  latestReportId?: string | null;
  latestReportWeekFrom?: string | null;
  latestReportWeekTo?: string | null;
  lastAnalysisId?: string | null;
  lastAnalysisWeekFrom?: string | null;
  lastAnalysisWeekTo?: string | null;
}): string {
  const weekFrom = input.lastAnalysisWeekFrom ?? input.latestReportWeekFrom ?? null;
  const weekTo = input.lastAnalysisWeekTo ?? input.latestReportWeekTo ?? null;
  return buildNutritionStudentCardHref({
    studentId: input.studentId,
    weekFrom,
    weekTo,
    reportId: input.latestReportId ?? null,
    reviewId: input.lastAnalysisId ?? null,
  });
}

export function buildNutritionStudentCardHref(input: {
  studentId: string;
  weekFrom?: string | null;
  weekTo?: string | null;
  reportId?: string | null;
  reviewId?: string | null;
  planId?: string | null;
  notice?: string | null;
  error?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.weekFrom) {
    params.set("weekFrom", input.weekFrom);
  }
  if (input.weekTo) {
    params.set("weekTo", input.weekTo);
  }
  if (input.reportId) {
    params.set("reportId", input.reportId);
  }
  if (input.reviewId) {
    params.set("reviewId", input.reviewId);
  }
  if (input.planId) {
    params.set("planId", input.planId);
  }
  if (input.notice) {
    params.set("notice", input.notice);
  }
  if (input.error) {
    params.set("error", input.error);
  }
  const query = params.toString();
  return query
    ? `/admin/coach-os/nutrition/${input.studentId}?${query}`
    : `/admin/coach-os/nutrition/${input.studentId}`;
}

export function pickDefaultNutritionReport(
  reports: NutritionReportPickCandidate[],
  reportIdFromQuery?: string | null
): string | null {
  if (reports.length === 0) {
    return null;
  }
  if (reportIdFromQuery && reports.some((report) => report.id === reportIdFromQuery)) {
    return reportIdFromQuery;
  }
  const pickLatestByStatus = (status: string) =>
    reports
      .filter((report) => report.status === status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  const ready = pickLatestByStatus("ready_for_analysis");
  if (ready) {
    return ready.id;
  }
  const needsReview = pickLatestByStatus("needs_review");
  if (needsReview) {
    return needsReview.id;
  }
  return reports[0]?.id ?? null;
}

export function buildNutritionNextActionHref(input: {
  studentId: string;
  nextAction: string;
  report: { id: string; weekFrom: string; weekTo: string } | null;
  analysis: { id: string; weekFrom: string; weekTo: string; reportId: string | null } | null;
}): string | null {
  const studentCard = buildNutritionStudentCardHref({ studentId: input.studentId });

  switch (input.nextAction) {
    case "Generate weekly nutrition review":
      if (!input.report) {
        return studentCard;
      }
      return buildNutritionStudentCardHref({
        studentId: input.studentId,
        weekFrom: input.report.weekFrom,
        weekTo: input.report.weekTo,
        reportId: input.report.id,
        reviewId: input.analysis?.id ?? null,
      });
    case "Fix report data quality":
    case "Parse and review macros":
      if (!input.report) {
        return studentCard;
      }
      return buildNutritionStudentCardHref({
        studentId: input.studentId,
        weekFrom: input.report.weekFrom,
        weekTo: input.report.weekTo,
        reportId: input.report.id,
      });
    case "Review draft and mark approved":
    case "Manual safety review required":
      if (input.analysis) {
        return buildNutritionStudentCardHref({
          studentId: input.studentId,
          weekFrom: input.analysis.weekFrom,
          weekTo: input.analysis.weekTo,
          reportId: input.analysis.reportId,
          reviewId: input.analysis.id,
        });
      }
      return studentCard;
    case "Add manual report":
    case "Enable nutrition profile":
      return studentCard;
    case "Up to date":
      return null;
    default:
      return studentCard;
  }
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

export function formatNutritionExtractionWarning(warning: string): string {
  if (warning.includes("pdf_text_empty")) {
    return "PDF похож на изображение, текст не извлечён.";
  }
  if (warning.includes("pdf_extraction_failed:")) {
    return "PDF не удалось прочитать на сервере (ошибка pdfjs).";
  }
  if (warning.includes("unsupported_pdf_image_only")) {
    return "PDF загружен, но не читается как текст (возможен скан/скриншот).";
  }
  if (warning.includes("daily_totals_not_found")) {
    return "PDF прочитан, но дневные итоги не найдены.";
  }
  if (warning.includes("parsed_food_rows_but_no_day_totals")) {
    return "Похоже, в PDF есть продукты, но нет распознанной строки итога за день.";
  }
  if (warning.includes("fatsecret_layout_not_recognized")) {
    return "Нераспознанный layout FatSecret PDF.";
  }
  if (warning.includes("duplicate_day_totals")) {
    return "Обнаружены дубли дневных итогов.";
  }
  if (warning.includes("low_confidence_pdf_parse")) {
    return "Низкая уверенность распознавания PDF.";
  }
  return warning;
}

export { NUTRITION_FILE_UPLOAD_LIMIT_HINT } from "@/features/nutrition/file-upload-limits";
