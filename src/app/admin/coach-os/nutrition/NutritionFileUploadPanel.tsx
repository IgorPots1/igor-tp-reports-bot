"use client";

import { useActionState, useMemo, useState, type FormEvent } from "react";

import FormActionButton from "@/app/admin/FormActionButton";
import NutritionReportUploadForm from "@/app/admin/coach-os/nutrition/NutritionReportUploadForm";
import {
  NUTRITION_FILE_UPLOAD_PREVIEW_INITIAL_STATE,
  type NutritionFileUploadPreviewActionState,
} from "@/app/admin/coach-os/nutrition/upload-action-state";
import {
  formatNutritionStatus,
  formatNutritionExtractionWarning,
  NUTRITION_FILE_UPLOAD_LIMIT_HINT,
} from "@/features/nutrition/admin-labels";
import { validateNutritionUploadFiles } from "@/features/nutrition/file-upload-limits";
import type { NutritionFileUploadPreviewSnapshot } from "@/features/nutrition/file-preview-cookie";

type NutritionFileUploadPanelProps = {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  redirectTo: string;
  initialPreview: NutritionFileUploadPreviewSnapshot | null;
  previewAction: (
    prevState: NutritionFileUploadPreviewActionState,
    formData: FormData
  ) => Promise<NutritionFileUploadPreviewActionState>;
  saveAction: (formData: FormData) => Promise<void>;
};

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

function mapUnsupportedReason(reason: string): string {
  if (reason === "pdf_text_empty") {
    return "PDF похож на изображение, текст не извлечён.";
  }
  if (reason === "pdf_password_protected") {
    return "PDF защищён паролем.";
  }
  if (reason === "pdf_invalid_or_corrupted") {
    return "PDF повреждён или имеет неверный формат.";
  }
  if (reason === "daily_totals_not_found") {
    return "PDF прочитан, но дневные итоги не найдены.";
  }
  return reason;
}

