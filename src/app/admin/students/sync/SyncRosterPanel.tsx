"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  applyTrainingPeaksRosterSyncAction,
  previewTrainingPeaksRosterSyncAction,
} from "@/app/admin/actions";
import type { TrainingPeaksRosterSyncPreviewResult } from "@/app/admin/students/sync/types";
import type { ApplyTrainingPeaksRosterImportResult } from "@/features/trainingpeaks/admin";
import type { ImportPlan, WouldInsertRow } from "@/features/trainingpeaks/athlete-roster-import";

function SummaryBadges({ summary }: { summary: ImportPlan["summary"] }) {
  return (
    <div className="admin-badge-row">
      <span className="admin-badge admin-badge-accent">Новых: {summary.would_insert}</span>
      <span className="admin-badge admin-badge-muted">В TP всего: {summary.discovered_total}</span>
      <span className="admin-badge admin-badge-muted">Уже в базе: {summary.already_exists}</span>
      {summary.archived_existing > 0 && (
        <span className="admin-badge admin-badge-warning">В архиве: {summary.archived_existing}</span>
      )}
      {summary.slug_collisions > 0 && (
        <span className="admin-badge admin-badge-warning">Коллизии кода: {summary.slug_collisions}</span>
      )}
      {summary.name_warnings > 0 && (
        <span className="admin-badge admin-badge-warning">Совпадения имён: {summary.name_warnings}</span>
      )}
      {summary.supabase_not_in_tp > 0 && (
        <span className="admin-badge admin-badge-outline">В базе, но не в TP: {summary.supabase_not_in_tp}</span>
      )}
    </div>
  );
}

function ApplyResultView({ result }: { result: ApplyTrainingPeaksRosterImportResult }) {
  const problems = result.results.filter((row) => row.outcome !== "inserted");
  return (
    <div className="admin-card">
      <div className="admin-badge-row">
        <span className="admin-badge admin-badge-success">Добавлено: {result.inserted}</span>
        {result.skipped > 0 && <span className="admin-badge admin-badge-muted">Пропущено: {result.skipped}</span>}
        {result.failed > 0 && <span className="admin-badge admin-badge-danger">Ошибок: {result.failed}</span>}
      </div>
      {problems.length > 0 && (
        <ul className="admin-list">
          {problems.map((row) => (
            <li key={row.student_id}>
              <strong>{row.student_name}</strong> ({row.student_id}) —{" "}
              {row.outcome === "skipped" ? "пропущен" : "ошибка"}
              {row.message ? `: ${row.message}` : ""}
            </li>
          ))}
        </ul>
      )}
      <div className="admin-actions">
        <Link className="admin-button" href="/admin/students">
          К списку учеников
        </Link>
      </div>
    </div>
  );
}

export default function SyncRosterPanel() {
  const [preview, setPreview] = useState<TrainingPeaksRosterSyncPreviewResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applyResult, setApplyResult] = useState<ApplyTrainingPeaksRosterImportResult | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isPreviewing, startPreview] = useTransition();
  const [isApplying, startApply] = useTransition();

  const plan = preview?.ok ? preview.plan : null;

  function handlePreview() {
    setApplyResult(null);
    setApplyError(null);
    startPreview(async () => {
      try {
        const result = await previewTrainingPeaksRosterSyncAction();
        setPreview(result);
        if (result.ok) {
          setSelectedIds(new Set(result.plan.would_insert.map((row) => row.student_id)));
        }
      } catch {
        setPreview({
          ok: false,
          kind: "unknown",
          message: "Не удалось выполнить запрос к серверу. Попробуй ещё раз.",
        });
      }
    });
  }

  function toggle(studentId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  }

  function setAll(rows: WouldInsertRow[], checked: boolean) {
    setSelectedIds(checked ? new Set(rows.map((row) => row.student_id)) : new Set());
  }

  function handleApply(rows: WouldInsertRow[]) {
    const selected = rows.filter((row) => selectedIds.has(row.student_id));
    if (selected.length === 0) return;
    setApplyError(null);
    startApply(async () => {
      try {
        const result = await applyTrainingPeaksRosterSyncAction(selected);
        setApplyResult(result);
      } catch {
        setApplyError("Не удалось добавить учеников. Попробуй ещё раз.");
      }
    });
  }

  return (
    <div className="admin-form-stack">
      <div className="admin-actions">
        <button type="button" className="admin-button" onClick={handlePreview} disabled={isPreviewing}>
          {isPreviewing ? "Загрузка ростера..." : "Загрузить ростер из TrainingPeaks"}
        </button>
      </div>

      {preview && !preview.ok && <div className="admin-alert admin-alert-error">{preview.message}</div>}

      {plan && (
        <article className="admin-card">
          <SummaryBadges summary={plan.summary} />

          {plan.would_insert.length === 0 ? (
            <div className="admin-alert admin-alert-success">Новых спортсменов нет — всё уже в базе.</div>
          ) : (
            <>
              <div className="admin-actions">
                <button
                  type="button"
                  className="admin-button admin-button-secondary admin-button-small"
                  onClick={() => setAll(plan.would_insert, true)}
                >
                  Выбрать всех
                </button>
                <button
                  type="button"
                  className="admin-button admin-button-secondary admin-button-small"
                  onClick={() => setAll(plan.would_insert, false)}
                >
                  Снять все
                </button>
              </div>

              <ul className="admin-list">
                {plan.would_insert.map((row) => (
                  <li key={row.student_id}>
                    <label style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.student_id)}
                        onChange={() => toggle(row.student_id)}
                      />
                      <span>
                        <strong>{row.student_name}</strong>{" "}
                        <span className="admin-muted">
                          ({row.student_id} · athlete {row.athlete_id})
                        </span>
                        {row.slug_suffix != null && (
                          <span className="admin-badge admin-badge-warning" style={{ marginLeft: "0.4rem" }}>
                            код с суффиксом -{row.slug_suffix}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <div className="admin-actions">
                <button
                  type="button"
                  className="admin-button"
                  onClick={() => handleApply(plan.would_insert)}
                  disabled={isApplying || selectedIds.size === 0}
                >
                  {isApplying ? "Добавление..." : `Добавить выбранных (${selectedIds.size})`}
                </button>
              </div>

              {applyError && <div className="admin-alert admin-alert-error">{applyError}</div>}
            </>
          )}

          {plan.name_warnings.length > 0 && (
            <details>
              <summary>Совпадения имён ({plan.name_warnings.length})</summary>
              <ul className="admin-list">
                {plan.name_warnings.map((row) => (
                  <li key={`${row.athlete_id}-${row.existing_student_id}`}>
                    TP «{row.display_name}» (athlete {row.athlete_id}) совпадает по имени с существующим{" "}
                    {row.existing_student_name} ({row.existing_student_id})
                  </li>
                ))}
              </ul>
            </details>
          )}

          {plan.archived_existing.length > 0 && (
            <details>
              <summary>В архиве, повторно не добавляются ({plan.archived_existing.length})</summary>
              <ul className="admin-list">
                {plan.archived_existing.map((row) => (
                  <li key={row.existing_student_id}>
                    {row.display_name} → {row.existing_student_id} (совпадение по {row.match_by})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </article>
      )}

      {applyResult && <ApplyResultView result={applyResult} />}
    </div>
  );
}
