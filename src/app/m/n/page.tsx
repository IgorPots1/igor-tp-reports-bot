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
    borderRadius: 12,
    padding: "20px 16px",
    marginTop: 8,
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  },
  heading: { fontSize: 18, fontWeight: 600, marginBottom: 12, marginTop: 0 },
  label: { display: "block" as const, fontSize: 14, marginBottom: 6, fontWeight: 500 },
  fileInput: { display: "block" as const, width: "100%", marginBottom: 16 },
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
    marginBottom: 10,
  },
  btnSecondary: {
    background: "transparent",
    color: "var(--tg-theme-button-color, #2481cc)",
    border: "1px solid var(--tg-theme-button-color, #2481cc)",
  },
  hint: { fontSize: 13, color: "var(--tg-theme-hint-color, #888)", marginTop: 8 },
  previewRow: { marginBottom: 6 },
  dateInput: {
    display: "block" as const,
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #ddd",
    fontSize: 15,
    marginBottom: 12,
    boxSizing: "border-box" as const,
  },
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

        {step === "idle" || step === "uploading" ? (
          <>
            <label style={STYLES.label}>Файл из FatSecret (PDF)</label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              style={STYLES.fileInput}
              onChange={handleFileChange}
              disabled={busy}
            />
            {file && (
              <p style={STYLES.hint}>{file.name}</p>
            )}
            <button
              style={{ ...STYLES.btn, opacity: busy ? 0.6 : 1 }}
              onClick={handleUpload}
              disabled={busy || !file}
            >
              {step === "uploading" ? "Обрабатываю..." : "Загрузить"}
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
              style={{ ...STYLES.btn, opacity: busy ? 0.6 : 1, marginTop: 12 }}
              onClick={handleConfirm}
              disabled={busy}
            >
              {step === "confirming" ? "Сохраняю..." : "Подтвердить и отправить"}
            </button>
            <button
              style={{ ...STYLES.btn, ...STYLES.btnSecondary }}
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
