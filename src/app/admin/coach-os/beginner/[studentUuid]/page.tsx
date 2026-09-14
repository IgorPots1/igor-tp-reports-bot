import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import { todayIsoInCoachTimezone } from "@/features/intervals/loop/clock";
import { isCoachSendEnabled } from "@/features/intervals/loop/coach-message";
import { listIntervalsStudents, loadCoachStudentView } from "@/features/intervals/loop/coach-view";
import { BEGINNER_LADDER } from "@/features/methodology/beginner";

import { publishPlanAction, sendCoachMessageAction } from "../actions";

export const dynamic = "force-dynamic";

const cell = { padding: "6px 10px", verticalAlign: "top" as const };
const box = {
  border: "1px solid #e0e0e0",
  borderRadius: 10,
  padding: "14px 16px",
  marginBottom: 18,
  maxWidth: 900,
};

export default async function BeginnerStudentPage({
  params,
}: {
  params: Promise<{ studentUuid: string }>;
}) {
  const { studentUuid } = await params;
  const students = await listIntervalsStudents();
  const student = students.find((row) => row.studentUuid === studentUuid);
  if (!student) notFound();

  const today = todayIsoInCoachTimezone();
  const view = await loadCoachStudentView(student, today);
  const sendEnabled = isCoachSendEnabled();

  const draftCycle =
    view.latestCycle && view.latestCycle.status === "draft" ? view.latestCycle : null;

  return (
    <section>
      <p>
        <Link href="/admin/coach-os/beginner">← Ученики Intervals</Link>
      </p>
      <h1>{student.studentName}</h1>

      {!student.sourceId ? (
        <p style={{ color: "#a33" }}>
          Источник Intervals не заведён — плана и тренировок не будет. Заведите строку в{" "}
          <code>student_data_sources</code>.
        </p>
      ) : null}

      {/* ── Ступень ── */}
      <div style={box}>
        <h2 style={{ marginTop: 0 }}>Ступень</h2>
        {view.progression ? (
          <>
            <p style={{ margin: "0 0 6px", fontSize: 18 }}>
              <strong>
                {view.progression.currentStep} из {BEGINNER_LADDER.length}
              </strong>{" "}
              — {view.stepLabelRu}
            </p>
            <p style={{ margin: 0, color: "#555" }}>
              сессий на ступени: {view.progression.sessionsAtStep} · методика{" "}
              {view.progression.methodologyId} {view.progression.methodologyVersion} · последний переход:{" "}
              {view.progression.lastTransitionAt ?? "не было"}
            </p>
          </>
        ) : (
          <p style={{ margin: 0, color: "#555" }}>
            Состояния нет — прогрессия заведётся при записи первого плана.
          </p>
        )}
      </div>

      {/* ── Анкета ── */}
      <div style={box}>
        <h2 style={{ marginTop: 0 }}>Анкета</h2>
        {view.answers ? (
          <>
            <p style={{ margin: "0 0 6px" }}>
              цель: <strong>{view.answers.goalKind}</strong>
              {view.answers.raceDate ? ` · старт ${view.answers.raceDate}` : ""}
              {view.answers.raceDistanceKm ? ` · ${view.answers.raceDistanceKm} км` : ""}
            </p>
            <p style={{ margin: "0 0 6px" }}>
              дней в неделю: {view.answers.daysPerWeek} · недоступные дни:{" "}
              {view.answers.unavailableWeekdays.length > 0
                ? view.answers.unavailableWeekdays.join(", ")
                : "нет"}{" "}
              · длительная:{" "}
              {view.answers.preferredLongWeekday === null
                ? "не задана"
                : String(view.answers.preferredLongWeekday)}{" "}
              · непрерывно:{" "}
              {view.answers.canRunContinuously === null
                ? "не спрашивали"
                : view.answers.canRunContinuously
                  ? "может"
                  : "пока нет"}
            </p>
            {view.answers.coachNote ? (
              <div style={{ marginTop: 10, background: "#fffbe6", padding: "10px 12px", borderRadius: 8 }}>
                <strong>Что важно знать тренеру:</strong>
                <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{view.answers.coachNote}</p>
              </div>
            ) : null}
          </>
        ) : (
          <p style={{ margin: 0, color: "#555" }}>Анкета ещё не заполнена.</p>
        )}
      </div>

      {/* ── План ── */}
      <div style={box}>
        <h2 style={{ marginTop: 0 }}>План</h2>
        {view.latestCycle ? (
          <>
            <p style={{ margin: "0 0 10px" }}>
              цикл {view.latestCycle.id.slice(0, 8)} · статус <strong>{view.latestCycle.status}</strong> ·{" "}
              {view.latestCycle.lengthWeeks} нед с {view.latestCycle.firstWeekStart} · данные{" "}
              {view.latestCycle.dataLevel} · стартовая точка {view.latestCycle.startPointSource}
            </p>

            {draftCycle ? (
              <form action={publishPlanAction} style={{ marginBottom: 12 }}>
                <input type="hidden" name="studentUuid" value={studentUuid} />
                <input type="hidden" name="cycleId" value={draftCycle.id} />
                <input type="hidden" name="sourceId" value={student.sourceId ?? ""} />
                <FormActionButton
                  confirmMessage="Показать этот план ученице? После подтверждения она увидит его в приложении."
                  pendingText="Публикую…"
                >
                  Показать ученице
                </FormActionButton>
                <span style={{ marginLeft: 10, color: "#a33" }}>
                  сейчас ученица плана НЕ видит — это черновик
                </span>
              </form>
            ) : (
              <p style={{ margin: "0 0 12px", color: "#2E7D45" }}>
                Опубликован {view.latestCycle.publishedAt ?? "—"} — ученица его видит.
              </p>
            )}

            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                  <th style={cell}>Дата</th>
                  <th style={cell}>Тренировка</th>
                  <th style={cell}>Мин</th>
                  <th style={cell}>Отметка</th>
                </tr>
              </thead>
              <tbody>
                {view.sessions.map((session) => {
                  const checkin = view.checkins.find((item) => item.planSessionId === session.id);
                  return (
                    <tr
                      key={session.id}
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        background: session.sessionDate === today ? "#f4f9ff" : undefined,
                      }}
                    >
                      <td style={cell}>
                        {session.sessionDate}
                        {session.originalSessionDate ? (
                          <span style={{ color: "#a60", display: "block", fontSize: 12 }}>
                            перенесена с {session.originalSessionDate}
                          </span>
                        ) : null}
                      </td>
                      <td style={cell}>
                        {session.title}
                        {session.description ? (
                          <span style={{ display: "block", color: "#666", fontSize: 12 }}>
                            {session.description}
                          </span>
                        ) : null}
                      </td>
                      <td style={cell}>{session.minutes}</td>
                      <td style={cell}>
                        {checkin
                          ? `${checkin.effortLabel ?? "—"}${checkin.pain ? " · БОЛЬ" : ""}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <p style={{ margin: 0, color: "#555" }}>
            Плана нет. Сгенерировать:{" "}
            <code>
              intervals-onboarding-plan.ts --athlete={student.externalAthleteId ?? "<id>"} --commit
            </code>
          </p>
        )}
      </div>

      {/* ── Чек-ины и ответ тренера ── */}
      <div style={box}>
        <h2 style={{ marginTop: 0 }}>Чек-ины</h2>
        <p style={{ marginTop: 0, color: sendEnabled ? "#2E7D45" : "#a33" }}>
          {sendEnabled
            ? "Отправка ВКЛЮЧЕНА: «Написать» уйдёт ученице в Telegram."
            : "Отправка выключена (INTERVALS_COACH_SEND_ENABLED). Текст сохранится со статусом prepared, наружу не уйдёт."}
        </p>

        {view.checkins.length === 0 ? (
          <p style={{ color: "#555" }}>Пока ни одного.</p>
        ) : (
          view.checkins.map((checkin) => {
            const answered = !view.unansweredCheckinIds.has(checkin.id);
            const activity = view.activities.find(
              (row) => row.activityId === checkin.activityId
            );
            return (
              <div
                key={checkin.id}
                style={{
                  borderTop: "1px solid #eee",
                  paddingTop: 12,
                  marginTop: 12,
                }}
              >
                <p style={{ margin: "0 0 4px" }}>
                  <strong>{checkin.sessionDate}</strong> · {checkin.effortLabel ?? "—"} (RPE{" "}
                  {checkin.effortRpe ?? "—"})
                  {checkin.pain ? <span style={{ color: "#c00" }}> · БОЛЬ — прогрессия заблокирована</span> : null}
                  {checkin.planSessionId ? "" : " · вне плана"}
                </p>
                <p style={{ margin: "0 0 4px", color: "#555", fontSize: 13 }}>
                  ступень {checkin.stepBefore} → {checkin.stepAfter} · {checkin.progressionAction} ·{" "}
                  {checkin.progressionReason}
                </p>
                {checkin.commentText ? (
                  <p style={{ margin: "0 0 4px", whiteSpace: "pre-wrap" }}>«{checkin.commentText}»</p>
                ) : null}
                <p style={{ margin: "0 0 8px", color: "#555", fontSize: 13 }}>
                  тренировка из Intervals:{" "}
                  {activity
                    ? `${activity.activityType ?? "—"}, ${Math.round((activity.movingTimeS ?? 0) / 60)} мин, ${
                        activity.distanceM ? (activity.distanceM / 1000).toFixed(2) : "—"
                      } км, данные ${activity.dataLevel}`
                    : "не приехала"}
                </p>

                {answered ? (
                  <p style={{ margin: 0, color: "#2E7D45", fontSize: 13 }}>✓ ответ уже написан</p>
                ) : (
                  <form action={sendCoachMessageAction}>
                    <input type="hidden" name="studentUuid" value={studentUuid} />
                    <input type="hidden" name="sourceId" value={student.sourceId ?? ""} />
                    <input type="hidden" name="checkinId" value={checkin.id} />
                    <input type="hidden" name="planSessionId" value={checkin.planSessionId ?? ""} />
                    <textarea
                      name="body"
                      rows={3}
                      placeholder="Что написать ученице"
                      style={{ width: "100%", maxWidth: 700, padding: 8, fontFamily: "inherit" }}
                    />
                    <div style={{ marginTop: 6 }}>
                      <FormActionButton
                        confirmMessage={
                          sendEnabled
                            ? "Отправить этот текст ученице в Telegram?"
                            : "Сохранить текст? Отправка выключена — наружу он не уйдёт."
                        }
                        pendingText="Сохраняю…"
                      >
                        {sendEnabled ? "Написать ученице" : "Сохранить (без отправки)"}
                      </FormActionButton>
                    </div>
                  </form>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Тренировки из Intervals ── */}
      <div style={box}>
        <h2 style={{ marginTop: 0 }}>Тренировки из Intervals</h2>
        {view.activities.length === 0 ? (
          <p style={{ margin: 0, color: "#555" }}>За окно ±3 недели ничего не приехало.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={cell}>Дата</th>
                <th style={cell}>Тип</th>
                <th style={cell}>Время</th>
                <th style={cell}>Дистанция</th>
                <th style={cell}>Данные</th>
              </tr>
            </thead>
            <tbody>
              {view.activities.map((activity) => (
                <tr key={activity.activityId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={cell}>{activity.startDateLocal?.slice(0, 10) ?? "—"}</td>
                  <td style={cell}>{activity.activityType ?? "—"}</td>
                  <td style={cell}>{Math.round((activity.movingTimeS ?? 0) / 60)} мин</td>
                  <td style={cell}>
                    {activity.distanceM ? `${(activity.distanceM / 1000).toFixed(2)} км` : "—"}
                  </td>
                  <td style={cell}>{activity.dataLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Что уже написано ── */}
      <div style={box}>
        <h2 style={{ marginTop: 0 }}>Написанное ученице</h2>
        {view.messages.length === 0 ? (
          <p style={{ margin: 0, color: "#555" }}>Пока ничего.</p>
        ) : (
          view.messages.map((message) => (
            <div key={message.id} style={{ borderTop: "1px solid #eee", paddingTop: 10, marginTop: 10 }}>
              <p style={{ margin: "0 0 4px", color: "#555", fontSize: 13 }}>
                {message.createdAt.slice(0, 16).replace("T", " ")} · статус{" "}
                <strong>{message.status}</strong>
                {message.status === "prepared" ? " (сохранено, не отправлено)" : ""}
              </p>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{message.body}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
