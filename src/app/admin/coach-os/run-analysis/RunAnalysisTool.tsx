"use client";

import { useRef, useState } from "react";
import type {
  MetricStatus,
  RunAnalysisApiPayload,
  RunAnalysisResult,
  RunMetrics,
  RunnerGoal,
} from "@/features/run-analysis/types";
import ReportView from "@/app/admin/coach-os/run-analysis/ReportView";

type ToolStep = "form" | "processing" | "report" | "error";
type ErrorType = "no_pose" | "too_short" | "too_few_cycles" | "load_error" | "api_error" | "unknown";

const GOALS: { value: RunnerGoal; label: string }[] = [
  { value: "health", label: "Здоровье и фитнес" },
  { value: "5k", label: "5 км" },
  { value: "10k", label: "10 км" },
  { value: "half", label: "Полумарафон" },
  { value: "marathon", label: "Марафон" },
  { value: "speed", label: "Скорость и результат" },
];

const ERROR_CHECKLISTS: Partial<Record<ErrorType, string[]>> = {
  no_pose: [
    "Снимайте строго сбоку (сагиттальная плоскость)",
    "Бегун должен быть полностью в кадре от головы до ног",
    "Фон должен контрастировать с одеждой",
    "Избегайте съёмки против света",
  ],
  too_short: [
    "Запишите минимум 5–10 секунд непрерывного бега",
    "Темп должен быть рабочим — не трусца и не максимальный",
  ],
  too_few_cycles: [
    "В кадре должно быть минимум 4–6 шагов",
    "Запишите более длинный отрезок бега",
    "Убедитесь, что скорость стабильная",
  ],
};

function validateVideoFile(file: File): string | null {
  if (file.size > 30 * 1024 * 1024) return "Видео больше 30 МБ — сожмите или обрежьте.";
  if (!file.type.startsWith("video/") && !file.name.match(/\.(mp4|mov)$/i))
    return "Поддерживаются форматы MP4 и MOV.";
  return null;
}

function buildPayload(
  profile: { heightCm: number; weightKg: number; paceMinPerKm: string; goal: RunnerGoal },
  metrics: RunMetrics,
  metricStatuses: Record<string, MetricStatus>
): RunAnalysisApiPayload {
  return {
    runner_profile: {
      height_cm: profile.heightCm,
      weight_kg: profile.weightKg,
      pace_min_per_km: profile.paceMinPerKm,
      goal: profile.goal,
    },
    computed_metrics: {
      cadence_spm: metrics.cadenceSpm,
      knee_angle_at_contact_deg: metrics.kneeAngleDeg,
      trunk_lean_deg: metrics.trunkLeanDeg,
      vertical_oscillation_pct: metrics.verticalOscillationPct,
      overstride_pct: metrics.overstridePct,
      foot_strike: metrics.footStrike,
      gait_cycles_detected: metrics.gaitCyclesDetected,
      video_duration_sec: metrics.videoDurationSec,
    },
    metric_statuses: Object.fromEntries(
      Object.entries(metricStatuses).map(([k, v]) => [
        k,
        { value: v.value, severity: v.severity, norm: v.normDescription },
      ])
    ),
  };
}

