"use client";

import { useEffect, useRef, useState } from "react";

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  close: () => void;
  expand: () => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

type UploadPreview = {
  weekFrom: string;
  weekTo: string;
  dayCount: number;
  snappingApplied: boolean;
  needsManualWeek: boolean;
};

type Step = "idle" | "uploading" | "preview" | "confirming" | "done" | "error";

const STYLES = {
  page: {
    minHeight: "100vh",
    background: "var(--tg-theme-bg-color, #f5f5f5)",
    color: "var(--tg-theme-text-color, #222)",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 16,
    padding: "20px 16px 40px",
    boxSizing: "border-box" as const,
  },
  card: {
    background: "var(--tg-theme-secondary-bg-color, #fff)",
    borderRadius: 14,
    padding: "22px 18px",
    marginTop: 8,
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  },
  heading: { fontSize: 19, fontWeight: 700, margin: "0 0 4px" },
  subtitle: {
    fontSize: 14,
    color: "var(--tg-theme-hint-color, #888)",
    margin: "0 0 20px",
    lineHeight: 1.4,
  },
  stepLabel: {
    display: "block" as const,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    color: "var(--tg-theme-hint-color, #888)",
    margin: "0 0 8px",
  },
  label: { display: "block" as const, fontSize: 14, marginBottom: 6, fontWeight: 500 },
  btn: {
    display: "block" as const,
    width: "100%",
    padding: "14px 0",
    borderRadius: 10,
    border: "none",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    background: "var(--tg-theme-button-color, #2481cc)",
    color: "var(--tg-theme-button-text-color, #fff)",
    textAlign: "center" as const,
    boxSizing: "border-box" as const,
  },
  btnOutline: {
    background: "transparent",
    color: "var(--tg-theme-button-color, #2481cc)",
    border: "1px solid var(--tg-theme-button-color, #2481cc)",
  },
  btnDisabled: {
    // Greyed, non-interactive until a file is picked.
    background: "var(--tg-theme-hint-color, #c4c9cc)",
    color: "var(--tg-theme-secondary-bg-color, #fff)",
    cursor: "not-allowed" as const,
    opacity: 0.7,
  },
  fileChip: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 8,
    padding: "12px 14px",
    borderRadius: 10,
    background: "var(--tg-theme-bg-color, #f0f4f8)",
    color: "var(--tg-theme-text-color, #222)",
    fontSize: 14,
    wordBreak: "break-all" as const,
  },
  hint: { fontSize: 13, color: "var(--tg-theme-hint-color, #888)", marginTop: 8, lineHeight: 1.4 },
  previewRow: { marginBottom: 8, fontSize: 15 },
  dateInput: {
    display: "block" as const,
    width: "100%",
    padding: "11px 12px",
    borderRadius: 8,
    border: "1px solid var(--tg-theme-hint-color, #ddd)",
    background: "var(--tg-theme-bg-color, #fff)",
    color: "var(--tg-theme-text-color, #222)",
    fontSize: 15,
    marginBottom: 12,
    boxSizing: "border-box" as const,
  },
  hiddenInput: { display: "none" as const },
};

function formatIsoToDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export default function NutritionMiniApp() {
  const [step, setStep] = useState<Step>("idle");
  const [initData, setInitData] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [manualWeekFrom, setManualWeekFrom] = useState("");
  const [manualWeekTo, setManualWeekTo] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      // initData carries the signed start_param (student row id) from the
      // t.me direct link — the server reads it after validating the hash.
      setInitData(tg.initData);
    }
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(null);
    setErrorMsg(null);
  }

  async function handleUpload() {
    if (!file) {
      setErrorMsg("Выбери PDF-файл из FatSecret.");
      return;
    }
    setStep("uploading");
    setErrorMsg(null);

    const form = new FormData();
    form.append("initData", initData);
    form.append("file", file, file.name);

    try {
      const res = await fetch("/api/m/n/upload", { method: "POST", body: form });
      const json = (await res.json()) as { ok: boolean; preview?: UploadPreview; error?: string };
      if (!json.ok) {
        setErrorMsg(json.error ?? "Не удалось распознать файл.");
        setStep("idle");
        return;
      }
      const p = json.preview!;
      setPreview(p);
      if (p.needsManualWeek) {
        setManualWeekFrom("");
        setManualWeekTo("");
      }
      setStep("preview");
    } catch {
      setErrorMsg("Ошибка сети. Попробуй ещё раз.");
      setStep("idle");
    }
  }

  async function handleConfirm() {
    if (!file || !preview) return;

    const weekFrom = preview.needsManualWeek ? manualWeekFrom : preview.weekFrom;
    const weekTo = preview.needsManualWeek ? manualWeekTo : preview.weekTo;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(weekTo)) {
      setErrorMsg("Укажи даты недели в формате ГГГГ-ММ-ДД.");
      return;
    }

    setStep("confirming");
    setErrorMsg(null);

    const form = new FormData();
    form.append("initData", initData);
    form.append("file", file, file.name);
    form.append("weekFrom", weekFrom);
    form.append("weekTo", weekTo);

    try {
      const res = await fetch("/api/m/n/confirm", { method: "POST", body: form });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setErrorMsg(json.error ?? "Не удалось сохранить отчёт.");
        setStep("preview");
        return;
      }
      setStep("done");
      setTimeout(() => {
        window.Telegram?.WebApp?.close();
      }, 2000);
    } catch {
      setErrorMsg("Ошибка сети. Попробуй ещё раз.");
      setStep("preview");
    }
  }

  function handleBack() {
    setStep("idle");
    setPreview(null);
    setErrorMsg(null);
    if (fileRef.current) fileRef.current.value = "";
    setFile(null);
  }

  if (step === "done") {
    return (
      <div style={STYLES.page}>
        <div style={STYLES.card}>
          <p style={{ textAlign: "center", fontSize: 18 }}>✓ Отчёт сохранён!</p>
          <p style={{ ...STYLES.hint, textAlign: "center" }}>Тренер получил уведомление. Окно закроется автоматически.</p>
        </div>
      </div>
    );
  }

  const busy = step === "uploading" || step === "confirming";

  return (
    <div style={STYLES.page}>
      <div style={STYLES.card}>
        <h2 style={STYLES.heading}>Отчёт о питании</h2>
        <p style={STYLES.subtitle}>Прикрепи PDF-выгрузку из FatSecret за прошедшую неделю.</p>

        {step === "idle" || step === "uploading" ? (
          <>
            {/* Step 1 — choose the file (the primary action until one is picked). */}
            <span style={STYLES.stepLabel}>Шаг 1 · Файл</span>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              style={STYLES.hiddenInput}
              onChange={handleFileChange}
              disabled={busy}
            />
            {file ? (
              <div style={{ ...STYLES.fileChip, marginBottom: 12 }}>
                <span aria-hidden>✓</span>
                <span>{file.name}</span>
              </div>
            ) : null}
            <button
              type="button"
              style={{
                ...STYLES.btn,
                ...(file ? STYLES.btnOutline : {}),
                opacity: busy ? 0.6 : 1,
                marginBottom: 20,
              }}
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              {file ? "Выбрать другой файл" : "Выбрать файл"}
            </button>

            {/* Step 2 — upload (disabled until a file is selected). */}
            <span style={STYLES.stepLabel}>Шаг 2 · Загрузка</span>
            <button
              type="button"
              style={{
                ...STYLES.btn,
                ...(!file || busy ? STYLES.btnDisabled : {}),
              }}
              onClick={handleUpload}
              disabled={busy || !file}
            >
              {step === "uploading" ? "Обрабатываю…" : "Загрузить"}
            </button>
          </>
        ) : null}

        {(step === "preview" || step === "confirming") && preview ? (
          <>
            <p style={STYLES.previewRow}>
              <strong>Файл:</strong> {file?.name}
            </p>
            <p style={STYLES.previewRow}>
              <strong>Дней найдено:</strong> {preview.dayCount}
            </p>

            {preview.needsManualWeek ? (
              <>
                <p style={STYLES.hint}>
                  Даты в файле не распознаны — укажи неделю вручную.
                </p>
                <label style={STYLES.label}>Начало недели (пн)</label>
                <input
                  type="date"
                  style={STYLES.dateInput}
                  value={manualWeekFrom}
                  onChange={(e) => setManualWeekFrom(e.target.value)}
                  disabled={busy}
                />
                <label style={STYLES.label}>Конец недели (вс)</label>
                <input
                  type="date"
                  style={STYLES.dateInput}
                  value={manualWeekTo}
                  onChange={(e) => setManualWeekTo(e.target.value)}
                  disabled={busy}
                />
              </>
            ) : (
              <p style={STYLES.previewRow}>
                <strong>Неделя:</strong>{" "}
                {formatIsoToDisplay(preview.weekFrom)}–{formatIsoToDisplay(preview.weekTo)}
                {preview.snappingApplied && (
                  <span style={STYLES.hint}> (скорректирована до пн–вс)</span>
                )}
              </p>
            )}

            <button
              type="button"
              style={{ ...STYLES.btn, opacity: busy ? 0.6 : 1, marginTop: 12, marginBottom: 10 }}
              onClick={handleConfirm}
              disabled={busy}
            >
              {step === "confirming" ? "Сохраняю…" : "Подтвердить и отправить"}
            </button>
            <button
              type="button"
              style={{ ...STYLES.btn, ...STYLES.btnOutline }}
              onClick={handleBack}
              disabled={busy}
            >
              Назад
            </button>
          </>
        ) : null}

        {errorMsg && (
          <p style={{ color: "#c0392b", fontSize: 14, marginTop: 10 }}>{errorMsg}</p>
        )}

        {!initData && step === "idle" && (
          <p style={{ ...STYLES.hint, marginTop: 16 }}>
            Открой через Telegram для полного функционала.
          </p>
        )}
      </div>
    </div>
  );
}
