"use client";

import { useState } from "react";

import styles from "./races.module.css";

type State = "closed" | "open" | "sending" | "sent";

/* «Знаете старт, которого нет? Добавьте»: заявка уходит в race_suggestions, её
   разбирает еженедельный раннер. Обязательна только ссылка. */
export default function SuggestRace({ prefillCity = "" }: { prefillCity?: string }) {
  const [state, setState] = useState<State>("closed");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ url: "", name: "", city: prefillCity, date_text: "", contact: "", is_organizer: false, website: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    // Прежняя ошибка уходит, как только человек начал её исправлять.
    if (error) setError("");
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.url.trim()) {
      setError("Нужна ссылка на страницу старта.");
      return;
    }
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/races/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setState("sent");
      } else {
        setError(data.error || "Не получилось отправить. Попробуйте ещё раз чуть позже.");
        setState("open");
      }
    } catch {
      setError("Нет связи. Попробуйте ещё раз чуть позже.");
      setState("open");
    }
  }

  if (state === "closed") {
    return (
      <button type="button" className={styles.suggestOpen} onClick={() => setState("open")}>
        Знаете старт, которого нет? Добавьте
      </button>
    );
  }

  if (state === "sent") {
    return (
      <p className={styles.suggestDone} role="status">
        Спасибо! Проверим старт у организатора и добавим в календарь в течение недели.
      </p>
    );
  }

  return (
    <form className={styles.suggest} onSubmit={submit} noValidate>
      <p className={styles.suggestTitle}>Добавить старт</p>
      <label className={styles.suggestField}>
        <span>Ссылка на старт *</span>
        <input type="url" inputMode="url" required placeholder="Сайт, регистрация или пост ВК" value={form.url} onChange={set("url")} />
      </label>
      <label className={styles.suggestField}>
        <span>Название</span>
        <input type="text" value={form.name} onChange={set("name")} />
      </label>
      <div className={styles.suggestRow}>
        <label className={styles.suggestField}>
          <span>Город</span>
          <input type="text" value={form.city} onChange={set("city")} />
        </label>
        <label className={styles.suggestField}>
          <span>Дата</span>
          <input type="text" placeholder="например, 13.03.2027" value={form.date_text} onChange={set("date_text")} />
        </label>
      </div>
      <label className={styles.suggestField}>
        <span>Контакт для вопросов</span>
        <input type="text" placeholder="Telegram, почта или телефон" value={form.contact} onChange={set("contact")} />
      </label>
      <label className={styles.suggestCheck}>
        <input type="checkbox" checked={form.is_organizer} onChange={set("is_organizer")} />
        <span>Я организатор этого старта</span>
      </label>
      {/* Ловушка для ботов: человек это поле не видит и не заполняет. */}
      <label className={styles.hp} aria-hidden="true">
        Сайт
        <input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
      </label>
      <p className={styles.suggestErr} aria-live="polite">
        {error}
      </p>
      <div className={styles.suggestActions}>
        <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={state === "sending"}>
          {state === "sending" ? "Отправляю..." : "Отправить"}
        </button>
        <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={() => setState("closed")}>
          Отмена
        </button>
      </div>
    </form>
  );
}
