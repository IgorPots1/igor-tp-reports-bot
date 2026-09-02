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
  // Для формы с НЕСКОЛЬКИМИ действиями на разных кнопках (например
  // «Сохранить» и «Открыть новый поток» над одними и теми же полями):
  // передаётся вместо общего action у <form>, как штатный HTML-атрибут
  // formaction, который Next.js понимает и для server actions.
  formAction?: (formData: FormData) => void | Promise<void>;
};

export default function FormActionButton({
  children,
  className,
  confirmMessage,
  disabled = false,
  form,
  pendingText,
  formAction,
}: FormActionButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={disabled || pending}
      form={form}
      formAction={formAction}
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
