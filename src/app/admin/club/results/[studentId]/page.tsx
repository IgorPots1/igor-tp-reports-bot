import Link from "next/link";

import { getSingleSearchParam } from "@/app/admin/lib";
import FormActionButton from "@/app/admin/FormActionButton";
import {
  isClubAdminEnabled,
  getStudentRevisionCard,
  getRaceFillSuggestions,
  listActiveStudentsForRevision,
  DISTANCE_LABELS,
} from "@/features/club-admin/repository";
import {
  confirmRaceResultAction,
  hideRecordAction,
  clearRecordOverrideAction,
} from "@/app/admin/club/actions";
import type { RecordDistanceKey } from "@/features/club/records";

export const dynamic = "force-dynamic";

const KEYS: RecordDistanceKey[] = ["5k", "10k", "21k", "42k"];

function fmt(sec: number): string {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export default async function ClubResultBulkPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const { studentId } = await params;
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);

  const [card, active, suggestions] = await Promise.all([
    getStudentRevisionCard(studentId),
    listActiveStudentsForRevision(),
    getRaceFillSuggestions(studentId),
  ]);
  const suggestionByKey = new Map(suggestions.map((s) => [s.distanceKey, s]));
  const idx = active.findIndex((s) => s.id === studentId);
  const next = idx >= 0 && idx + 1 < active.length ? active[idx + 1] : null;
  const selfPath = `/admin/club/results/${studentId}`;
  const position = idx >= 0 ? `${idx + 1} из ${active.length}` : "";

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>{card.name}</h1>
        <p className="admin-section-subtitle">Массовый ввод результатов гонок · {position}</p>
      </div>

      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}

      <div className="admin-actions" style={{ marginBottom: 12 }}>
        <Link className="admin-button admin-button-secondary" href="/admin/club/results">← Список</Link>
        {next ? <Link className="admin-button admin-button-primary" href={`/admin/club/results/${next.id}`}>Следующий: {next.name} →</Link> : <span className="admin-badge admin-badge-muted">Последний</span>}
      </div>

      {KEYS.map((key) => {
        const override = card.coach.get(key);
        const suggestion = suggestionByKey.get(key);
        return (
          <div className="admin-card" key={key} style={{ marginBottom: 10 }}>
            <div className="admin-badge-row">
              <strong>{DISTANCE_LABELS[key]}</strong>
              {override ? (
                override.trust === "hidden"
                  ? <span className="admin-badge admin-badge-danger">скрыто тренером</span>
                  : <span className="admin-badge admin-badge-success">🏁 гонка {fmt(override.durationSeconds)}{override.raceName ? ` · ${override.raceName}` : ""}</span>
              ) : <span className="admin-badge admin-badge-muted">нет подтверждённой гонки</span>}
              {!override && suggestion ? <span className="admin-badge admin-badge-accent">из календаря: {suggestion.timeLabel} · {suggestion.date}</span> : null}
            </div>

            {!override && suggestion ? (
              <p className="admin-section-subtitle" style={{ margin: "6px 0 0" }}>Подставлено из race_events (время из сводки тренировки того дня). Проверь и подтверди.</p>
            ) : null}

            <form action={confirmRaceResultAction} className="admin-form-inline" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
              <input type="hidden" name="redirectTo" value={selfPath} />
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="distanceKey" value={key} />
              <input className="admin-input" name="time" placeholder="чч:мм:сс" defaultValue={suggestion?.timeLabel ?? ""} style={{ width: 110 }} />
              <input className="admin-input" name="date" type="date" defaultValue={suggestion?.date ?? ""} style={{ width: 150 }} />
              <input className="admin-input" name="raceName" placeholder="Название забега" defaultValue={suggestion?.raceName ?? ""} style={{ width: 200 }} />
              <FormActionButton className="admin-button admin-button-primary admin-button-small" pendingText="…">Подтвердить гонку</FormActionButton>
            </form>

            <div className="admin-inline-actions" style={{ marginTop: 6 }}>
              <form action={hideRecordAction}>
                <input type="hidden" name="redirectTo" value={selfPath} />
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="distanceKey" value={key} />
                <FormActionButton className="admin-button admin-button-danger admin-button-small" confirmMessage="Скрыть результат на этой дистанции?" pendingText="…">Скрыть</FormActionButton>
              </form>
              {override ? (
                <form action={clearRecordOverrideAction}>
                  <input type="hidden" name="redirectTo" value={selfPath} />
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="distanceKey" value={key} />
                  <FormActionButton className="admin-button admin-button-secondary admin-button-small" confirmMessage="Сбросить тренерское значение к реконструкции?" pendingText="…">Сбросить</FormActionButton>
                </form>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
