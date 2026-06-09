import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import NutritionDraftCopyBlock from "@/app/admin/coach-os/nutrition/NutritionDraftCopyBlock";
import NutritionFileUploadPanel from "@/app/admin/coach-os/nutrition/NutritionFileUploadPanel";
import { formatIsoDate, getSingleSearchParam } from "@/app/admin/lib";
import {
  addNutritionContextNoteAction,
  addNutritionWeightAction,
  generateNutritionWeeklyReviewAction,
  parseNutritionManualMacrosAction,
  previewNutritionFileUploadAction,
  saveNutritionFileReportAction,
  saveNutritionManualMacrosAction,
  saveNutritionProfileAction,
} from "@/app/admin/coach-os/nutrition/actions";
import {
  getNutritionAdminStudentCard,
  parseNutritionManualMacros,
} from "@/features/nutrition/admin";
import {
  buildNutritionStudentCardHref,
  formatNutritionCarbStrategy,
  formatNutritionCompactDate,
  formatNutritionConflictFlags,
  formatNutritionContextItemType,
  formatNutritionDataQualitySummary,
  formatNutritionDoNotSendReason,
  formatNutritionEnabled,
  formatNutritionFormality,
  formatNutritionFormalitySource,
  formatNutritionGenerationMode,
  formatNutritionShortId,
  formatNutritionSourceType,
  formatNutritionStatus,
  formatNutritionTone,
  formatNutritionTpCacheNote,
  formatNutritionTpCacheStatus,
  NUTRITION_CONTEXT_ITEM_TYPE_LABELS,
  pickDefaultNutritionReport,
} from "@/features/nutrition/admin-labels";
import {
  NUTRITION_FILE_PREVIEW_COOKIE,
  parseNutritionFileUploadPreview,
} from "@/features/nutrition/file-preview-cookie";
import type { NutritionContextItemType } from "@/features/nutrition/repository";

type NutritionStudentCardPageProps = {
  params: Promise<{ studentId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getCurrentWeekWindow(): { weekFrom: string; weekTo: string } {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1, 12, 0, 0));
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 7, 12, 0, 0));
  return {
    weekFrom: monday.toISOString().slice(0, 10),
    weekTo: sunday.toISOString().slice(0, 10),
  };
}

