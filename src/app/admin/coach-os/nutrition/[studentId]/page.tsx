import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import { formatIsoDate, getSingleSearchParam } from "@/app/admin/lib";
import {
  addNutritionContextNoteAction,
  addNutritionWeightAction,
  generateNutritionWeeklyReviewAction,
  parseNutritionManualMacrosAction,
  saveNutritionManualMacrosAction,
  saveNutritionProfileAction,
} from "@/app/admin/coach-os/nutrition/actions";
import {
  getNutritionAdminStudentCard,
  parseNutritionManualMacros,
} from "@/features/nutrition/admin";

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

function formatDoNotSendReasons(safetyFlags: Record<string, unknown>): string[] {
  const hardFlags = asStringArray(safetyFlags.hard_flags);
  return hardFlags.map((flag) => `manual_review_required:${flag}`);
}

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

  const card = await getNutritionAdminStudentCard({
    studentId,
    weekFrom,
    weekTo,
  });

  if (!card.student) {
    notFound();
  }

  const parsedPreview = rawText
    ? await parseNutritionManualMacros({
        studentId,
        weekFrom,
        weekTo,
        rawText,
      })
    : null;

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/coach-os/nutrition">
            ← Nutrition dashboard
          </Link>
          <h2>Nutrition Card · {card.student.studentName}</h2>
          <p className="admin-muted">
            {card.student.studentId} · {card.student.id}
          </p>
        </div>
        <span className={`admin-badge ${card.student.isActive ? "admin-badge-success" : "admin-badge-warning"}`}>
          {card.student.isActive ? "Active" : "Archived"}
        </span>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>{error ?? notice}</div>
      )}

      <div className="admin-grid admin-grid-student-detail">
        <article className="admin-card admin-card-compact">
          <h3>Student summary</h3>
          <dl className="admin-meta-list admin-meta-list-compact">
            <div>
              <dt>Weekly reports</dt>
              <dd>{card.student.weeklyReportEnabled ? "Enabled" : "Disabled"}</dd>
            </div>
            <div>
              <dt>Telegram delivery</dt>
              <dd>{card.student.telegramDeliveryEnabled ? "Enabled" : "Disabled"}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatIsoDate(card.student.updatedAt)}</dd>
            </div>
          </dl>
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Communication profile</h3>
          <dl className="admin-meta-list admin-meta-list-compact">
            <div>
              <dt>Formality</dt>
              <dd>{card.context.resolvedCommunicationProfile.formality}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{card.context.resolvedCommunicationProfile.formalitySource}</dd>
            </div>
            <div>
              <dt>Tone</dt>
              <dd>{card.context.resolvedCommunicationProfile.tone ?? "—"}</dd>
            </div>
            <div>
              <dt>Preferred greeting</dt>
              <dd>{card.context.resolvedCommunicationProfile.preferredGreeting ?? "—"}</dd>
            </div>
            <div>
              <dt>Conflict flags</dt>
              <dd>
                {card.context.resolvedCommunicationProfile.conflictFlags.length > 0
                  ? card.context.resolvedCommunicationProfile.conflictFlags.join(", ")
                  : "none"}
              </dd>
            </div>
          </dl>
        </article>

        <article className="admin-card">
          <h3>Nutrition profile</h3>
          <form className="admin-form-stack" action={saveNutritionProfileAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="redirectTo" value={`/admin/coach-os/nutrition/${studentId}`} />
            <label className="admin-form-field">
              <span>Enabled</span>
              <select name="enabled" className="admin-input" defaultValue={card.profile?.enabled ? "true" : "false"}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </label>
            <label className="admin-form-field">
              <span>Goal</span>
              <input className="admin-input" name="goal" defaultValue={card.profile?.goal ?? ""} />
            </label>
            <label className="admin-form-field">
              <span>Tracking app</span>
              <input className="admin-input" name="trackingApp" defaultValue={card.profile?.trackingApp ?? ""} />
            </label>
            <label className="admin-form-field">
              <span>Current weight (kg)</span>
              <input className="admin-input" name="currentWeightKg" type="number" step="0.1" defaultValue={card.profile?.currentWeightKg ?? ""} />
            </label>
            <label className="admin-form-field">
              <span>Tolerance notes</span>
              <textarea className="admin-textarea admin-textarea-compact" name="toleranceNotes" rows={3} defaultValue={card.profile?.toleranceNotes ?? ""} />
            </label>
            <label className="admin-form-field">
              <span>Coach notes</span>
              <textarea className="admin-textarea admin-textarea-compact" name="coachNotes" rows={3} defaultValue={card.profile?.coachNotes ?? ""} />
            </label>
            <FormActionButton className="admin-button" pendingText="Saving...">
              Save nutrition profile
            </FormActionButton>
          </form>
        </article>

        <article className="admin-card">
          <h3>Weight logs</h3>
          <form className="admin-form-inline" action={addNutritionWeightAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="redirectTo" value={`/admin/coach-os/nutrition/${studentId}`} />
            <input className="admin-input" name="weightKg" type="number" step="0.1" placeholder="kg" required />
            <input className="admin-input" name="source" defaultValue="manual" />
            <FormActionButton className="admin-button" pendingText="Adding...">
              Add weight
            </FormActionButton>
          </form>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table-compact">
              <thead>
                <tr>
                  <th>Logged at</th>
                  <th>Weight</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {card.weightLogs.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="admin-empty-cell">
                      No weight logs yet.
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

        <article className="admin-card">
          <h3>Nutrition context notes</h3>
          <form className="admin-form-inline" action={addNutritionContextNoteAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="redirectTo" value={`/admin/coach-os/nutrition/${studentId}`} />
            <select className="admin-input" name="itemType" defaultValue="note">
              <option value="preference">preference</option>
              <option value="dislike">dislike</option>
              <option value="tolerance">tolerance</option>
              <option value="energy">energy</option>
              <option value="hunger">hunger</option>
              <option value="gi">gi</option>
              <option value="training_food_experience">training_food_experience</option>
              <option value="note">note</option>
            </select>
            <input className="admin-input" name="text" placeholder="Context note..." required />
            <FormActionButton className="admin-button" pendingText="Adding...">
              Add context note
            </FormActionButton>
          </form>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table-compact">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Text</th>
                  <th>Priority</th>
                </tr>
              </thead>
              <tbody>
                {card.contextItems.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="admin-empty-cell">
                      No nutrition context notes yet.
                    </td>
                  </tr>
                ) : (
                  card.contextItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.itemType}</td>
                      <td>{item.text}</td>
                      <td>{item.priority}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="admin-card">
          <h3>Manual macro input</h3>
          <form className="admin-form-stack" action={parseNutritionManualMacrosAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="redirectTo" value={`/admin/coach-os/nutrition/${studentId}`} />
            <label className="admin-form-field">
              <span>Week from</span>
              <input className="admin-input" type="date" name="weekFrom" defaultValue={weekFrom} />
            </label>
            <label className="admin-form-field">
              <span>Week to</span>
              <input className="admin-input" type="date" name="weekTo" defaultValue={weekTo} />
            </label>
            <label className="admin-form-field">
              <span>Raw manual macro text</span>
              <textarea className="admin-textarea" name="rawText" rows={6} defaultValue={rawText} />
            </label>
            <div className="admin-card-actions admin-card-actions-compact">
              <FormActionButton className="admin-button admin-button-secondary" pendingText="Parsing...">
                Parse manual macros
              </FormActionButton>
            </div>
          </form>

          <form className="admin-form-stack" action={saveNutritionManualMacrosAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="weekFrom" value={weekFrom} />
            <input type="hidden" name="weekTo" value={weekTo} />
            <input type="hidden" name="rawText" value={rawText} />
            <input type="hidden" name="redirectTo" value={`/admin/coach-os/nutrition/${studentId}`} />
            <FormActionButton className="admin-button" pendingText="Saving...">
              Confirm/save parsed macros
            </FormActionButton>
          </form>

          {parsedPreview && (
            <>
              <div className="admin-card-actions admin-card-actions-compact">
                <span className={getBadgeClass(parsedPreview.status)}>
                  status: {parsedPreview.status}
                </span>
                <span className="admin-muted">
                  parsed days: {parsedPreview.quality.parsedDays}, low confidence: {parsedPreview.quality.lowConfidenceDays}
                </span>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table admin-table-compact">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>kcal</th>
                      <th>Protein</th>
                      <th>Fat</th>
                      <th>Carbs</th>
                      <th>Confidence</th>
                      <th>Notes</th>
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

        <article className="admin-card">
          <h3>TrainingPeaks context from cache</h3>
          <div className="admin-summary-grid">
            <article className="admin-card admin-summary-card">
              <span className="admin-summary-label">Past week cache</span>
              <strong className="admin-summary-value">{card.context.tpPastWeek.cacheStatus}</strong>
            </article>
            <article className="admin-card admin-summary-card">
              <span className="admin-summary-label">Next week cache</span>
              <strong className="admin-summary-value">{card.context.tpNextWeek.cacheStatus}</strong>
            </article>
            <article className="admin-card admin-summary-card">
              <span className="admin-summary-label">Past key sessions</span>
              <strong className="admin-summary-value">{card.context.tpPastWeek.keyWorkouts.length}</strong>
            </article>
            <article className="admin-card admin-summary-card">
              <span className="admin-summary-label">Next key sessions</span>
              <strong className="admin-summary-value">{card.context.tpNextWeek.keyWorkouts.length}</strong>
            </article>
          </div>
          <p className="admin-muted">{card.context.tpPastWeek.cacheStatusNote}</p>
          <p className="admin-muted">{card.context.tpNextWeek.cacheStatusNote}</p>
        </article>

        <article className="admin-card">
          <h3>Saved reports (this week)</h3>
          <p className="admin-muted">
            Each save creates a new report row. Older reports are kept; macros are scoped per report.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table-compact">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Report ID</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {card.reports.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="admin-empty-cell">
                      No saved reports for {weekFrom} — {weekTo}.
                    </td>
                  </tr>
                ) : (
                  card.reports.map((report) => (
                    <tr key={report.id}>
                      <td>{formatIsoDate(report.createdAt)}</td>
                      <td>
                        <span className={getBadgeClass(report.status)}>{report.status}</span>
                      </td>
                      <td>
                        <code>{report.id}</code>
                      </td>
                      <td>{report.sourceType}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="admin-card">
          <h3>Generate weekly review</h3>
          <p className="admin-muted">
            Generates internal analysis and a copy-only draft. Hard safety flags block athlete draft text.
          </p>
          <form className="admin-form-stack" action={generateNutritionWeeklyReviewAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="weekFrom" value={weekFrom} />
            <input type="hidden" name="weekTo" value={weekTo} />
            <input type="hidden" name="redirectTo" value={`/admin/coach-os/nutrition/${studentId}`} />
            <label className="admin-form-field">
              <span>Nutrition report</span>
              {card.reports.length > 0 ? (
                <select className="admin-input" name="reportId" required defaultValue={card.reports[0]?.id}>
                  {card.reports.map((report) => (
                    <option key={report.id} value={report.id}>
                      {formatIsoDate(report.createdAt)} · {report.status} · {report.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="admin-input" name="reportId" placeholder="Save a report first" required disabled />
              )}
            </label>
            <FormActionButton className="admin-button" pendingText="Generating..." disabled={card.reports.length === 0}>
              Generate weekly review
            </FormActionButton>
          </form>
        </article>

        <article className="admin-card">
          <h3>Saved weekly review (copy-only)</h3>
          {!card.weeklyAnalysis ? (
            <p className="admin-muted">No weekly review saved for {weekFrom} — {weekTo} yet.</p>
          ) : (
            <div className="admin-form-stack">
              <div className="admin-card-actions admin-card-actions-compact">
                <span className={getBadgeClass(card.weeklyAnalysis.status)}>{card.weeklyAnalysis.status}</span>
                <span className="admin-muted">updated {formatIsoDate(card.weeklyAnalysis.updatedAt)}</span>
              </div>

              {card.weeklyAnalysis.status === "blocked_safety" && (
                <div className="admin-alert admin-alert-error">
                  <strong>Safety block active.</strong> Athlete-facing draft is suppressed. Review hard flags and do-not-send
                  reasons before any manual copy.
                </div>
              )}

              <section>
                <h4>Internal summary</h4>
                <textarea
                  className="admin-textarea admin-textarea-compact"
                  rows={6}
                  readOnly
                  value={JSON.stringify(card.weeklyAnalysis.internalSummary, null, 2)}
                />
              </section>

              <section>
                <h4>Nutrition summary</h4>
                <textarea
                  className="admin-textarea admin-textarea-compact"
                  rows={4}
                  readOnly
                  value={JSON.stringify(card.weeklyAnalysis.nutritionSummary, null, 2)}
                />
              </section>

              <section>
                <h4>Safety flags</h4>
                <textarea
                  className="admin-textarea admin-textarea-compact"
                  rows={4}
                  readOnly
                  value={JSON.stringify(card.weeklyAnalysis.safetyFlags, null, 2)}
                />
                {formatDoNotSendReasons(card.weeklyAnalysis.safetyFlags).length > 0 && (
                  <div className="admin-meta-list admin-meta-list-compact">
                    <div>
                      <dt>Do-not-send reasons</dt>
                      <dd>{formatDoNotSendReasons(card.weeklyAnalysis.safetyFlags).join(", ")}</dd>
                    </div>
                  </div>
                )}
              </section>

              <section>
                <h4>Athlete draft (copy-only)</h4>
                {card.weeklyAnalysis.athleteMessageDraft ? (
                  <textarea
                    className="admin-textarea"
                    rows={8}
                    readOnly
                    value={card.weeklyAnalysis.athleteMessageDraft}
                  />
                ) : (
                  <p className="admin-muted">Athlete draft suppressed (safety block or insufficient data).</p>
                )}
              </section>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
