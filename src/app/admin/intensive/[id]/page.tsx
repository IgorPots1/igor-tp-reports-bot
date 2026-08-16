import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import { getSingleSearchParam } from "@/app/admin/lib";
import { SEATS_TOTAL } from "@/lib/flow";
import {
  APPLICATION_STATUSES,
  createScreenshotUrls,
  getApplication,
  getSeatsLeft,
} from "@/features/intensive/repository";
import {
  dayLabels,
  listLabel,
  orDash,
  sexLabel,
  statusBadgeClass,
  statusLabel,
  statusTakesSeat,
  strengthLabel,
} from "../labels";
import {
  updateIntensiveApplicationNoteAction,
  updateIntensiveApplicationStatusAction,
} from "../actions";

export const dynamic = "force-dynamic";

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function formatBirthDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(value)
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr", gap: 12, padding: "7px 0" }}>
      <span className="admin-summary-label">{label}</span>
      <span style={{ whiteSpace: "pre-wrap" }}>{value}</span>
    </div>
  );
}

export default async function IntensiveApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = `/admin/intensive/${id}`;

  const application = await getApplication(id);
  if (!application) {
    notFound();
  }

  const screenshots = await createScreenshotUrls(application.screenshots);

  // Сколько мест свободно СЕЙЧАС, без учёта этой анкеты, если она места не
  // занимает. Нужно, чтобы предупредить о переполнении до нажатия, а не после.
  const seatsLeft = await getSeatsLeft();
  const wouldExceedLimit = seatsLeft <= 0 && !statusTakesSeat(application.status);

  return (
    <section className="admin-section">
      <Link className="admin-backlink" href="/admin/intensive">
        ← Все анкеты
      </Link>

      <div className="admin-section-header">
        <h1>{application.fullName}</h1>
        <p className="admin-section-subtitle">
          Подана {formatDateTime(application.createdAt)} · поток{" "}
          {application.flowNumber ?? "—"}
        </p>
      </div>

      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}

      {/* ── Статус ── */}
      <div className="admin-card">
        <div className="admin-badge-row">
          <span className="admin-summary-label">Статус</span>
          <span className={statusBadgeClass(application.status)}>
            {statusLabel(application.status)}
          </span>
        </div>
        {wouldExceedLimit ? (
          <div className="admin-alert admin-alert-warning" style={{ marginTop: 10 }}>
            Свободных мест нет. Если переведёшь эту анкету в «Новая» или
            «Подтверждена», в потоке станет больше {SEATS_TOTAL} человек.
            Это разрешено — решение за тобой.
          </div>
        ) : null}
        <div className="admin-inline-actions" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          {APPLICATION_STATUSES.filter((value) => value !== application.status).map((value) => {
            // Предупреждение вшито в само подтверждение: тренер увидит его в
            // момент нажатия, даже если проскроллил плашку выше.
            const overflows = wouldExceedLimit && statusTakesSeat(value);
            const confirmMessage = overflows
              ? `Свободных мест нет — в потоке станет больше ${SEATS_TOTAL} человек. Всё равно перевести в «${statusLabel(value)}»?`
              : `Перевести анкету в «${statusLabel(value)}»?`;

            return (
              <form key={value} action={updateIntensiveApplicationStatusAction}>
                <input type="hidden" name="id" value={application.id} />
                <input type="hidden" name="status" value={value} />
                <input type="hidden" name="redirectTo" value={selfPath} />
                <FormActionButton
                  className={
                    value === "cancelled"
                      ? "admin-button admin-button-danger admin-button-small"
                      : "admin-button admin-button-primary admin-button-small"
                  }
                  confirmMessage={confirmMessage}
                  pendingText="…"
                >
                  {statusLabel(value)}
                  {overflows ? " (сверх лимита)" : ""}
                </FormActionButton>
              </form>
            );
          })}
        </div>
        <p className="admin-hint" style={{ marginTop: 8 }}>
          «Новая» и «Подтверждена» занимают место в потоке. «Лист ожидания» и
          «Отменена» место не занимают: анкета остаётся у тебя целиком, но на
          счётчик набора не влияет.
        </p>
      </div>

      {/* ── Шаг 1 ── */}
      <div className="admin-card" style={{ marginTop: 12 }}>
        <h2 className="admin-card-header">О себе</h2>
        <Row label="Имя и фамилия" value={application.fullName} />
        <Row label="Дата рождения" value={formatBirthDate(application.birthDate)} />
        <Row label="Пол" value={sexLabel(application.sex)} />
        <Row label="Рост" value={application.heightCm ? `${application.heightCm} см` : "—"} />
        <Row label="Вес" value={application.weightKg ? `${application.weightKg} кг` : "—"} />
        <Row label="Город" value={orDash(application.city)} />
      </div>

      {/* ── Шаг 2. ЧУВСТВИТЕЛЬНОЕ ── */}
      <div
        className="admin-card"
        style={{
          marginTop: 12,
          background: "#FFF8F4",
          borderColor: "#F3D9C9",
          borderWidth: 1.5,
          borderStyle: "solid",
        }}
      >
        <h2 className="admin-card-header">Здоровье</h2>
        <p className="admin-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          Медицинские сведения. Не пересылать, не выгружать, не показывать посторонним.
        </p>
        <Row label="Хронические проблемы" value={orDash(application.healthChronic)} />
        <Row label="Травмы и операции" value={orDash(application.healthInjuries)} />
        <Row label="Дискомфорт при беге" value={orDash(application.healthDiscomfort)} />
        <Row
          label="Подтверждение"
          value={
            application.healthDisclaimerAccepted
              ? "Противопоказаний нет (подтверждено)"
              : "НЕ подтверждено"
          }
        />
      </div>

      {/* ── Шаг 3 ── */}
      <div className="admin-card" style={{ marginTop: 12 }}>
        <h2 className="admin-card-header">Опыт</h2>
        <Row label="Км в неделю сейчас" value={orDash(application.weeklyKm)} />
        <Row label="Самая длинная дистанция" value={orDash(application.maxDistance)} />
        <Row
          label="Личные рекорды"
          value={
            [
              application.pr5k ? `5 км ${application.pr5k}` : null,
              application.pr10k ? `10 км ${application.pr10k}` : null,
              application.pr21k ? `21,1 км ${application.pr21k}` : null,
              application.pr42k ? `42,2 км ${application.pr42k}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "—"
          }
        />
        <Row label="Как тренируется сейчас" value={orDash(application.currentTraining)} />
        <Row label="Другие занятия" value={orDash(application.otherSports)} />
      </div>

      {/* ── Шаг 4 ── */}
      <div className="admin-card" style={{ marginTop: 12 }}>
        <h2 className="admin-card-header">Цель</h2>
        <Row label="Беговая цель" value={orDash(application.goal)} />
        <Row label="Забеги в этом году" value={orDash(application.racesThisYear)} />
        <Row label="Почему интенсив" value={orDash(application.whyIntensive)} />
      </div>

      {/* ── Шаг 5 ── */}
      <div className="admin-card" style={{ marginTop: 12 }}>
        <h2 className="admin-card-header">Практика</h2>
        <Row label="Удобные дни" value={dayLabels(application.availableDays)} />
        <Row label="Время на тренировку" value={orDash(application.sessionDuration)} />
        <Row label="Где бегает" value={listLabel(application.surfaces)} />
        <Row label="Гаджеты" value={listLabel(application.gadgets)} />
        <Row label="Кроссовки" value={orDash(application.shoes)} />
        <Row label="Силовые" value={strengthLabel(application.strength)} />
      </div>

      {/* ── Скриншоты ── */}
      <div className="admin-card" style={{ marginTop: 12 }}>
        <h2 className="admin-card-header">Скриншоты ({screenshots.length})</h2>
        {screenshots.length === 0 ? (
          <p className="admin-summary-label">Не приложены.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
              marginTop: 8,
            }}
          >
            {screenshots.map(({ screenshot, url }) => (
              <div key={screenshot.path}>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={screenshot.name}
                      style={{
                        width: "100%",
                        borderRadius: 10,
                        border: "1px solid #E7E1D5",
                        display: "block",
                      }}
                    />
                  </a>
                ) : (
                  <div className="admin-alert admin-alert-warning">
                    Ссылка не выдалась
                  </div>
                )}
                <p className="admin-summary-label" style={{ marginTop: 6 }}>
                  {screenshot.name}
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="admin-hint" style={{ marginTop: 8 }}>
          Ссылки подписанные и живут 10 минут — bucket приватный, прямых адресов у
          файлов нет.
        </p>
      </div>

      {/* ── Заметка тренера ── */}
      <div className="admin-card" style={{ marginTop: 12 }}>
        <h2 className="admin-card-header">Заметка тренера</h2>
        <form action={updateIntensiveApplicationNoteAction} className="admin-form-stack">
          <input type="hidden" name="id" value={application.id} />
          <input type="hidden" name="redirectTo" value={selfPath} />
          <textarea
            className="admin-textarea"
            name="admin_note"
            rows={4}
            defaultValue={application.adminNote ?? ""}
            placeholder="Видно только в админке"
          />
          <div className="admin-card-actions">
            <FormActionButton
              className="admin-button admin-button-primary admin-button-small"
              pendingText="Сохраняю…"
            >
              Сохранить заметку
            </FormActionButton>
          </div>
        </form>
      </div>
    </section>
  );
}