export default function RunAnalysisTool() {
  const [step, setStep] = useState<ToolStep>("form");
  const [studentName, setStudentName] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [paceMinPerKm, setPaceMinPerKm] = useState("5:30");
  const [goal, setGoal] = useState<RunnerGoal>("health");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [errorType, setErrorType] = useState<ErrorType>("unknown");
  const [result, setResult] = useState<RunAnalysisResult | null>(null);

  // Canvas is always in DOM so ref is valid before step transition
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setVideoFile(file);
    setFileError(file ? validateVideoFile(file) : null);
  }

  async function handleAnalyze() {
    if (!videoFile || !heightCm || !weightKg) return;
    const fileErr = validateVideoFile(videoFile);
    if (fileErr) { setFileError(fileErr); return; }

    setStep("processing");
    setProgress(0);
    setProcessingStatus("Загружаем модель анализа поз…");

    try {
      const { initPoseLandmarker, processVideoFile } = await import(
        "@/features/run-analysis/pose/pose-runner"
      );

      const initResult = await initPoseLandmarker();
      if (!initResult.ok) {
        setErrorMsg(initResult.error);
        setErrorType("load_error");
        setStep("error");
        return;
      }

      setProcessingStatus("Анализируем технику бега…");
      const canvas = canvasRef.current!;

      const poseResult = await processVideoFile(
        initResult.landmarker,
        videoFile,
        canvas,
        (prog) => setProgress(prog)
      );

      try { initResult.landmarker.close(); } catch { /* ok */ }

      if (!poseResult.ok) {
        setErrorMsg(poseResult.error);
        setErrorType(poseResult.errorType as ErrorType);
        setStep("error");
        return;
      }

      setProcessingStatus("Вычисляем метрики…");
      const { computeMetrics } = await import(
        "@/features/run-analysis/metrics/compute-metrics"
      );
      const { metrics, metricStatuses } = computeMetrics({
        frames: poseResult.frames,
        fps: poseResult.fps,
        durationSec: poseResult.durationSec,
      });

      const heroFrameDataUrl = canvas.toDataURL("image/jpeg", 0.85);

      setProcessingStatus("Составляем разбор техники…");
      const payload = buildPayload(
        { heightCm: Number(heightCm), weightKg: Number(weightKg), paceMinPerKm, goal },
        metrics,
        metricStatuses
      );

      const apiRes = await fetch("/api/run-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "same-origin",
      });

      if (!apiRes.ok) {
        const errData = await apiRes.json().catch(() => null) as { error?: string } | null;
        setErrorMsg(
          errData?.error === "unauthorized"
            ? "Нет доступа. Войдите в /admin заново."
            : `Ошибка при составлении разбора (${apiRes.status}). Попробуйте ещё раз.`
        );
        setErrorType("api_error");
        setStep("error");
        return;
      }

      const apiData = await apiRes.json() as { report?: unknown };
      const { parseRunAnalysisReport } = await import("@/features/run-analysis/llm/parse");
      const parseResult = parseRunAnalysisReport(apiData.report);

      if (!parseResult.ok) {
        setErrorMsg(`Ошибка при разборе ответа модели: ${parseResult.error}. Попробуйте ещё раз.`);
        setErrorType("api_error");
        setStep("error");
        return;
      }

      setResult({ metrics, metricStatuses, report: parseResult.report, heroFrameDataUrl, studentName });
      setStep("report");

    } catch (err) {
      setErrorMsg(`Неожиданная ошибка: ${err instanceof Error ? err.message : String(err)}`);
      setErrorType("unknown");
      setStep("error");
    }
  }

  function handleReset() {
    setStep("form");
    setProgress(0);
    setProcessingStatus("");
    setResult(null);
    setErrorMsg("");
  }

  const checklist = ERROR_CHECKLISTS[errorType];

  return (
    <div className="admin-ra-tool">
      {/* Canvas always in DOM so canvasRef is valid when processing starts */}
      <canvas
        ref={canvasRef}
        className="admin-ra-canvas"
        style={{ display: step === "processing" ? "block" : "none" }}
      />

      {step === "form" && (
        <div className="admin-card">
          <h3>Данные бегуна</h3>
          <div className="admin-form-stack">
            <div className="admin-field">
              <label>Имя ученика (для отчёта)</label>
              <input
                className="admin-input"
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Например: Анна С."
              />
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <div className="admin-field" style={{ flex: 1 }}>
                <label>Рост (см) *</label>
                <input
                  className="admin-input"
                  type="number"
                  min={140}
                  max={220}
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  placeholder="170"
                />
              </div>
              <div className="admin-field" style={{ flex: 1 }}>
                <label>Вес (кг) *</label>
                <input
                  className="admin-input"
                  type="number"
                  min={40}
                  max={150}
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  placeholder="65"
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <div className="admin-field" style={{ flex: 1 }}>
                <label>Рабочий темп (мин/км)</label>
                <input
                  className="admin-input"
                  type="text"
                  value={paceMinPerKm}
                  onChange={(e) => setPaceMinPerKm(e.target.value)}
                  placeholder="5:30"
                />
              </div>
              <div className="admin-field" style={{ flex: 1 }}>
                <label>Цель</label>
                <select
                  className="admin-input"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value as RunnerGoal)}
                >
                  {GOALS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="admin-field">
              <label>Видео (MP4 или MOV, сбоку, ≤ 30 МБ) *</label>
              <input
                className="admin-input"
                type="file"
                accept="video/mp4,video/quicktime,.mp4,.mov"
                onChange={handleFileChange}
              />
              {fileError && <p className="admin-field-error">{fileError}</p>}
              <p className="admin-muted">
                Снимайте строго сбоку. Бегун в кадре от головы до ног, 5–10 секунд непрерывного бега.
              </p>
            </div>

            <div className="admin-actions">
              <button
                className="admin-button"
                onClick={handleAnalyze}
                disabled={!videoFile || !!fileError || !heightCm || !weightKg}
              >
                Анализировать
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "processing" && (
        <div className="admin-card">
          <p style={{ fontWeight: 600, marginBottom: 0 }}>{processingStatus}</p>
          <div className="admin-ra-progress-bar">
            <div className="admin-ra-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="admin-muted" style={{ marginTop: 2 }}>
            {progress}% кадров обработано
          </p>
        </div>
      )}

      {step === "report" && result && (
        <ReportView result={result} onNewAnalysis={handleReset} />
      )}

      {step === "error" && (
        <div className="admin-card">
          <div className="admin-alert admin-alert-error">
            <strong>Ошибка анализа</strong>
            <p style={{ margin: "4px 0 0" }}>{errorMsg}</p>
          </div>
          {checklist && (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>Как снять правильно:</p>
              <ul className="admin-ra-checklist">
                {checklist.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="admin-actions" style={{ marginTop: 16 }}>
            <button className="admin-button" onClick={handleReset}>
              Попробовать снова
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
