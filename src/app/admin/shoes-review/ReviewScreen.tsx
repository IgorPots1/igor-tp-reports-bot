"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import {
  DRAFT_FIELDS,
  EXCLUDE_REASONS,
  applyDecision,
  batchProgress,
  draftIsConfirmed,
  type CoachDraft,
  type DraftField,
  type DraftFieldKey,
  type ExcludeReason,
  type FieldDef,
} from "@/features/shoes/coach-drafts";

import { decideShoeDraftField, excludeShoeDraft } from "./actions";
import styles from "./review.module.css";

/**
 * Экран проверки: одна модель, поля по порядку, у каждого — черновое значение,
 * цитаты и ссылки. Решение применяется на экране сразу и уходит на сервер;
 * сервер не принял — откат и сообщение.
 *
 * Клавиши: ↑/↓ — поле; 1 или Enter — «верно»; 2 или E — «поправить»;
 * 3 или N — «не знаю»; ←/→ — модель. В правке: Enter — сохранить, Esc — отмена.
 * X — «убрать из каталога»: затем 1/2/3 — причина, Esc — отмена.
 */

const STATUS_WORD: Record<string, string> = { draft: "черновик", confirmed: "верно", unknown: "не знаю" };

function show(def: FieldDef, value: unknown): string {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return "— нет данных —";
  const label = (v: unknown) => def.options.find((o) => o.value === v)?.label ?? String(v);
  return Array.isArray(value) ? value.map(label).join(" · ") : label(value);
}

