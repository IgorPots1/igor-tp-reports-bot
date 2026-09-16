"use client";

import type { CSSProperties, ReactNode } from "react";

// The component half of the primitive (use-optimistic-action.ts is the hook half). A drop-in
// replacement for a plain <button> on any confirming action: disables itself while pending and
// swaps its label, so screens don't hand-roll `disabled={busy === "x"}` per button.
export function ConfirmButton(props: {
  pending: boolean;
  pendingLabel?: ReactNode;
  disabled?: boolean;
  onPress: () => void;
  style: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      style={props.style}
      disabled={props.pending || props.disabled}
      onClick={props.onPress}
    >
      {props.pending ? (props.pendingLabel ?? "…") : props.children}
    </button>
  );
}
