import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
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
  formatNutritionConflictFlags,
  formatNutritionContextItemType,
  formatNutritionDoNotSendReason,
  formatNutritionEnabled,
  formatNutritionFormality,
  formatNutritionFormalitySource,
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
  const defaultWeek = getCurrentWeekWindow();
  const weekFrom = getSingleSearchParam(resolvedSearchParams.weekFrom) ?? defaultWeek.weekFrom;
  const weekTo = getSingleSearchParam(resolvedSearchParams.weekTo) ?? defaultWeek.weekTo;
  const reportIdFromQuery = getSingleSearchParam(resolvedSearchParams.reportId);

  const card = await getNutritionAdminStudentCard({
    studentId,
    weekFrom,
    weekTo,
  });

  if (!card.student) {
    notFound();
  }

  const selectedReportId = pickDefaultNutritionReport(card.reports, reportIdFromQuery);
  const studentCardPath = buildNutritionStudentCardHref({
    studentId,
    weekFrom,
    weekTo,
    reportId: selectedReportId,
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

      <div className="admin-grid admin-grid-student-detail">
        <article className="admin-card admin-card-compact">
          <h3>Сводка</h3>
          <dl className="admin-meta-list admin-meta-list-compact">
            <div>
              <dt>Недельные отчёты</dt>
              <dd>{formatNutritionEnabled(card.student.weeklyReportEnabled)}</dd>
            </div>
            <div>
              <dt>Telegram</dt>
              <dd>{formatNutritionEnabled(card.student.telegramDeliveryEnabled)}</dd>
            </div>
            <div>
              <dt>Обновлено</dt>
              <dd>{formatIsoDate(card.student.updatedAt)}</dd>
            </div>
          </dl>
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Стиль общения</h3>
          <dl className="admin-meta-list admin-meta-list-compact">
            <div>
              <dt>Формальность</dt>
              <dd>{formatNutritionFormality(card.context.resolvedCommunicationProfile.formality)}</dd>
            </div>
            <div>
              <dt>Источник</dt>
              <dd>{formatNutritionFormalitySource(card.context.resolvedCommunicationProfile.formalitySource)}</dd>
            </div>
            <div>
              <dt>Тон</dt>
              <dd>{formatNutritionTone(card.context.resolvedCommunicationProfile.tone)}</dd>
            </div>
            <div>
              <dt>Приветствие</dt>
              <dd>{card.context.resolvedCommunicationProfile.preferredGreeting ?? "—"}</dd>
            </div>
            <div>
              <dt>Конфликты</dt>
              <dd>{formatNutritionConflictFlags(card.context.resolvedCommunicationProfile.conflictFlags)}</dd>
            </div>
          </dl>
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Профиль питания</h3>
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
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Вес</h3>
          <form className="admin-form-inline" action={addNutritionWeightAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="redirectTo" value={studentCardPath} />
            <input className="admin-input" name="weightKg" type="number" step="0.1" placeholder="кг" required />
            <input className="admin-input" name="source" defaultValue="manual" />
            <FormActionButton className="admin-button" pendingText="Добавляю…">
              Добавить
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
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Контекст питания</h3>
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
        </article>

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
          <h3>Ручной ввод макросов</h3>
          <form className="admin-form-stack" action={parseNutritionManualMacrosAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="redirectTo" value={studentCardPath} />
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
            <div className="admin-card-actions admin-card-actions-compact">
              <FormActionButton className="admin-button admin-button-secondary" pendingText="Разбираю…">
                Разобрать макросы
              </FormActionButton>
            </div>
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
                  дней: {parsedPreview.quality.parsedDays}, низкая уверенность: {parsedPreview.quality.lowConfidenceDays}
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
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Кэш TrainingPeaks</h3>
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
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Сохранённые отчёты</h3>
          <p className="admin-muted admin-nutrition-helper">
            {weekFrom} — {weekTo}. Каждое сохранение — новая строка.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table-compact">
              <thead>
                <tr>
                  <th>Создан</th>
                  <th>Статус</th>
                  <th>ID</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                {card.reports.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="admin-empty-cell">
                      Отчётов за период нет.
                    </td>
                  </tr>
                ) : (
                  card.reports.map((report) => (
                    <tr key={report.id}>
                      <td>{formatIsoDate(report.createdAt)}</td>
                      <td>
                        <span className={getBadgeClass(report.status)}>{formatNutritionStatus(report.status, "report")}</span>
                      </td>
                      <td>
                        <code className="admin-nutrition-code">{report.id}</code>
                      </td>
                      <td>{report.sourceType}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Недельный обзор</h3>
          <p className="admin-muted admin-nutrition-helper">
            Внутренний анализ и черновик для копирования. Жёсткие флаги блокируют текст для ученика.
          </p>
          <form className="admin-form-stack" action={generateNutritionWeeklyReviewAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="weekFrom" value={weekFrom} />
            <input type="hidden" name="weekTo" value={weekTo} />
            <input type="hidden" name="redirectTo" value={studentCardPath} />
            <label className="admin-form-field">
              <span>Отчёт питания</span>
              {card.reports.length > 0 ? (
                <select className="admin-input" name="reportId" required defaultValue={selectedReportId ?? undefined}>
                  {card.reports.map((report) => (
                    <option key={report.id} value={report.id}>
                      {formatIsoDate(report.createdAt)} · {formatNutritionStatus(report.status, "report")} · {report.id.slice(0, 8)}
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
        </article>

        <article className="admin-card admin-card-compact admin-nutrition-card-wide">
          <h3>Сохранённый обзор (только копия)</h3>
          {!card.weeklyAnalysis ? (
            <p className="admin-muted">Обзора за {weekFrom} — {weekTo} пока нет.</p>
          ) : (
            <div className="admin-form-stack">
              <div className="admin-card-actions admin-card-actions-compact">
                <span className={getBadgeClass(card.weeklyAnalysis.status)}>
                  {formatNutritionStatus(card.weeklyAnalysis.status, "analysis")}
                </span>
                <span className="admin-muted">обновлён {formatIsoDate(card.weeklyAnalysis.updatedAt)}</span>
              </div>

              {card.weeklyAnalysis.status === "blocked_safety" && (
                <div className="admin-alert admin-alert-error">
                  <strong>Блок безопасности.</strong> Черновик для ученика скрыт. Проверьте флаги перед ручным копированием.
                </div>
              )}

              <section>
                <h4>Черновик для ученика</h4>
                {generationMode !== "ai" && (
                  <p className="admin-muted">Сгенерировано шаблоном, лучше проверить текст вручную.</p>
                )}
                {card.weeklyAnalysis.athleteMessageDraft ? (
                  <textarea
                    className="admin-textarea admin-textarea-compact admin-textarea-readonly"
                    rows={6}
                    readOnly
                    value={card.weeklyAnalysis.athleteMessageDraft}
                  />
                ) : (
                  <p className="admin-muted">Черновик скрыт (блок безопасности или мало данных).</p>
                )}
              </section>

              <section>
                <h4>Главный вывод для тренера</h4>
                {coachSummaryText ? (
                  <textarea
                    className="admin-textarea admin-textarea-compact admin-textarea-readonly"
                    rows={6}
                    readOnly
                    value={coachSummaryText}
                  />
                ) : (
                  <p className="admin-muted">Главный вывод не сформирован.</p>
                )}
              </section>

              <section>
                <h4>Разбор по дням</h4>
                {dayByDayAnalysisText ? (
                  <textarea
                    className="admin-textarea admin-textarea-compact admin-textarea-readonly"
                    rows={8}
                    readOnly
                    value={dayByDayAnalysisText}
                  />
                ) : (
                  <p className="admin-muted">Разбор по дням не сформирован.</p>
                )}
              </section>

              <section>
                <h4>Метрики недели</h4>
                <dl className="admin-meta-list admin-meta-list-compact">
                  <div>
                    <dt>Качество данных</dt>
                    <dd>
                      parsed_days: {typeof dataQualitySummary.parsed_days === "number" ? dataQualitySummary.parsed_days : "—"}
                      , low_confidence_days:{" "}
                      {typeof dataQualitySummary.low_confidence_days === "number" ? dataQualitySummary.low_confidence_days : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Средние ккал/Б/Ж/У</dt>
                    <dd>
                      {(weeklyNutritionSummary.avg_kcal as number | null) ?? "—"} / {(weeklyNutritionSummary.avg_protein_g as number | null) ?? "—"} /{" "}
                      {(weeklyNutritionSummary.avg_fat_g as number | null) ?? "—"} / {(weeklyNutritionSummary.avg_carbs_g as number | null) ?? "—"}
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
                    <dd>{carbStrategy ?? "—"}</dd>
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
                <h4>Флаги безопасности</h4>
                {!hasSafetyFlags ? (
                  <p className="admin-muted">Флагов нет.</p>
                ) : (
                  <div className="admin-meta-list admin-meta-list-compact">
                    <div>
                      <dt>Причины не отправлять</dt>
                      <dd>{formatDoNotSendReasons(card.weeklyAnalysis.safetyFlags).join(", ")}</dd>
                    </div>
                  </div>
                )}
                <details>
                  <summary>Safety JSON</summary>
                  <textarea
                    className="admin-textarea admin-textarea-compact admin-textarea-readonly"
                    rows={3}
                    readOnly
                    value={JSON.stringify(card.weeklyAnalysis.safetyFlags, null, 2)}
                  />
                </details>
              </section>

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
                <summary>Technical JSON</summary>
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
          )}
        </article>
      </div>
    </section>
  );
}
