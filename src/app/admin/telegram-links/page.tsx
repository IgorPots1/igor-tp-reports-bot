import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import { bindTrainingPeaksStudentTelegramFromBusinessChatAction } from "@/app/admin/actions";
import { formatIsoDate, getSingleSearchParam } from "@/app/admin/lib";
import {
  formatTrainingPeaksAdminTelegramBindConfirmMessage,
  formatTrainingPeaksAdminTelegramChatName,
  listTrainingPeaksAdminTelegramLinksOverview,
  shortenTrainingPeaksAdminChatId,
  type TrainingPeaksAdminTelegramLinksTab,
} from "@/features/trainingpeaks/admin";

type TelegramLinksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const TAB_LABELS: Record<TrainingPeaksAdminTelegramLinksTab, string> = {
  suspicious: "Подозрительные привязки",
  unlinked: "Без привязки с кандидатами",
  orphans: "Сиротские Business-чаты",
};

function getActiveTab(value: string | undefined): TrainingPeaksAdminTelegramLinksTab {
  if (value === "unlinked" || value === "orphans") {
    return value;
  }

  return "suspicious";
}

function getTabHref(tab: TrainingPeaksAdminTelegramLinksTab): string {
  return tab === "suspicious" ? "/admin/telegram-links" : `/admin/telegram-links?tab=${tab}`;
}

