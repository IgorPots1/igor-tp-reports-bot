import Link from "next/link";

import {
  getPhysioGroupSummary,
  listPhysioAthletes,
  listPhysioDataHealth,
  listPhysioGlossary,
  listPhysioRadar,
  type PhysioAlert,
  type PhysioAthleteRow,
  type PhysioContextItem,
  type PhysioRadarRow,
  type ReadinessState,
} from "@/features/physio/repository";

type PhysioPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type PhysioTab = "radar" | "athletes" | "data" | "glossary";

const TABS: Array<{ key: PhysioTab; label: string }> = [
  { key: "radar", label: "Кому нужно внимание" },
  { key: "athletes", label: "Атлеты" },
  { key: "data", label: "Данные" },
  { key: "glossary", label: "Что означают цифры" },
];

const READINESS_LABELS: Record<ReadinessState, string> = {
  green: "норма",
  amber: "внимание",
  red: "просела",
  partial: "нет HRV",
  no_data: "нет данных",
};

const READINESS_BADGE: Record<ReadinessState, string> = {
  green: "admin-badge admin-badge-success",
  amber: "admin-badge admin-badge-warning",
  red: "admin-badge admin-badge-danger",
  partial: "admin-badge admin-badge-muted",
  no_data: "admin-badge admin-badge-muted",
};

const DURABILITY_LABELS: Record<string, string> = {
  strong: "сильная",
  ok: "норма",
  weak: "слабая",
  unknown: "нет данных",
};

const QUALITY_LABELS: Record<string, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
};

const CONTEXT_KIND_LABELS: Record<string, string> = {
  health: "здоровье",
  schedule: "график",
  goal: "цель",
  mood: "состояние",
  nutrition: "питание",
  other: "прочее",
};

const SEVERITY_LABELS: Record<number, string> = {
  3: "срочно",
  2: "внимание",
  1: "к сведению",
};

const SEVERITY_BADGE: Record<number, string> = {
  3: "admin-badge admin-badge-danger",
  2: "admin-badge admin-badge-warning",
  1: "admin-badge admin-badge-muted",
};

const DISTANCE_LABELS: Record<string, string> = {
  d1500: "1500 м",
  d3000: "3 км",
  d5000: "5 км",
  d10000: "10 км",
  half: "полумарафон",
  marathon: "марафон",
};

const ZONE_LABELS: Record<string, string> = {
  z1_recovery: "Восстановление",
  z2_aerobic: "Аэробная база",
  z3_marathon: "Марафонская",
  z4_threshold: "Пороговая",
  z5_cs: "Критическая скорость",
  z6_vo2max: "VO2max",
  z7_anaerobic: "Анаэробная",
};

function formatPace(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "—";
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

function resolveTab(raw: string | string[] | undefined): PhysioTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "athletes" || value === "data" || value === "glossary") {
    return value;
  }
  return "radar";
}

function tabHref(tab: PhysioTab, studentId?: string): string {
  const params = new URLSearchParams({ tab });
  if (studentId) {
    params.set("student", studentId);
  }
  return `/admin/physio?${params.toString()}`;
}