export default function ReviewScreen({ initial }: { initial: CoachDraft[] }) {
  const [drafts, setDrafts] = useState(initial);
  const [i, setI] = useState(() => Math.max(0, initial.findIndex((d) => d.status === "draft")));
  const [excluding, setExcluding] = useState(false);
  const [fieldIx, setFieldIx] = useState(0);
  const [editing, setEditing] = useState<{ key: DraftFieldKey; value: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const draft = drafts[i];
  // Убранные из каталога в счётчик пачки не входят.
  const progress = batchProgress(drafts);
  const def = DRAFT_FIELDS[fieldIx];

  const replace = (next: CoachDraft) => setDrafts((all) => all.map((d) => (d.id === next.id ? next : d)));

  const decide = useCallback(
    (key: DraftFieldKey, action: "confirm" | "correct" | "unknown", value?: unknown) => {
      const before = drafts[i];
      // Сразу на экране: Игорь не ждёт сервер, чтобы перейти к следующему полю.
      const fields = { ...before.fields, [key]: applyDecision(before.fields[key], action, value, new Date().toISOString()) };
      replace({ ...before, fields, status: draftIsConfirmed(fields) ? "confirmed" : "draft" });
      setError(null);
      startTransition(async () => {
        const res = await decideShoeDraftField({ id: before.id, field: key, action, value });
        if (res.ok) replace(res.draft);
        else {
          replace(before);
          setError(`Не сохранилось (${before.model}, ${key}): ${res.error}`);
        }
      });
      setFieldIx((f) => Math.min(DRAFT_FIELDS.length - 1, f + 1));
    },
    [drafts, i]
  );

  const exclude = useCallback(
    (reason: ExcludeReason | null) => {
      const before = drafts[i];
      replace({ ...before, status: reason ? "excluded" : draftIsConfirmed(before.fields) ? "confirmed" : "draft", excluded_reason: reason });
      setExcluding(false);
      setError(null);
      startTransition(async () => {
        const res = await excludeShoeDraft({ id: before.id, reason });
        if (res.ok) replace(res.draft);
        else {
          replace(before);
          setError(`Не сохранилось (${before.model}): ${res.error}`);
        }
      });
    },
    [drafts, i]
  );

  const startEdit = useCallback(() => {
    const f = draft.fields[def.key];
    setEditing({ key: def.key, value: f?.value ?? (def.kind === "many" ? [] : null) });
  }, [draft, def]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (excluding) {
        const ix = ["1", "2", "3"].indexOf(e.key);
        if (ix > -1) exclude(EXCLUDE_REASONS[ix].value);
        else if (e.key === "Escape") setExcluding(false);
        e.preventDefault();
        return;
      }
      if (editing) {
        if (e.key === "Escape") setEditing(null);
        if (e.key === "Enter" && tag !== "TEXTAREA") {
          e.preventDefault();
          decide(editing.key, "correct", editing.value);
          setEditing(null);
        }
        return;
      }
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key.toLowerCase() === "x" || e.key.toLowerCase() === "ч") {
        if (drafts[i]?.status !== "excluded") setExcluding(true);
        e.preventDefault();
        return;
      }
      if (drafts[i]?.status === "excluded" && !e.key.startsWith("Arrow")) return;
      if (e.key === "ArrowDown") setFieldIx((f) => Math.min(DRAFT_FIELDS.length - 1, f + 1));
      else if (e.key === "ArrowUp") setFieldIx((f) => Math.max(0, f - 1));
      else if (e.key === "ArrowRight") {
        setI((x) => Math.min(drafts.length - 1, x + 1));
        setFieldIx(0);
      } else if (e.key === "ArrowLeft") {
        setI((x) => Math.max(0, x - 1));
        setFieldIx(0);
      } else if (e.key === "1" || e.key === "Enter") decide(def.key, "confirm");
      else if (e.key === "2" || e.key.toLowerCase() === "e" || e.key.toLowerCase() === "у") startEdit();
      else if (e.key === "3" || e.key.toLowerCase() === "n" || e.key.toLowerCase() === "т") decide(def.key, "unknown");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, def, drafts, editing, excluding, exclude, i, startEdit]);

  const sources = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of Object.values(draft?.fields ?? {}) as DraftField[]) {
      for (const e of f.evidence ?? []) seen.set(e.url, e.source_title);
    }
    return [...seen.entries()];
  }, [draft]);

  if (!draft) return <p className="admin-muted">В пачке нет моделей.</p>;

  return (
    <section className="admin-section">
      <div className={styles.counter}>
        Подтверждено {progress.confirmed} из {progress.total}
        {progress.excluded ? ` · убрано ${progress.excluded}` : ""} · модель {i + 1} из {drafts.length}
        <span className="admin-muted"> · ↑↓ поле · 1/Enter верно · 2/E поправить · 3/N не знаю · X убрать · ←→ модель</span>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}

      <div className="admin-card">
        <div className={styles.head}>
          <div className={styles.name}>
            {draft.brand} {draft.model}
          </div>
          <div className="admin-muted">
            {draft.kind === "manual" ? "пустая карточка — заполни сам" : `источников: ${sources.length}`}
            {draft.confidence === "low" ? " · один источник" : ""}
            {draft.status === "confirmed" ? " · модель подтверждена" : ""}
          </div>
        </div>
        {draft.note ? <p className="admin-hint">{draft.note}</p> : null}
        {draft.status === "excluded" ? (
          <div className={styles.excluded}>
            Убрана из каталога: {EXCLUDE_REASONS.find((r) => r.value === draft.excluded_reason)?.label ?? "причина не указана"}.
            В подбор не попадёт.{" "}
            <button type="button" onClick={() => exclude(null)}>Вернуть в каталог</button>
          </div>
        ) : excluding ? (
          <div className={styles.excluded}>
            Убрать из каталога — причина:{" "}
            {EXCLUDE_REASONS.map((r, k) => (
              <button key={r.value} type="button" onClick={() => exclude(r.value)}>
                {k + 1} · {r.label}
              </button>
            ))}{" "}
            <button type="button" onClick={() => setExcluding(false)}>Отмена (Esc)</button>
          </div>
        ) : (
          <div className={styles.buttons}>
            <button type="button" onClick={() => setExcluding(true)}>Убрать из каталога (X)</button>
          </div>
        )}
        {draft.kind === "manual" ? (
          <ManualName draft={draft} onSaved={replace} onError={setError} />
        ) : null}

        <ol className={styles.fields}>
          {DRAFT_FIELDS.map((f, ix) => {
            const field = draft.fields[f.key];
            const status = field?.status ?? "draft";
            const active = ix === fieldIx;
            return (
              <li
                key={f.key}
                className={`${styles.field} ${active ? styles.fieldActive : ""} ${styles[`st_${status}`] ?? ""}`}
                onClick={() => setFieldIx(ix)}
              >
                <div className={styles.fieldHead}>
                  <span className={styles.fieldTitle}>{f.title}</span>
                  <span className={styles.status}>{STATUS_WORD[status]}</span>
                </div>
                {editing && editing.key === f.key ? (
                  <Editor def={f} value={editing.value} onChange={(v) => setEditing({ key: f.key, value: v })} />
                ) : (
                  <div className={styles.value}>{show(f, field?.value)}</div>
                )}
                {field && field.status === "confirmed" && JSON.stringify(field.value) !== JSON.stringify(field.draft_value) ? (
                  <div className="admin-muted">черновик был: {show(f, field.draft_value)}</div>
                ) : null}
                {(field?.evidence ?? []).map((e, k) => (
                  <blockquote key={k} className={styles.quote}>
                    «{e.quote}» —{" "}
                    <a href={e.url} target="_blank" rel="noopener noreferrer">
                      {e.source_title}
                    </a>
                  </blockquote>
                ))}
                {active && draft.status !== "excluded" ? (
                  <div className={styles.buttons}>
                    {editing && editing.key === f.key ? (
                      <>
                        <button type="button" onClick={() => { decide(f.key, "correct", editing.value); setEditing(null); }}>
                          Сохранить (Enter)
                        </button>
                        <button type="button" onClick={() => setEditing(null)}>Отмена (Esc)</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => decide(f.key, "confirm")}>Верно (1)</button>
                        <button type="button" onClick={startEdit}>Поправить (2)</button>
                        <button type="button" onClick={() => decide(f.key, "unknown")}>Не знаю (3)</button>
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className={styles.nav}>
          <button type="button" disabled={i === 0} onClick={() => { setI(i - 1); setFieldIx(0); }}>
            ← Предыдущая
          </button>
          <button type="button" disabled={i === drafts.length - 1} onClick={() => { setI(i + 1); setFieldIx(0); }}>
            Следующая →
          </button>
        </div>
      </div>
    </section>
  );
}

function Editor({ def, value, onChange }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  if (def.kind === "number") {
    return (
      <input
        autoFocus
        className="admin-input"
        type="number"
        min={2015}
        max={2030}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      />
    );
  }
  if (def.kind === "one") {
    return (
      <div className={styles.options}>
        {def.options.map((o) => (
          <label key={String(o.value)} className={styles.option}>
            <input type="radio" checked={value === o.value} onChange={() => onChange(o.value)} /> {o.label}
          </label>
        ))}
        <label className={styles.option}>
          <input type="radio" checked={value === null} onChange={() => onChange(null)} /> пусто
        </label>
      </div>
    );
  }
  const list = Array.isArray(value) ? (value as unknown[]) : [];
  return (
    <div className={styles.options}>
      {def.options.map((o) => (
        <label key={String(o.value)} className={styles.option}>
          <input
            type="checkbox"
            checked={list.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))}
          />{" "}
          {o.label}
        </label>
      ))}
    </div>
  );
}

function ManualName({
  draft,
  onSaved,
  onError,
}: {
  draft: CoachDraft;
  onSaved: (d: CoachDraft) => void;
  onError: (e: string | null) => void;
}) {
  const [name, setName] = useState(draft.model);
  const [pending, start] = useTransition();
  return (
    <form
      className="admin-form-inline"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await decideShoeDraftField({ id: draft.id, field: "model", action: "correct", value: name });
          if (res.ok) {
            onSaved(res.draft);
            onError(null);
          } else onError(res.error);
        });
      }}
    >
      <input className="admin-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название модели" />
      <button type="submit" disabled={pending}>Сохранить название</button>
    </form>
  );
}
