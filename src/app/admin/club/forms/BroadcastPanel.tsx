"use client";

import { useMemo, useState } from "react";

type Recipient = { studentId: string; name: string };
type FormType = "starts" | "schedule";

export default function BroadcastPanel(props: {
  selfPath: string;
  recipients: Recipient[];
  unreachable: Array<{ studentId: string; name: string; reason: string }>;
  nonResponders: { targetWeek: string | null; names: string[] };
  defaults: Record<FormType, string>;
  titles: Record<FormType, string>;
  sendAction: (formData: FormData) => void | Promise<void>;
  remindAction: (formData: FormData) => void | Promise<void>;
}) {
  const [formType, setFormType] = useState<FormType>("schedule");
  const [texts, setTexts] = useState<Record<FormType, string>>({ ...props.defaults });
  const [checked, setChecked] = useState<Record<string, boolean>>(
    () => Object.fromEntries(props.recipients.map((r) => [r.studentId, true]))
  );

  const checkedIds = useMemo(() => props.recipients.filter((r) => checked[r.studentId]).map((r) => r.studentId), [checked, props.recipients]);
  const count = checkedIds.length;

  function setAll(on: boolean) {
    setChecked(Object.fromEntries(props.recipients.map((r) => [r.studentId, on])));
  }

  return (
    <div>
      {/* form type */}
      <div className="admin-card" style={{ marginTop: 12 }}>
        <div className="admin-summary-label" style={{ marginBottom: 6 }}>Тип формы</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["schedule", "starts"] as FormType[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`admin-button admin-button-small ${formType === t ? "admin-button-primary" : ""}`}
              onClick={() => setFormType(t)}
            >
              {props.titles[t]}
            </button>
          ))}
        </div>

        <div className="admin-summary-label" style={{ margin: "12px 0 4px" }}>Текст сообщения (редактируется)</div>
        <textarea
          className="admin-input"
          style={{ width: "100%", minHeight: 80, boxSizing: "border-box" }}
          value={texts[formType]}
          onChange={(e) => setTexts((prev) => ({ ...prev, [formType]: e.target.value }))}
        />
        <p className="admin-summary-label" style={{ marginTop: 4 }}>
          Ссылка «{formType === "starts" ? "Открыть старты" : "Открыть расписание"}» добавится в конец автоматически и откроет нужный раздел клуба.
        </p>
      </div>

      {/* recipients */}
      <div className="admin-card" style={{ marginTop: 12 }}>
        <div className="admin-badge-row">
          <strong>Получатели: выбрано {count} из {props.recipients.length}</strong>
          <span>
            <button type="button" className="admin-button admin-button-small" onClick={() => setAll(true)}>Выбрать все</button>{" "}
            <button type="button" className="admin-button admin-button-small" onClick={() => setAll(false)}>Снять все</button>
          </span>
        </div>
        <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 8, columns: "2 220px" }}>
          {props.recipients.map((r) => (
            <label key={r.studentId} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", breakInside: "avoid" }}>
              <input
                type="checkbox"
                checked={Boolean(checked[r.studentId])}
                onChange={(e) => setChecked((prev) => ({ ...prev, [r.studentId]: e.target.checked }))}
              />
              <span>{r.name}</span>
            </label>
          ))}
        </div>

        {/* send */}
        <form
          action={props.sendAction}
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            if (count === 0) { e.preventDefault(); return; }
            if (!window.confirm(`Отправить «${props.titles[formType]}» ${count} ученикам?`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="redirectTo" value={props.selfPath} />
          <input type="hidden" name="formType" value={formType} />
          <input type="hidden" name="messageText" value={texts[formType]} />
          {checkedIds.map((id) => (
            <input key={id} type="hidden" name="studentIds" value={id} />
          ))}
          <button type="submit" className="admin-button admin-button-primary" disabled={count === 0}>
            Отправить {count} ученикам
          </button>
        </form>
      </div>

      {/* unreachable */}
      {props.unreachable.length > 0 ? (
        <div className="admin-card" style={{ marginTop: 12 }}>
          <div className="admin-summary-label" style={{ marginBottom: 6 }}>Нельзя отправить ({props.unreachable.length}) - нет telegram_user_id</div>
          <div style={{ columns: "2 220px" }}>
            {props.unreachable.map((u) => (
              <div key={u.studentId} style={{ padding: "2px 0", breakInside: "avoid" }}>{u.name}</div>
            ))}
          </div>
        </div>
      ) : null}

      {/* remind non-responders (schedule) */}
      <div className="admin-card" style={{ marginTop: 12 }}>
        <div className="admin-summary-label" style={{ marginBottom: 6 }}>Напоминание не ответившим (форма расписания)</div>
        {props.nonResponders.names.length === 0 ? (
          <p className="admin-summary-label">
            {props.nonResponders.targetWeek
              ? `Все, кому отправляли расписание на неделю ${props.nonResponders.targetWeek}, уже заполнили - напоминать некому.`
              : "Рассылки расписания ещё не было."}
          </p>
        ) : (
          <>
            <p className="admin-summary-label">
              Не заполнили расписание на неделю {props.nonResponders.targetWeek} ({props.nonResponders.names.length}): {props.nonResponders.names.join(", ")}
            </p>
            <form
              action={props.remindAction}
              style={{ marginTop: 8 }}
              onSubmit={(e) => {
                if (!window.confirm(`Отправить напоминание ${props.nonResponders.names.length} не ответившим?`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="redirectTo" value={props.selfPath} />
              <input type="hidden" name="messageText" value={texts.schedule} />
              <button type="submit" className="admin-button admin-button-primary">
                Напомнить {props.nonResponders.names.length} не ответившим
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
