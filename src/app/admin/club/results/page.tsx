import Link from "next/link";

import { getSingleSearchParam } from "@/app/admin/lib";
import {
  isClubAdminEnabled,
  loadClubResultsForRevision,
  listActiveStudentsForRevision,
  DISTANCE_LABELS,
} from "@/features/club-admin/repository";
import type { RecordDistanceKey } from "@/features/club/records";

export const dynamic = "force-dynamic";

const KEYS: RecordDistanceKey[] = ["5k", "10k", "21k", "42k"];

function fmt(sec: number | null): string {
  if (!sec || sec <= 0) return "—";
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// Provenance of a record — shown as a hover tooltip in the compact revision table.
const SOURCE_LABEL: Record<string, string> = {
  race_events: "гонка из календаря TP (race_events)",
  club_races: "старт, заявленный учеником (club_races)",
  coach_confirmed: "подтверждено тренером",
  reconstructed: "реконструкция из тренировки",
};

export default async function ClubResultsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен (CLUB_ADMIN_ENABLED=false).</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);

  const [students, active] = await Promise.all([loadClubResultsForRevision(), listActiveStudentsForRevision()]);
  const firstStudent = active[0]?.id ?? null;

  let raceCount = 0;
  let trainingCount = 0;
  let hiddenCount = 0;
  let emptyCount = 0;
  for (const s of students) {
    for (const r of s.records) {
      if (r.type === "race") raceCount += 1;
      else if (r.type === "training_split") trainingCount += 1;
      else if (r.trust === "hidden") hiddenCount += 1;
      else emptyCount += 1;
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Ревизия результатов</h1>
        <p className="admin-section-subtitle">Гонки = coach_confirmed, дата из календаря TP (race_events) или заявленный старт. Остальное — отрезки тренировок. Наведи на ячейку — происхождение записи. Гонки идут в топы и якорь прогноза.</p>
      </div>

      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}

      <div className="admin-summary-grid">
        <div className="admin-summary-card"><div className="admin-summary-label">Гонки</div><div className="admin-summary-value">{raceCount}</div></div>
        <div className="admin-summary-card"><div className="admin-summary-label">Отрезки тренировок</div><div className="admin-summary-value">{trainingCount}</div></div>
        <div className="admin-summary-card"><div className="admin-summary-label">Скрыто</div><div className="admin-summary-value">{hiddenCount}</div></div>
        <div className="admin-summary-card"><div className="admin-summary-label">Нет данных</div><div className="admin-summary-value">{emptyCount}</div></div>
      </div>

      <div className="admin-actions" style={{ marginBottom: 12 }}>
        {firstStudent ? <Link className="admin-button admin-button-primary" href={`/admin/club/results/${firstStudent}`}>Массовый ввод — начать</Link> : null}
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead>
            <tr>
              <th>Ученик</th>
              {KEYS.map((k) => <th key={k}>{DISTANCE_LABELS[k]}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.studentId}>
                <td>{s.studentName}</td>
                {KEYS.map((k) => {
                  const r = s.records.find((x) => x.distanceKey === k);
                  const badge = r?.type === "race" ? "🏁" : r?.type === "training_split" ? "🏃" : r?.trust === "hidden" ? "🚫" : "";
                  const origin = r?.source ? SOURCE_LABEL[r.source] ?? r.source : undefined;
                  return (
                    <td key={k} title={origin}>
                      {r?.durationSeconds ? `${badge} ${fmt(r.durationSeconds)}` : r?.trust === "hidden" ? "🚫" : "—"}
                    </td>
                  );
                })}
                <td><Link className="admin-button admin-button-small" href={`/admin/club/results/${s.studentId}`}>Ввести</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
