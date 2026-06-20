// Client-only module — runs in browser via dynamic import from RunAnalysisFlow
import type { NormalizedLandmark, PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

// Min frames required for a meaningful analysis
const MIN_FRAMES_FOR_ANALYSIS = 30;
const MIN_GAIT_CYCLES = 2;

export type PoseRunnerInitResult =
  | { ok: true; landmarker: PoseLandmarker }
  | { ok: false; error: string };

export type PoseRunnerProcessResult =
  | { ok: true; frames: NormalizedLandmark[][]; fps: number; durationSec: number; heroFrameIdx: number }
  | { ok: false; error: string; errorType: "no_pose" | "too_short" | "too_few_cycles" | "load_error" };

export type ProcessProgressCallback = (progress: number, canvas: HTMLCanvasElement) => void;

// MediaPipe failures during WASM/model loading are often thrown as a raw
// DOM Event/ErrorEvent (e.g. a failed network fetch), not an Error — so the
// naive String(err) yields "[object Event]". Extract something meaningful.
function describeLoadError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof ErrorEvent !== "undefined" && err instanceof ErrorEvent) {
    return err.message || (err.error instanceof Error ? err.error.message : "ошибка загрузки ресурса");
  }
  if (typeof Event !== "undefined" && err instanceof Event) {
    const target = err.target as { src?: string; currentSrc?: string } | null;
    const src = target?.src || target?.currentSrc;
    return `сбой загрузки ресурса (event "${err.type}"${src ? `, src: ${src}` : ""})`;
  }
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export async function initPoseLandmarker(): Promise<PoseRunnerInitResult> {
  try {
    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    return { ok: true, landmarker };
  } catch (err) {
    // Full object to the console for diagnostics (real cause, stack, event target)
    console.error("[run-analysis] Pose Landmarker init failed:", err);
    return {
      ok: false,
      error:
        "Не удалось загрузить модель распознавания позы. Проверьте интернет-соединение и попробуйте ещё раз. " +
        `(детали: ${describeLoadError(err)})`,
    };
  }
}

export async function processVideoFile(
  landmarker: PoseLandmarker,
  file: File,
  overlayCanvas: HTMLCanvasElement,
  onProgress: ProcessProgressCallback
): Promise<PoseRunnerProcessResult> {
  const url = URL.createObjectURL(file);
  try {
    return await _processUrl(landmarker, url, overlayCanvas, onProgress);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function _processUrl(
  landmarker: PoseLandmarker,
  url: string,
  canvas: HTMLCanvasElement,
  onProgress: ProcessProgressCallback
): Promise<PoseRunnerProcessResult> {
  // Load video metadata
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Не удалось загрузить видео"));
    setTimeout(() => reject(new Error("Таймаут загрузки видео")), 15_000);
  });

  const durationSec = video.duration;
  if (!isFinite(durationSec) || durationSec < 2) {
    return { ok: false, error: "Видео слишком короткое. Нужно минимум 2 секунды бега.", errorType: "too_short" };
  }

  // Determine sampling rate: target ~30 fps, cap at video native fps
  const targetFps = 30;
  const frameInterval = 1 / targetFps;
  const totalFrames = Math.floor(durationSec * targetFps);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { ok: false, error: "Не удалось получить доступ к canvas.", errorType: "load_error" };
  }

  const allFrameLandmarks: NormalizedLandmark[][] = [];
  let bestFrameVisibility = -1;
  let heroFrameIdx = 0;

  for (let i = 0; i < totalFrames; i++) {
    const timestamp = i * frameInterval;
    video.currentTime = timestamp;

    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      // Fallback in case onseeked fires late
      setTimeout(resolve, 200);
    });

    // Adapt canvas to video dimensions on first frame
    if (i === 0) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
    }

    // Detect pose at this timestamp (ms)
    let result: PoseLandmarkerResult;
    try {
      result = landmarker.detectForVideo(video, timestamp * 1000);
    } catch {
      continue;
    }

    const landmarks = result.landmarks[0];
    if (landmarks && landmarks.length > 0) {
      allFrameLandmarks.push(landmarks);

      // Track best frame for hero (highest total landmark visibility)
      const totalVis = landmarks.reduce((s, lm) => s + (lm.visibility ?? 0), 0);
      if (totalVis > bestFrameVisibility) {
        bestFrameVisibility = totalVis;
        heroFrameIdx = allFrameLandmarks.length - 1;
      }
    }

    // Draw current frame + skeleton to canvas and report progress
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (landmarks) {
      drawSkeleton(ctx, landmarks, canvas.width, canvas.height);
    }
    const progress = Math.round(((i + 1) / totalFrames) * 100);
    onProgress(progress, canvas);
  }

  video.src = "";

  if (allFrameLandmarks.length < MIN_FRAMES_FOR_ANALYSIS) {
    return {
      ok: false,
      error:
        "Не удалось обнаружить позу в достаточном количестве кадров. Убедитесь, что вы полностью в кадре и сняты строго сбоку.",
      errorType: "no_pose",
    };
  }

  // Rough gait cycle estimate: count ankle y-peaks (each peak ≈ 1 step)
  const ankleYValues = allFrameLandmarks.map((f) => f[27]?.y ?? f[28]?.y ?? 0);
  const minGap = Math.max(2, Math.round(targetFps * 0.2));
  const peaks = countLocalMaxima(ankleYValues, minGap);
  if (peaks < MIN_GAIT_CYCLES * 2) {
    return {
      ok: false,
      error:
        "Слишком мало шагов в кадре. Запишите 5–10 секунд непрерывного бега в темпе, который вы хотите проанализировать.",
      errorType: "too_few_cycles",
    };
  }

  // Re-render best (hero) frame to canvas before handing off
  const heroLandmarks = allFrameLandmarks[heroFrameIdx];
  if (heroLandmarks) {
    const heroTs = heroFrameIdx * frameInterval;
    video.currentTime = heroTs;
    await new Promise<void>((r) => {
      video.onseeked = () => r();
      setTimeout(r, 300);
    });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawSkeleton(ctx, heroLandmarks, canvas.width, canvas.height);
  }

  return {
    ok: true,
    frames: allFrameLandmarks,
    fps: targetFps,
    durationSec,
    heroFrameIdx,
  };
}

function countLocalMaxima(values: number[], minGap: number): number {
  let count = 0;
  for (let i = minGap; i < values.length - minGap; i++) {
    const v = values[i] ?? 0;
    let isPeak = true;
    for (let j = i - minGap; j <= i + minGap; j++) {
      if (j !== i && (values[j] ?? 0) >= v) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) count++;
  }
  return count;
}

// MediaPipe pose connections (pairs of landmark indices)
const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31],
  [24, 26], [26, 28], [28, 30], [28, 32],
];

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  w: number,
  h: number
): void {
  ctx.save();
  ctx.strokeStyle = "#facc15"; // yellow-400 (XO Runners accent)
  ctx.lineWidth = 2;
  ctx.fillStyle = "#facc15";

  for (const [a, b] of POSE_CONNECTIONS) {
    const lmA = landmarks[a];
    const lmB = landmarks[b];
    if (!lmA || !lmB) continue;
    if ((lmA.visibility ?? 0) < 0.3 || (lmB.visibility ?? 0) < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(lmA.x * w, lmA.y * h);
    ctx.lineTo(lmB.x * w, lmB.y * h);
    ctx.stroke();
  }

  for (const lm of landmarks) {
    if ((lm.visibility ?? 0) < 0.3) continue;
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, 3, 0, 2 * Math.PI);
    ctx.fill();
  }

  ctx.restore();
}
