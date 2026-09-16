// Framework-agnostic core of the mini-app "instant confirm" primitive. No React, no DOM —
// kept pure so it's directly unit-testable with node:test (no @testing-library/react in this
// repo). The React-facing wrapper is use-optimistic-action.ts.

// One row/entity can only have one action in flight at a time. A repeat tap on the SAME key
// while its previous call hasn't settled is ignored outright; different keys never block each
// other. This is the whole "two confirmations on different rows don't conflict, a second tap on
// the same row is a no-op" requirement — everything else in the hook is just wiring around it.
export function createKeyedGate() {
  const active = new Set<string>();
  return {
    tryEnter(key: string): boolean {
      if (active.has(key)) return false;
      active.add(key);
      return true;
    },
    leave(key: string): void {
      active.delete(key);
    },
    has(key: string): boolean {
      return active.has(key);
    },
  };
}

export type OptimisticRunOutcome = "success" | "failure";

export type OptimisticRunOptions<TResult> = {
  // Applied synchronously, before the request goes out — the row updates immediately.
  optimisticUpdate?: () => void;
  // Applied when the request fails (rejects, or isSuccess(result) is false) — undoes
  // optimisticUpdate. Screens pass a closure that restores the prior value; no automatic
  // undo/snapshotting is attempted here (the caller already has the prior state at hand).
  rollback?: () => void;
  request: () => Promise<TResult>;
  // A request can resolve without throwing yet still not be the outcome the optimistic update
  // assumed (e.g. a "prepare-only" response instead of "sent") — isSuccess is how the caller
  // says whether the optimistic guess was right.
  isSuccess: (result: TResult) => boolean;
  onSuccess?: (result: TResult) => void;
  // null when the request threw (network error) rather than resolved with a non-success result.
  onFailure?: (result: TResult | null) => void;
  haptic?: (kind: "impact" | "success" | "error") => void;
};

// Runs one optimistic action to completion. No key/dedup handling here — that's the gate above,
// composed in the hook — this function only knows about one call's lifecycle.
export async function runOptimisticActionCore<TResult>(
  opts: OptimisticRunOptions<TResult>
): Promise<OptimisticRunOutcome> {
  opts.haptic?.("impact");
  opts.optimisticUpdate?.();
  try {
    const result = await opts.request();
    if (opts.isSuccess(result)) {
      opts.haptic?.("success");
      opts.onSuccess?.(result);
      return "success";
    }
    opts.rollback?.();
    opts.haptic?.("error");
    opts.onFailure?.(result);
    return "failure";
  } catch {
    opts.rollback?.();
    opts.haptic?.("error");
    opts.onFailure?.(null);
    return "failure";
  }
}
