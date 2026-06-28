"use client";

import { useEffect, useRef, useState } from "react";

import ReviewScreen from "@/app/m/n/ReviewScreen";

type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { start_param?: string };
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

type Step = "idle" | "uploading" | "preview" | "checkin" | "confirming" | "done" | "error";

// Force-light palette for the check-in step. Explicit hex so the phone's Telegram
// dark theme can't wash out the scale taps (same intent as ReviewScreen).
const CHECKIN = {
  section: {
    marginBottom: 24,
  },
  scaleLabel: { fontSize: 14, fontWeight: 600, color: "#8a8f96", letterSpacing: "0.03em", textTransform: "uppercase" as const, margin: "0 0 10px" },
  scaleRow: { display: "flex" as const, gap: 4, marginBottom: 4 },
  scaleCell: {
    flex: 1,
    minWidth: 0,
    padding: "12px 0",
    borderRadius: 10,
    border: "1.5px solid #e5e8ed",
    background: "#f7f8fa",
    color: "#5a5f6b",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "center" as const,
    transition: "background 0.1s, color 0.1s, border-color 0.1s",
  },
  scaleCellActive: {
    background: "#2481cc",
    color: "#ffffff",
    border: "1.5px solid #2481cc",
  },
  scalePoles: {
    display: "flex" as const,
    justifyContent: "space-between" as const,
    fontSize: 11,
    color: "#b0b5be",
    marginBottom: 22,
    padding: "0 2px",
  },
  fieldLabel: { display: "block" as const, fontSize: 14, fontWeight: 600, color: "#8a8f96", letterSpacing: "0.03em", textTransform: "uppercase" as const, margin: "0 0 8px" },
  input: {
    display: "block" as const,
    width: "100%",
    padding: "13px 14px",
    borderRadius: 10,
    border: "1.5px solid #e5e8ed",
    background: "#f7f8fa",
    color: "#1c1c1e",
    fontSize: 16, // ≥16px prevents iOS auto-zoom on focus
    marginBottom: 20,
    boxSizing: "border-box" as const,
  },
  note: { fontSize: 13, color: "#b0b5be", margin: "0 0 20px", lineHeight: 1.45 },
  divider: { height: 1, background: "#f0f2f5", margin: "4px 0 20px" },
};

