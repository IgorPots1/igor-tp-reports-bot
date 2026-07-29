import { getSingleSearchParam } from "@/app/admin/lib";
import { isClubAdminEnabled } from "@/features/club-admin/repository";
import { isClubFormsBroadcastEnabled } from "@/features/club/constants";
import {
  listBroadcastRecipients,
  computeScheduleNonResponders,
  CLUB_FORM_DEFAULT_TEXT,
  CLUB_FORM_TITLES,
} from "@/features/club-admin/forms-broadcast";
import { sendClubFormsBroadcastAction, remindClubScheduleNonRespondersAction } from "@/app/admin/club/actions";
import BroadcastPanel from "./BroadcastPanel";

export const dynamic = "force-dynamic";
// The send loops over recipients with a pause; give the function room. Vercel caps this to the
// plan limit. If it is capped low, a timeout is safe: sent rows are logged and the dedup skips
// them, so re-tapping simply continues where it stopped (or send in chunks via the checkboxes).
export const maxDuration = 60;

export default async function ClubFormsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = "/admin/club/forms";

  const [{ attached, unreachable }, nonResponders] = await Promise.all([
    listBroadcastRecipients(),
    computeScheduleNonResponders(),
  ]);
  const broadcastEnabled = isClubFormsBroadcastEnabled();

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Рассылка форм</h1>
        <p className="admin-section-subtitle">
          Сообщение от бота с ссылкой, открывающей нужный раздел клуба. Ничего не уходит само - только по кнопке ниже, с подтверждением. Отправка идёт по одному с паузой; сбои собираются и показываются после.
        </p>
      </div>

      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}
      {!broadcastEnabled ? (
        <div className="admin-alert admin-alert-warning">
          Рассылка выключена флагом CLUB_FORMS_BROADCAST_ENABLED. Получателей видно, но отправка вернёт «выключено». Включи флаг на Vercel, когда будешь готов.
        </div>
      ) : null}

      <BroadcastPanel
        selfPath={selfPath}
        recipients={attached.map((r) => ({ studentId: r.studentId, name: r.name }))}
        unreachable={unreachable}
        nonResponders={{ targetWeek: nonResponders.targetWeek, names: nonResponders.students.map((s) => s.name) }}
        defaults={CLUB_FORM_DEFAULT_TEXT}
        titles={CLUB_FORM_TITLES}
        sendAction={sendClubFormsBroadcastAction}
        remindAction={remindClubScheduleNonRespondersAction}
      />
    </section>
  );
}
