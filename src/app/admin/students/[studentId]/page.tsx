import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import {
  archiveTrainingPeaksStudentAction,
  bindTrainingPeaksStudentTelegramFromBusinessChatAction,
  createTrainingPeaksStudentTelegramLinkCodeAction,
  restoreTrainingPeaksStudentAction,
  searchTrainingPeaksStudentTelegramByUsernameAction,
  sendTrainingPeaksStudentTelegramTestAction,
  setTrainingPeaksStudentWeeklyReportsEnabledAction,
  unlinkTrainingPeaksStudentTelegramAction,
} from "@/app/admin/actions";
import {
  formatIsoDate,
  formatWeekRange,
  getRegistryStatusLabel,
  getReviewStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import {
  findTrainingPeaksAdminBusinessChatsByUsername,
  formatTrainingPeaksAdminLinkCodeExpiresAt,
  formatTrainingPeaksAdminTelegramChatName,
  getTrainingPeaksAdminStudentById,
  getTrainingPeaksAdminStudentLastKnownBusinessChat,
  listTrainingPeaksAdminRecentBusinessChats,
  listTrainingPeaksAdminReportsForStudent,
  normalizeTrainingPeaksAdminTelegramUsername,
  shortenTrainingPeaksAdminChatId,
  TRAININGPEAKS_ADMIN_TELEGRAM_USERNAME_NOT_FOUND_MESSAGE,
} from "@/features/trainingpeaks/admin";

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

function getStudentDetailPath(studentId: string): string {
  return `/admin/students/${studentId}`;
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
  const [student, reports] = await Promise.all([
    getTrainingPeaksAdminStudentById(studentId),
    listTrainingPeaksAdminReportsForStudent(studentId),
  ]);

  if (!student) {
    notFound();
  }

  const [lastKnownBusinessChat, recentChats, usernameLookup] = await Promise.all([
    getTrainingPeaksAdminStudentLastKnownBusinessChat(student),
    telegramView === "recent" ? listTrainingPeaksAdminRecentBusinessChats(12) : Promise.resolve([]),
    telegramView === "username" && normalizedTelegramUsername
      ? findTrainingPeaksAdminBusinessChatsByUsername(normalizedTelegramUsername, 10)
      : Promise.resolve({
          normalizedUsername: normalizedTelegramUsername,
          chats: [],
        }),
  ]);
  const usernameCandidates = telegramView === "username" ? usernameLookup.chats : [];
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
              <dt>Статус</dt>
              <dd>
                <div className="admin-table-primary">
                  <span>{getTelegramBindingText(student)}</span>
                  <span className="admin-muted">{getTelegramContactText(student, lastKnownBusinessChat)}</span>
                </div>
              </dd>
            </div>
            <div>
              <dt>Доставка</dt>
              <dd>{student.telegramDeliveryEnabled ? "Включена" : "Выключена"}</dd>
            </div>
            <div>
              <dt>Последний Business-чат</dt>
              <dd>{getLastKnownBusinessChatText(lastKnownBusinessChat)}</dd>
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
                <FormActionButton className="admin-button" pendingText="Отправка...">
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
                          <FormActionButton className="admin-button" pendingText="Привязка...">
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
                            <FormActionButton className="admin-button" pendingText="Привязка...">
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
