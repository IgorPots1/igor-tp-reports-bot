/**
 * Блок «Страница плана» на карточке ученицы: ссылка (выпустить / отозвать),
 * её сообщения тренеру, «Мои дни» со слов тренера и сигнал «поменяла дни».
 *
 * Отданную неделю «поменяла дни» не перестраивает [решение Игоря, 21.10.2026]:
 * сигнал здесь, решает тренер.
 */
import FormActionButton from "@/app/admin/FormActionButton";
import { getOnboardingAnswers } from "@/features/intervals/loop/repository";
import { isPlanPageEnabled, planPageUrl } from "@/features/intervals/plan-page/core";
import { getLivePlanLink } from "@/features/intervals/plan-page/links";
import { createSupabaseServerClient } from "@/features/supabase/server";

import {
  issuePlanLinkAction,
  markStudentMessagesReadAction,
  revokePlanLinkAction,
  saveCoachDaysAction,
} from "../actions";

const WD = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const DAY_FIELDS = ["available_weekdays", "unavailable_weekdays", "preferred_long_weekday"];

const box = { border: "1px solid #e0e0e0", borderRadius: 10, padding: "14px 16px", marginBottom: 18, maxWidth: 900 };

function ruDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function PlanPageAdminBlock({ studentUuid, sourceId }: { studentUuid: string; sourceId: string }) {
  const supabase = createSupabaseServerClient();
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const [link, answers, messagesRes, historyRes] = await Promise.all([
    getLivePlanLink(sourceId),
    getOnboardingAnswers(sourceId),
    supabase
      .from("intervals_student_messages")
      .select("id, body, origin, created_at, coach_read_at")
      .eq("source_id", sourceId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("intervals_onboarding_field_history")
      .select("field, changed_by, changed_at")
      .eq("source_id", sourceId)
      .in("field", DAY_FIELDS)
      .eq("changed_by", "student")
      .gte("changed_at", since)
      .order("changed_at", { ascending: false })
      .limit(1),
  ]);
  const messages = (messagesRes.data ?? []) as { id: string; body: string; origin: string; created_at: string; coach_read_at: string | null }[];
  const unread = messages.filter((m) => !m.coach_read_at);
  const daysChangedAt = (historyRes.data?.[0] as { changed_at?: string } | undefined)?.changed_at ?? null;
  const available = answers
    ? answers.availableWeekdays.length
      ? answers.availableWeekdays
      : [0, 1, 2, 3, 4, 5, 6].filter((d) => !answers.unavailableWeekdays.includes(d))
    : [];
  const long = answers?.preferredLongWeekday ?? null;

  return (
    <div style={{ ...box, background: unread.length || daysChangedAt ? "#FFF6E5" : undefined }}>
      <h2 style={{ marginTop: 0 }}>Страница плана</h2>

      {!isPlanPageEnabled() ? (
        <p style={{ margin: "0 0 10px", color: "#a3330a" }}>INTERVALS_PLAN_PAGE_ENABLED выключен: ссылка не откроется, бот ведёт в мини-апп.</p>
      ) : null}

      {link ? (
        <p style={{ margin: "0 0 8px", wordBreak: "break-all" }}>
          <a href={planPageUrl(link)} target="_blank" rel="noreferrer">
            {planPageUrl(link)}
          </a>
        </p>
      ) : (
        <p style={{ margin: "0 0 8px", color: "#555" }}>Ссылки нет — она на мини-аппе.</p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <form action={issuePlanLinkAction}>
          <input type="hidden" name="studentUuid" value={studentUuid} />
          <input type="hidden" name="sourceId" value={sourceId} />
          <FormActionButton
            confirmMessage={link ? "Выпустить новую ссылку? Старая сразу перестанет открываться." : "Выпустить ссылку на страницу плана?"}
            pendingText="Выпускаю…"
          >
            {link ? "Выпустить новую" : "Выпустить ссылку"}
          </FormActionButton>
        </form>
        {link ? (
          <form action={revokePlanLinkAction}>
            <input type="hidden" name="studentUuid" value={studentUuid} />
            <input type="hidden" name="sourceId" value={sourceId} />
            <FormActionButton confirmMessage="Отозвать ссылку? Страница перестанет открываться, бот снова поведёт в мини-апп." pendingText="Отзываю…">
              Отозвать
            </FormActionButton>
          </form>
        ) : null}
      </div>

      {daysChangedAt ? (
        <p style={{ margin: "12px 0 0", fontWeight: 600, color: "#7a5a12" }}>⚑ Поменяла дни {ruDate(daysChangedAt)}. Отданную неделю это не перестроило.</p>
      ) : null}

      <form action={saveCoachDaysAction} style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input type="hidden" name="studentUuid" value={studentUuid} />
        <input type="hidden" name="sourceId" value={sourceId} />
        <span>Дни:</span>
        {WD.map((t, d) => (
          <label key={d} style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
            <input type="checkbox" name="day" value={d} defaultChecked={available.includes(d)} />
            {t}
          </label>
        ))}
        <select name="long" defaultValue={long === null ? "" : String(long)} style={{ padding: "4px 6px" }}>
          <option value="">длительная —</option>
          {WD.map((t, d) => (
            <option key={d} value={d}>
              длительная: {t}
            </option>
          ))}
        </select>
        <FormActionButton pendingText="Сохраняю…">Сохранить со слов тренера</FormActionButton>
      </form>

      {messages.length ? (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Написала тренеру{unread.length ? ` · новых ${unread.length}` : ""}</h3>
          {messages.map((m) => (
            <div key={m.id} style={{ padding: "6px 0", borderTop: "1px solid #eee", fontWeight: m.coach_read_at ? 400 : 600 }}>
              <span style={{ color: "#777", fontSize: 12 }}>
                {ruDate(m.created_at)} · {m.origin === "page" ? "со страницы" : "боту"}
              </span>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
            </div>
          ))}
          {unread.length ? (
            <form action={markStudentMessagesReadAction} style={{ marginTop: 8 }}>
              <input type="hidden" name="studentUuid" value={studentUuid} />
              <input type="hidden" name="sourceId" value={sourceId} />
              <FormActionButton pendingText="…">Прочитал</FormActionButton>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
