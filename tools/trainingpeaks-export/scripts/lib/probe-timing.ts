export type ProbeTimingContext = {
  enabled: boolean;
  studentId?: string;
  phase?: string;
};

let globalContext: ProbeTimingContext = { enabled: false };

export function configureProbeTiming(context: Partial<ProbeTimingContext>): void {
  globalContext = { ...globalContext, ...context };
}

export function isProbeTimingEnabled(): boolean {
  return globalContext.enabled;
}

export function probeTimingNowMs(): number {
  return performance.now();
}

export function probeTimingElapsedMs(startMs: number): number {
  return Math.round(probeTimingNowMs() - startMs);
}

export type ProbeTimingLogInput = {
  phase: string;
  message: string;
  elapsedMs?: number;
  data?: Record<string, unknown>;
};

export function logProbeTiming(input: ProbeTimingLogInput): void {
  if (!globalContext.enabled) return;

  const parts = ["[tp-race-prediction-probe][timing]"];
  if (globalContext.studentId) parts.push(`student=${globalContext.studentId}`);
  parts.push(`phase=${input.phase}`);
  if (input.elapsedMs !== undefined) parts.push(`elapsed=${input.elapsedMs}ms`);
  parts.push(input.message);

  console.log(parts.join(" "));

  if (input.data && Object.keys(input.data).length > 0) {
    console.log(`  ${JSON.stringify(input.data)}`);
  }
}

export async function withProbeTiming<T>(
  phase: string,
  fn: () => Promise<T> | T,
  data?: Record<string, unknown>,
): Promise<T> {
  if (!globalContext.enabled) return await fn();

  const startMs = probeTimingNowMs();
  logProbeTiming({ phase, message: "start", data });
  try {
    const result = await fn();
    logProbeTiming({ phase, message: "done", elapsedMs: probeTimingElapsedMs(startMs), data });
    return result;
  } catch (error) {
    logProbeTiming({
      phase,
      message: "error",
      elapsedMs: probeTimingElapsedMs(startMs),
      data: { ...data, error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
