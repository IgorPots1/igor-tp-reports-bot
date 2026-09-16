"use client";

import { useCallback, useRef, useState } from "react";

import { triggerHaptic } from "./haptic";
import { createKeyedGate, runOptimisticActionCore, type OptimisticRunOptions } from "./optimistic-action-core";

// THE primitive every confirming action in /m/* should go through (see repo CLAUDE.md §
// «конвенция мини-аппа»). One hook: keyed by row/entity id so unrelated rows never block each
// other, a repeat tap on the SAME row while it's in flight is a no-op, every call gets the
// Telegram haptic tick, and the request is optimistic (row updates before the server answers,
// rolls back on failure) — no navigation, no full-route refetch, ever.
//
// Usage (a couple of lines per action):
//   const { run, isPending } = useOptimisticAction<"dismiss" | "send">();
//   run(card.id, {
//     meta: "dismiss",
//     optimisticUpdate: () => setView(v => removeCard(v, card.id)),
//     rollback: () => setView(v => reinsertCard(v, card)),
//     request: () => fetch(...).then(r => r.json()),
//     isSuccess: (json) => json.ok,
//     onFailure: (json) => setToast(json?.error ?? "Ошибка сети."),
//   });
//   <button disabled={isPending(card.id)}>{isPending(card.id) ? "…" : "Убрать"}</button>

export function useOptimisticAction<TMeta = string>() {
  const [pending, setPending] = useState<Record<string, TMeta>>({});
  const gateRef = useRef(createKeyedGate());

  const run = useCallback(
    <TResult,>(key: string, opts: { meta: TMeta } & OptimisticRunOptions<TResult>): void => {
      if (!gateRef.current.tryEnter(key)) return; // same row already has an action in flight
      setPending((p) => ({ ...p, [key]: opts.meta }));
      void runOptimisticActionCore({ ...opts, haptic: triggerHaptic }).finally(() => {
        gateRef.current.leave(key);
        setPending((p) => {
          if (!(key in p)) return p;
          const next = { ...p };
          delete next[key];
          return next;
        });
      });
    },
    []
  );

  const isPending = useCallback((key: string) => key in pending, [pending]);

  return { run, pending, isPending };
}
