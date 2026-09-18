import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import { todayIsoInCoachTimezone } from "@/features/intervals/loop/clock";
import { isCoachSendEnabled } from "@/features/intervals/loop/coach-message";
import { dataLevelLabelRu } from "@/features/intervals/data-quality";
import { listIntervalsStudents, loadCoachStudentView } from "@/features/intervals/loop/coach-view";
import { IntervalsAnketaCard } from "@/features/intervals/loop/anketa-card";
import { BEGINNER_LADDER } from "@/features/methodology/beginner";

import { previewStudentDeletion } from "@/features/intervals/delete-student";

import { deleteStudentAction, publishPlanAction, sendCoachMessageAction } from "../actions";

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

      {/* ── Сигнал недели ──
          ДВА РАЗНЫХ БЛОКА, ПОТОМУ ЧТО ЭТО ДВА РАЗНЫХ РЕШЕНИЯ. Боль ведёт к
          разговору и не несёт ни одной цифры: что делать с объёмом, решается
          ПОСЛЕ разговора. Полоса по RPE ведёт к объёму следующей недели и про
          боль ничего не знает. Склеить их в один блок значит снова смешать
          «поговори» и «посчитай». */}
      {view.weekSignal.painFlags.slice(0, 3).map((flag) => (
        <div key={flag.checkinId} style={{ ...box, background: "#FDE8E0", border: "1px solid #E5480E" }}>
          <h2 style={{ marginTop: 0, color: "#a3330a" }}>Была отмечена боль — сначала разговор, не формула</h2>
          <p style={{ margin: 0 }}>
            {flag.sessionDate}
            {flag.effortLabel ? `, «${flag.effortLabel}»` : null}
            {flag.painNote ? (
              <>
                {". Её слова: "}
                <em>«{flag.painNote}»</em>
              </>
            ) : ". Что именно беспокоило, она не написала."}
          </p>
          <p style={{ margin: "10px 0 0", color: "#555" }}>
            Ответ по этому чек-ину ещё не написан. Что делать с объёмом следующей недели — решать
            после разговора, этот блок числа не предлагает. Форма ответа ниже, в «Чек-инах»: как
            только ответите, блок пропадёт.
          </p>
        </div>
      ))}

      {view.weekSignal.volume ? (
        view.weekSignal.volume.band === "calm" ? (
          <p style={{ margin: "0 0 18px", color: "#555", maxWidth: 900 }}>
            Неделя {view.weekSignal.volume.weekStart} — {view.weekSignal.volume.weekEnd}:{" "}
            {view.weekSignal.volume.checkinCount} чек-ина, тяжелее всего —{" "}
            «{view.weekSignal.volume.worstLabel ?? `RPE ${view.weekSignal.volume.worstRpe}`}».{" "}
            {view.weekSignal.volume.adviceRu}
          </p>
        ) : (
          <div
            style={{
              ...box,
              background: view.weekSignal.volume.band === "cut" ? "#FDF0E8" : "#FBF3E4",
              border: view.weekSignal.volume.band === "cut" ? "1px solid #D98A3D" : "1px solid #e0e0e0",
            }}
          >
            <h2 style={{ marginTop: 0 }}>{view.weekSignal.volume.headlineRu}</h2>
            <p style={{ margin: 0 }}>
              {view.weekSignal.volume.weekStart} — {view.weekSignal.volume.weekEnd}:{" "}
              {view.weekSignal.volume.checkinCount} чек-ина, тяжелее всего —{" "}
              «{view.weekSignal.volume.worstLabel ?? `RPE ${view.weekSignal.volume.worstRpe}`}» (
              {view.weekSignal.volume.worstDate}).
            </p>
            <p style={{ margin: "10px 0 0" }}>{view.weekSignal.volume.adviceRu}</p>
          </div>
        )
      ) : null}

      {/* ── Анкета ── */}
      <div style={box}>
        <h2 style={{ marginTop: 0 }}>Анкета</h2>
        <IntervalsAnketaCard answers={view.answers} studentTimezone={student.timezone} />
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
                  {/* «из Intervals» верно только для того, что реально оттуда приехало.
                      Ручная запись — не привезённая, а введённая, и подпись обязана
                      это различать: тренер читает этот экран каждый день. */}
                  {activity?.dataLevel === "manual" ? "тренировка (введена вручную)" : "тренировка из Intervals"}:{" "}
                  {activity
                    ? `${activity.activityType ?? "—"}, ${Math.round((activity.movingTimeS ?? 0) / 60)} мин, ${
                        activity.distanceM ? (activity.distanceM / 1000).toFixed(2) : "—"
                      } км, данные: ${dataLevelLabelRu(activity.dataLevel)}`
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

      {/* ── Тренировки ──
          БЕЗ «ИЗ INTERVALS» В ЗАГОЛОВКЕ [16.09.2026]. Список может целиком
          состоять из ручных записей — заголовок, который называет источник,
          которого нет, врёт молча каждый день. Источник строки видно в её
          собственной колонке. */}
      <div style={box}>
        <h2 style={{ marginTop: 0 }}>Тренировки</h2>
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
                <th style={cell}>Источник</th>
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
                  <td style={cell}>{activity.dataLevel === "manual" ? "вручную" : "Intervals"}</td>
                  <td style={cell}>{dataLevelLabelRu(activity.dataLevel)}</td>
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

          {/* Про архив говорим ДО кнопки: знание, что ошибку можно отменить,
              меняет цену нажатия, и человек должен получить его заранее. */}
          <p style={{ margin: "0 0 12px", color: "#2E7D45" }}>
            Снимок всех этих данных сохранится в архиве на полгода: план, анкета, чек-ины и ваши
            тексты. Восстановить можно будет руками. Привезённые из Intervals тренировки в снимок
            не попадают: они приедут снова, если человек подключится.
          </p>

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
