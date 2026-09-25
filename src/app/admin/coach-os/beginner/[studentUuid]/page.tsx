import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import { todayIsoInCoachTimezone } from "@/features/intervals/loop/clock";
import { isCoachSendEnabled } from "@/features/intervals/loop/coach-message";
import { dataLevelLabelRu } from "@/features/intervals/data-quality";
import { describeEditRu, editNeedsCoachEye } from "@/features/intervals/loop/checkin-edit";
import {
  activityNumbersRu,
  activityPaceSecPerKm,
  paceLabelRu,
} from "@/features/intervals/loop/activity-numbers";
import { MANUAL_ATHLETE_PREFIX } from "@/features/intervals/manual-entry";
import { listIntervalsStudents, loadCoachStudentView } from "@/features/intervals/loop/coach-view";
import { IntervalsAnketaCard } from "@/features/intervals/loop/anketa-card";
import { BEGINNER_LADDER } from "@/features/methodology/beginner";
import type { PlanSession, SessionStep, StepTarget } from "@/features/intervals/loop/types";
import { formatRuDay } from "@/features/intervals/loop/student-view";

import { previewStudentDeletion } from "@/features/intervals/delete-student";

import {
  deleteStudentAction,
  publishPlanAction,
  releaseWeekAction,
  resolvePainAction,
  sendCoachMessageAction,
  takeWeekIntoWorkAction,
} from "../actions";

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
  /* Ручной источник узнаётся по синтетическому external_athlete_id — он уже
     лежит в строке ученика, лишнего запроса за auth_method не нужно. */
  const isManualSource = student.externalAthleteId?.startsWith(MANUAL_ATHLETE_PREFIX) === true;

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

      {/* ── Ступень ── ТОЛЬКО ДЛЯ ТЕХ, КТО НА ЛЕСТНИЦЕ [20.09.2026].
          Раньше блок стоял всегда и у остальных сообщал «Состояния нет». Это
          не информация: человек вне лестницы никогда её и не получит, а строка
          занимает первый экран и приучает пролистывать верх карточки. */}
      {view.progression ? (
        <div style={box}>
          <h2 style={{ marginTop: 0 }}>Ступень</h2>
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
        </div>
      ) : null}

      {/* ── Сигнал недели ──
          ДВА РАЗНЫХ БЛОКА, ПОТОМУ ЧТО ЭТО ДВА РАЗНЫХ РЕШЕНИЯ. Боль ведёт к
          разговору и не несёт ни одной цифры: что делать с объёмом, решается
          ПОСЛЕ разговора. Полоса по RPE ведёт к объёму следующей недели и про
          боль ничего не знает. Склеить их в один блок значит снова смешать
          «поговори» и «посчитай». */}
      {view.weekSignal.painFlags.slice(0, 3).map((flag) => {
        const answered = flag.state === "answered_waiting";
        return (
          <div
            key={flag.checkinId}
            style={{
              ...box,
              // Ждём её — сигнал остаётся, но перестаёт кричать: тревожный
              // красный на неделю вперёд читается как «тут всегда красное»
              // и перестаёт работать. Жёлтый значит «висит на мне».
              background: answered ? "#FBF3E4" : "#FDE8E0",
              border: answered ? "1px solid #C89B3C" : "1px solid #E5480E",
            }}
          >
            <h2 style={{ marginTop: 0, color: answered ? "#7a5a12" : "#a3330a" }}>
              {answered
                ? "Была отмечена боль — ответил, жду её"
                : "Была отмечена боль — сначала разговор, не формула"}
            </h2>
            <p style={{ margin: 0 }}>
              {flag.sessionDate}
              {flag.effortLabel ? `, «${flag.effortLabel}»` : null}.
            </p>
            {/* ЕЁ СЛОВА БЕРЁМ ОТТУДА, ГДЕ ОНИ ЕСТЬ [23.09.2026]. Поле «что
                именно беспокоило» люди пропускают и пишут всё в комментарий.
                Раньше блок в этом случае утверждал «она не написала» — про
                единственный факт, ради которого он и существует. Источник
                подписан: комментарий это ответ про всю тренировку, а не про
                боль, и выдавать его за прицельный ответ нельзя. */}
            {flag.painNote ? (
              <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                Её слова: <em>«{flag.painNote}»</em>
              </p>
            ) : flag.commentText ? (
              <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                Поле «что беспокоило» пустое, но в комментарии к тренировке она написала:{" "}
                <em>«{flag.commentText}»</em>
              </p>
            ) : (
              <p style={{ margin: "6px 0 0" }}>Что именно беспокоило, она не написала.</p>
            )}
            <p style={{ margin: "10px 0 0", color: "#555" }}>
              {answered
                ? "Ответ отправлен, её ответа пока нет. Вопрос остаётся открытым: написанный текст закрывает его не больше, чем заданный вопрос отвечает сам на себя."
                : "Ответ по этому чек-ину ещё не написан. Форма ответа ниже, в «Чек-инах»."}
              {" Что делать с объёмом следующей недели — решать после разговора, этот блок числа не предлагает."}
            </p>
            {/* ГАСИТ ТОЛЬКО ТРЕНЕР ИЛИ СЛЕДУЮЩИЙ ЧЕК-ИН БЕЗ БОЛИ. Кнопка —
                единственный ручной путь, и она говорит про разговор, а не про
                строку в базе. */}
            <form action={resolvePainAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="studentUuid" value={studentUuid} />
              <input type="hidden" name="checkinId" value={flag.checkinId} />
              <FormActionButton
                confirmMessage="Снять сигнал? Он больше не появится по этому чек-ину. Если боль повторится, она придёт со следующим отчётом."
                pendingText="Снимаю…"
              >
                Разобрался, снять сигнал
              </FormActionButton>
            </form>
          </div>
        );
      })}

      {/* ЧТО СКАЗАЛ САМ ЧЕЛОВЕК — ОТДЕЛЬНО ОТ ТОГО, ЧТО ПОСЧИТАНО ПО ОТМЕТКАМ.
          Полоса объёма считается из RPE тренировок, недельная форма — это его
          собственные слова про график и усталость. Склеить их в одну строку
          значило бы выдать его фразу за наш вывод. */}
      {view.weekSignal.weekly ? (
        <div
          style={{
            ...box,
            background: view.weekSignal.weekly.needsTalk ? "#FDE8E0" : "#FBF3E4",
            border: view.weekSignal.weekly.needsTalk ? "1px solid #E5480E" : "1px solid #e0e0e0",
          }}
        >
          <h2 style={{ marginTop: 0, color: view.weekSignal.weekly.needsTalk ? "#a3330a" : undefined }}>
            Недельная форма
          </h2>
          <p style={{ margin: 0 }}>{view.weekSignal.weekly.headlineRu}.</p>
          {view.weekSignal.weekly.commentText ? (
            <p style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>
              Её словами: <em>«{view.weekSignal.weekly.commentText}»</em>
            </p>
          ) : (
            <p style={{ margin: "10px 0 0", color: "#555" }}>Свободное поле она не заполнила.</p>
          )}
        </div>
      ) : null}

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
                Опубликован {view.latestCycle.publishedAt ?? "—"}. Что именно она видит — по неделям ниже.
              </p>
            )}

            {/* ── НЕДЕЛИ ── Единица публикации теперь неделя, а не цикл. Пока
                неделя не отдана, ученица её не видит, сколько бы раз вы её ни
                правили. */}
            <div style={{ marginBottom: 14 }}>
              {view.planWeeks.length === 0 ? (
                <p style={{ margin: 0, color: "#555" }}>Недель у цикла не заведено.</p>
              ) : (
                view.planWeeks.map((week) => {
                  const isReleased = week.status === "released";
                  const isEditing = week.status === "editing";
                  return (
                    <div
                      key={week.weekStart}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                        padding: "8px 10px",
                        marginBottom: 6,
                        borderRadius: 8,
                        border: "1px solid #e0e0e0",
                        background: isReleased ? "#EAF5EC" : isEditing ? "#FBF3E4" : "#fff",
                      }}
                    >
                      {/* ДАТА ЦЕЛИКОМ И ДИАПАЗОН [20.09.2026]. Голая ISO-строка
                          в узкой колонке ломалась переносом, и тренер читал
                          обрывки («девятое, семнадцатое»). Понедельник словами
                          плюс конец недели читается с одного взгляда и не
                          разваливается при переносе. */}
                      <strong style={{ minWidth: 190, whiteSpace: "nowrap" }}>
                        {formatRuDay(week.weekStart)} — {formatRuDay(shiftIso(week.weekStart, 6))}
                      </strong>
                      <span style={{ color: "#888", fontSize: 12, whiteSpace: "nowrap" }}>
                        {week.weekStart}
                      </span>
                      <span style={{ color: isReleased ? "#2E7D45" : "#a33" }}>
                        {isReleased
                          ? `отдана ${(week.releasedAt ?? "").slice(0, 10)} — ученица её видит`
                          : isEditing
                            ? "в работе — ученица НЕ видит"
                            : "собрана машиной — ученица НЕ видит"}
                      </span>
                      {!isReleased ? (
                        <>
                          <form action={releaseWeekAction} style={{ margin: 0 }}>
                            <input type="hidden" name="studentUuid" value={studentUuid} />
                            <input type="hidden" name="cycleId" value={view.latestCycle?.id ?? ""} />
                            <input type="hidden" name="sourceId" value={student.sourceId ?? ""} />
                            <input type="hidden" name="weekStart" value={week.weekStart} />
                            <FormActionButton
                              confirmMessage={`Отдать неделю с ${week.weekStart} ученице? Она увидит её в приложении, плюс уйдёт уведомление.`}
                              pendingText="Отдаю…"
                            >
                              Отдать ученице
                            </FormActionButton>
                          </form>
                          {!isEditing ? (
                            <form action={takeWeekIntoWorkAction} style={{ margin: 0 }}>
                              <input type="hidden" name="studentUuid" value={studentUuid} />
                              <input type="hidden" name="cycleId" value={view.latestCycle?.id ?? ""} />
                              <input type="hidden" name="weekStart" value={week.weekStart} />
                              <FormActionButton pendingText="Отмечаю…">Взять в работу</FormActionButton>
                            </form>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

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
                        <strong>{session.title}</strong>
                        <SessionContent session={session} />
                      </td>
                      <td style={cell}>{session.minutes}</td>
                      {/* ОТВЕТ ЦЕЛИКОМ И ФОРМА ОТВЕТА — ЗДЕСЬ ЖЕ [22.09.2026].
                          Было одно слово в колонке, а её текст, боль и ваш ответ
                          жили в другом блоке экрана. Тренер читает тренировку и
                          отвечает на неё же: разносить это по разным местам
                          значит заставлять соединять их глазами каждый раз. */}
                      <td style={cell}>
                        {!checkin ? (
                          <span style={{ color: "#999" }}>не отметилась</span>
                        ) : (
                          <>
                            <div>
                              <strong>{checkin.effortLabel ?? "—"}</strong>
                              {checkin.effortRpe !== null ? (
                                <span style={{ color: "#888" }}> (RPE {checkin.effortRpe})</span>
                              ) : null}
                              {checkin.pain ? (
                                <span style={{ color: "#c00", fontWeight: 600 }}> · БОЛЬ</span>
                              ) : null}
                            </div>
                            {checkin.painNote ? (
                              <div style={{ color: "#c00", marginTop: 2 }}>«{checkin.painNote}»</div>
                            ) : null}
                            {checkin.commentText ? (
                              <div style={{ marginTop: 2, whiteSpace: "pre-wrap" }}>
                                «{checkin.commentText}»
                              </div>
                            ) : null}
                            {view.unansweredCheckinIds.has(checkin.id) ? (
                              <form action={sendCoachMessageAction} style={{ marginTop: 6 }}>
                                <input type="hidden" name="studentUuid" value={studentUuid} />
                                <input type="hidden" name="sourceId" value={student.sourceId ?? ""} />
                                <input type="hidden" name="checkinId" value={checkin.id} />
                                <input type="hidden" name="planSessionId" value={checkin.planSessionId ?? ""} />
                                <textarea
                                  name="body"
                                  rows={2}
                                  placeholder="Что ответить"
                                  style={{ width: "100%", minWidth: 220, padding: 6, fontFamily: "inherit" }}
                                />
                                <div style={{ marginTop: 4 }}>
                                  <FormActionButton
                                    confirmMessage={
                                      sendEnabled && student.telegramDeliveryEnabled
                                        ? "Отдать текст ученице? Она увидит его в приложении, плюс уйдёт уведомление в Telegram."
                                        : "Отдать текст ученице? Она увидит его в приложении. Уведомления в Telegram не будет."
                                    }
                                    pendingText="Отдаю…"
                                  >
                                    Ответить
                                  </FormActionButton>
                                </div>
                              </form>
                            ) : (
                              <div style={{ color: "#2E7D45", marginTop: 4 }}>✓ ответ написан</div>
                            )}
                          </>
                        )}
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
                  {checkin.pain ? (
                    <span style={{ color: "#c00" }}>
                      {" · БОЛЬ"}
                      {view.progression ? " — прогрессия заблокирована" : " — напишите ей"}
                    </span>
                  ) : null}
                  {checkin.planSessionId ? "" : " · вне плана"}
                </p>
                {/* СТРОКА СТУПЕНИ — ТОЛЬКО ТЕМ, КТО НА ЛЕСТНИЦЕ [23.09.2026].
                    У человека вне лестницы все четыре поля пустые, и строка
                    рисовалась как «ступень → · ·» — мусор ровно там, где тренер
                    ищет её слова. Та же правка, что уже сделана в блоке анкеты. */}
                {checkin.stepBefore !== null || checkin.progressionAction !== null ? (
                  <p style={{ margin: "0 0 4px", color: "#555", fontSize: 13 }}>
                    ступень {checkin.stepBefore} → {checkin.stepAfter} · {checkin.progressionAction} ·{" "}
                    {checkin.progressionReason}
                  </p>
                ) : null}
                {checkin.commentText ? (
                  <p style={{ margin: "0 0 4px", whiteSpace: "pre-wrap" }}>«{checkin.commentText}»</p>
                ) : null}
                {/* ОТВЕТ МЕНЯЛСЯ — ЭТО ВИДНО [23.09.2026]. Строка чек-ина
                    перезаписывается при правке, и без этой истории «болело»
                    стало бы «не болело» бесследно. Правки про боль и усилие
                    показываем заметно, правку одного комментария — тихо:
                    заметность стоит дорого и тратится на то, что её стоит. */}
                {(view.checkinEdits.get(checkin.id) ?? []).map((edit, index) => {
                  const loud = editNeedsCoachEye(edit.changed);
                  return (
                    <p
                      key={`${checkin.id}-edit-${index}`}
                      style={{
                        margin: "0 0 4px",
                        fontSize: 13,
                        color: loud ? "#a3330a" : "#777",
                        fontWeight: loud ? 600 : 400,
                      }}
                    >
                      {`она поправила ответ ${edit.editedAt.slice(0, 16).replace("T", " ")} · ${describeEditRu(edit)}`}
                    </p>
                  );
                })}
                {/* ЦИФРЫ РЯДОМ С ОТМЕТКОЙ [23.09.2026]. Раньше здесь были только
                    минуты и километры, и то в строчку с типом и уровнем данных.
                    Для человека без часов это половина отчёта: темп и пульс он
                    вводил, а тренер их не видел. Теперь цифры идут первыми и
                    крупно — читать их тренер будет чаще, чем всё остальное. */}
                {activity ? (
                  <p style={{ margin: "0 0 2px", fontSize: 15 }}>
                    <strong>{activityNumbersRu(activity)}</strong>
                  </p>
                ) : null}
                <p style={{ margin: "0 0 8px", color: "#555", fontSize: 13 }}>
                  {/* «из Intervals» верно только для того, что реально оттуда приехало.
                      Ручная запись — не привезённая, а введённая, и подпись обязана
                      это различать: тренер читает этот экран каждый день. */}
                  {activity
                    ? `${activity.activityType ?? "—"} · ${
                        activity.dataLevel === "manual" ? "введена вручную" : "приехала из Intervals"
                      } · данные: ${dataLevelLabelRu(activity.dataLevel)}`
                    : "тренировки в базе нет: отметка есть, цифр она не оставила"}
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
          /* «НИЧЕГО НЕ ПРИЕХАЛО» — НЕПРАВДА ДЛЯ РУЧНОГО ВВОДА [23.09.2026].
             У человека без часов ничего и не приезжает: он вводит сам. Пустой
             список у него означает «не вводила», а прежняя подпись читалась
             как «синк сломался» — и тренер шёл чинить то, чего нет. */
          <p style={{ margin: 0, color: "#555" }}>
            {isManualSource
              ? "За окно ±3 недели она не ввела ни одной тренировки."
              : "За окно ±3 недели ничего не приехало."}
          </p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={cell}>Дата</th>
                <th style={cell}>Тип</th>
                <th style={cell}>Время</th>
                <th style={cell}>Дистанция</th>
                <th style={cell}>Темп</th>
                <th style={cell}>Пульс</th>
                <th style={cell}>Источник</th>
                <th style={cell}>Данные</th>
              </tr>
            </thead>
            <tbody>
              {view.activities.map((activity) => {
                const pace = activityPaceSecPerKm(activity);
                return (
                  <tr key={activity.activityId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={cell}>{activity.startDateLocal?.slice(0, 10) ?? "—"}</td>
                    <td style={cell}>{activity.activityType ?? "—"}</td>
                    <td style={cell}>{Math.round((activity.movingTimeS ?? 0) / 60)} мин</td>
                    <td style={cell}>
                      {activity.distanceM ? `${(activity.distanceM / 1000).toFixed(2)} км` : "—"}
                    </td>
                    <td style={cell}>{pace === null ? "—" : `${paceLabelRu(pace)} /км`}</td>
                    <td style={cell}>{activity.averageHeartrate ?? "—"}</td>
                    <td style={cell}>{activity.dataLevel === "manual" ? "вручную" : "Intervals"}</td>
                    <td style={cell}>{dataLevelLabelRu(activity.dataLevel)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Переписка в телеграме ──
          ОНА ОТВЕЧАЕТ НЕ ТУДА, КУДА ВЫ СМОТРИТЕ [25.09.2026]. 23.09 ответ про
          боль в пятке ушёл в личку, лёг в базу наблюдений и пролежал два дня:
          здесь его было не видно, а сказать о нём было некому.
          Блок только читает: сама переписка живёт в телеграме, отвечать надо
          там же. Текст хранится обрезанным до 500 символов — это не копия
          чата, а напоминание, что разговор идёт. */}
      {view.telegramLines.length > 0 ? (
        <div style={box}>
          <h2 style={{ marginTop: 0 }}>Переписка в телеграме</h2>
          <p style={{ margin: "0 0 12px", color: "#555", fontSize: 13 }}>
            Последние {view.telegramLines.length}. Свежие внизу. Отвечать — в телеграме, здесь только видно.
          </p>
          {view.telegramLines.map((line, index) => {
            const mine = line.direction === "outbound";
            const health = line.labels.includes("pain_or_health");
            return (
              <div
                key={`${line.at}-${index}`}
                style={{
                  borderLeft: `3px solid ${mine ? "#ccc" : health ? "#E5480E" : "#2E7D45"}`,
                  padding: "2px 0 2px 10px",
                  margin: "0 0 10px",
                }}
              >
                <p style={{ margin: "0 0 2px", color: "#777", fontSize: 12 }}>
                  {line.at.slice(0, 16).replace("T", " ")} ·{" "}
                  {mine ? "вы" : "она"}
                  {health && !mine ? <span style={{ color: "#a3330a" }}> · про здоровье</span> : null}
                </p>
                <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {line.text ?? "(без текста: голосовое или вложение)"}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

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

/** Темп шага словами: 427 → «7:07». */
function paceText(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

function targetText(target: StepTarget | undefined): string | null {
  if (!target) return null;
  if (target.kind === "pace") return `${paceText(target.fastSec)}–${paceText(target.slowSec)} /км`;
  if (target.kind === "rpe") return `усилие ${target.rpe} из 10`;
  if (target.kind === "self_discovery") return target.hint ? `подобрать: ${target.hint}` : "подобрать самой";
  return target.text;
}

function StepLines({ steps, depth = 0 }: { steps: SessionStep[]; depth?: number }) {
  return (
    <>
      {steps.map((step, i) => {
        const target = targetText(step.target);
        return (
          <span key={i} style={{ display: "block", paddingLeft: depth * 12 }}>
            {step.repeat ? (
              <>
                <span style={{ color: "#7a4a00" }}>{step.repeat.count} ×</span>
                <StepLines steps={step.repeat.steps} depth={depth + 1} />
              </>
            ) : (
              <>
                {step.minutes} мин — {step.name}
                {target ? <span style={{ color: "#555" }}> · {target}</span> : null}
                {step.detail ? <span style={{ color: "#888" }}> · {step.detail}</span> : null}
              </>
            )}
          </span>
        );
      })}
    </>
  );
}

/**
 * ЧТО ИМЕННО В ТРЕНИРОВКЕ — ПРЯМО В ТАБЛИЦЕ [20.09.2026].
 *
 * Было видно только название, минуты и отметку. У машинных сессий под
 * названием стояло плоское description, у написанных РУКОЙ — ничего: их
 * содержание живёт в steps, и его никто не рисовал. Тренер работает по этому
 * экрану и должен видеть состав, не открывая ничего.
 *
 * Порядок источников: steps (ручное авторство, самый подробный), потом
 * segments (машинная структура), потом плоский текст описания.
 */
function SessionContent({ session }: { session: PlanSession }) {
  const small = { display: "block", color: "#666", fontSize: 12, lineHeight: 1.45 } as const;

  if (session.steps && session.steps.length > 0) {
    return (
      <span style={small}>
        <StepLines steps={session.steps} />
        {session.notes?.map((note, i) => (
          <span key={i} style={{ display: "block", color: "#7a4a00", marginTop: 2 }}>
            {note.title ? `${note.title}: ` : ""}
            {note.body}
          </span>
        ))}
      </span>
    );
  }

  if (session.segments && session.segments.length > 0) {
    return (
      <span style={small}>
        {session.segments.map((seg, i) => (
          <span key={i} style={{ display: "block" }}>
            {seg.minutes} мин — {seg.label}
            {seg.fastSec !== null && seg.slowSec !== null ? (
              <span style={{ color: "#555" }}> · {paceText(seg.fastSec)}–{paceText(seg.slowSec)} /км</span>
            ) : seg.noPaceText ? (
              <span style={{ color: "#555" }}> · {seg.noPaceText}</span>
            ) : null}
          </span>
        ))}
      </span>
    );
  }

  return session.description ? <span style={small}>{session.description}</span> : null;
}

/** Сдвиг ISO-даты на дни. Локальная копия: страница не тянет ради этого сервис. */
function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
