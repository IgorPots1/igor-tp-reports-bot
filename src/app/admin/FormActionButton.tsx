"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type FormActionButtonProps = {
  children: ReactNode;
  className?: string;
  confirmMessage?: string;
  disabled?: boolean;
  pendingText?: string;
};

export default function FormActionButton({
  children,
  className,
  confirmMessage,
  disabled = false,
  pendingText,
}: FormActionButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={disabled || pending}
      onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {pending ? pendingText ?? "Сохранение..." : children}
    </button>
  );
}