function getBadgeClass(status: string): string {
  if (status === "ready_for_analysis" || status === "approved_for_copy" || status === "draft_generated") {
    return "admin-badge admin-badge-success";
  }
  if (status === "blocked_safety" || status === "insufficient") {
    return "admin-badge admin-badge-danger";
  }
  if (status === "needs_review") {
    return "admin-badge admin-badge-warning";
  }
  return "admin-badge admin-badge-outline";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function formatDoNotSendReasons(safetyFlags: Record<string, unknown>): string[] {
  const hardFlags = asStringArray(safetyFlags.hard_flags);
  return hardFlags.map((flag) => formatNutritionDoNotSendReason(`manual_review_required:${flag}`));
}

function formatTrainingType(type: string | null | undefined): string {
  switch (type) {
    case "long_run":
      return "длительная";
    case "intervals":
      return "интервалы";
    case "tempo":
      return "темпо";
    case "race":
      return "гонка";
    case "easy":
      return "лёгкий бег";
    case "rest":
      return "отдых";
    case "strength":
      return "силовая";
    default:
      return "неизвестно";
  }
}

function getParsedDays(dataQuality: Record<string, unknown>): string {
  const parsedDays = dataQuality.parsed_days;
  return typeof parsedDays === "number" ? String(parsedDays) : "—";
}

const CONTEXT_ITEM_TYPES = Object.keys(NUTRITION_CONTEXT_ITEM_TYPE_LABELS) as NutritionContextItemType[];

export default async function CoachOsNutritionStudentCardPage({
  params,
  searchParams,
}: NutritionStudentCardPageProps) {
  const { studentId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const rawText = getSingleSearchParam(resolvedSearchParams.macroText) ?? "";
  const weekFromParam = getSingleSearchParam(resolvedSearchParams.weekFrom);
  const weekToParam = getSingleSearchParam(resolvedSearchParams.weekTo);
  const defaultWeek = getCurrentWeekWindow();
  let weekFrom = weekFromParam ?? defaultWeek.weekFrom;
  let weekTo = weekToParam ?? defaultWeek.weekTo;
  if (!weekFromParam && !weekToParam) {
    const { getNutritionStudentDefaultWeek } = await import("@/features/nutrition/repository");
    const nutritionWeek = await getNutritionStudentDefaultWeek(studentId);
    if (nutritionWeek) {
      weekFrom = nutritionWeek.weekFrom;
      weekTo = nutritionWeek.weekTo;
    }
  }
  const reportIdFromQuery = getSingleSearchParam(resolvedSearchParams.reportId);
  const reviewIdFromQuery = getSingleSearchParam(resolvedSearchParams.reviewId);

  const card = await getNutritionAdminStudentCard({
    studentId,
    weekFrom,
    weekTo,
    reviewId: reviewIdFromQuery,
  });

  if (!card.student) {
    notFound();
  }

  const selectedReportId = pickDefaultNutritionReport(card.reports, reportIdFromQuery);
  const selectedReport = card.reports.find((report) => report.id === selectedReportId) ?? null;
  const selectedReviewId = card.weeklyAnalysis?.id ?? null;
  const studentCardPath = buildNutritionStudentCardHref({
    studentId,
    weekFrom,
    weekTo,
    reportId: selectedReportId,
    reviewId: selectedReviewId,
  });

  const parsedPreview = rawText
    ? await parseNutritionManualMacros({
        studentId,
        weekFrom,
        weekTo,
        rawText,
      })
    : null;
  const cookieStore = await cookies();
  const fileUploadPreview = parseNutritionFileUploadPreview(cookieStore.get(NUTRITION_FILE_PREVIEW_COOKIE)?.value);
  const activeFilePreview =
    fileUploadPreview &&
    fileUploadPreview.studentId === studentId &&
    fileUploadPreview.weekFrom === weekFrom &&
    fileUploadPreview.weekTo === weekTo
      ? fileUploadPreview
      : null;
  const weeklyNutritionSummary = asObject(card.weeklyAnalysis?.nutritionSummary);
  const dailyAnalysis = Array.isArray(weeklyNutritionSummary.daily_analysis)
    ? (weeklyNutritionSummary.daily_analysis as Array<Record<string, unknown>>)
    : [];
  const importantDays = dailyAnalysis.filter((day) => {
    const relevance = typeof day.relevance === "string" ? day.relevance : "";
    return relevance === "high" || relevance === "medium";
  });
  const trainingLinks = Array.isArray(weeklyNutritionSummary.training_nutrition_links)
    ? (weeklyNutritionSummary.training_nutrition_links as string[])
    : [];
  const oneFocus = asObject(weeklyNutritionSummary.one_focus);
  const methodologySignals = asObject(weeklyNutritionSummary.methodology_signals);
  const dataQualitySummary = asObject(weeklyNutritionSummary.data_quality_summary);
  const coachSummaryText =
    typeof weeklyNutritionSummary.coach_summary_text === "string"
      ? weeklyNutritionSummary.coach_summary_text
      : null;
  const dayByDayAnalysisText =
    typeof weeklyNutritionSummary.day_by_day_analysis_text === "string"
      ? weeklyNutritionSummary.day_by_day_analysis_text
      : null;
  const generationMode =
    typeof weeklyNutritionSummary.generation_mode === "string"
      ? weeklyNutritionSummary.generation_mode
      : "fallback";
  const promptVersion =
    typeof weeklyNutritionSummary.prompt_version === "string"
      ? weeklyNutritionSummary.prompt_version
      : card.weeklyAnalysis?.promptHash ?? "—";
  const bodyweightKg =
    typeof weeklyNutritionSummary.bodyweight_kg === "number"
      ? weeklyNutritionSummary.bodyweight_kg
      : card.context.currentWeightKg;
  const carbStrategy =
    typeof weeklyNutritionSummary.carb_progression_strategy === "string"
      ? weeklyNutritionSummary.carb_progression_strategy
      : typeof oneFocus.progression_strategy === "string"
        ? oneFocus.progression_strategy
        : null;
  const oneFocusText = typeof oneFocus.statement_ru === "string" ? oneFocus.statement_ru : null;
  const hardSafetyFlags = asStringArray(card.weeklyAnalysis?.safetyFlags?.hard_flags);
  const hasSafetyFlags = hardSafetyFlags.length > 0;
  const reviewSelectedById = Boolean(reviewIdFromQuery && card.weeklyAnalysis?.id === reviewIdFromQuery);
  const profileWeightKg = card.profile?.currentWeightKg ?? card.weightLogs[0]?.weightKg ?? null;
  const profileFormality = formatNutritionFormality(card.context.resolvedCommunicationProfile.formality);
  const recentReports = [...card.reports].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const visibleReports = recentReports.slice(0, 5);
  const hiddenReportCount = Math.max(0, recentReports.length - visibleReports.length);

  return (
    <section className="admin-section admin-nutrition-page">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/coach-os/nutrition">
            ← Питание
          </Link>
          <h2>Карточка питания · {card.student.studentName}</h2>
          <p className="admin-muted">
            {card.student.studentId} · {card.student.id}
          </p>
        </div>
        <span className={`admin-badge ${card.student.isActive ? "admin-badge-success" : "admin-badge-warning"}`}>
          {card.student.isActive ? "Активен" : "Архив"}
        </span>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>{error ?? notice}</div>
      )}

      <article className="admin-card admin-card-compact admin-nutrition-card-wide admin-nutrition-profile-compact">
        <h3>Неделя и профиль</h3>
        <form className="admin-form-inline admin-nutrition-week-row" method="get">
          {selectedReportId ? <input type="hidden" name="reportId" value={selectedReportId} /> : null}
          {selectedReviewId ? <input type="hidden" name="reviewId" value={selectedReviewId} /> : null}
          <span className="admin-nutrition-week-label">Неделя:</span>
          <label className="admin-form-field">
            <span>с</span>
            <input className="admin-input" type="date" name="weekFrom" defaultValue={weekFrom} />
          </label>
          <label className="admin-form-field">
            <span>по</span>
            <input className="admin-input" type="date" name="weekTo" defaultValue={weekTo} />
          </label>
          <button className="admin-button admin-button-secondary" type="submit">
            Показать
          </button>
        </form>
        <p className="admin-nutrition-inline-meta">
          Питание: {formatNutritionEnabled(card.profile?.enabled ?? false).toLowerCase()} · Вес:{" "}
          {profileWeightKg ?? "—"} кг · Стиль: {profileFormality}
        </p>
      </article>

      <div className="admin-grid admin-grid-student-detail">
        <NutritionFileUploadPanel
          studentId={studentId}
          weekFrom={weekFrom}
          weekTo={weekTo}
          redirectTo={studentCardPath}
          initialPreview={activeFilePreview}
          previewAction={previewNutritionFileUploadAction}
          saveAction={saveNutritionFileReportAction}
        />

        <article className="admin-card admin-card-compact admin-nutrition-card-wide">
          <h3>Отчёт питания за неделю</h3>
          {!selectedReport ? (
            <p className="admin-muted">Сначала сохраните или выберите отчёт питания за эту неделю.</p>
          ) : (
            <p className="admin-nutrition-selected-card">
              Выбран: <code className="admin-nutrition-code">{formatNutritionShortId(selectedReport.id)}</code> ·{" "}
              {formatNutritionStatus(selectedReport.status, "report")} ·{" "}
              {formatNutritionSourceType(selectedReport.sourceType)} · создан{" "}
              {formatNutritionCompactDate(selectedReport.createdAt)}
            </p>
          )}

          {recentReports.length > 0 ? (
            <>
              <p className="admin-muted">Сохранённые отчёты за неделю:</p>
              <div className="admin-nutrition-mini-table">
                {visibleReports.map((report) => {
                  const isSelected = report.id === selectedReportId;
                  const reportHref = buildNutritionStudentCardHref({
                    studentId,
                    weekFrom,
                    weekTo,
                    reportId: report.id,
                    reviewId: isSelected ? selectedReviewId : null,
                  });
                  return (
                    <div
                      key={report.id}
                      className={`admin-nutrition-mini-table-row${isSelected ? " admin-nutrition-mini-table-row-selected" : ""}`}
                    >
                      {isSelected ? (
                        <span className="admin-nutrition-mini-table-badge">выбран</span>
                      ) : (
                        <Link className="admin-backlink" href={reportHref}>
                          открыть
                        </Link>
                      )}
                      <span>
                        {formatNutritionCompactDate(report.createdAt)} ·{" "}
                        {formatNutritionStatus(report.status, "report")} ·{" "}
                        {formatNutritionSourceType(report.sourceType)} · {getParsedDays(report.dataQuality)} дней
                      </span>
                    </div>
                  );
                })}
              </div>
              {hiddenReportCount > 0 ? (
                <details>
                  <summary>Показать все отчёты ({recentReports.length})</summary>
                  <div className="admin-nutrition-mini-table">
                    {recentReports.slice(5).map((report) => {
                      const isSelected = report.id === selectedReportId;
                      const reportHref = buildNutritionStudentCardHref({
                        studentId,
                        weekFrom,
                        weekTo,
                        reportId: report.id,
                        reviewId: isSelected ? selectedReviewId : null,
                      });
                      return (
                        <div
                          key={report.id}
                          className={`admin-nutrition-mini-table-row${isSelected ? " admin-nutrition-mini-table-row-selected" : ""}`}
                        >
                          {isSelected ? (
                            <span className="admin-nutrition-mini-table-badge">выбран</span>
                          ) : (
                            <Link className="admin-backlink" href={reportHref}>
                              открыть
                            </Link>
                          )}
                          <span>
                            {formatNutritionCompactDate(report.createdAt)} ·{" "}
                            {formatNutritionStatus(report.status, "report")} ·{" "}
                            {formatNutritionSourceType(report.sourceType)} · {getParsedDays(report.dataQuality)} дней
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ) : null}
            </>
          ) : (
            <p className="admin-muted">Отчётов за период {weekFrom} — {weekTo} пока нет.</p>
          )}
        </article>

        <article className="admin-card admin-card-compact admin-nutrition-card-wide">
          <h3>Разбор прошлой недели</h3>
          <form className="admin-nutrition-review-row" action={generateNutritionWeeklyReviewAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="weekFrom" value={weekFrom} />
            <input type="hidden" name="weekTo" value={weekTo} />
            <input type="hidden" name="redirectTo" value={studentCardPath} />
            <label className="admin-form-field">
              <span>Отчёт</span>
              {card.reports.length > 0 ? (
                <select className="admin-input" name="reportId" required defaultValue={selectedReportId ?? undefined}>
                  {card.reports.map((report) => (
                    <option key={report.id} value={report.id}>
                      {formatNutritionCompactDate(report.createdAt)} · {formatNutritionStatus(report.status, "report")} ·{" "}
                      {formatNutritionShortId(report.id)}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="admin-input" name="reportId" placeholder="Сначала сохраните отчёт" required disabled />
              )}
            </label>
            <FormActionButton className="admin-button" pendingText="Генерирую…" disabled={!selectedReportId}>
              Сгенерировать обзор
            </FormActionButton>
          </form>

          {!card.weeklyAnalysis ? (
            <p className="admin-muted admin-nutrition-helper">Обзор ещё не сгенерирован.</p>
          ) : (
            <p className="admin-nutrition-inline-meta admin-nutrition-helper">
              Сохранённый обзор: {formatNutritionGenerationMode(generationMode)} ·{" "}
              {formatNutritionStatus(card.weeklyAnalysis.status, "analysis")} · обновлён{" "}
              {formatNutritionCompactDate(card.weeklyAnalysis.updatedAt)} · review{" "}
              <code className="admin-nutrition-code">{formatNutritionShortId(card.weeklyAnalysis.id)}</code>
              {reviewSelectedById ? " · выбран по ссылке" : ""}
            </p>
          )}
        </article>

        <article className="admin-card admin-card-compact admin-nutrition-card-wide">
          <h3>Черновик для ученика</h3>
          {!card.weeklyAnalysis ? (
            <p className="admin-muted">Обзор ещё не сгенерирован.</p>
          ) : card.weeklyAnalysis.status === "blocked_safety" ? (
            <div className="admin-alert admin-alert-error">
              <strong>Блок безопасности.</strong> Черновик для ученика скрыт. Проверьте флаги перед ручным копированием.
            </div>
          ) : card.weeklyAnalysis.athleteMessageDraft ? (
            <NutritionDraftCopyBlock draft={card.weeklyAnalysis.athleteMessageDraft} generationMode={generationMode} />
          ) : (
            <p className="admin-muted">Черновик скрыт (блок безопасности или мало данных).</p>
          )}
        </article>

        <article className="admin-card admin-card-compact admin-nutrition-card-wide">
          <h3>Детали для тренера</h3>
          {!card.weeklyAnalysis ? (
            <p className="admin-muted">Обзор ещё не сгенерирован.</p>
          ) : (
            <div className="admin-nutrition-coach-section">
              <section>
                <h4>Главный вывод для тренера</h4>
                {coachSummaryText ? (
                  <p className="admin-nutrition-text-block">{coachSummaryText}</p>
                ) : (
                  <p className="admin-muted">Главный вывод не сформирован.</p>
                )}
              </section>

              <section>
                <h4>Разбор по дням</h4>
                {dayByDayAnalysisText ? (
                  <p className="admin-nutrition-text-block">{dayByDayAnalysisText}</p>
                ) : (
                  <p className="admin-muted">Разбор по дням не сформирован.</p>
                )}
              </section>

              <section>
                <h4>Связки тренировка ↔ питание</h4>
                {trainingLinks.length === 0 ? (
                  <p className="admin-muted">Связки не сформированы.</p>
                ) : (
                  <ul className="admin-list">
                    {trainingLinks.map((line, idx) => (
                      <li key={`training-link-${idx}`}>{line}</li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4>Метрики недели</h4>
                <dl className="admin-meta-list admin-meta-list-compact admin-nutrition-compact-grid">
                  <div>
                    <dt>Качество данных</dt>
                    <dd>
                      {formatNutritionDataQualitySummary({
                        parsedDays:
                          typeof dataQualitySummary.parsed_days === "number" ? dataQualitySummary.parsed_days : null,
                        lowConfidenceDays:
                          typeof dataQualitySummary.low_confidence_days === "number"
                            ? dataQualitySummary.low_confidence_days
                            : null,
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt>Средние ккал/Б/Ж/У</dt>
                    <dd>
                      {(weeklyNutritionSummary.avg_kcal as number | null) ?? "—"} /{" "}
                      {(weeklyNutritionSummary.avg_protein_g as number | null) ?? "—"} /{" "}
                      {(weeklyNutritionSummary.avg_fat_g as number | null) ?? "—"} /{" "}
                      {(weeklyNutritionSummary.avg_carbs_g as number | null) ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Вес (кг)</dt>
                    <dd>{bodyweightKg ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Белок достаточный</dt>
                    <dd>
                      {bodyweightKg === null
                        ? "Вес не задан — расчёт г/кг и белок достаточный недоступны."
                        : methodologySignals.protein_sufficient === true
                          ? "Да"
                          : "Нет/неизвестно"}
                    </dd>
                  </div>
                  <div>
                    <dt>Один фокус</dt>
                    <dd>{oneFocusText ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Стратегия углеводов</dt>
                    <dd>{formatNutritionCarbStrategy(carbStrategy)}</dd>
                  </div>
                  <div>
                    <dt>TP прошлой недели</dt>
                    <dd>{formatNutritionTpCacheStatus(card.context.tpPastWeek.cacheStatus)}</dd>
                  </div>
                  <div>
                    <dt>TP следующей недели</dt>
                    <dd>{formatNutritionTpCacheStatus(card.context.tpNextWeek.cacheStatus)}</dd>
                  </div>
                </dl>
              </section>

              {hasSafetyFlags && (
                <section>
                  <h4>Флаги безопасности</h4>
                  <p className="admin-nutrition-text-block">
                    {formatDoNotSendReasons(card.weeklyAnalysis.safetyFlags).join(", ")}
                  </p>
                </section>
              )}
            </div>
          )}
        </article>

        <details className="admin-card admin-card-compact admin-nutrition-card-wide admin-nutrition-advanced-stack">
          <summary>Дополнительно</summary>
          <div className="admin-nutrition-advanced-inner">
            <details>
              <summary>Профиль и вес</summary>
              <div className="admin-form-stack">
                <dl className="admin-meta-list admin-meta-list-compact admin-nutrition-compact-grid">
                  <div>
                    <dt>Недельные отчёты</dt>
                    <dd>{formatNutritionEnabled(card.student.weeklyReportEnabled)}</dd>
                  </div>
                  <div>
                    <dt>Telegram</dt>
                    <dd>{formatNutritionEnabled(card.student.telegramDeliveryEnabled)}</dd>
                  </div>
                  <div>
                    <dt>Формальность</dt>
                    <dd>{formatNutritionFormality(card.context.resolvedCommunicationProfile.formality)}</dd>
                  </div>
                  <div>
                    <dt>Источник стиля</dt>
                    <dd>{formatNutritionFormalitySource(card.context.resolvedCommunicationProfile.formalitySource)}</dd>
                  </div>
                  <div>
                    <dt>Тон</dt>
                    <dd>{formatNutritionTone(card.context.resolvedCommunicationProfile.tone)}</dd>
                  </div>
                  <div>
                    <dt>Конфликты</dt>
                    <dd>{formatNutritionConflictFlags(card.context.resolvedCommunicationProfile.conflictFlags)}</dd>
                  </div>
                </dl>
                <form className="admin-form-stack" action={saveNutritionProfileAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="redirectTo" value={studentCardPath} />
                  <label className="admin-form-field">
                    <span>Питание</span>
                    <select name="enabled" className="admin-input" defaultValue={card.profile?.enabled ? "true" : "false"}>
                      <option value="false">Выключено</option>
                      <option value="true">Включено</option>
                    </select>
                  </label>
                  <label className="admin-form-field">
                    <span>Цель</span>
                    <input className="admin-input" name="goal" defaultValue={card.profile?.goal ?? ""} />
                  </label>
                  <label className="admin-form-field">
                    <span>Приложение</span>
                    <input className="admin-input" name="trackingApp" defaultValue={card.profile?.trackingApp ?? ""} />
                  </label>
                  <label className="admin-form-field">
                    <span>Текущий вес (кг)</span>
                    <input className="admin-input" name="currentWeightKg" type="number" step="0.1" defaultValue={card.profile?.currentWeightKg ?? ""} />
                  </label>
                  <label className="admin-form-field">
                    <span>Заметки по переносимости</span>
                    <textarea className="admin-textarea admin-textarea-compact" name="toleranceNotes" rows={2} defaultValue={card.profile?.toleranceNotes ?? ""} />
                  </label>
                  <label className="admin-form-field">
                    <span>Заметки тренера</span>
                    <textarea className="admin-textarea admin-textarea-compact" name="coachNotes" rows={2} defaultValue={card.profile?.coachNotes ?? ""} />
                  </label>
                  <FormActionButton className="admin-button" pendingText="Сохраняю…">
                    Сохранить профиль
                  </FormActionButton>
                </form>
                <form className="admin-form-inline" action={addNutritionWeightAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="redirectTo" value={studentCardPath} />
                  <input className="admin-input" name="weightKg" type="number" step="0.1" placeholder="кг" required />
                  <input className="admin-input" name="source" defaultValue="manual" />
                  <FormActionButton className="admin-button" pendingText="Добавляю…">
                    Добавить вес
                  </FormActionButton>
                </form>
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table-compact">
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th>Вес</th>
                        <th>Источник</th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.weightLogs.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="admin-empty-cell">
                            Записей веса пока нет.
                          </td>
                        </tr>
                      ) : (
                        card.weightLogs.map((row) => (
                          <tr key={row.id}>
                            <td>{formatIsoDate(row.loggedAt)}</td>
                            <td>{row.weightKg}</td>
                            <td>{row.source}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>

            <details>
              <summary>Контекстные заметки</summary>
              <div className="admin-form-stack">
                <form className="admin-form-inline" action={addNutritionContextNoteAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="redirectTo" value={studentCardPath} />
                  <select className="admin-input" name="itemType" defaultValue="note">
                    {CONTEXT_ITEM_TYPES.map((itemType) => (
                      <option key={itemType} value={itemType}>
                        {formatNutritionContextItemType(itemType)}
                      </option>
                    ))}
                  </select>
                  <input className="admin-input" name="text" placeholder="Заметка…" required />
                  <FormActionButton className="admin-button" pendingText="Добавляю…">
                    Добавить
                  </FormActionButton>
                </form>
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table-compact">
                    <thead>
                      <tr>
                        <th>Тип</th>
                        <th>Текст</th>
                        <th>Приоритет</th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.contextItems.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="admin-empty-cell">
                            Заметок пока нет.
                          </td>
                        </tr>
                      ) : (
                        card.contextItems.map((item) => (
                          <tr key={item.id}>
                            <td>{formatNutritionContextItemType(item.itemType)}</td>
                            <td>{item.text}</td>
                            <td>{item.priority}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>

            <details>
              <summary>Ручной ввод макросов</summary>
              <div className="admin-form-stack">
                <form className="admin-form-stack" action={parseNutritionManualMacrosAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="redirectTo" value={studentCardPath} />
                  {selectedReportId ? <input type="hidden" name="reportId" value={selectedReportId} /> : null}
                  <div className="admin-nutrition-kv-grid">
                    <label className="admin-form-field">
                      <span>Неделя с</span>
                      <input className="admin-input" type="date" name="weekFrom" defaultValue={weekFrom} />
                    </label>
                    <label className="admin-form-field">
                      <span>Неделя по</span>
                      <input className="admin-input" type="date" name="weekTo" defaultValue={weekTo} />
                    </label>
                  </div>
                  <label className="admin-form-field">
                    <span>Текст макросов</span>
                    <textarea className="admin-textarea admin-textarea-compact" name="rawText" rows={4} defaultValue={rawText} />
                  </label>
                  <FormActionButton className="admin-button admin-button-secondary" pendingText="Разбираю…">
                    Разобрать макросы
                  </FormActionButton>
                </form>
                <form className="admin-form-stack" action={saveNutritionManualMacrosAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="weekFrom" value={weekFrom} />
                  <input type="hidden" name="weekTo" value={weekTo} />
                  <input type="hidden" name="rawText" value={rawText} />
                  <input type="hidden" name="redirectTo" value={studentCardPath} />
                  <FormActionButton className="admin-button" pendingText="Сохраняю…" disabled={!rawText}>
                    Сохранить разбор
                  </FormActionButton>
                </form>
                {parsedPreview && (
                  <>
                    <div className="admin-card-actions admin-card-actions-compact">
                      <span className={getBadgeClass(parsedPreview.status)}>
                        {formatNutritionStatus(parsedPreview.status, "report")}
                      </span>
                      <span className="admin-muted">
                        {formatNutritionDataQualitySummary({
                          parsedDays: parsedPreview.quality.parsedDays,
                          lowConfidenceDays: parsedPreview.quality.lowConfidenceDays,
                        })}
                      </span>
                    </div>
                    <div className="admin-table-wrap">
                      <table className="admin-table admin-table-compact">
                        <thead>
                          <tr>
                            <th>День</th>
                            <th>ккал</th>
                            <th>Белки</th>
                            <th>Жиры</th>
                            <th>Углев.</th>
                            <th>Уверен.</th>
                            <th>Заметки</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedPreview.rows.map((row) => (
                            <tr key={`${row.day}-${row.weekday ?? "na"}`}>
                              <td>{row.day}</td>
                              <td>{row.kcal ?? "—"}</td>
                              <td>{row.proteinG ?? "—"}</td>
                              <td>{row.fatG ?? "—"}</td>
                              <td>{row.carbsG ?? "—"}</td>
                              <td>{row.confidence.toFixed(2)}</td>
                              <td>{row.notes ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </details>

            <details>
              <summary>Кэш TrainingPeaks</summary>
              <div className="admin-form-stack">
                <div className="admin-nutrition-kv-grid">
                  <dl className="admin-nutrition-kv">
                    <dt>Прошлая неделя</dt>
                    <dd>{formatNutritionTpCacheStatus(card.context.tpPastWeek.cacheStatus)}</dd>
                  </dl>
                  <dl className="admin-nutrition-kv">
                    <dt>Следующая неделя</dt>
                    <dd>{formatNutritionTpCacheStatus(card.context.tpNextWeek.cacheStatus)}</dd>
                  </dl>
                  <dl className="admin-nutrition-kv">
                    <dt>Ключ. тренировки (прош.)</dt>
                    <dd>{card.context.tpPastWeek.keyWorkouts.length}</dd>
                  </dl>
                  <dl className="admin-nutrition-kv">
                    <dt>Ключ. тренировки (след.)</dt>
                    <dd>{card.context.tpNextWeek.keyWorkouts.length}</dd>
                  </dl>
                </div>
                <p className="admin-muted">{formatNutritionTpCacheNote(card.context.tpPastWeek.cacheStatusNote)}</p>
                <p className="admin-muted">{formatNutritionTpCacheNote(card.context.tpNextWeek.cacheStatusNote)}</p>
              </div>
            </details>

            <details id="nutrition-all-reports">
              <summary>Все сохранённые отчёты</summary>
              <div className="admin-table-wrap">
                <table className="admin-table admin-table-compact">
                  <thead>
                    <tr>
                      <th>Создан</th>
                      <th>Статус</th>
                      <th>ID</th>
                      <th>Источник</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.reports.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="admin-empty-cell">
                          Отчётов за период нет.
                        </td>
                      </tr>
                    ) : (
                      recentReports.map((report) => {
                        const isSelected = report.id === selectedReportId;
                        const reportHref = buildNutritionStudentCardHref({
                          studentId,
                          weekFrom,
                          weekTo,
                          reportId: report.id,
                          reviewId: isSelected ? selectedReviewId : null,
                        });
                        return (
                          <tr key={report.id}>
                            <td>{formatNutritionCompactDate(report.createdAt)}</td>
                            <td>
                              <span className={getBadgeClass(report.status)}>
                                {formatNutritionStatus(report.status, "report")}
                              </span>
                            </td>
                            <td>
                              <code className="admin-nutrition-code">{formatNutritionShortId(report.id)}</code>
                            </td>
                            <td>{formatNutritionSourceType(report.sourceType)}</td>
                            <td>
                              {isSelected ? (
                                <span className="admin-muted">выбран</span>
                              ) : (
                                <Link className="admin-backlink" href={reportHref}>
                                  Выбрать
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </details>

            {card.weeklyAnalyses.length > 0 && (
              <details>
                <summary>Все сохранённые обзоры</summary>
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table-compact">
                    <thead>
                      <tr>
                        <th>Обновлён</th>
                        <th>Статус</th>
                        <th>ID</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.weeklyAnalyses.map((analysis) => {
                        const isSelected = analysis.id === selectedReviewId;
                        const analysisHref = buildNutritionStudentCardHref({
                          studentId,
                          weekFrom,
                          weekTo,
                          reportId: analysis.reportId ?? selectedReportId,
                          reviewId: analysis.id,
                        });
                        return (
                          <tr key={analysis.id}>
                            <td>{formatNutritionCompactDate(analysis.updatedAt)}</td>
                            <td>
                              <span className={getBadgeClass(analysis.status)}>
                                {formatNutritionStatus(analysis.status, "analysis")}
                              </span>
                            </td>
                            <td>
                              <code className="admin-nutrition-code">{formatNutritionShortId(analysis.id)}</code>
                            </td>
                            <td>
                              {isSelected ? (
                                <span className="admin-muted">выбран</span>
                              ) : (
                                <Link className="admin-backlink" href={analysisHref}>
                                  Открыть
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {card.weeklyAnalysis && (
              <details>
                <summary>Technical JSON</summary>
                <div className="admin-form-stack">
                  <p className="admin-muted">Prompt: {promptVersion}</p>
                  <details>
                    <summary>Safety JSON</summary>
                    <textarea
                      className="admin-textarea admin-textarea-compact admin-textarea-readonly"
                      rows={3}
                      readOnly
                      value={JSON.stringify(card.weeklyAnalysis.safetyFlags, null, 2)}
                    />
                  </details>
                  <details>
                    <summary>Важные дни (technical)</summary>
                    {importantDays.length === 0 ? (
                      <p className="admin-muted">Ключевые дни не выделены.</p>
                    ) : (
                      <ul className="admin-list">
                        {importantDays.map((day, idx) => {
                          const date = typeof day.date === "string" ? day.date : "—";
                          const trainingType = formatTrainingType(typeof day.trainingType === "string" ? day.trainingType : null);
                          const findings = Array.isArray(day.findings) ? (day.findings as string[]) : [];
                          const line = findings[0] ?? "сигнал без деталей";
                          return (
                            <li key={`${date}-${idx}`}>
                              {date} · {trainingType} · {line}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </details>
                  <details>
                    <summary>nutritionSummary JSON</summary>
                    <textarea
                      className="admin-textarea admin-textarea-compact admin-textarea-readonly"
                      rows={10}
                      readOnly
                      value={JSON.stringify(
                        {
                          internalSummary: card.weeklyAnalysis.internalSummary,
                          nutritionSummary: card.weeklyAnalysis.nutritionSummary,
                          safetyFlags: card.weeklyAnalysis.safetyFlags,
                        },
                        null,
                        2
                      )}
                    />
                  </details>
                </div>
              </details>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
