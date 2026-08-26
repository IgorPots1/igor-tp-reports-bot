"use client";
import { useState, FormEvent } from "react";

type Status = "idle" | "loading" | "success" | "error";

export default function LeadForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    const form = e.currentTarget;
    const data = {
      name: (form.elements.namedItem("name") as HTMLInputElement).value,
      phone: (form.elements.namedItem("phone") as HTMLInputElement).value,
      telegram:
        (form.elements.namedItem("telegram") as HTMLInputElement)?.value ?? "",
    };
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = (await res.json()) as { ok: boolean };
      if (json.ok) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg(
          "Не удалось отправить. Попробуй ещё раз или напиши напрямую."
        );
      }
    } catch {
      setStatus("error");
      setErrorMsg("Нет соединения. Попробуй ещё раз.");
    }
  }

  if (status === "success") {
    return (
      <p className="signup-success">
        Спасибо, свяжусь в течение 24 часов ✓
      </p>
    );
  }

  return (
    <form className="signup" onSubmit={handleSubmit}>
      <div className="fld">
        <label htmlFor="n">Имя</label>
        <input
          id="n"
          name="name"
          type="text"
          placeholder="Как тебя зовут"
          required
          disabled={status === "loading"}
        />
      </div>
      <div className="fld">
        <label htmlFor="p">Телефон</label>
        <input
          id="p"
          name="phone"
          type="tel"
          placeholder="+7 999 000 00 00"
          required
          disabled={status === "loading"}
        />
      </div>
      <div className="fld">
        <label htmlFor="tg">Telegram (по желанию)</label>
        <input
          id="tg"
          name="telegram"
          type="text"
          placeholder="@username"
          disabled={status === "loading"}
        />
      </div>
      <button type="submit" className="btn btn--lg" disabled={status === "loading"}>
        {status === "loading" ? "Отправляю..." : "Оставить заявку →"}
      </button>
      <div className="note">Без обязательств · Свяжусь в течение 24 часов</div>
      {status === "error" && (
        <p style={{ color: "#e53e3e", marginTop: "8px" }}>{errorMsg}</p>
      )}
    </form>
  );
}
