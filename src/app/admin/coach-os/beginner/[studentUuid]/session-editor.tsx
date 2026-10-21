/**
 * «Править» у тренировки на карточке ученицы [решение Игоря, 21.10.2026]:
 * название, заметка, текст и минуты каждого шага, ключ шага для эталона.
 *
 * Отданная неделя: правка видна ей сразу. Уведомление «Поправил неделю» —
 * только по кнопке здесь же (тот же releaseWeekAction, что «Отдать ученице»),
 * не автоматически при сохранении.
 */
import FormActionButton from "@/app/admin/FormActionButton";
import { editableRows, studentNoteOf, type EditableSession } from "@/features/intervals/step-texts/edit";
import { STEP_KEYS, STEP_KEY_LABEL_RU } from "@/features/intervals/step-texts/keys";

import { editSessionAction, releaseWeekAction } from "../actions";

type EditRow = {
  field: string;
  step_index: number | null;
  step_key: string | null;
  value_before: string | null;
  value_after: string | null;
  edited_by: string;
  edited_at: string;
  became_etalon: boolean;
};

const FIELD_RU: Record<string, string> = { title: "название", note: "заметка", step_text: "текст шага", step_minutes: "минуты шага" };

export function SessionEditor(props: {
  studentUuid: string;
  sourceId: string;
  session: EditableSession & { cycleId: string; weekStart: string };
  onTreadmill: boolean;
  weekReleased: boolean;
  history: EditRow[];
  justEdited: boolean;
  etalonSkipped: number;
}) {
  const { session } = props;
  const rows = editableRows(session, props.onTreadmill);
  const input = { padding: "4px 6px", fontFamily: "inherit", fontSize: 13 } as const;
  return (
    <details id={`s-${session.id}`} open={props.justEdited || undefined} style={{ marginTop: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 13, color: "#355" }}>Править</summary>
      {props.justEdited ? (
        <p style={{ margin: "6px 0", fontSize: 13, color: "#2E7D45" }}>
          ✓ Сохранено{props.weekReleased ? " — ей уже видно" : ""}.
          {props.etalonSkipped ? ` Эталоном не стало ${props.etalonSkipped}: в тексте диапазон чисел.` : ""}
        </p>
      ) : null}
      <form action={editSessionAction} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
        <input type="hidden" name="studentUuid" value={props.studentUuid} />
        <input type="hidden" name="sourceId" value={props.sourceId} />
        <input type="hidden" name="sessionId" value={session.id} />
        <label style={{ fontSize: 12 }}>
          Название
          <input name="title" defaultValue={session.title} style={{ ...input, display: "block", width: "100%" }} />
        </label>
        <label style={{ fontSize: 12 }}>
          Заметка ученице
          <textarea name="note" rows={2} defaultValue={studentNoteOf(session)} style={{ ...input, display: "block", width: "100%" }} />
        </label>
        {rows.map((row) => (
          <div key={row.path} style={{ borderTop: "1px dashed #ddd", paddingTop: 6 }}>
            <input type="hidden" name="path" value={row.path} />
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {row.name}
              {row.times > 1 ? ` × ${row.times}` : ""}
            </div>
            <textarea name={`text:${row.path}`} rows={2} defaultValue={row.text} style={{ ...input, width: "100%" }} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
              <label>
                мин <input name={`min:${row.path}`} defaultValue={String(row.minutes)} inputMode="decimal" style={{ ...input, width: 56 }} />
              </label>
              <select name={`key:${row.path}`} defaultValue={row.key ?? row.guessedKey ?? ""} style={input}>
                <option value="">без ключа — не эталон</option>
                {STEP_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {STEP_KEY_LABEL_RU[k]}
                    {!row.key && row.guessedKey === k ? " (догадка)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
        <div>
          <FormActionButton
            confirmMessage={
              props.weekReleased
                ? "Сохранить? Неделя отдана — ей станет видно сразу. Текст шага с ключом станет эталоном для всех учеников. Уведомления не будет."
                : "Сохранить? Текст шага с ключом станет эталоном для всех учеников."
            }
            pendingText="Сохраняю…"
          >
            Сохранить правку
          </FormActionButton>
        </div>
      </form>
      {props.weekReleased ? (
        <form action={releaseWeekAction} style={{ marginTop: 6 }}>
          <input type="hidden" name="studentUuid" value={props.studentUuid} />
          <input type="hidden" name="cycleId" value={session.cycleId} />
          <input type="hidden" name="sourceId" value={props.sourceId} />
          <input type="hidden" name="weekStart" value={session.weekStart} />
          <FormActionButton confirmMessage="Отправить ей «Поправил вашу неделю»?" pendingText="Отправляю…">
            Сообщить ей: «Поправил неделю»
          </FormActionButton>
        </form>
      ) : null}
      {props.history.length ? (
        <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
          {props.history.slice(0, 12).map((h, i) => (
            <div key={i} style={{ padding: "2px 0" }}>
              {h.edited_at.slice(0, 16).replace("T", " ")} · {h.edited_by} · {FIELD_RU[h.field] ?? h.field}
              {h.step_key ? ` (${STEP_KEY_LABEL_RU[h.step_key as keyof typeof STEP_KEY_LABEL_RU] ?? h.step_key})` : ""}: «{h.value_before ?? "—"}» → «
              {h.value_after ?? "—"}»{h.became_etalon ? " · ЭТАЛОН" : ""}
            </div>
          ))}
        </div>
      ) : null}
    </details>
  );
}
