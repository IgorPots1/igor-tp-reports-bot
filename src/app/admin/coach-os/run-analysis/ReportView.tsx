import type {
  MetricConfidence,
  MetricReason,
  MetricSeverity,
  MetricStatus,
  RunAnalysisResult,
  VerticalOscillationBand,
} from "@/features/run-analysis/types";

type ReportViewProps = {
  result: RunAnalysisResult;
  onNewAnalysis: () => void;
};

// Priority order: landing (overstride + knee + foot strike) first, then oscillation, then posture.
const METRIC_ORDER = ["overstride", "kneeFlexion", "footStrike", "verticalOscillation", "trunkLean"];

const REASON_TEXT: Record<MetricReason, string> = {
  few_contact_cycles: "мало чистых контактов стопы с землёй в кадре",
  low_landmark_visibility: "ключевые точки тела плохо видны на видео",
  camera_motion: "камера двигалась во время съёмки",
  subject_too_small: "бегун слишком мелкий в кадре",
};

const FOOT_STRIKE_LABEL: Record<string, string> = {
  forefoot: "передняя часть стопы",
  midfoot: "средняя часть стопы",
  heel: "пятка",
  unknown: "не определён",
};

const BAND_LABEL: Record<VerticalOscillationBand, string> = {
  low: "низкие",
  medium: "средние",
  high: "высокие",
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

function statusBadge(confidence: MetricConfidence, severity: MetricSeverity) {
  if (confidence === "unavailable") {
    return <span className="admin-badge">Нет данных</span>;
  }
  return <span className={severityClass(severity)}>{severityLabel(severity)}</span>;
}

function renderValue(ms: MetricStatus): string {
  if (ms.confidence === "unavailable" || ms.value === null || ms.value === undefined) {
    return "не удалось определить";
  }
  const approx = ms.confidence === "low";
  if (ms.key === "verticalOscillation") {
    const band = ms.band ? BAND_LABEL[ms.band] : "—";
    const pct = `${ms.value}% роста`;
    // Low confidence → band is primary, % only as orientation.
    return approx ? `${band} (≈ ${pct})` : `${band} (${pct})`;
  }
  if (ms.key === "footStrike") {
    return FOOT_STRIKE_LABEL[String(ms.value)] ?? String(ms.value);
  }
  const v = `${ms.value}${ms.unit ? " " + ms.unit : ""}`;
  return approx ? `≈ ${v}` : v;
}

function metricNote(ms: MetricStatus): string | null {
  if (ms.confidence === "unavailable") {
    return ms.reason ? REASON_TEXT[ms.reason] : "по этому видео определить не удалось";
  }
  if (ms.confidence === "low") {
    return ms.reason ? `приблизительно — ${REASON_TEXT[ms.reason]}` : "приблизительно";
  }
  return null;
}

export default function ReportView({ result, onNewAnalysis }: ReportViewProps) {
  const { report, metrics, metricStatuses, heroFrameDataUrl, studentName } = result;
  const date = new Date().toLocaleDateString("ru-RU");
  const orderedStatuses = METRIC_ORDER.map((k) => metricStatuses[k]).filter(
    (ms): ms is MetricStatus => Boolean(ms)
  );

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
            {metrics.contactCyclesDetected} контактов &middot;{" "}
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
              {orderedStatuses.map((ms) => {
                const note = metricNote(ms);
                const unavailable = ms.confidence === "unavailable";
                return (
                  <tr key={ms.key}>
                    <td>{ms.label}</td>
                    <td>
                      <span style={unavailable ? { fontStyle: "italic", opacity: 0.7 } : undefined}>
                        {renderValue(ms)}
                      </span>
                      {note && (
                        <div className="admin-muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {note}
                        </div>
                      )}
                    </td>
                    <td className="admin-muted">{ms.normDescription}</td>
                    <td>{statusBadge(ms.confidence, ms.severity)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cadence from watch (context only — not measured from video) */}
      {metrics.cadenceFromWatchSpm != null && (
        <div className="admin-card">
          <h4 style={{ marginBottom: 4 }}>Каденс (с часов)</h4>
          <p style={{ margin: 0 }}>
            {metrics.cadenceFromWatchSpm} шаг/мин{" "}
            <span className="admin-muted">— введён вручную, как контекст; из видео не измеряется.</span>
          </p>
        </div>
      )}

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
          неподвижности камеры, качества видео, освещения и одежды. Не является медицинской или
          клинической оценкой. Все выводы требуют профессиональной интерпретации тренера.
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
