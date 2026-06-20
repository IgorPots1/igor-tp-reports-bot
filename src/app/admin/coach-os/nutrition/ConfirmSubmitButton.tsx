"use client";

import type { ReactNode } from "react";

// Submit button that asks for confirmation before firing its form's server action.
// Used for archiving reports/analyses so a needed entry is not hidden by one click.
export default function ConfirmSubmitButton({
  children,
  confirmMessage,
  className = "admin-button admin-button-ghost",
}: {
  children: ReactNode;
  confirmMessage?: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
