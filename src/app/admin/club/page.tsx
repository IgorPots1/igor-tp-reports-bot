import Link from "next/link";

import { getClubTpSendStatus, isClubAdminEnabled } from "@/features/club-admin/repository";

export const dynamic = "force-dynamic";

export default async function ClubHubPage() {
  if (!isClubAdminEnabled()) {
    return (
      <section className="admin-section">
        <div className="admin-section-header">
          <h1>Клуб</h1>
        </div>
        <div className="admin-alert admin-alert-warning">Раздел выключен (CLUB_ADMIN_ENABLED=false).</div>
      </section>
    );
  }
  const tpSend = await getClubTpSendStatus();
  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Клуб</h1>
        <p className="admin-section-subtitle">Тренерская панель: ревизия результатов, очередь заявок, привязки, управление.</p>
      </div>
      {tpSend.queued > 0 ? (
        <div className={tpSend.failed > 0 ? "admin-alert admin-alert-warning" : "admin-alert"}>
          <strong>Ожидают отправки в TrainingPeaks: {tpSend.queued}</strong>
          {tpSend.failed > 0 ? ` (с ошибкой: ${tpSend.failed})` : ""}
          {tpSend.failedList.length > 0 ? (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {tpSend.failedList.map((f, i) => (
                <li key={i}>
                  {f.studentName} · {f.date ?? "?"} · {f.kind}: {f.error} (попыток: {f.attempts})
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="admin-actions">
        <Link className="admin-button admin-button-primary" href="/admin/club/requests">Заявки на доступ</Link>
        <Link className="admin-button admin-button-primary" href="/admin/club/forms">Рассылка форм</Link>
        <Link className="admin-button admin-button-secondary" href="/admin/club/results">Ревизия результатов</Link>
        <Link className="admin-button admin-button-secondary" href="/admin/club/race-fill">Дотяжка гонок</Link>
        <Link className="admin-button admin-button-secondary" href="/admin/club/queue">Очередь заявок</Link>
        <Link className="admin-button admin-button-secondary" href="/admin/club/calendar">Календарь клуба</Link>
        <Link className="admin-button admin-button-secondary" href="/admin/club/challenges">Челленджи</Link>
        <Link className="admin-button admin-button-secondary" href="/admin/club/comments">Комментарии</Link>
        <Link className="admin-button admin-button-secondary" href="/admin/club/billing">Оплата клуба</Link>
        <Link className="admin-button admin-button-secondary" href="/admin/club/prediction">Видимость прогноза</Link>
        <Link className="admin-button admin-button-secondary" href="/admin/club/links">Ссылки на клуб</Link>
        <Link className="admin-button admin-button-secondary" href="/admin/club/manage">Управление клубом</Link>
      </div>
    </section>
  );
}