export default async function AdminTelegramLinksPage({ searchParams }: TelegramLinksPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const activeTab = getActiveTab(getSingleSearchParam(resolvedSearchParams.tab) ?? undefined);
  const overview = await listTrainingPeaksAdminTelegramLinksOverview();

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2>Telegram-привязки</h2>
          <p className="admin-muted">
            Проверка неверных привязок, подсказки для непривязанных учеников и Business-чаты без ученика.
          </p>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>
          {error ?? notice}
        </div>
      )}

      <div className="admin-badge-row">
        {(["suspicious", "unlinked", "orphans"] as const).map((tab) => (
          <Link
            key={tab}
            className={`admin-badge ${activeTab === tab ? "admin-badge-accent" : "admin-badge-outline"}`}
            href={getTabHref(tab)}
          >
            {TAB_LABELS[tab]}
            {" · "}
            {tab === "suspicious"
              ? overview.suspicious.length
              : tab === "unlinked"
                ? overview.unlinked.length
                : overview.orphans.length}
          </Link>
        ))}
      </div>

      {activeTab === "suspicious" && (
        <article className="admin-card">
          <h3>{TAB_LABELS.suspicious}</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ученик</th>
                  <th>Business-контакт</th>
                  <th>Риск</th>
                  <th>Последняя активность</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {overview.suspicious.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="admin-empty-cell">
                      Подозрительных привязок не найдено.
                    </td>
                  </tr>
                ) : (
                  overview.suspicious.map((entry) => (
                    <tr key={entry.student.id}>
                      <td>
                        <div className="admin-table-primary">
                          <Link href={`/admin/students/${entry.student.id}`}>
                            <strong>{entry.student.studentName}</strong>
                          </Link>
                          <span className="admin-muted">
                            {entry.student.telegramUsername
                              ? `@${entry.student.telegramUsername}`
                              : entry.student.telegramChatId}
                          </span>
                        </div>
                      </td>
                      <td>
                        {entry.capturedChat ? (
                          <div className="admin-table-primary">
                            <strong>{formatTrainingPeaksAdminTelegramChatName(entry.capturedChat)}</strong>
                            <span className="admin-muted">
                              {entry.capturedChat.username ? `@${entry.capturedChat.username}` : "без username"}
                            </span>
                          </div>
                        ) : (
                          <span className="admin-muted">Business-чат не найден</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`admin-badge ${
                            entry.riskScore >= 300
                              ? "admin-badge-warning"
                              : entry.riskScore >= 200
                                ? "admin-badge-warning"
                                : "admin-badge-muted"
                          }`}
                        >
                          {entry.hasMismatch
                            ? entry.student.telegramDeliveryEnabled
                              ? "Несовпадение + доставка"
                              : "Несовпадение"
                            : "Чат не найден"}
                        </span>
                      </td>
                      <td>{formatIsoDate(entry.lastSeenAt)}</td>
                      <td>
                        <Link className="admin-button admin-button-secondary" href={`/admin/students/${entry.student.id}`}>
                          Открыть
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      )}

      {activeTab === "unlinked" && (
        <article className="admin-card">
          <h3>{TAB_LABELS.unlinked}</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ученик</th>
                  <th>Кандидаты</th>
                  <th>Последняя активность</th>
                </tr>
              </thead>
              <tbody>
                {overview.unlinked.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="admin-empty-cell">
                      Непривязанных учеников с подходящими Business-чатами не найдено.
                    </td>
                  </tr>
                ) : (
                  overview.unlinked.map((entry) => (
                    <tr key={entry.student.id}>
                      <td>
                        <div className="admin-table-primary">
                          <Link href={`/admin/students/${entry.student.id}`}>
                            <strong>{entry.student.studentName}</strong>
                          </Link>
                          <span className="admin-muted">{entry.student.studentId}</span>
                        </div>
                      </td>
                      <td>
                        <div className="admin-form-stack">
                          {entry.candidates.map((candidate) => (
                            <div key={candidate.chat.id} className="admin-card admin-card-compact">
                              <div className="admin-table-primary">
                                <strong>{formatTrainingPeaksAdminTelegramChatName(candidate.chat)}</strong>
                                <span className="admin-muted">
                                  score {candidate.score} · {formatIsoDate(candidate.chat.lastSeenAt)}
                                </span>
                              </div>
                              <p className="admin-muted">
                                {candidate.chat.username ? `@${candidate.chat.username}` : "без username"} · chat{" "}
                                {shortenTrainingPeaksAdminChatId(candidate.chat.chatId)}
                                {candidate.chat.lastText ? ` · ${candidate.chat.lastText}` : ""}
                              </p>
                              <form action={bindTrainingPeaksStudentTelegramFromBusinessChatAction}>
                                <input type="hidden" name="studentId" value={entry.student.id} />
                                <input type="hidden" name="businessChatId" value={candidate.chat.id} />
                                <input
                                  type="hidden"
                                  name="redirectTo"
                                  value={`/admin/telegram-links?tab=unlinked`}
                                />
                                <FormActionButton
                                  className="admin-button"
                                  pendingText="Привязка..."
                                  confirmMessage={formatTrainingPeaksAdminTelegramBindConfirmMessage(
                                    entry.student.studentName,
                                    candidate.chat
                                  )}
                                >
                                  Привязать
                                </FormActionButton>
                              </form>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>{formatIsoDate(entry.lastSeenAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      )}

      {activeTab === "orphans" && (
        <article className="admin-card">
          <h3>{TAB_LABELS.orphans}</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Контакт</th>
                  <th>Последнее сообщение</th>
                  <th>Последняя активность</th>
                  <th>Chat ID</th>
                </tr>
              </thead>
              <tbody>
                {overview.orphans.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="admin-empty-cell">
                      Сиротских Business-чатов не найдено.
                    </td>
                  </tr>
                ) : (
                  overview.orphans.map((entry) => (
                    <tr key={entry.chat.id}>
                      <td>
                        <div className="admin-table-primary">
                          <strong>{formatTrainingPeaksAdminTelegramChatName(entry.chat)}</strong>
                          <span className="admin-muted">
                            {entry.chat.username ? `@${entry.chat.username}` : "без username"}
                          </span>
                        </div>
                      </td>
                      <td>{entry.chat.lastText ?? "—"}</td>
                      <td>{formatIsoDate(entry.chat.lastSeenAt)}</td>
                      <td>
                        <div className="admin-table-primary">
                          <span>{shortenTrainingPeaksAdminChatId(entry.chat.chatId)}</span>
                          <span className="admin-muted">{entry.chat.chatId}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </section>
  );
}
