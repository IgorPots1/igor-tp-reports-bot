import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import {
  archiveTrainingPeaksStudentAction,
  bindTrainingPeaksStudentTelegramFromBusinessChatAction,
  createTrainingPeaksStudentTelegramLinkCodeAction,
  createTrainingPeaksStudentWeeklyReportJobAction,
  restoreTrainingPeaksStudentAction,
  searchTrainingPeaksStudentTelegramByUsernameAction,
  sendTrainingPeaksStudentTelegramTestAction,
  setTrainingPeaksStudentWeeklyReportsEnabledAction,
  unlinkTrainingPeaksStudentTelegramAction,
  updateTrainingPeaksStudentTelegramContextAction,
} from "@/app/admin/actions";
import {
  formatIsoDate,
  formatWeekRange,
  getRegistryStatusLabel,
  getReviewStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import {
  buildTrainingPeaksAdminStudentTelegramMismatchStatus,
  findTrainingPeaksAdminBusinessChatsByUsername,
  formatTrainingPeaksAdminLinkCodeExpiresAt,
  formatTrainingPeaksAdminTelegramBindConfirmMessage,
  formatTrainingPeaksAdminTelegramChatName,
  getTrainingPeaksAdminStudentById,
  getTrainingPeaksAdminStudentCapturedBusinessChat,
  getTrainingPeaksAdminStudentGroupTopicLinkStatusText,
  getTrainingPeaksAdminStudentLastKnownBusinessChat,
  getTrainingPeaksAdminStudentTelegramSuggestedMatches,
  getTrainingPeaksAdminStudentThreadLinkMethod,
  listTrainingPeaksAdminRecentBusinessChats,
  listTrainingPeaksAdminReportsForStudent,
  listTrainingPeaksAdminStudentContextObservations,
  listTrainingPeaksAdminStudentThreads,
  normalizeTrainingPeaksAdminTelegramUsername,
  shortenTrainingPeaksAdminChatId,
  TRAININGPEAKS_ADMIN_TELEGRAM_USERNAME_NOT_FOUND_MESSAGE,
} from "@/features/trainingpeaks/admin";
import { formatTelegramMismatchAcknowledgementMessage } from "@/features/trainingpeaks/telegram-identity-match";
import {
  buildTelegramContextTextPreview,
  formatTrainingPeaksTelegramContextSourceType,
  formatTrainingPeaksTelegramFormalityLabel,
} from "@/features/trainingpeaks/telegram-context";
import { getTrainingPeaksWeeklyReportForStudentWeekFromService } from "@/features/trainingpeaks/service";
import { getPreviousTrainingPeaksWeek } from "@/features/trainingpeaks/week";
type StudentDetailPageProps = {
  params: Promise<{
    studentId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type AdminStudentRecord = NonNullable<Awaited<ReturnType<typeof getTrainingPeaksAdminStudentById>>>;
type BusinessChatRecord = Awaited<ReturnType<typeof listTrainingPeaksAdminRecentBusinessChats>>[number];

function getTelegramBindingText(student: AdminStudentRecord): string {
  if (!student.telegramChatId) {
    return "Не привязан";
  }

  if (student.telegramUsername) {
    return `Привязан: @${student.telegramUsername}`;
  }

  return "Привязан";
}

function getTelegramBindingBadgeClass(student: AdminStudentRecord): string {
  if (!student.telegramChatId) {
    return "admin-badge-muted";
  }

  return student.telegramDeliveryEnabled ? "admin-badge-success" : "admin-badge-warning";
}

function getTelegramContactText(
  student: AdminStudentRecord,
  lastKnownBusinessChat: BusinessChatRecord | null
): string {
  if (!student.telegramChatId) {
    return "—";
  }

  const parts: string[] = [];
  const fullName = [lastKnownBusinessChat?.firstName, lastKnownBusinessChat?.lastName].filter(Boolean).join(" ").trim();

  if (student.telegramUsername) {
    parts.push(`@${student.telegramUsername}`);
  }

  if (fullName) {
    parts.push(fullName);
  }

  parts.push(student.telegramChatId);
  return parts.join(" / ");
}

function getLastKnownBusinessChatText(chat: BusinessChatRecord | null): string {
  if (!chat) {
    return "—";
  }

  const lastText = chat.lastText ? ` · ${chat.lastText}` : "";
  return `${formatTrainingPeaksAdminTelegramChatName(chat)} · ${formatIsoDate(chat.lastSeenAt)}${lastText}`;
}

function getTelegramLinkStatusText(student: AdminStudentRecord): string {
  return student.telegramChatId ? "Привязан" : "Не привязан";
}

function getTelegramDeliveryStatusText(student: AdminStudentRecord): string {
  if (!student.telegramChatId) {
    return "—";
  }

  return student.telegramDeliveryEnabled ? "Включена" : "Выключена";
}

function getBusinessChatSeenStatusText(
  student: AdminStudentRecord,
  lastKnownBusinessChat: BusinessChatRecord | null
): string {
  if (!student.telegramChatId) {
    return "—";
  }

  if (!lastKnownBusinessChat) {
    return "Не видели — ученик ещё не писал в Business или привязка устарела";
  }

  if (lastKnownBusinessChat.chatId !== student.telegramChatId) {
    return "Возможно устарела — привязанный chat_id не совпадает с последним Business-чатом";
  }

  return "Видели в Business";
}

function hasBusinessChatMismatch(
  student: AdminStudentRecord,
  lastKnownBusinessChat: BusinessChatRecord | null
): boolean {
  return Boolean(
    student.telegramChatId &&
      lastKnownBusinessChat &&
      lastKnownBusinessChat.chatId !== student.telegramChatId
  );
}

function getStudentDetailPath(studentId: string): string {
  return `/admin/students/${studentId}`;
}

function getLatestBusinessMessagePreview(
  capturedBusinessChat: BusinessChatRecord | null,
  lastKnownBusinessChat: BusinessChatRecord | null
): string {
  const sourceChat = capturedBusinessChat ?? lastKnownBusinessChat;
  if (!sourceChat?.lastText) {
    return "—";
  }

  return buildTelegramContextTextPreview(sourceChat.lastText) ?? "—";
}

function getContextObservationLabelsText(labels: string[]): string {
  if (labels.length === 0) {
    return "unknown";
  }

  return labels.join(", ");
}

export default async function AdminStudentDetailPage({
  params,
  searchParams,
}: StudentDetailPageProps) {
  const { studentId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const telegramView = getSingleSearchParam(resolvedSearchParams.telegramView);
  const telegramUsername = getSingleSearchParam(resolvedSearchParams.telegramUsername);
  const telegramLinkCode = getSingleSearchParam(resolvedSearchParams.telegramLinkCode);
  const telegramLinkCodeExpiresAt = getSingleSearchParam(resolvedSearchParams.telegramLinkCodeExpiresAt);
  const showSyncReminder = notice?.startsWith("Ученик создан:") ?? false;
  const normalizedTelegramUsername = normalizeTrainingPeaksAdminTelegramUsername(telegramUsername ?? "");
  const lastFullWeek = getPreviousTrainingPeaksWeek();
  const student = await getTrainingPeaksAdminStudentById(studentId);

  if (!student) {
    notFound();
  }

  const [reports, existingLastWeekReport, studentThreads] = await Promise.all([
    listTrainingPeaksAdminReportsForStudent(studentId),
    getTrainingPeaksWeeklyReportForStudentWeekFromService(
      student.studentId,
      lastFullWeek.weekFrom,
      lastFullWeek.weekTo
    ),
    listTrainingPeaksAdminStudentThreads(student.id),
  ]);
  const primaryStudentThread = studentThreads[0] ?? null;

  const [lastKnownBusinessChat, capturedBusinessChat, suggestedTelegramMatches, recentChats, usernameLookup, contextObservations] =
    await Promise.all([
      getTrainingPeaksAdminStudentLastKnownBusinessChat(student),
      getTrainingPeaksAdminStudentCapturedBusinessChat(student),
      getTrainingPeaksAdminStudentTelegramSuggestedMatches(student),
      telegramView === "recent" ? listTrainingPeaksAdminRecentBusinessChats(12) : Promise.resolve([]),
      telegramView === "username" && normalizedTelegramUsername
        ? findTrainingPeaksAdminBusinessChatsByUsername(normalizedTelegramUsername, 10)
        : Promise.resolve({
            normalizedUsername: normalizedTelegramUsername,
            chats: [],
          }),
      listTrainingPeaksAdminStudentContextObservations(student.id),
    ]);
  const telegramMismatchStatus = buildTrainingPeaksAdminStudentTelegramMismatchStatus(
    student,
    capturedBusinessChat
  );
  const telegramMismatchAckMessage = telegramMismatchStatus.hasMismatch
    ? formatTelegramMismatchAcknowledgementMessage({
        studentName: student.studentName,
        capturedName: telegramMismatchStatus.capturedName,
        capturedUsername: capturedBusinessChat?.username ?? null,
        actionLabel: "Отправить тест",
      })
    : undefined;
  const usernameCandidates = telegramView === "username" ? usernameLookup.chats : [];
  const businessChatSeen = getBusinessChatSeenStatusText(student, lastKnownBusinessChat);
  const showBusinessChatMissingWarning =
    Boolean(student.telegramChatId && student.telegramDeliveryEnabled && !lastKnownBusinessChat);
  const studentDetailPath = getStudentDetailPath(student.id);
  const recentViewPath = `${studentDetailPath}?telegramView=recent`;
  const usernameViewPath = `${studentDetailPath}?telegramView=username`;
  const usernameResolvedPath =
    telegramView === "username" && normalizedTelegramUsername
      ? `${usernameViewPath}&telegramUsername=${encodeURIComponent(normalizedTelegramUsername)}`
      : usernameViewPath;

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/students">
            ← Ко всем ученикам
          </Link>
          <h2>{student.studentName}</h2>
          <p className="admin-muted">{student.studentId}</p>
          <div className="admin-badge-row">
            <span className={`admin-badge ${student.isActive ? "admin-badge-success" : "admin-badge-warning"}`}>
              {student.isActive ? "Активен" : "Архив"}
            </span>
            <span
              className={`admin-badge ${student.weeklyReportEnabled ? "admin-badge-accent" : "admin-badge-warning"}`}
            >
              {student.weeklyReportEnabled ? "Недельные отчёты включены" : "Недельные отчёты выключены"}
            </span>
            <span
              className={`admin-badge ${getTelegramBindingBadgeClass(student)}`}
            >
              {student.telegramChatId ? "Telegram привязан" : "Telegram не привязан"}
            </span>
          </div>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>
          {error ?? notice}
        </div>
      )}

      {showSyncReminder && (
        <div className="admin-alert admin-alert-success">
          После добавления запусти локально <code>tp-sync-students</code>, чтобы Mac-runner обновил{" "}
          <code>students.json</code>.
        </div>
      )}

      {!student.isActive && (
        <div className="admin-alert admin-alert-success">
          После восстановления недельные отчёты включатся автоматически, но доставку в Telegram нужно проверить отдельно.
        </div>
      )}

      {student.isActive && !student.weeklyReportEnabled && (
        <div className="admin-alert admin-alert-error">
          Недельные отчёты выключены. Будущая генерация, sync и доставка для этого ученика будут заблокированы.
        </div>
      )}

      {student.telegramChatId && !student.telegramDeliveryEnabled && (
        <div className="admin-alert admin-alert-error">
          Telegram привязан, но доставка выключена. После восстановления или перепривязки проверь состояние доставки отдельно.
        </div>
      )}

      {showBusinessChatMissingWarning && (
        <div className="admin-alert admin-alert-warning">
          Telegram привязан и доставка включена, но Business-чат не найден в истории. Попроси ученика написать в
          Business-чат, затем привяжи его из последних Business-чатов и отправь тест.
        </div>
      )}

      {hasBusinessChatMismatch(student, lastKnownBusinessChat) && (
        <div className="admin-alert admin-alert-warning">
          Привязанный chat_id не совпадает с последним Business-чатом по username. Перепривяжи ученика из последних
          Business-чатов.
        </div>
      )}

      {telegramMismatchStatus.hasMismatch && (
        <div className="admin-alert admin-alert-error">
          <strong>Несовпадение Telegram-привязки.</strong> Ученик «{student.studentName}» привязан к другому
          Business-контакту: {formatTrainingPeaksAdminTelegramChatName(capturedBusinessChat!)}
          {capturedBusinessChat?.username ? ` (@${capturedBusinessChat.username})` : ""}. Последняя активность:{" "}
          {formatIsoDate(capturedBusinessChat!.lastSeenAt)}. Перепроверь привязку перед отправкой отчётов.
        </div>
      )}

      {!student.telegramChatId && suggestedTelegramMatches.length > 0 && (
        <article className="admin-card">
          <h3>Предложенные Business-чаты</h3>
          <p className="admin-muted">
            Найдены непривязанные Business-чаты, похожие на этого ученика. Проверь имя и username перед привязкой.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Контакт</th>
                  <th>Последнее сообщение</th>
                  <th>Был в сети</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {suggestedTelegramMatches.map((candidate) => (
                  <tr key={candidate.chat.id}>
                    <td>
                      <div className="admin-table-primary">
                        <strong>{formatTrainingPeaksAdminTelegramChatName(candidate.chat)}</strong>
                        <span className="admin-muted">
                          {candidate.chat.username ? `@${candidate.chat.username}` : "без username"} · score{" "}
                          {candidate.score}
                        </span>
                      </div>
                    </td>
                    <td>{candidate.chat.lastText ?? "—"}</td>
                    <td>{formatIsoDate(candidate.chat.lastSeenAt)}</td>
                    <td>
                      <form action={bindTrainingPeaksStudentTelegramFromBusinessChatAction}>
                        <input type="hidden" name="studentId" value={student.id} />
                        <input type="hidden" name="businessChatId" value={candidate.chat.id} />
                        <input type="hidden" name="redirectTo" value={studentDetailPath} />
                        <FormActionButton
                          className="admin-button"
                          pendingText="Привязка..."
                          confirmMessage={formatTrainingPeaksAdminTelegramBindConfirmMessage(
                            student.studentName,
                            candidate.chat
                          )}
                        >
                          Привязать
                        </FormActionButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}

      <div className="admin-grid admin-grid-student-detail">
        <article className="admin-card admin-card-compact">
          <h3>Состояние</h3>
          <dl className="admin-meta-list admin-meta-list-compact">
            <div>
              <dt>Активность</dt>
              <dd>{student.isActive ? "Активен" : "Архив"}</dd>
            </div>
            <div>
              <dt>Архивирован</dt>
              <dd>{formatIsoDate(student.archivedAt)}</dd>
            </div>
            <div>
              <dt>Недельные отчёты</dt>
              <dd>{student.weeklyReportEnabled ? "Включены" : "Выключены"}</dd>
            </div>
            <div>
              <dt>Обновлён</dt>
              <dd>{formatIsoDate(student.updatedAt)}</dd>
            </div>
          </dl>
        </article>

        <article className="admin-card admin-card-compact">
          <h3>TrainingPeaks</h3>
          <dl className="admin-meta-list admin-meta-list-compact">
            <div>
              <dt>Ссылка на athlete</dt>
              <dd>
                <a href={student.trainingPeaksAthleteUrl} target="_blank" rel="noreferrer">
                  {student.trainingPeaksAthleteUrl}
                </a>
              </dd>
            </div>
            <div>
              <dt>Качество данных</dt>
              <dd>{student.dataQualityStatus ?? "—"}</dd>
            </div>
            <div>
              <dt>Заметки</dt>
              <dd>{student.notes ?? "—"}</dd>
            </div>
          </dl>
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Telegram</h3>
          <dl className="admin-meta-list admin-meta-list-compact">
            <div>
              <dt>Привязка</dt>
              <dd>
                <div className="admin-table-primary">
                  <span>{getTelegramLinkStatusText(student)}</span>
                  <span className="admin-muted">{getTelegramBindingText(student)}</span>
                </div>
              </dd>
            </div>
            <div>
              <dt>Доставка</dt>
              <dd>{getTelegramDeliveryStatusText(student)}</dd>
            </div>
            <div>
              <dt>Business-чат</dt>
              <dd>
                <div className="admin-table-primary">
                  <span>{businessChatSeen}</span>
                  {!capturedBusinessChat && lastKnownBusinessChat && (
                    <span className="admin-muted">{getLastKnownBusinessChatText(lastKnownBusinessChat)}</span>
                  )}
                </div>
                {capturedBusinessChat && (
                  <dl className="admin-meta-list admin-meta-list-compact">
                    <div>
                      <dt>Имя</dt>
                      <dd>{capturedBusinessChat.firstName ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Фамилия</dt>
                      <dd>{capturedBusinessChat.lastName ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Username</dt>
                      <dd>{capturedBusinessChat.username ? `@${capturedBusinessChat.username}` : "—"}</dd>
                    </div>
                    <div>
                      <dt>Последняя активность</dt>
                      <dd>{formatIsoDate(capturedBusinessChat.lastSeenAt)}</dd>
                    </div>
                    {capturedBusinessChat.lastText && (
                      <div>
                        <dt>Последнее сообщение</dt>
                        <dd>{capturedBusinessChat.lastText}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </dd>
            </div>
            <div>
              <dt>Контакт</dt>
              <dd>{getTelegramContactText(student, lastKnownBusinessChat)}</dd>
            </div>
            <div>
              <dt>Chat ID</dt>
              <dd>{student.telegramChatId ?? "—"}</dd>
            </div>
            {student.telegramProfileUrl && (
              <div>
                <dt>Профиль</dt>
                <dd>
                  <a href={student.telegramProfileUrl} target="_blank" rel="noreferrer">
                    {student.telegramProfileUrl}
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt>Группа (тема ученика)</dt>
              <dd>
                <dl className="admin-meta-list admin-meta-list-compact">
                  <div>
                    <dt>Тема</dt>
                    <dd>{getTrainingPeaksAdminStudentGroupTopicLinkStatusText(student.hasGroupTopic)}</dd>
                  </div>
                  <div>
                    <dt>Группа</dt>
                    <dd>{primaryStudentThread?.chatTitle ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Тема</dt>
                    <dd>{primaryStudentThread?.threadTitle ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Как привязали</dt>
                    <dd>
                      {getTrainingPeaksAdminStudentThreadLinkMethod(primaryStudentThread?.linkedByUserId)}
                    </dd>
                  </div>
                </dl>
                {!student.hasGroupTopic && (
                  <p className="admin-muted">
                    В Telegram откройте тему ученика в группе и отправьте: /tp_link_thread {student.studentName}
                  </p>
                )}
              </dd>
            </div>
          </dl>
          {!student.isActive && (
            <p className="admin-muted">
              Для архивного ученика новая Telegram-привязка недоступна, пока он не будет восстановлен.
            </p>
          )}
          <div className="admin-card-actions admin-card-actions-compact">
            <form method="get" action={studentDetailPath}>
              <input type="hidden" name="telegramView" value="recent" />
              <button className="admin-button admin-button-secondary" type="submit" disabled={!student.isActive}>
                Привязать из последних чатов
              </button>
            </form>
            <form method="get" action={studentDetailPath}>
              <input type="hidden" name="telegramView" value="username" />
              <button className="admin-button admin-button-secondary" type="submit" disabled={!student.isActive}>
                Найти по username
              </button>
            </form>
            <form action={createTrainingPeaksStudentTelegramLinkCodeAction}>
              <input type="hidden" name="studentId" value={student.id} />
              <input type="hidden" name="redirectTo" value={studentDetailPath} />
              <FormActionButton
                className="admin-button admin-button-secondary"
                disabled={!student.isActive}
                pendingText="Создание..."
              >
                Создать код привязки
              </FormActionButton>
            </form>
            {student.telegramChatId && student.telegramDeliveryEnabled && (
              <form action={sendTrainingPeaksStudentTelegramTestAction}>
                <input type="hidden" name="studentId" value={student.id} />
                <input type="hidden" name="redirectTo" value={studentDetailPath} />
                <FormActionButton
                  className="admin-button"
                  pendingText="Отправка..."
                  confirmMessage={telegramMismatchAckMessage}
                >
                  Отправить тест
                </FormActionButton>
              </form>
            )}
            {student.telegramChatId && (
              <form action={unlinkTrainingPeaksStudentTelegramAction}>
                <input type="hidden" name="studentId" value={student.id} />
                <input type="hidden" name="redirectTo" value={studentDetailPath} />
                <FormActionButton
                  className="admin-button admin-button-secondary"
                  confirmMessage="Отвязать Telegram? telegram_chat_id, username и profile URL будут очищены, доставка выключится, но история Business-чатов сохранится."
                  pendingText="Отвязка..."
                >
                  Отвязать Telegram
                </FormActionButton>
              </form>
            )}
          </div>
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Telegram context</h3>
          <form className="admin-form-stack" action={updateTrainingPeaksStudentTelegramContextAction}>
            <input type="hidden" name="studentId" value={student.id} />
            <input type="hidden" name="redirectTo" value={studentDetailPath} />
            <label className="admin-form-field">
              <span>Обращение</span>
              <select
                className="admin-input"
                name="telegramFormality"
                defaultValue={student.telegramFormality}
              >
                <option value="unknown">неизвестно</option>
                <option value="ty">на ты</option>
                <option value="vy">на вы</option>
              </select>
            </label>
            <p className="admin-muted">
              Сейчас: {formatTrainingPeaksTelegramFormalityLabel(student.telegramFormality)}
            </p>
            <label className="admin-form-field">
              <span>Заметки по контексту</span>
              <textarea
                className="admin-textarea admin-textarea-compact"
                name="telegramContextNotes"
                rows={4}
                defaultValue={student.telegramContextNotes ?? ""}
              />
            </label>
            <FormActionButton className="admin-button" pendingText="Сохранение...">
              Сохранить контекст
            </FormActionButton>
          </form>
          <dl className="admin-meta-list admin-meta-list-compact">
            <div>
              <dt>Последнее Business-сообщение</dt>
              <dd>{getLatestBusinessMessagePreview(capturedBusinessChat, lastKnownBusinessChat)}</dd>
            </div>
          </dl>
          {contextObservations.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table admin-table-compact">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Источник</th>
                    <th>Метки</th>
                    <th>Превью</th>
                  </tr>
                </thead>
                <tbody>
                  {contextObservations.map((observation) => (
                    <tr key={observation.id}>
                      <td>{formatIsoDate(observation.observedAt)}</td>
                      <td>{formatTrainingPeaksTelegramContextSourceType(observation.sourceType)}</td>
                      <td>{getContextObservationLabelsText(observation.labels)}</td>
                      <td>{observation.textPreview ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="admin-muted">Наблюдений контекста пока нет.</p>
          )}
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Создать недельный отчёт</h3>
          <p className="admin-muted">
            Поставит в очередь локальную генерацию для одного ученика. Отчёт не отправится ученику автоматически.
          </p>
          {existingLastWeekReport && (
            <p className="admin-muted">
              За прошлую неделю ({formatWeekRange(lastFullWeek.weekFrom, lastFullWeek.weekTo)}) отчёт уже есть:{" "}
              <Link href={`/admin/reports/${existingLastWeekReport.id}`}>открыть</Link>
            </p>
          )}
          <form className="admin-form-inline" action={createTrainingPeaksStudentWeeklyReportJobAction}>
            <input type="hidden" name="studentId" value={student.id} />
            <input type="hidden" name="redirectTo" value={studentDetailPath} />
            <label className="admin-form-field">
              <span className="admin-muted">С</span>
              <input
                className="admin-input"
                type="date"
                name="weekFrom"
                defaultValue={lastFullWeek.weekFrom}
                required
              />
            </label>
            <label className="admin-form-field">
              <span className="admin-muted">По</span>
              <input
                className="admin-input"
                type="date"
                name="weekTo"
                defaultValue={lastFullWeek.weekTo}
                required
              />
            </label>
            <FormActionButton
              className="admin-button"
              disabled={!student.isActive || !student.trainingPeaksAthleteUrl}
              pendingText="Постановка..."
            >
              Создать задачу
            </FormActionButton>
          </form>
          {!student.isActive && (
            <p className="admin-muted">Архивного ученика нельзя запустить без восстановления.</p>
          )}
          {student.isActive && !student.trainingPeaksAthleteUrl && (
            <p className="admin-muted">Нужна ссылка TrainingPeaks athlete.</p>
          )}
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Действия</h3>
          <div className="admin-card-actions admin-card-actions-compact">
            {student.weeklyReportEnabled ? (
              <form action={setTrainingPeaksStudentWeeklyReportsEnabledAction}>
                <input type="hidden" name="studentId" value={student.id} />
                <input type="hidden" name="enabled" value="false" />
                <input type="hidden" name="redirectTo" value={`/admin/students/${student.id}`} />
                <FormActionButton
                  className="admin-button admin-button-secondary"
                  confirmMessage="Отключить недельные отчёты? Будущая генерация и доставка для ученика будут заблокированы."
                  pendingText="Сохранение..."
                >
                  Отключить отчёты
                </FormActionButton>
              </form>
            ) : (
              <form action={setTrainingPeaksStudentWeeklyReportsEnabledAction}>
                <input type="hidden" name="studentId" value={student.id} />
                <input type="hidden" name="enabled" value="true" />
                <input type="hidden" name="redirectTo" value={`/admin/students/${student.id}`} />
                <FormActionButton
                  className="admin-button"
                  disabled={!student.isActive}
                  pendingText="Сохранение..."
                >
                  Включить отчёты
                </FormActionButton>
              </form>
            )}
            {student.isActive ? (
              <form action={archiveTrainingPeaksStudentAction}>
                <input type="hidden" name="studentId" value={student.id} />
                <input type="hidden" name="redirectTo" value={`/admin/students/${student.id}`} />
                <FormActionButton
                  className="admin-button admin-button-danger"
                  confirmMessage="Архивировать ученика? Это выключит недельные отчёты и доставку в Telegram."
                  pendingText="Архивация..."
                >
                  Архивировать
                </FormActionButton>
              </form>
            ) : (
              <form action={restoreTrainingPeaksStudentAction}>
                <input type="hidden" name="studentId" value={student.id} />
                <input type="hidden" name="redirectTo" value={`/admin/students/${student.id}`} />
                <FormActionButton className="admin-button" pendingText="Восстановление...">
                  Восстановить
                </FormActionButton>
              </form>
            )}
          </div>
        </article>
      </div>

      {telegramView === "code" && telegramLinkCode && telegramLinkCodeExpiresAt && (
        <article className="admin-card">
          <h3>Код привязки</h3>
          <p>
            Отправь этот код ученику. Когда ученик пришлёт его тебе в Telegram Business чат, привязка
            произойдёт автоматически.
          </p>
          <p className="admin-code">{telegramLinkCode}</p>
          <p className="admin-muted">
            Код действует до {formatTrainingPeaksAdminLinkCodeExpiresAt(telegramLinkCodeExpiresAt)}.
          </p>
        </article>
      )}

      {telegramView === "recent" && (
        <article className="admin-card">
          <div className="admin-section-header">
            <div>
              <h3>Последние Business-чаты</h3>
              <p className="admin-muted">
                Выбери чат ученика из свежих Telegram Business сообщений. После привязки доставка включится
                автоматически.
              </p>
            </div>
            <Link className="admin-button admin-button-secondary" href={studentDetailPath}>
              Скрыть
            </Link>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Контакт</th>
                  <th>Последнее сообщение</th>
                  <th>Был в сети</th>
                  <th>Chat ID</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recentChats.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="admin-empty-cell">
                      Последние Business-чаты пока не появились. Попроси ученика написать любое сообщение в
                      Telegram.
                    </td>
                  </tr>
                ) : (
                  recentChats.map((chat) => (
                    <tr key={chat.id}>
                      <td>
                        <div className="admin-table-primary">
                          <strong>{formatTrainingPeaksAdminTelegramChatName(chat)}</strong>
                          <span className="admin-muted">{chat.username ? `@${chat.username}` : "без username"}</span>
                        </div>
                      </td>
                      <td>{chat.lastText ?? "—"}</td>
                      <td>{formatIsoDate(chat.lastSeenAt)}</td>
                      <td>
                        <div className="admin-table-primary">
                          <span>{shortenTrainingPeaksAdminChatId(chat.chatId)}</span>
                          <span className="admin-muted">{chat.chatId}</span>
                        </div>
                      </td>
                      <td>
                        <form action={bindTrainingPeaksStudentTelegramFromBusinessChatAction}>
                          <input type="hidden" name="studentId" value={student.id} />
                          <input type="hidden" name="businessChatId" value={chat.id} />
                          <input type="hidden" name="redirectTo" value={recentViewPath} />
                          <FormActionButton
                            className="admin-button"
                            pendingText="Привязка..."
                            confirmMessage={formatTrainingPeaksAdminTelegramBindConfirmMessage(
                              student.studentName,
                              chat
                            )}
                          >
                            Привязать
                          </FormActionButton>
                        </form>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      )}

      {telegramView === "username" && (
        <article className="admin-card">
          <div className="admin-section-header">
            <div>
              <h3>Поиск по username</h3>
              <p className="admin-muted">
                Ищи по `@username` или `username`. Поиск нечувствителен к регистру и ищет среди последних
                Business-чатов.
              </p>
            </div>
            <Link className="admin-button admin-button-secondary" href={studentDetailPath}>
              Скрыть
            </Link>
          </div>
          <form className="admin-form-inline" action={searchTrainingPeaksStudentTelegramByUsernameAction}>
            <input type="hidden" name="studentId" value={student.id} />
            <input type="hidden" name="redirectTo" value={usernameViewPath} />
            <input
              className="admin-input"
              type="text"
              name="telegramUsername"
              defaultValue={telegramUsername ?? ""}
              placeholder="@username"
              autoComplete="off"
            />
            <FormActionButton className="admin-button" pendingText="Поиск...">
              Найти по username
            </FormActionButton>
          </form>

          {normalizedTelegramUsername && usernameCandidates.length === 0 && (
            <div className="admin-alert admin-alert-warning">
              {TRAININGPEAKS_ADMIN_TELEGRAM_USERNAME_NOT_FOUND_MESSAGE}
            </div>
          )}

          {usernameCandidates.length > 1 && (
            <>
              <div className="admin-alert admin-alert-warning">
                Нашлось несколько Business-чатов для @{normalizedTelegramUsername}. Выбери нужный вариант.
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Контакт</th>
                      <th>Последнее сообщение</th>
                      <th>Был в сети</th>
                      <th>Chat ID</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {usernameCandidates.map((chat) => (
                      <tr key={chat.id}>
                        <td>
                          <div className="admin-table-primary">
                            <strong>{formatTrainingPeaksAdminTelegramChatName(chat)}</strong>
                            <span className="admin-muted">{chat.username ? `@${chat.username}` : "без username"}</span>
                          </div>
                        </td>
                        <td>{chat.lastText ?? "—"}</td>
                        <td>{formatIsoDate(chat.lastSeenAt)}</td>
                        <td>
                          <div className="admin-table-primary">
                            <span>{shortenTrainingPeaksAdminChatId(chat.chatId)}</span>
                            <span className="admin-muted">{chat.chatId}</span>
                          </div>
                        </td>
                        <td>
                          <form action={bindTrainingPeaksStudentTelegramFromBusinessChatAction}>
                            <input type="hidden" name="studentId" value={student.id} />
                            <input type="hidden" name="businessChatId" value={chat.id} />
                            <input type="hidden" name="redirectTo" value={usernameResolvedPath} />
                            <FormActionButton
                              className="admin-button"
                              pendingText="Привязка..."
                              confirmMessage={formatTrainingPeaksAdminTelegramBindConfirmMessage(
                                student.studentName,
                                chat
                              )}
                            >
                              Привязать
                            </FormActionButton>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </article>
      )}

      <article className="admin-card">
        <h3>История отчётов</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Неделя</th>
                <th>Статус</th>
                <th>Доставка</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={4} className="admin-empty-cell">
                    История отчётов пока пустая.
                  </td>
                </tr>
              ) : (
                reports.map((entry) => (
                  <tr key={entry.report.id}>
                    <td>{formatWeekRange(entry.report.weekFrom, entry.report.weekTo)}</td>
                    <td>
                      <div className="admin-table-primary">
                        <span className="admin-badge admin-badge-outline">
                          {getReviewStatusLabel(entry.report.reviewStatus)}
                        </span>
                        <span className="admin-muted">{getRegistryStatusLabel(entry.report.status)}</span>
                      </div>
                    </td>
                    <td>{entry.report.sentAt ? formatIsoDate(entry.report.sentAt) : entry.report.deliveryError ?? "—"}</td>
                    <td>
                      <Link className="admin-button admin-button-secondary" href={`/admin/reports/${entry.report.id}`}>
                        Открыть отчёт
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
