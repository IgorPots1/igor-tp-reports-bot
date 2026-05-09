import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import { createTrainingPeaksStudentAction } from "@/app/admin/actions";
import { getSingleSearchParam } from "@/app/admin/lib";

type NewStudentPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminNewStudentPage({ searchParams }: NewStudentPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/students">
            ← Ко всем ученикам
          </Link>
          <h2>Добавить ученика</h2>
          <p className="admin-muted">
            Добавление в Web Admin обновляет только Supabase-реестр. Локальный <code>students.json</code>{" "}
            веб-приложение не меняет.
          </p>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>
          {error ?? notice}
        </div>
      )}

      <div className="admin-alert admin-alert-success">
        После добавления запусти локально <code>tp-sync-students</code>, чтобы Mac-runner обновил{" "}
        <code>students.json</code>.
      </div>

      <article className="admin-card">
        <form className="admin-form-stack" action={createTrainingPeaksStudentAction}>
          <input type="hidden" name="redirectTo" value="/admin/students/new" />

          <label className="admin-field">
            <span>student_id</span>
            <input
              className="admin-input"
              name="student_id"
              placeholder="olga-smirnova"
              autoComplete="off"
              required
            />
            <span className="admin-muted">
              Стабильный slug/code для локального pipeline и папок. Без пробелов, только буквы, цифры, точка,
              подчёркивание или дефис.
            </span>
          </label>

          <label className="admin-field">
            <span>Имя ученика</span>
            <input className="admin-input" name="student_name" placeholder="Ольга Смирнова" required />
          </label>

          <label className="admin-field">
            <span>TrainingPeaks athlete URL</span>
            <input
              className="admin-input"
              name="trainingpeaks_athlete_url"
              type="url"
              placeholder="https://app.trainingpeaks.com/#calendar/athletes/123456"
              required
            />
          </label>

          <label className="admin-field">
            <span>Статус качества данных</span>
            <input className="admin-input" name="data_quality_status" placeholder="ok" />
            <span className="admin-muted">Поле опционально. Если не нужно, оставь пустым.</span>
          </label>

          <label className="admin-field">
            <span>Заметки</span>
            <textarea className="admin-textarea admin-textarea-compact" name="notes" rows={5} />
          </label>

          <div className="admin-actions">
            <FormActionButton className="admin-button" pendingText="Создание...">
              Создать ученика
            </FormActionButton>
            <Link className="admin-button admin-button-secondary" href="/admin/students">
              Отмена
            </Link>
          </div>
        </form>
      </article>
    </section>
  );
}
