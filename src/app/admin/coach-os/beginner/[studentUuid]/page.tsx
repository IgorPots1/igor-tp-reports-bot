import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import { dayOffsetFromCoach, todayIsoInCoachTimezone } from "@/features/intervals/loop/clock";
import { isCoachSendEnabled } from "@/features/intervals/loop/coach-message";
import { listIntervalsStudents, loadCoachStudentView } from "@/features/intervals/loop/coach-view";
import { fieldLabelRu, PREFILLABLE_FIELDS } from "@/features/intervals/loop/prefill";
import { BEGINNER_LADDER } from "@/features/methodology/beginner";

import { previewStudentDeletion } from "@/features/intervals/delete-student";

import { deleteStudentAction, publishPlanAction, sendCoachMessageAction } from "../actions";

export const dynamic = "force-dynamic";

const cell = { padding: "6px 10px", verticalAlign: "top" as const };

const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const weekdayRu = (day: number): string => WEEKDAYS_RU[day] ?? String(day);
const box = {
  border: "1px solid #e0e0e0",
  borderRadius: 10,
  padding: "14px 16px",
  marginBottom: 18,
  maxWidth: 900,
};

export default async function BeginnerStudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentUuid: string }>;
  searchParams: Promise<{ delete_error?: string }>;
}) {
  const { studentUuid } = await params;
  const { delete_error: deleteError } = await searchParams;
  const students = await listIntervalsStudents();
  const student = students.find((row) => row.studentUuid === studentUuid);
  if (!student) notFound();

  const today = todayIsoInCoachTimezone();
  const view = await loadCoachStudentView(student, today);
  const sendEnabled = isCoachSendEnabled();
  const deletion = await previewStudentDeletion(studentUuid);

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

      {/* ── Идут ли данные ── ПЕРВЫМ БЛОКОМ: всё остальное на экране теряет
          смысл, если тренировки не приезжают. */}
      {view.connectionHealth.state === "connected_but_silent" ? (
        <div style={{ ...box, background: "#FDE8E0", border: "1px solid #E5480E" }}>
          <h2 style={{ marginTop: 0, color: "#a3330a" }}>Данные не идут, хотя человек бегает</h2>
          <p style={{ margin: 0 }}>{view.connectionHealth.messageRu}</p>
          <p style={{ margin: "10px 0 0", color: "#555" }}>
            {/* Ссылки на /connect здесь больше нет: страница теперь про формат
                работы, а инструкция по галочкам живёт в приложении ученицы. */}
            Что сказать: открыть intervals.icu → Settings → блок своих часов → отметить галочку про
            скачивание тренировок. То же самое написано у неё в приложении, на экране подключения.
          </p>
        </div>
      ) : null}
      {view.connectionHealth.state === "auth_revoked" ? (
        <div style={{ ...box, background: "#FDE8E0", border: "1px solid #E5480E" }}>
          <h2 style={{ marginTop: 0, color: "#a3330a" }}>Доступ отозван</h2>
          <p style={{ margin: 0 }}>
            С {view.connectionHealth.sinceIso} Intervals не принимает наш доступ. Обновить токен
            нельзя, у них нет срока жизни: нужно повторное подключение учеником в приложении.
          </p>
        </div>
      ) : null}
      {view.connectionHealth.state === "not_connected" ? (
        <div style={{ ...box, background: "#FBF3E4" }}>
          <h2 style={{ marginTop: 0 }}>Часы не подключены</h2>
          <p style={{ margin: 0 }}>Плана не будет, пока не подключит: данных нет.</p>
        </div>
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
            {/* КТО ОТВЕЧАЛ — отдельной строкой, а не мелким шрифтом сбоку.
                «Ученица сказала, что бегает непрерывно» и «тренер знал, что она
                бегает непрерывно» — для корпуса разные данные, и различать их
                задним числом по значению невозможно. */}
            <table style={{ borderCollapse: "collapse", marginBottom: 12 }}>
              <tbody>
                {PREFILLABLE_FIELDS.map((field) => {
                  const byCoach = view.answers?.coachSetFields.includes(field) === true;
                  return (
                    <tr key={field}>
                      <td style={{ padding: "2px 10px 2px 0", color: "#555" }}>{fieldLabelRu(field)}</td>
                      <td
                        style={{
                          padding: "2px 0",
                          color: byCoach ? "#7a4a00" : "#2E7D45",
                          fontWeight: 600,
                        }}
                      >
                        {byCoach ? "задал тренер" : "ответила сама"}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ padding: "2px 10px 2px 0", color: "#555" }}>{fieldLabelRu("coachNote")}</td>
                  <td style={{ padding: "2px 0", color: "#2E7D45", fontWeight: 600 }}>
                    всегда её
                  </td>
                </tr>
              </tbody>
            </table>
            <p style={{ margin: "0 0 6px" }}>
              цель: <strong>{view.answers.goalKind}</strong>
              {view.answers.raceDate ? ` · старт ${view.answers.raceDate}` : ""}
              {view.answers.raceDistanceKm ? ` · ${view.answers.raceDistanceKm} км` : ""}
            </p>
            <p style={{ margin: "0 0 6px" }}>
              неделя:{" "}
              {view.answers.weekStability === "stable"
                ? "стабильная"
                : view.answers.weekStability === "varies"
                  ? "плавающая (план на переносах)"
                  : "не спрашивали"}{" "}
              · дней в неделю: {view.answers.daysPerWeek}{" "}
              <span style={{ color: "#7a4a00" }}>({view.answers.daysPerWeekSource})</span>
            </p>
            <p style={{ margin: "0 0 6px" }}>
              свободные дни:{" "}
              {view.answers.availableWeekdays.length > 0
                ? view.answers.availableWeekdays.map(weekdayRu).join(", ")
                : "не отмечены"}{" "}
              · занятые:{" "}
              {view.answers.unavailableWeekdays.length > 0
                ? view.answers.unavailableWeekdays.map(weekdayRu).join(", ")
                : "нет"}
            </p>
            <p style={{ margin: "0 0 6px" }}>
              длинная:{" "}
              {view.answers.preferredLongWeekday === null
                ? "не задана"
                : weekdayRu(view.answers.preferredLongWeekday)}{" "}
              · тяжёлая:{" "}
              {view.answers.preferredQualityWeekday === null
                ? "не задана"
                : weekdayRu(view.answers.preferredQualityWeekday)}{" "}
              · время:{" "}
              {view.answers.timeOfDay === "morning"
                ? "утро"
                : view.answers.timeOfDay === "evening"
                  ? "вечер"
                  : view.answers.timeOfDay === "varies"
                    ? "по-разному"
                    : "не спрашивали"}
            </p>
            <p style={{ margin: "0 0 6px" }}>
              на тренировку есть:{" "}
              {view.answers.maxSessionMinutes === null
                ? "без потолка"
                : `${view.answers.maxSessionMinutes} мин`}{" "}
              · часовой пояс:{" "}
              {student.timezone ?? "не определён (считаем по твоей зоне)"}
              {student.timezone && dayOffsetFromCoach(student.timezone) !== 0
                ? dayOffsetFromCoach(student.timezone) > 0
                  ? " · у неё уже завтра"
                  : " · у неё ещё вчера"
                : ""}
            </p>
            <p style={{ margin: "0 0 6px" }}>
              где бегает:{" "}
              {view.answers.runSurfaces.length > 0 ? view.answers.runSurfaces.join(", ") : "не отмечено"}{" "}
              · непрерывно:{" "}
              {view.answers.canRunContinuously === null
                ? "не задано"
                : view.answers.canRunContinuously
                  ? "может"
                  : "пока нет"}
            </p>
            {view.answers.weekBreakers ? (
              <div style={{ marginTop: 10, background: "#fffbe6", padding: "10px 12px", borderRadius: 8 }}>
                <strong>Что срывает неделю:</strong>
                <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{view.answers.weekBreakers}</p>
              </div>
            ) : null}
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
        {/* ДВЕ РАЗНЫЕ СТРОЧКИ, ПОТОМУ ЧТО ЭТО ДВА РАЗНЫХ СОБЫТИЯ. Текст всегда
            появляется у неё в приложении; уведомление в телеграм зависит от
            killswitch-а и от флага доставки у карточки. Склеивать их в одну
            фразу значит снова путать «ответил» и «уведомил». */}
        <p style={{ marginTop: 0, color: "#2E7D45" }}>
          Текст сразу появится у неё в приложении, на экране «Ответ тренера».
        </p>
        <p style={{ marginTop: 4, color: sendEnabled && student.telegramDeliveryEnabled ? "#2E7D45" : "#a33" }}>
          {!student.telegramChatId
            ? "Уведомления в Telegram не будет: чат не привязан."
            : !student.telegramDeliveryEnabled
              ? "Уведомления в Telegram не будет: у карточки выключена доставка (telegram_delivery_enabled)."
              : sendEnabled
                ? "Плюс уведомление в Telegram."
                : "Уведомления в Telegram не будет: выключен INTERVALS_COACH_SEND_ENABLED."}
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
                          sendEnabled && student.telegramDeliveryEnabled
                            ? "Отдать текст ученице? Она увидит его в приложении, плюс уйдёт уведомление в Telegram."
                            : "Отдать текст ученице? Она увидит его в приложении. Уведомления в Telegram не будет."
                        }
                        pendingText="Отдаю…"
                      >
                        Отдать ученице
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
                {message.createdAt.slice(0, 16).replace("T", " ")} ·{" "}
                {message.visibleToStudentAt ? (
                  <strong style={{ color: "#2E7D45" }}>видит в приложении</strong>
                ) : (
                  <strong style={{ color: "#a33" }}>не отдано</strong>
                )}
                {" · телеграм: "}
                {message.status === "sent"
                  ? "уведомлён"
                  : message.status === "prepared"
                    ? "не уведомлён (отправка выключена)"
                    : "не уведомлён"}
              </p>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{message.body}</p>
            </div>
          ))
        )}
      </div>

      {/* ── Удаление ── В САМОМ НИЗУ И ПОСЛЕДНИМ. Кнопка, стирающая человека,
          не должна попадаться под руку по дороге к обычной работе: чтобы до
          неё добраться, надо проскроллить всю карточку. */}
      {deletion ? (
        <div style={{ ...box, borderColor: "#e0b4a4", background: "#FFFBFA" }}>
          <h2 style={{ marginTop: 0, color: "#a3330a" }}>Удалить ученика</h2>

          {deleteError ? (
            <p style={{ margin: "0 0 10px", color: "#a3330a", fontWeight: 600 }}>{deleteError}</p>
          ) : null}

          <p style={{ margin: "0 0 8px" }}>
            Будет удалено безвозвратно, всего строк: <strong>{deletion.total}</strong>
          </p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 20, color: "#555" }}>
            {deletion.rows
              .filter((row) => row.count > 0)
              .map((row) => (
                <li key={row.table}>
                  {row.labelRu}: <strong>{row.count}</strong>
                </li>
              ))}
          </ul>

          {deletion.looksLikeRealStudent ? (
            <p style={{ margin: "0 0 12px", color: "#a3330a" }}>
              У этого ученика есть отметки о тренировках и ваши тексты. Похоже на живого человека,
              а не на тестовый прогон. Восстановить это будет нечем.
            </p>
          ) : null}

          <form action={deleteStudentAction}>
            <input type="hidden" name="studentUuid" value={studentUuid} />
            <label style={{ display: "block", marginBottom: 6, color: "#555" }}>
              Чтобы удалить, введите имя ученика буква в букву: <code>{student.studentName}</code>
            </label>
            <input
              className="admin-input"
              name="typedName"
              autoComplete="off"
              placeholder={student.studentName}
              style={{ maxWidth: 320 }}
            />
            <div style={{ marginTop: 8 }}>
              <FormActionButton
                confirmMessage={`Удалить «${student.studentName}» и все ${deletion.total} строк? Отменить будет нельзя.`}
                pendingText="Удаляю…"
              >
                Удалить ученика
              </FormActionButton>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
