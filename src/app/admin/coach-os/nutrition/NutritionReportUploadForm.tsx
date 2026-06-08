"use client";

import type { FormEvent, ReactNode } from "react";

import { validateNutritionUploadFiles } from "@/features/nutrition/file-upload-limits";

type NutritionReportUploadFormProps = {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
};

export default function NutritionReportUploadForm({
  action,
  children,
  className,
}: NutritionReportUploadFormProps) {
  return (
    <form
      className={className}
      action={action}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        const form = event.currentTarget;
        const input = form.querySelector<HTMLInputElement>('input[type="file"][name="reportFiles"]');
        if (!input?.files || input.files.length === 0) {
          return;
        }
        const error = validateNutritionUploadFiles([...input.files]);
        if (error) {
          event.preventDefault();
          window.alert(error);
        }
      }}
    >
      {children}
    </form>
  );
}
