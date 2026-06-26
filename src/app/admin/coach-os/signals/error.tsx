"use client";

export default function SignalsPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="admin-section">
      <div className="admin-card">
        <p>Не удалось загрузить страницу сигналов.</p>
        <p className="admin-muted" style={{ marginTop: 8 }}>
          {error.message || "Неизвестная ошибка"}
        </p>
        <button className="admin-button admin-button-secondary" style={{ marginTop: 12 }} onClick={reset}>
          Попробовать ещё раз
        </button>
      </div>
    </section>
  );
}
