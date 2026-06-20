import type { MetricSeverity, RunAnalysisResult } from "@/features/run-analysis/types";

type ReportViewProps = {
  result: RunAnalysisResult;
  onNewAnalysis: () => void;
};

function severityClass(s: MetricSeverity): string {
  if (s === "ok") return "admin-badge admin-badge-success";
  if (s === "important") return "admin-badge admin-badge-danger";
  return "admin-badge admin-badge-warning";
}

function severityLabel(s: MetricSeverity): string {
  if (s === "ok") return "Норма";
  if (s === "important") return "Важно";
  return "Внимание";
}

export default function ReportView({ result, onNewAnalysis }: ReportViewProps) {
  const { report, metrics, metricStatuses, heroFrameDataUrl, studentName } = result;
  const date = new Date().toLocaleDateString("ru-RU");

  return (
    <div className="admin-ra-tool">
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>
            Анализ техники бега{studentName ? ` — ${studentName}` : ""}
          </h3>
          <p className="admin-muted" style={{ margin: "4px 0 0" }}>
            {date} &middot; {metrics.framesAnalyzed} кадров &middot;{" "}
            {metrics.gaitCyclesDetected} шагов &middot;{" "}
            {metrics.videoDurationSec.toFixed(1)} с
          </p>
        </div>
        <button
          className="admin-button admin-button-secondary"
          onClick={onNewAnalysis}
          style={{ flexShrink: 0 }}
        >
          Новый анализ
        </button>
      </div>

      {/* Hero frame */}
      {heroFrameDataUrl && (
        <div className="admin-card">
          <h4 style={{ marginBottom: 10 }}>Кадр с разметкой скелета</h4>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroFrameDataUrl}
            alt="Кадр анализа со скелетом"
            className="admin-ra-hero-img"
          />
        </div>
      )}

      {/* Summary */}
      <div className="admin-card">
        <h4 style={{ marginBottom: 8 }}>Общий вывод</h4>
        <p style={{ margin: 0 }}>{report.summary}</p>
      </div>

      {/* Headline findings */}
      {report.headline_findings.length > 0 && (
        <div className="admin-card">
          <h4 style={{ marginBottom: 12 }}>Ключевые находки</h4>
          {report.headline_findings.map((f, i) => (
            <div key={i} className={`admin-ra-finding admin-ra-finding-${f.severity}`}>
              <div className="admin-ra-finding-title">
                {f.title}
                <span className={severityClass(f.severity)}>{severityLabel(f.severity)}</span>
              </div>
              <p className="admin-muted" style={{ margin: 0 }}>
                {f.explanation}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Metrics table */}
      <div className="admin-card">
        <h4 style={{ marginBottom: 10 }}>Метрики vs норма</h4>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Метрика</th>
                <th>Значение</th>
                <th>Норма</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(metricStatuses).map((ms) => (
                <tr key={ms.label}>
                  <td>{ms.label}</td>
                  <td>
                    {ms.value !== null && ms.value !== undefined
                      ? `${ms.value}${ms.unit ? " " + ms.unit : ""}`
                      : "—"}
                  </td>
                  <td className="admin-muted">{ms.normDescription}</td>
                  <td>
                    <span className={severityClass(ms.severity)}>
                      {severityLabel(ms.severity)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Metrics commentary */}
      {report.metrics_commentary.length > 0 && (
        <div className="admin-card">
          <h4 style={{ marginBottom: 10 }}>Комментарий к метрикам</h4>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Метрика</th>
                  <th>Вывод</th>
                  <th>Примечание</th>
                </tr>
              </thead>
              <tbody>
                {report.metrics_commentary.map((mc, i) => (
                  <tr key={i}>
                    <td>{mc.metric}</td>
                    <td>{mc.verdict}</td>
                    <td className="admin-muted">{mc.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div className="admin-card">
          <h4 style={{ marginBottom: 12 }}>Рекомендации</h4>
          {report.recommendations.map((rec, i) => (
            <div key={i} className="admin-ra-rec-item">
              <p className="admin-ra-rec-issue">{rec.issue}</p>
              <p className="admin-ra-rec-advice">{rec.advice}</p>
              {rec.drills.length > 0 && (
                <ul className="admin-ra-drill-list">
                  {rec.drills.map((drill, di) => (
                    <li key={di}>{drill}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Disclaimer */}
      <div className="admin-card">
        <p className="admin-ra-disclaimer">
          <strong>Дисклеймер.</strong> Анализ основан на автоматическом 2D-трекинге позы
          (MediaPipe Pose Landmarker). Метрики приблизительные: точность зависит от ракурса,
          качества видео, освещения и одежды. Не является медицинской или клинической оценкой.
          Все выводы требуют профессиональной интерпретации тренера.
        </p>
      </div>

      {/* Bottom actions */}
      <div className="admin-actions">
        <button className="admin-button admin-button-secondary" onClick={onNewAnalysis}>
          Новый анализ
        </button>
      </div>
    </div>
  );
}
