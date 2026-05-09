"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type FormActionButtonProps = {
  children: ReactNode;
  className?: string;
  confirmMessage?: string;
  disabled?: boolean;
  form?: string;
  pendingText?: string;
};

export default function FormActionButton({
  children,
  className,
  confirmMessage,
  disabled = false,
  form,
  pendingText,
}: FormActionButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={disabled || pending}
      form={form}
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
