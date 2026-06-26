import { getSingleSearchParam } from "@/app/admin/lib";
import FormActionButton from "@/app/admin/FormActionButton";
import { closeHealthSignalAction } from "@/app/admin/coach-os/signals/actions";
import {
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudentContactStatus,
  listTrainingPeaksStudents,
  isAdminCloseableHealthSignalType,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import {
  getTrainingPeaksAttentionSnapshot,
  resolveOperationalSignalDisplaySummary,
} from "@/features/trainingpeaks/service";

type SignalsAdminPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const maxDuration = 30;

const HEALTH_SIGNAL_TYPE_LABELS: Record<string, string> = {
  pain_injury: "травма / боль",
  health_issue_started: "болезнь (начало)",
  health_issue_improving: "болезнь (улучшение)",
  health_issue_resolved: "болезнь (восстановление)",
  resume_training: "возобновление тренировок",
};

const CLOSE_REASON_LABELS: Record<string, string> = {
  recovered: "Выздоровел / прошло",
  false_positive: "Ошибочный сигнал",
  obsolete: "Неактуально",
};

const COACH_IDLE_THRESHOLD_DAYS = 3;
const ATHLETE_SILENT_THRESHOLD_DAYS = 5;

function daysSince(isoTimestamp: string | null): number | null {
  if (!isoTimestamp) {
    return null;
  }
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function formatDaysLabel(days: number | null): string {
  if (days === null) {
    return "—";
  }
  if (days === 0) {
    return "сегодня";
  }
  if (days === 1) {
    return "вчера";
  }
  return `${days} дн. назад`;
}

function formatIsoDateShort(isoTimestamp: string | null): string {
  if (!isoTimestamp) {
    return "—";
  }
  const d = new Date(isoTimestamp);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function getSignalTypeLabel(signalType: string): string {
  return HEALTH_SIGNAL_TYPE_LABELS[signalType] ?? signalType.replace(/_/g, " ");
}

type HealthSignalRow = {
  signal: TrainingPeaksStudentOperationalSignal;
  studentName: string | null;
  displaySummary: string | null;
  ageDays: number | null;
};

export default async function SignalsAdminPage({ searchParams }: SignalsAdminPageProps) {
  const resolved = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolved.notice);
  const error = getSingleSearchParam(resolved.error);

  const [r0, r1, r2, r3] = await Promise.allSettled([
    listTrainingPeaksOperationalSignals({ status: "active", limit: 200 }),
    listTrainingPeaksStudents(),
    listTrainingPeaksStudentContactStatus(),
    getTrainingPeaksAttentionSnapshot(),
  ]);

  const activeSignalsResult = r0.status === "fulfilled" ? r0.value : { items: [] as TrainingPeaksStudentOperationalSignal[], total: 0 };
  const students = r1.status === "fulfilled" ? r1.value : [];
  const contactStatuses = r2.status === "fulfilled" ? r2.value : [];
  const snapshotResult = r3.status === "fulfilled" ? r3.value : null;

  const loadFailedSources: string[] = [];
  if (r0.status === "rejected") loadFailedSources.push("операционные сигналы");
  if (r1.status === "rejected") loadFailedSources.push("список учеников");
  if (r2.status === "rejected") loadFailedSources.push("статус связи");
  if (r3.status === "rejected") loadFailedSources.push("скан активности (пропуски / доступность)");

  const studentNameById = new Map(
    students.map((s) => [s.id, s.studentName?.trim() || null])
  );

  const activeSignals = activeSignalsResult.items;

  // Health basket — signals with close button
  const healthSignals: HealthSignalRow[] = activeSignals
    .filter((s) => isAdminCloseableHealthSignalType(s.signalType))
    .sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return aTime - bTime; // oldest first
    })
    .map((signal) => ({
      signal,
      studentName: studentNameById.get(signal.studentId) ?? null,
      displaySummary: resolveOperationalSignalDisplaySummary(signal),
      ageDays: daysSince(signal.createdAt),
    }));

  // Contact basket — split into coach-idle vs athlete-silent
  const activeStudentIds = new Set(students.map((s) => s.id));
  const coachIdleList = contactStatuses
    .filter((s) => {
      if (!activeStudentIds.has(s.studentId)) {
        return false;
      }
      const days = daysSince(s.lastCoachTouchAt);
      return days !== null && days >= COACH_IDLE_THRESHOLD_DAYS;
    })
    .sort((a, b) => {
      const aDays = daysSince(a.lastCoachTouchAt) ?? 0;
      const bDays = daysSince(b.lastCoachTouchAt) ?? 0;
      return bDays - aDays; // longest idle first
    })
    .map((s) => ({
      studentId: s.studentId,
      studentName: studentNameById.get(s.studentId) ?? s.studentId,
      coachIdleDays: daysSince(s.lastCoachTouchAt),
      athleteSilentDays: daysSince(s.lastAthleteMessageAt),
    }));

  const athleteSilentList = contactStatuses
    .filter((s) => {
      if (!activeStudentIds.has(s.studentId)) {
        return false;
      }
      const days = daysSince(s.lastAthleteMessageAt);
      return days !== null && days >= ATHLETE_SILENT_THRESHOLD_DAYS;
    })
    .sort((a, b) => {
      const aDays = daysSince(a.lastAthleteMessageAt) ?? 0;
      const bDays = daysSince(b.lastAthleteMessageAt) ?? 0;
      return bDays - aDays;
    })
    .map((s) => ({
      studentId: s.studentId,
      studentName: studentNameById.get(s.studentId) ?? s.studentId,
      coachIdleDays: daysSince(s.lastCoachTouchAt),
      athleteSilentDays: daysSince(s.lastAthleteMessageAt),
    }));

  const missedWorkouts = snapshotResult?.missedWorkouts ?? [];
  const planConstraints = snapshotResult?.planConstraintsToday ?? [];

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2>Сигналы · Coach OS</h2>
          <p className="admin-muted">
            Активные сигналы по 4 корзинам. Здоровье можно закрыть — остальные обновляются автоматически.
          </p>
        </div>
        <span className="admin-badge admin-badge-outline">Закрытие только сигналов здоровья</span>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>
          {error ?? notice}
        </div>
      )}

      {loadFailedSources.length > 0 && (
        <div className="admin-alert admin-alert-error">
          Не удалось загрузить: {loadFailedSources.join(", ")}. Данные могут быть неполными — обновите страницу.
        </div>
      )}

      <div className="admin-summary-grid admin-summary-grid-compact">
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">🩺 Здоровье</span>
          <strong className="admin-summary-value">{healthSignals.length}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">🏃 Пропуск</span>
          <strong className="admin-summary-value">{missedWorkouts.length}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">📅 Доступность</span>
          <strong className="admin-summary-value">{planConstraints.length}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">📭 Я молчу ≥{COACH_IDLE_THRESHOLD_DAYS}д</span>
          <strong className="admin-summary-value">{coachIdleList.length}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">📭 Ученик молчит ≥{ATHLETE_SILENT_THRESHOLD_DAYS}д</span>
          <strong className="admin-summary-value">{athleteSilentList.length}</strong>
        </article>
      </div>

      {/* 🩺 ЗДОРОВЬЕ */}
      <section className="admin-section" id="health">
        <div className="admin-section-header">
          <div>
            <h3>🩺 Здоровье — болезни и травмы</h3>
            <p className="admin-muted">
              Все активные сигналы здоровья. У каждого — кнопка закрытия с подтверждением и выбором причины.
            </p>
          </div>
        </div>

        {healthSignals.length === 0 ? (
          <div className="admin-card">
            <p className="admin-muted">Нет активных сигналов здоровья.</p>
          </div>
        ) : (
          <div className="admin-card admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ученик</th>
                  <th>Тип</th>
                  <th>Суть</th>
                  <th>Создан</th>
                  <th>Висит</th>
                  <th>Закрыть</th>
                </tr>
              </thead>
              <tbody>
                {healthSignals.map(({ signal, studentName, displaySummary, ageDays }) => (
                  <tr key={signal.id}>
                    <td>
                      <strong>{studentName ?? signal.studentId}</strong>
                    </td>
                    <td>
                      <span className="admin-badge admin-badge-warning">
                        {getSignalTypeLabel(signal.signalType)}
                      </span>
                    </td>
                    <td>
                      <span className="admin-muted">{displaySummary ?? "—"}</span>
                    </td>
                    <td>{formatIsoDateShort(signal.createdAt)}</td>
                    <td>{formatDaysLabel(ageDays)}</td>
                    <td>
                      <form action={closeHealthSignalAction}>
                        <input type="hidden" name="signalId" value={signal.id} />
                        <input type="hidden" name="studentId" value={signal.studentId} />
                        <div className="admin-inline-actions">
                          <select
                            name="closeReason"
                            className="admin-input"
                            defaultValue="recovered"
                          >
                            {Object.entries(CLOSE_REASON_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <FormActionButton
                            className="admin-button admin-button-secondary admin-button-compact"
                            pendingText="Закрываем…"
                            confirmMessage={`Закрыть сигнал "${getSignalTypeLabel(signal.signalType)}" у ${studentName ?? signal.studentId}? Действие необратимо.`}
                          >
                            Закрыть
                          </FormActionButton>
                        </div>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 🏃 ПРОПУСК ТРЕНИРОВКИ */}
      <section className="admin-section" id="missed">
        <div className="admin-section-header">
          <div>
            <h3>🏃 Пропуск тренировки — вчера</h3>
            <p className="admin-muted">
              Запланированная беговая тренировка вчера не выполнена (по данным TP-скана).
              Обновляется автоматически — закрытие не требуется.
            </p>
          </div>
        </div>

        {missedWorkouts.length === 0 ? (
          <div className="admin-card">
            <p className="admin-muted">Нет пропусков вчера (или скан ещё не готов).</p>
          </div>
        ) : (
          <div className="admin-card admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ученик</th>
                  <th>Суть</th>
                </tr>
              </thead>
              <tbody>
                {missedWorkouts.map((signal, idx) => (
                  <tr key={`missed-${idx}-${signal.studentId ?? signal.studentName}`}>
                    <td>
                      <strong>{signal.studentName ?? "—"}</strong>
                    </td>
                    <td>
                      <span className="admin-muted">{signal.reason}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 📅 ДОСТУПНОСТЬ / ПЛАН */}
      <section className="admin-section" id="plan">
        <div className="admin-section-header">
          <div>
            <h3>📅 Доступность — учесть в плане</h3>
            <p className="admin-muted">
              Активные ограничения расписания и доступности. Уходят сами по датам.
            </p>
          </div>
        </div>

        {planConstraints.length === 0 ? (
          <div className="admin-card">
            <p className="admin-muted">Нет активных ограничений расписания.</p>
          </div>
        ) : (
          <div className="admin-card admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ученик</th>
                  <th>Суть</th>
                </tr>
              </thead>
              <tbody>
                {planConstraints.map((signal, idx) => (
                  <tr key={`plan-${idx}-${signal.studentId ?? signal.studentName}`}>
                    <td>
                      <strong>{signal.studentName ?? "—"}</strong>
                    </td>
                    <td>
                      <span className="admin-muted">{signal.reason}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 📭 СВЯЗЬ */}
      <section className="admin-section" id="contact">
        <div className="admin-section-header">
          <div>
            <h3>📭 Связь</h3>
            <p className="admin-muted">
              Два независимых среза: тренер давно не писал (coach idle ≥{COACH_IDLE_THRESHOLD_DAYS}д)
              и ученик молчит (athlete silent ≥{ATHLETE_SILENT_THRESHOLD_DAYS}д).
            </p>
          </div>
        </div>

        <div className="admin-section-header">
          <div>
            <h4>Я давно не писал (coach idle ≥{COACH_IDLE_THRESHOLD_DAYS} дн.)</h4>
          </div>
        </div>

        {coachIdleList.length === 0 ? (
          <div className="admin-card">
            <p className="admin-muted">Все ученики получили сообщение в последние {COACH_IDLE_THRESHOLD_DAYS} дня.</p>
          </div>
        ) : (
          <div className="admin-card admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ученик</th>
                  <th>Тренер молчит</th>
                  <th>Ученик молчит</th>
                </tr>
              </thead>
              <tbody>
                {coachIdleList.map(({ studentId, studentName, coachIdleDays, athleteSilentDays }) => (
                  <tr key={`coach-idle-${studentId}`}>
                    <td>
                      <strong>{studentName}</strong>
                    </td>
                    <td>
                      <span className="admin-badge admin-badge-warning">
                        {formatDaysLabel(coachIdleDays)}
                      </span>
                    </td>
                    <td>{formatDaysLabel(athleteSilentDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="admin-section-header">
          <div>
            <h4>Ученик молчит (athlete silent ≥{ATHLETE_SILENT_THRESHOLD_DAYS} дн.)</h4>
          </div>
        </div>

        {athleteSilentList.length === 0 ? (
          <div className="admin-card">
            <p className="admin-muted">Все ученики писали в последние {ATHLETE_SILENT_THRESHOLD_DAYS} дней.</p>
          </div>
        ) : (
          <div className="admin-card admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ученик</th>
                  <th>Ученик молчит</th>
                  <th>Тренер молчит</th>
                </tr>
              </thead>
              <tbody>
                {athleteSilentList.map(({ studentId, studentName, coachIdleDays, athleteSilentDays }) => (
                  <tr key={`athlete-silent-${studentId}`}>
                    <td>
                      <strong>{studentName}</strong>
                    </td>
                    <td>
                      <span className="admin-badge admin-badge-warning">
                        {formatDaysLabel(athleteSilentDays)}
                      </span>
                    </td>
                    <td>{formatDaysLabel(coachIdleDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
