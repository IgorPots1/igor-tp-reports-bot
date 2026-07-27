import Link from "next/link";

import { isClubAdminEnabled } from "@/features/club-admin/repository";

export const dynamic = "force-dynamic";

export default function ClubHubPage() {
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
  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Клуб</h1>
        <p className="admin-section-subtitle">Тренерская панель: ревизия результатов, очередь заявок, привязки, управление.</p>
      </div>
      <div className="admin-actions">
        <Link className="admin-button admin-button-primary" href="/admin/club/requests">Заявки на доступ</Link>
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
