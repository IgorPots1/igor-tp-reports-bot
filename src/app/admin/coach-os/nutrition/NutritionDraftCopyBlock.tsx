"use client";

import { useState } from "react";

type NutritionDraftCopyBlockProps = {
  draft: string;
  generationMode: string;
  copyEnabled?: boolean;
};

export default function NutritionDraftCopyBlock({
  draft,
  generationMode,
  copyEnabled = true,
}: NutritionDraftCopyBlockProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="admin-nutrition-copy-block">
      {generationMode !== "ai" && (
        <p className="admin-muted">Сгенерировано шаблоном, лучше проверить текст вручную.</p>
      )}
      {copyEnabled ? (
        <div className="admin-nutrition-copy-actions">
          <button className="admin-button admin-button-secondary admin-button-small" type="button" onClick={handleCopy}>
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
      ) : null}
      <textarea
        className="admin-textarea admin-textarea-compact admin-textarea-readonly admin-nutrition-draft-textarea"
        rows={Math.min(12, Math.max(4, draft.split("\n").length + 1))}
        readOnly
        value={draft}
      />
    </div>
  );
}