export default async function PhysioPage({ searchParams }: PhysioPageProps) {
  const resolvedParams = (await searchParams) ?? {};
  const tab = resolveTab(resolvedParams.tab);
  const selectedStudentRaw = resolvedParams.student;
  const selectedStudentId = Array.isArray(selectedStudentRaw)
    ? selectedStudentRaw[0]
    : selectedStudentRaw;

  const [summary, radar, athletes, dataHealth, glossary] = await Promise.all([
    getPhysioGroupSummary(),
    listPhysioRadar(),
    listPhysioAthletes(),
    listPhysioDataHealth(),
    listPhysioGlossary(),
  ]);

  const withProfile = athletes.filter((athlete) => athlete.csMps !== null);
  const selectedAthlete =
    withProfile.find((athlete) => athlete.studentId === selectedStudentId) ?? null;

  return (
    <section className="admin-section">
      <header className="admin-physio-header">
        <div>
          <p className="admin-eyebrow">Физиология</p>
          <h2>Что происходит с учениками</h2>
          <p className="admin-muted">
            Критическая скорость, выносливость на длинной, готовность и радар внимания —
            по данным тренировок, часов и переписки.
            {summary?.alertDate ? ` Данные на ${summary.alertDate}.` : ""}
            {summary?.lastRun?.finished_at
              ? ` Последний пересчёт: ${new Date(summary.lastRun.finished_at).toLocaleString("ru-RU")}.`
              : ""}
          </p>
        </div>
      </header>

      {summary && (
        <div className="admin-grid admin-grid-meta">
          <SummaryCard label="Нужно внимание" value={summary.needAttention} hint={`из ${summary.athletes} учеников`} />
          <SummaryCard label="Срочно" value={summary.urgentToday} />
          <SummaryCard label="Причина известна" value={summary.explained} hint="болеет или в паузе" />
          <SummaryCard label="Болеют или в паузе" value={summary.sickOrPaused} hint="по переписке" />
          <SummaryCard
            label="Данные не доезжают"
            value={summary.dataBroken}
            hint={`из ${summary.dataOk + summary.dataBroken}`}
          />
          <SummaryCard
            label="Профилей построено"
            value={summary.profilesTotal}
            hint={`${summary.profilesHigh} надёжных`}
          />
        </div>
      )}

      <nav className="admin-nav">
        {TABS.map((entry) => (
          <Link
            key={entry.key}
            href={tabHref(entry.key)}
            className={tab === entry.key ? "admin-tab-active" : undefined}
          >
            {entry.label}
            {entry.key === "radar" ? ` (${radar.filter((row) => !row.fullyExplained).length})` : ""}
            {entry.key === "athletes" ? ` (${withProfile.length})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "radar" && <RadarTab rows={radar} />}
      {tab === "athletes" && (
        <AthletesTab rows={withProfile} selected={selectedAthlete} />
      )}
      {tab === "data" && <DataTab rows={dataHealth} />}
      {tab === "glossary" && <GlossaryTab rows={glossary} />}
    </section>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="admin-card admin-card-compact">
      <p className="admin-eyebrow">{label}</p>
      <p className="admin-stat-value">{value}</p>
      {hint && <p className="admin-muted">{hint}</p>}
    </div>
  );
}

function ContextBlock({ items }: { items: PhysioContextItem[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="admin-meta-list admin-meta-list-compact">
      <p className="admin-eyebrow">Что он писал</p>
      <ul>
        {items.slice(0, 6).map((item, index) => (
          <li key={`${item.type}-${index}`}>
            <span className="admin-badge admin-badge-muted">
              {CONTEXT_KIND_LABELS[item.kind] ?? item.kind}
            </span>{" "}
            {item.text} <span className="admin-muted">{item.when}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AlertItem({ alert }: { alert: PhysioAlert }) {
  return (
    <li>
      <p>
        <strong>{alert.title}</strong>
        {alert.term && alert.term !== "—" && (
          <span className="admin-muted"> · {alert.term}</span>
        )}
      </p>
      {alert.headline && <p>{alert.headline}</p>}
      {alert.means && <p className="admin-muted">{alert.means}</p>}
      {alert.todo && <p className="admin-hint">{alert.todo}</p>}
    </li>
  );
}

function RadarCard({ row }: { row: PhysioRadarRow }) {
  return (
    <article className="admin-card">
      <div className="admin-card-header">
        <h3>{row.studentName}</h3>
        <span className={SEVERITY_BADGE[row.maxSeverity]}>{SEVERITY_LABELS[row.maxSeverity]}</span>
      </div>
      <div className="admin-badge-row">
        {row.readinessState && (
          <span className={READINESS_BADGE[row.readinessState]}>
            Готовность {row.readinessScore ?? "—"} · {READINESS_LABELS[row.readinessState]}
          </span>
        )}
        <span className="admin-muted">
          Форма {formatNumber(row.ctl, 0)} · Усталость {formatNumber(row.atl, 0)} · Свежесть{" "}
          {formatNumber(row.tsb, 0)}
        </span>
        {row.csPaceSecPerKm && (
          <span className="admin-muted">Пороговый темп {formatPace(row.csPaceSecPerKm)}/км</span>
        )}
        {row.durabilityGrade && (
          <span className="admin-muted">
            Хватает на длинной: {DURABILITY_LABELS[row.durabilityGrade] ?? row.durabilityGrade}
          </span>
        )}
        {row.dataVerdict && row.dataVerdict !== "всё на месте" && (
          <span className="admin-badge admin-badge-outline">{row.dataVerdict}</span>
        )}
      </div>
      <ul className="admin-meta-list">
        {row.alertsJson.map((alert) => (
          <AlertItem key={alert.code} alert={alert} />
        ))}
      </ul>
      <ContextBlock items={row.contextJson} />
      <div className="admin-card-actions admin-card-actions-compact">
        <Link className="admin-button admin-button-secondary admin-button-small" href={tabHref("athletes", row.studentId)}>
          Открыть профиль
        </Link>
      </div>
    </article>
  );
}

function RadarTab({ rows }: { rows: PhysioRadarRow[] }) {
  const needAttention = rows.filter((row) => !row.fullyExplained);
  const explained = rows.filter((row) => row.fullyExplained);

  return (
    <div className="admin-section">
      <h3 className="admin-eyebrow">Нужно разбираться — {needAttention.length}</h3>
      {needAttention.length === 0 ? (
        <p className="admin-muted">Никто не требует внимания.</p>
      ) : (
        needAttention.map((row) => <RadarCard key={row.studentId} row={row} />)
      )}

      {explained.length > 0 && (
        <>
          <h3 className="admin-eyebrow">
            Причина известна — {explained.length}: человек сам написал, что болеет или в паузе
          </h3>
          {explained.map((row) => (
            <RadarCard key={row.studentId} row={row} />
          ))}
        </>
      )}
    </div>
  );
}

function AthleteCard({ athlete }: { athlete: PhysioAthleteRow }) {
  const predictions = athlete.predictions ?? {};
  const zones = athlete.zones ?? {};

  return (
    <article className="admin-card">
      <div className="admin-card-header">
        <h3>{athlete.studentName}</h3>
        <span className="admin-muted">
          Окно {athlete.windowFrom} — {athlete.windowTo} · {athlete.nPoints} точек · R²{" "}
          {formatNumber(athlete.modelR2, 4)}
        </span>
      </div>

      <div className="admin-grid admin-grid-meta">
        <Metric label="Пороговый темп" value={`${formatPace(athlete.csPaceSecPerKm)}/км`} />
        <Metric label="Запас на рывок" value={athlete.dPrimeM ? `${Math.round(athlete.dPrimeM)} м` : "—"} />
        <Metric label="Уровень бегуна" value={formatNumber(athlete.vdot)} hint="VDOT" />
        <Metric
          label="Хватает на длинной"
          value={athlete.durabilityIndex === null ? "—" : `${formatNumber(athlete.durabilityIndex)}%/ч`}
          hint={`${athlete.durabilitySamples ?? 0} длинных`}
        />
        <Metric label="Порог по пульсу" value={athlete.lthr ? String(athlete.lthr) : "—"} hint={athlete.maxHr ? `макс ${athlete.maxHr}` : undefined} />
        <Metric
          label="Готовность"
          value={athlete.readinessScore === null ? "—" : String(athlete.readinessScore)}
          hint={athlete.readinessState ? READINESS_LABELS[athlete.readinessState] : undefined}
        />
      </div>

      <h4 className="admin-eyebrow">Прогноз результата</h4>
      <div className="admin-grid admin-grid-meta">
        {Object.entries(predictions).map(([key, prediction]) => (
          <div key={key} className="admin-card admin-card-compact">
            <p className="admin-muted">{DISTANCE_LABELS[key] ?? key}</p>
            <p className="admin-stat-value">{prediction.time}</p>
            <p className="admin-muted">
              {formatPace(prediction.pace_s_km)}/км
              {prediction.method !== "cs_model" ? " · с поправкой на выносливость" : ""}
            </p>
          </div>
        ))}
      </div>

      <h4 className="admin-eyebrow">Зоны от порогового темпа</h4>
      <table className="admin-table">
        <tbody>
          {Object.entries(ZONE_LABELS).map(([key, label]) => {
            const zone = zones[key];
            if (!zone) {
              return null;
            }
            return (
              <tr key={key}>
                <td>{label}</td>
                <td>
                  {zone.from_pace_s_km ? formatPace(zone.from_pace_s_km) : "медленнее"} —{" "}
                  {zone.to_pace_s_km ? formatPace(zone.to_pace_s_km) : "быстрее"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {athlete.qualityReasons && athlete.qualityReasons.length > 0 && (
        <div className="admin-alert admin-alert-warning">
          <p>
            <strong>Ограничения модели</strong>
          </p>
          <ul>
            {athlete.qualityReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      <ContextBlock items={athlete.contextJson} />
    </article>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="admin-card admin-card-compact">
      <p className="admin-eyebrow">{label}</p>
      <p className="admin-stat-value">{value}</p>
      {hint && <p className="admin-muted">{hint}</p>}
    </div>
  );
}

function AthletesTab({
  rows,
  selected,
}: {
  rows: PhysioAthleteRow[];
  selected: PhysioAthleteRow | null;
}) {
  return (
    <div className="admin-section">
      {selected && <AthleteCard athlete={selected} />}

      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Атлет</th>
              <th>Пороговый темп</th>
              <th>Запас на рывок</th>
              <th>Хватает на длинной</th>
              <th>Готовность</th>
              <th>Форма</th>
              <th>10 км</th>
              <th>Марафон</th>
              <th>Надёжность</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((athlete) => {
              const healthNote = athlete.contextJson.find((item) => item.kind === "health");
              return (
                <tr key={athlete.studentId}>
                  <td>
                    <Link href={tabHref("athletes", athlete.studentId)}>{athlete.studentName}</Link>
                    {athlete.openAlerts ? (
                      <span className="admin-badge admin-badge-warning"> {athlete.openAlerts}</span>
                    ) : null}
                    {healthNote && <p className="admin-muted">{healthNote.text}</p>}
                  </td>
                  <td>{athlete.csPaceSecPerKm ? `${formatPace(athlete.csPaceSecPerKm)}/км` : "—"}</td>
                  <td>{athlete.dPrimeM ? `${Math.round(athlete.dPrimeM)} м` : "—"}</td>
                  <td>
                    {athlete.durabilityGrade
                      ? DURABILITY_LABELS[athlete.durabilityGrade] ?? athlete.durabilityGrade
                      : "—"}
                    {athlete.durabilityIndex !== null && (
                      <span className="admin-muted"> {formatNumber(athlete.durabilityIndex)}%/ч</span>
                    )}
                  </td>
                  <td>
                    {athlete.readinessScore === null ? (
                      <span className="admin-empty-cell">—</span>
                    ) : (
                      <span className={READINESS_BADGE[athlete.readinessState ?? "no_data"]}>
                        {athlete.readinessScore}
                      </span>
                    )}
                  </td>
                  <td>{formatNumber(athlete.ctl, 0)}</td>
                  <td>{athlete.predictions?.d10000?.time.replace(/^00:/, "") ?? "—"}</td>
                  <td>{athlete.predictions?.marathon?.time ?? "—"}</td>
                  <td className="admin-muted">
                    {athlete.quality ? QUALITY_LABELS[athlete.quality] ?? athlete.quality : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataTab({
  rows,
}: {
  rows: Awaited<ReturnType<typeof listPhysioDataHealth>>;
}) {
  const broken = rows.filter((row) => row.verdict !== "всё на месте");
  const okCount = rows.length - broken.length;

  return (
    <div className="admin-section">
      <div className="admin-alert">
        У {okCount} учеников данные в порядке, у {broken.length} — нет. Без вариабельности пульса и
        сна готовность считается вслепую: система покажет «нет данных», а не «всё хорошо».
      </div>
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Атлет</th>
              <th>Что не так</th>
              <th>Последние данные с часов</th>
              <th>Дней HRV за месяц</th>
              <th>Дней сна</th>
              <th>Дней пульса покоя</th>
              <th>Тренировок за месяц</th>
            </tr>
          </thead>
          <tbody>
            {broken.map((row) => (
              <tr key={row.studentId}>
                <td>{row.studentName}</td>
                <td>{row.verdict}</td>
                <td>{row.lastHealthDate ?? "—"}</td>
                <td>{row.hrvDays30}</td>
                <td>{row.sleepDays30}</td>
                <td>{row.rhrDays30}</td>
                <td>{row.runs30}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GlossaryTab({
  rows,
}: {
  rows: Awaited<ReturnType<typeof listPhysioGlossary>>;
}) {
  const metrics = rows.filter((row) => row.kind === "metric");
  const alerts = rows.filter((row) => row.kind === "alert");

  const renderGroup = (list: typeof rows) => (
    <div className="admin-grid">
      {list.map((entry) => (
        <article key={entry.code} className="admin-card admin-card-compact">
          <h4>{entry.plainName}</h4>
          {entry.term && entry.term !== "—" && <p className="admin-muted">{entry.term}</p>}
          <p>{entry.whatItMeans}</p>
          {entry.whatToDo && <p className="admin-hint">{entry.whatToDo}</p>}
        </article>
      ))}
    </div>
  );

  return (
    <div className="admin-section">
      <h3 className="admin-eyebrow">Показатели</h3>
      {renderGroup(metrics)}
      <h3 className="admin-eyebrow">Флаги радара</h3>
      {renderGroup(alerts)}
    </div>
  );
}