export default function NutritionFileUploadPanel({
  studentId,
  weekFrom,
  weekTo,
  redirectTo,
  initialPreview,
  previewAction,
  saveAction,
}: NutritionFileUploadPanelProps) {
  const [state, formAction, pending] = useActionState(previewAction, NUTRITION_FILE_UPLOAD_PREVIEW_INITIAL_STATE);
  const [localPreviewError, setLocalPreviewError] = useState<string | null>(null);

  const activePreview = useMemo(() => state.preview ?? initialPreview, [initialPreview, state.preview]);
  const previewNotice = state.notice;
  const previewError = localPreviewError ?? state.error;

  return (
    <article className="admin-card admin-card-compact admin-nutrition-card-wide">
      <h3>Загрузить отчёт питания</h3>
      <p className="admin-muted admin-nutrition-helper">
        PDF, CSV, TXT, JPG/JPEG, PNG, WEBP, HEIC. {NUTRITION_FILE_UPLOAD_LIMIT_HINT}
      </p>

      <section className="admin-nutrition-upload-step">
        <h4>Шаг 1 — загрузить и распознать</h4>
        <form
          className="admin-form-stack"
          action={formAction}
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            setLocalPreviewError(null);
            const form = event.currentTarget;
            const input = form.querySelector<HTMLInputElement>('input[type="file"][name="reportFiles"]');
            if (!input?.files || input.files.length === 0) {
              return;
            }
            const error = validateNutritionUploadFiles([...input.files]);
            if (error) {
              event.preventDefault();
              setLocalPreviewError(error);
            }
          }}
        >
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <div className="admin-nutrition-kv-grid">
            <label className="admin-form-field">
              <span>Неделя с</span>
              <input className="admin-input" type="date" name="weekFrom" defaultValue={weekFrom} required />
            </label>
            <label className="admin-form-field">
              <span>Неделя по</span>
              <input className="admin-input" type="date" name="weekTo" defaultValue={weekTo} required />
            </label>
          </div>
          <label className="admin-form-field">
            <span>Файлы отчёта</span>
            <input
              className="admin-input"
              type="file"
              name="reportFiles"
              multiple
              required
              accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,.heic,image/heic,image/heif"
            />
          </label>
          <label className="admin-form-field">
            <span>Слова ученика (что прислал сам)</span>
            <textarea className="admin-textarea admin-textarea-compact" name="studentNotes" rows={2} />
          </label>
          <div className="admin-card-actions admin-card-actions-compact">
            <button className="admin-button admin-button-secondary" type="submit" disabled={pending}>
              {pending ? "Распознаю…" : "Загрузить и распознать"}
            </button>
          </div>
        </form>
      </section>

      {previewNotice && <div className="admin-alert admin-alert-success">{previewNotice}</div>}
      {previewError && <div className="admin-alert admin-alert-error">{previewError}</div>}

      {activePreview && (
        <>
          <div className="admin-card-actions admin-card-actions-compact">
            <span className={getBadgeClass(activePreview.status)}>{formatNutritionStatus(activePreview.status, "report")}</span>
            <span className="admin-muted">
              найдено дней: {activePreview.quality.parsedDays}
              {activePreview.rows.length > 0
                ? ` · даты: ${activePreview.rows[0]?.day.slice(5).replace("-", ".")}—${activePreview.rows.at(-1)?.day.slice(5).replace("-", ".")}`
                : ""}
              {` · низкая уверенность: ${activePreview.quality.lowConfidenceDays}`}
            </span>
          </div>
          {activePreview.extractionWarnings.length > 0 && (
            <div className="admin-alert admin-alert-warning">
              {activePreview.extractionWarnings.map(formatNutritionExtractionWarning).join(" | ")}
            </div>
          )}
          {activePreview.unsupportedFiles.length > 0 && (
            <div className="admin-alert admin-alert-warning">
              {activePreview.unsupportedFiles
                .map((item) => `${item.fileName}: ${mapUnsupportedReason(item.reason)}`)
                .join(" | ")}
            </div>
          )}
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
                {activePreview.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="admin-empty-cell">
                      Распознанных строк из файлов пока нет.
                    </td>
                  </tr>
                ) : (
                  activePreview.rows.map((row) => (
                    <tr key={`${row.day}-${row.kcal ?? "na"}-${row.confidence.toFixed(3)}`}>
                      <td>{row.day}</td>
                      <td>{row.kcal ?? "—"}</td>
                      <td>{row.proteinG ?? "—"}</td>
                      <td>{row.fatG ?? "—"}</td>
                      <td>{row.carbsG ?? "—"}</td>
                      <td>{row.confidence.toFixed(2)}</td>
                      <td>{row.notes ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {activePreview.files.length > 0 && (
            <details>
              <summary>Диагностика PDF</summary>
              <div className="admin-table-wrap">
                <table className="admin-table admin-table-compact">
                  <thead>
                    <tr>
                      <th>Файл</th>
                      <th>PDF</th>
                      <th>Текст</th>
                      <th>Найдено дней</th>
                      <th>Статус</th>
                      <th>Предупреждения</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePreview.files.map((file) => {
                      const parsedDays = file.extractionDiagnostics?.parsedRows ?? 0;
                      const textLen = file.extractionTextLength ?? 0;
                      const pdfReadable = file.extractionErrorCode ? "не прочитан" : "прочитан";
                      const compactStatus =
                        parsedDays >= 5 ? "готово" : parsedDays > 0 ? "мало дней" : "мало данных";
                      return (
                        <tr key={`${file.originalFileName}-${file.fileKind}`}>
                          <td>{file.originalFileName}</td>
                          <td>{file.fileKind === "pdf" ? pdfReadable : "—"}</td>
                          <td>{file.fileKind === "pdf" ? `${textLen} символов` : "—"}</td>
                          <td>{file.fileKind === "pdf" ? parsedDays : "—"}</td>
                          <td>{file.fileKind === "pdf" ? compactStatus : "—"}</td>
                          <td>{(file.extractionWarnings ?? []).map(formatNutritionExtractionWarning).join(" | ") || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <section className="admin-nutrition-upload-step admin-nutrition-upload-step-save">
            <h4>Шаг 2 — сохранить распознанный отчёт</h4>
            <p className="admin-muted">Для сохранения выберите тот же файл ещё раз.</p>
            <NutritionReportUploadForm className="admin-form-stack" action={saveAction}>
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="weekFrom" value={weekFrom} />
              <input type="hidden" name="weekTo" value={weekTo} />
              <label className="admin-form-field">
                <span>Файлы отчёта</span>
                <input
                  className="admin-input"
                  type="file"
                  name="reportFiles"
                  multiple
                  required
                  accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,.heic,image/heic,image/heif"
                />
              </label>
              <label className="admin-form-field">
                <span>Слова ученика (что прислал сам)</span>
                <textarea
                  className="admin-textarea admin-textarea-compact"
                  name="studentNotes"
                  rows={2}
                  placeholder="Слова ученика как есть: «очень старалась», «не было аппетита из-за жары», «во вторник овсянка перед бегом». Разбор учтёт их тоном — числа берёт только из PDF."
                />
              </label>
              <label className="admin-form-field">
                <span>Твой комментарий к этому отчёту</span>
                <textarea
                  className="admin-textarea admin-textarea-compact"
                  name="coachNotesRu"
                  rows={2}
                  placeholder="Контекст для разбора: интервалы натощак утром; уточнил, что ел перед длительной. ☑ ниже — помнить про ученика всегда."
                />
              </label>
              <label className="admin-form-field admin-form-field-inline">
                <input type="checkbox" name="rememberCoachNote" value="true" />
                <span>🧠 Запомнить про ученика (подтягивать в каждый разбор)</span>
              </label>
              <label className="admin-form-field">
                <span>Если данных мало</span>
                <select className="admin-input" name="forceNeedsReview" defaultValue="false">
                  <option value="false">Автостатус по качеству данных</option>
                  <option value="true">Сохранить как needs_review</option>
                </select>
              </label>
              <div className="admin-card-actions admin-card-actions-compact">
                <FormActionButton className="admin-button" pendingText="Сохраняю…">
                  Сохранить отчёт
                </FormActionButton>
              </div>
            </NutritionReportUploadForm>
          </section>
        </>
      )}
    </article>
  );
}
