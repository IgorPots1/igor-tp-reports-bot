import Link from "next/link";

import { getSingleSearchParam } from "@/app/admin/lib";
import { SEATS_TOTAL } from "@/lib/flow";
import {
  APPLICATION_STATUSES,
  getSeatsLeft,
  getWaitlistCount,
  listApplications,
  listFlowNumbers,
  type ApplicationListItem,
} from "@/features/intensive/repository";
import { shorten, statusBadgeClass, statusLabel } from "./labels";

export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

export default async function IntensiveApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const status = getSingleSearchParam(sp.status);
  const flow = getSingleSearchParam(sp.flow);
  const notice = getSingleSearchParam(sp.notice);

  let applications: ApplicationListItem[] = [];
  let flows: string[] = [];
  let seatsLeft = SEATS_TOTAL;
  let waitlistCount = 0;
  let loadError: string | null = null;

  try {
    [applications, flows, seatsLeft, waitlistCount] = await Promise.all([
      listApplications({ status, flow }),
      listFlowNumbers(),
      getSeatsLeft(),
      getWaitlistCount(),
    ]);
  } catch (error) {
    // Самый частый случай — миграция ещё не применена. Показываем это прямо,
    // а не пустым списком: пустой список читается как «заявок нет».
    loadError = error instanceof Error ? error.message : String(error);
  }

  const seatsTaken = SEATS_TOTAL - seatsLeft;

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Беговой интенсив</h1>
        <p className="admin-section-subtitle">
          Анкеты участников. Место в потоке занимают «Новая» и «Подтверждена».
          «Лист ожидания» и «Отменена» место не занимают — анкета сохранена и
          ждёт твоего решения.
        </p>
      </div>

      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {loadError ? (
        <div className="admin-alert admin-alert-error">
          Не удалось прочитать анкеты: {loadError}
        </div>
      ) : null}

      <div className="admin-summary-grid admin-summary-grid-compact">
        <div className="admin-summary-card">
          <span className="admin-summary-label">Занято</span>
          <span className="admin-summary-value">
            {seatsTaken} из {SEATS_TOTAL}
          </span>
        </div>
        <div className="admin-summary-card">
          <span className="admin-summary-label">Свободно</span>
          <span className="admin-summary-value">{seatsLeft}</span>
        </div>
        <div className="admin-summary-card">
          <span className="admin-summary-label">В листе ожидания</span>
          <span className="admin-summary-value">{waitlistCount}</span>
        </div>
        <div className="admin-summary-card">
          <span className="admin-summary-label">Показано анкет</span>
          <span className="admin-summary-value">{applications.length}</span>
        </div>
      </div>

      <form className="admin-filters admin-filters-compact" method="get">
        <label className="admin-field">
          <span className="admin-summary-label">Статус</span>
          <select className="admin-input" name="status" defaultValue={status ?? ""}>
            <option value="">Любой</option>
            {APPLICATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span className="admin-summary-label">Поток</span>
          <select className="admin-input" name="flow" defaultValue={flow ?? ""}>
            <option value="">Любой</option>
            {flows.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-filters-actions">
          <button className="admin-button admin-button-primary admin-button-small" type="submit">
            Показать
          </button>
          <Link className="admin-button admin-button-secondary admin-button-small" href="/admin/intensive">
            Сбросить
          </Link>
        </div>
      </form>

      {applications.length === 0 && !loadError ? (
        <div className="admin-card" style={{ marginTop: 12 }}>
          <p className="admin-summary-label">Анкет нет.</p>
        </div>
      ) : null}

      {applications.length > 0 ? (
        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Имя</th>
                <th>Город</th>
                <th>Цель</th>
                <th>Поток</th>
                <th>Статус</th>
                <th>Скрин.</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <Link href={`/admin/intensive/${item.id}`}>{item.fullName}</Link>
                  </td>
                  <td>{item.city ?? "—"}</td>
                  <td>{shorten(item.goal, 60)}</td>
                  <td>{item.flowNumber ?? "—"}</td>
                  <td>
                    <span className={statusBadgeClass(item.status)}>
                      {statusLabel(item.status)}
                    </span>
                  </td>
                  <td>{item.screenshotCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