// 1-10 scale selector. Tap to set, tap again to clear (skippable).
function ScaleRow(props: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
  showPoles?: boolean;
}) {
  return (
    <div style={CHECKIN.section}>
      <p style={CHECKIN.scaleLabel}>{props.label}</p>
      <div style={CHECKIN.scaleRow}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const active = props.value === n;
          return (
            <button
              key={n}
              type="button"
              disabled={props.disabled}
              aria-label={`${props.label}: ${n}`}
              aria-pressed={active}
              style={{ ...CHECKIN.scaleCell, ...(active ? CHECKIN.scaleCellActive : {}) }}
              onClick={() => props.onChange(active ? null : n)}
            >
              {n}
            </button>
          );
        })}
      </div>
      {props.showPoles && (
        <div style={CHECKIN.scalePoles}>
          <span>1 — низко</span>
          <span>10 — высоко</span>
        </div>
      )}
    </div>
  );
}

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
    fontSize: 16,
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
  // Review mode: the t.me deep link uses startapp=r_<uuid> (form uses bare uuid).
  // Routing only — the server re-validates start_param from the signed initData.
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [manualWeekFrom, setManualWeekFrom] = useState("");
  const [manualWeekTo, setManualWeekTo] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Step 4 — optional weekly check-in (all skippable; null/empty = not provided).
  const [energy, setEnergy] = useState<number | null>(null);
  const [wellbeing, setWellbeing] = useState<number | null>(null);
  const [eatingComfort, setEatingComfort] = useState<number | null>(null);
  const [weightKg, setWeightKg] = useState("");
  const [checkinNote, setCheckinNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      // initData carries the signed start_param (student row id) from the
      // t.me direct link — the server reads it after validating the hash.
      setInitData(tg.initData);
      setIsReviewMode((tg.initDataUnsafe?.start_param ?? "").startsWith("r_"));
    }
  }, []);

  if (isReviewMode) {
    return <ReviewScreen initData={initData} />;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    // FatSecret may split a week across several PDFs — append picked files,
    // dedupe by name+size, so the coach can add more across multiple picks.
    const picked = Array.from(e.target.files ?? []);
    if (picked.length > 0) {
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
        const merged = [...prev];
        for (const f of picked) {
          const key = `${f.name}:${f.size}`;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(f);
          }
        }
        return merged;
      });
      setPreview(null);
      setErrorMsg(null);
    }
    // Reset the input so picking the same file again still fires onChange.
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleRemoveFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setPreview(null);
    setErrorMsg(null);
  }

  async function handleUpload() {
    if (files.length === 0) {
      setErrorMsg("Выбери хотя бы один PDF-файл из FatSecret.");
      return;
    }
    setStep("uploading");
    setErrorMsg(null);

    const form = new FormData();
    form.append("initData", initData);
    for (const f of files) {
      form.append("file", f, f.name);
    }

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

  // preview → check-in: validate the week dates once here, then show the optional
  // check-in step. Dates are locked in before the (skippable) check-in.
  function goToCheckin() {
    if (files.length === 0 || !preview) return;
    const weekFrom = preview.needsManualWeek ? manualWeekFrom : preview.weekFrom;
    const weekTo = preview.needsManualWeek ? manualWeekTo : preview.weekTo;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(weekTo)) {
      setErrorMsg("Укажи даты недели в формате ГГГГ-ММ-ДД.");
      return;
    }
    setErrorMsg(null);
    setStep("checkin");
  }

  async function handleConfirm() {
    if (files.length === 0 || !preview) return;

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
    for (const f of files) {
      form.append("file", f, f.name);
    }
    form.append("weekFrom", weekFrom);
    form.append("weekTo", weekTo);
    // Optional check-in — only send fields the athlete actually set (skippable form).
    if (energy !== null) form.append("energy", String(energy));
    if (wellbeing !== null) form.append("wellbeing", String(wellbeing));
    if (eatingComfort !== null) form.append("eatingComfort", String(eatingComfort));
    const trimmedWeight = weightKg.trim().replace(",", ".");
    if (trimmedWeight) form.append("weightKg", trimmedWeight);
    const trimmedNote = checkinNote.trim();
    if (trimmedNote) form.append("studentNotes", trimmedNote);

    try {
      const res = await fetch("/api/m/n/confirm", { method: "POST", body: form });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setErrorMsg(json.error ?? "Не удалось сохранить отчёт.");
        setStep("checkin");
        return;
      }
      setStep("done");
      setTimeout(() => {
        window.Telegram?.WebApp?.close();
      }, 2000);
    } catch {
      setErrorMsg("Ошибка сети. Попробуй ещё раз.");
      setStep("checkin");
    }
  }

  function handleBack() {
    setStep("idle");
    setPreview(null);
    setErrorMsg(null);
    if (fileRef.current) fileRef.current.value = "";
    setFiles([]);
    setEnergy(null);
    setWellbeing(null);
    setEatingComfort(null);
    setWeightKg("");
    setCheckinNote("");
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
        <h2 style={STYLES.heading}>
          {step === "checkin" || step === "confirming" ? "Самочувствие за неделю" : "Недельный отчёт"}
        </h2>
        {(step === "idle" || step === "uploading") && (
          <p style={STYLES.subtitle}>Прикрепи PDF-выгрузку из FatSecret за прошедшую неделю.</p>
        )}
        {(step === "checkin" || step === "confirming") && preview && (
          <p style={STYLES.subtitle}>
            {formatIsoToDisplay(preview.needsManualWeek ? manualWeekFrom : preview.weekFrom)}–
            {formatIsoToDisplay(preview.needsManualWeek ? manualWeekTo : preview.weekTo)}
          </p>
        )}

        {step === "idle" || step === "uploading" ? (
          <>
            {/* Step 1 — choose files (FatSecret may split a week into several PDFs). */}
            <span style={STYLES.stepLabel}>Шаг 1 · Файлы</span>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              multiple
              style={STYLES.hiddenInput}
              onChange={handleFileChange}
              disabled={busy}
            />
            {files.map((f, i) => (
              <div key={`${f.name}:${f.size}`} style={{ ...STYLES.fileChip, marginBottom: 8 }}>
                <span aria-hidden>✓</span>
                <span style={{ flex: 1 }}>{f.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(i)}
                  disabled={busy}
                  aria-label={`Убрать ${f.name}`}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--tg-theme-hint-color, #888)",
                    fontSize: 18,
                    cursor: "pointer",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              style={{
                ...STYLES.btn,
                ...(files.length > 0 ? STYLES.btnOutline : {}),
                opacity: busy ? 0.6 : 1,
                marginTop: files.length > 0 ? 4 : 0,
                marginBottom: 20,
              }}
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              {files.length > 0 ? "Добавить ещё файл" : "Выбрать файлы"}
            </button>

            {/* Step 2 — upload (disabled until at least one file is selected). */}
            <span style={STYLES.stepLabel}>Шаг 2 · Загрузка</span>
            <button
              type="button"
              style={{
                ...STYLES.btn,
                ...(files.length === 0 || busy ? STYLES.btnDisabled : {}),
              }}
              onClick={handleUpload}
              disabled={busy || files.length === 0}
            >
              {step === "uploading" ? "Обрабатываю…" : "Загрузить"}
            </button>
          </>
        ) : null}

        {step === "preview" && preview ? (
          <>
            <p style={STYLES.previewRow}>
              <strong>{files.length > 1 ? `Файлов: ${files.length}` : "Файл:"}</strong>{" "}
              {files.map((f) => f.name).join(", ")}
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
              onClick={goToCheckin}
              disabled={busy}
            >
              Далее →
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

        {(step === "checkin" || step === "confirming") && preview ? (
          <div style={{ marginTop: 8 }}>
            <p style={CHECKIN.note}>
              Всё по желанию. Оценки помогают тренеру точнее разобрать неделю.
            </p>
            <ScaleRow label="Энергия" value={energy} onChange={setEnergy} disabled={busy} />
            <ScaleRow label="Самочувствие" value={wellbeing} onChange={setWellbeing} disabled={busy} />
            <ScaleRow label="Комфорт питания" value={eatingComfort} onChange={setEatingComfort} disabled={busy} showPoles />

            <div style={CHECKIN.divider} />

            <label style={CHECKIN.fieldLabel}>Вес</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="кг, например 62.5"
              style={CHECKIN.input}
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              disabled={busy}
            />

            <label style={CHECKIN.fieldLabel}>Заметка тренеру</label>
            <textarea
              placeholder="По желанию: что было особенного за неделю"
              style={{ ...CHECKIN.input, minHeight: 88, resize: "vertical" as const }}
              value={checkinNote}
              onChange={(e) => setCheckinNote(e.target.value)}
              disabled={busy}
            />

            <button
              type="button"
              style={{ ...STYLES.btn, opacity: busy ? 0.6 : 1, marginTop: 4, marginBottom: 10 }}
              onClick={handleConfirm}
              disabled={busy}
            >
              {step === "confirming" ? "Сохраняю…" : "Отправить →"}
            </button>
            <button
              type="button"
              style={{ ...STYLES.btn, ...STYLES.btnOutline, marginTop: 4 }}
              onClick={() => {
                setErrorMsg(null);
                setStep("preview");
              }}
              disabled={busy}
            >
              ← Назад
            </button>
          </div>
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
