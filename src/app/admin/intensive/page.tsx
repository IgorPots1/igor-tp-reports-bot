import Link from "next/link";

import { getSingleSearchParam } from "@/app/admin/lib";
import { formatFlowStartDate, seatsWord } from "@/lib/flow";
import FormActionButton from "@/app/admin/FormActionButton";
import {
  APPLICATION_STATUSES,
  getActiveFlowConfigRow,
  getSeatsLeft,
  getWaitlistCount,
  listApplications,
  listFlowNumbers,
  type ApplicationListItem,
  type FlowConfigRow,
} from "@/features/intensive/repository";
import { shorten, statusBadgeClass, statusLabel } from "./labels";
import { openNewFlowAction, saveFlowConfigAction } from "./actions";

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
  const error = getSingleSearchParam(sp.error);

  // Конфиг потока читаем ОТДЕЛЬНО от списка заявок, без общего try/catch:
  // это две разные области отказа. Если упадёт таблица настроек, список
  // заявок должен остаться читаемым и наоборот — тренеру нужно видеть, что
  // именно сломалось, а не «что-то не так» целиком.
  let flowConfig: FlowConfigRow | null = null;
  let flowConfigError: string | null = null;
  try {
    flowConfig = await getActiveFlowConfigRow();
    if (!flowConfig) {
      flowConfigError =
        "Нет активной строки настроек потока. Проверь, применена ли миграция и вставлен ли сид.";
    }
  } catch (err) {
    flowConfigError = err instanceof Error ? err.message : String(err);
  }

  let applications: ApplicationListItem[] = [];
  let flows: string[] = [];
  let waitlistCount = 0;
  let seatsLeft: number | null = null;
  let loadError: string | null = null;

  try {
    const [apps, flowNumbers, waitlist] = await Promise.all([
      listApplications({ status, flow }),
      listFlowNumbers(),
      getWaitlistCount(),
    ]);
    applications = apps;
    flows = flowNumbers;
    waitlistCount = waitlist;
    // Мест без номера потока не посчитать — если сама настройка потока не
    // прочиталась, оставляем seatsLeft пустым и показываем это явно, а не
    // тихо считаем от константы, которую тренер мог уже сто раз поменять.
    if (flowConfig) {
      seatsLeft = await getSeatsLeft(flowConfig);
    }
  } catch (err) {
    // Самый частый случай — миграция ещё не применена. Показываем это прямо,
    // а не пустым списком: пустой список читается как «заявок нет».
    loadError = err instanceof Error ? err.message : String(err);
  }

  const seatsTaken = flowConfig && seatsLeft !== null ? flowConfig.seatsTotal - seatsLeft : null;

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
      {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}
      {loadError ? (
        <div className="admin-alert admin-alert-error">
          Не удалось прочитать анкеты: {loadError}
        </div>
      ) : null}

      {/* ── Настройки потока ── */}
      <div className="admin-card">
        <h2 className="admin-card-header">Настройки потока</h2>
        {flowConfigError ? (
          <div className="admin-alert admin-alert-error">{flowConfigError}</div>
        ) : null}

        {flowConfig ? (
          <>
            <p className="admin-hint" style={{ marginTop: -4, marginBottom: 12 }}>
              Занято в {flowConfig.number}-м потоке ({formatFlowStartDate(flowConfig.startDateIso)}):{" "}
              {seatsTaken ?? "—"} из {flowConfig.seatsTotal} · в листе ожидания: {waitlistCount}
            </p>

            <form className="admin-form-inline" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
              <label className="admin-field">
                <span className="admin-summary-label">Номер потока</span>
                <input
                  className="admin-input"
                  type="number"
                  name="flow_number"
                  min={1}
                  max={9999}
                  step={1}
                  defaultValue={flowConfig.number}
                  style={{ width: 100 }}
                />
              </label>
              <label className="admin-field">
                <span className="admin-summary-label">Дата старта</span>
                <input
                  className="admin-input"
                  type="date"
                  name="start_date"
                  defaultValue={flowConfig.startDateIso}
                />
              </label>
              <label className="admin-field">
                <span className="admin-summary-label">Всего мест</span>
                <input
                  className="admin-input"
                  type="number"
                  name="seats_total"
                  min={1}
                  max={500}
                  step={1}
                  defaultValue={flowConfig.seatsTotal}
                  style={{ width: 90 }}
                />
              </label>
              <label className="admin-field">
                <span className="admin-summary-label">Цена ₽</span>
                <input
                  className="admin-input"
                  type="text"
                  name="price_rub"
                  defaultValue={flowConfig.priceRub}
                  style={{ width: 110 }}
                />
              </label>
              <label className="admin-field">
                <span className="admin-summary-label">Цена €</span>
                <input
                  className="admin-input"
                  type="text"
                  name="price_eur"
                  defaultValue={flowConfig.priceEur}
                  style={{ width: 90 }}
                />
              </label>

              <div className="admin-card-actions" style={{ gap: 8 }}>
                <FormActionButton
                  className="admin-button admin-button-primary admin-button-small"
                  formAction={saveFlowConfigAction}
                  pendingText="Сохраняю…"
                >
                  Сохранить
                </FormActionButton>
                <FormActionButton
                  className="admin-button admin-button-secondary admin-button-small"
                  formAction={openNewFlowAction}
                  confirmMessage={`Открыть поток ${flowConfig.number + 1}? Номер увеличится сам, дату старта нужно указать в поле выше — она уйдёт именно в новый поток. Старые заявки останутся при своём номере.`}
                  pendingText="Открываю…"
                >
                  Открыть новый поток
                </FormActionButton>
              </div>
            </form>
            <p className="admin-hint" style={{ marginTop: 8 }}>
              Изменения появляются на сайте сразу после сохранения, без деплоя.
              «Открыть новый поток» берёт номер {flowConfig.number} + 1 сам —
              значение в поле «Номер потока» для этой кнопки не используется,
              но дату старта нужно вписать новую заранее.
            </p>
          </>
        ) : null}
      </div>

      <div className="admin-summary-grid admin-summary-grid-compact">
        <div className="admin-summary-card">
          <span className="admin-summary-label">
            {flowConfig ? `Занято в ${flowConfig.number}-м потоке` : "Занято"}
          </span>
          <span className="admin-summary-value">
            {seatsTaken !== null && flowConfig ? `${seatsTaken} из ${flowConfig.seatsTotal}` : "—"}
          </span>
        </div>
        <div className="admin-summary-card">
          <span className="admin-summary-label">Свободно</span>
          <span className="admin-summary-value">
            {seatsLeft !== null ? `${seatsLeft} ${seatsWord(seatsLeft)}` : "—"}
          </span>
        </div>
        <div className="admin-summary-card">
          <span className="admin-summary-label">В листе ожидания (все потоки)</span>
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
