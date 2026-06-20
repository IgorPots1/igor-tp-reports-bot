import type { Metadata } from "next";
import RunAnalysisTool from "@/app/admin/coach-os/run-analysis/RunAnalysisTool";

export const metadata: Metadata = {
  title: "Анализ техники бега | Admin",
};

export default function RunAnalysisPage() {
  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2>Анализ техники бега</h2>
          <p className="admin-muted">
            Загрузите видео сбоку. MediaPipe считает метрики локально — на сервер уходит только JSON метрик.
          </p>
        </div>
      </div>
      <RunAnalysisTool />
    </div>
  );
}
