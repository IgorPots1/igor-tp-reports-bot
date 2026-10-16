"use client";
import { useState, FormEvent } from "react";

// English twin of src/app/club/LeadForm.tsx for /coaching.
// Same endpoint (/api/lead). Only name + phone: many international leads
// have no Telegram, the coach calls or writes back on the number himself.
// source="coaching-en" marks the lead as coming from the English page.

type Status = "idle" | "loading" | "success" | "error";

export default function LeadFormEn() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    const form = e.currentTarget;
    const data = {
      name: (form.elements.namedItem("name") as HTMLInputElement).value,
      phone: (form.elements.namedItem("phone") as HTMLInputElement).value,
      source: "coaching-en",
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
        setErrorMsg("Something went wrong. Try again or DM me on Instagram.");
      }
    } catch {
      setStatus("error");
      setErrorMsg("No connection. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <p className="signup-success">Thanks! I&apos;ll get back to you within 24 hours ✓</p>
    );
  }

  return (
    <form className="signup" onSubmit={handleSubmit}>
      <div className="fld">
        <label htmlFor="n">Name</label>
        <input
          id="n"
          name="name"
          type="text"
          placeholder="Your name"
          required
          disabled={status === "loading"}
        />
      </div>
      <div className="fld">
        <label htmlFor="p">Phone number</label>
        <input
          id="p"
          name="phone"
          type="tel"
          placeholder="+1 555 000 0000"
          required
          disabled={status === "loading"}
        />
      </div>
      <button type="submit" className="btn btn--lg" disabled={status === "loading"}>
        {status === "loading" ? "Sending..." : "Apply now →"}
      </button>
      <div className="note">No commitment · I reply within 24 hours</div>
      {status === "error" && (
        <p style={{ color: "#e53e3e", marginTop: "8px" }}>{errorMsg}</p>
      )}
    </form>
  );
}
