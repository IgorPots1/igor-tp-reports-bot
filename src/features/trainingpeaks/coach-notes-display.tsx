type CoachNoteSignal = {
  code?: string;
  message?: string;
  severity?: string;
  workout_date?: string | null;
  workout_title?: string | null;
};

export type CoachNotesDisplayModel = {
  summary: string;
  confidenceOverall: string | null;
  confidenceReasons: string[];
  dataQualityFlags: CoachNoteSignal[];
  trainingSignals: CoachNoteSignal[];
  recoverySignals: CoachNoteSignal[];
  followUpSuggestions: string[];
  planningNotes: string[];
  watchFlags: CoachNoteSignal[];
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function asSignalArray(value: unknown): CoachNoteSignal[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is CoachNoteSignal => {
    return typeof entry === "object" && entry !== null && typeof (entry as CoachNoteSignal).message === "string";
  });
}

export function parseCoachNotesForDisplay(value: unknown): CoachNotesDisplayModel | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const notes = value as Record<string, unknown>;
  if (notes.schema_version !== "coach-notes.v1") {
    return null;
  }

  const confidence =
    notes.confidence && typeof notes.confidence === "object"
      ? (notes.confidence as Record<string, unknown>)
      : null;

  return {
    summary: typeof notes.summary === "string" ? notes.summary : "",
    confidenceOverall:
      confidence && typeof confidence.overall === "string" ? confidence.overall : null,
    confidenceReasons: asStringArray(confidence?.reasons),
    dataQualityFlags: asSignalArray(notes.data_quality_flags),
    trainingSignals: asSignalArray(notes.training_signals),
    recoverySignals: asSignalArray(notes.recovery_signals),
    followUpSuggestions: asStringArray(notes.follow_up_suggestions),
    planningNotes: asStringArray(notes.planning_notes),
    watchFlags: asSignalArray(notes.watch_flags),
  };
}

function SignalList({ items }: { items: CoachNoteSignal[] }) {
  if (items.length === 0) {
    return <p className="admin-muted">Нет сигналов.</p>;
  }

  return (
    <ul className="admin-coach-notes-list">
      {items.map((item, index) => (
        <li key={`${item.code ?? "signal"}-${index}`}>
          {item.code && <span className="admin-coach-notes-code">{item.code}</span>}
          <span>{item.message}</span>
        </li>
      ))}
    </ul>
  );
}

function StringList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="admin-muted">Нет пунктов.</p>;
  }

  return (
    <ul className="admin-coach-notes-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function TrainingPeaksCoachNotesPanel({ notes }: { notes: CoachNotesDisplayModel }) {
  return (
    <details className="admin-card admin-card-compact admin-coach-notes-panel">
      <summary className="admin-coach-notes-summary">
        <span>
          <strong>Только для тренера</strong>
          <span className="admin-muted"> — внутренние технические заметки, не отправляются ученику</span>
        </span>
        {notes.confidenceOverall && (
          <span className="admin-badge admin-badge-outline">Уверенность: {notes.confidenceOverall}</span>
        )}
      </summary>

      <div className="admin-coach-notes-body">
        {notes.summary && (
          <section className="admin-coach-notes-section">
            <h4>Кратко</h4>
            <p>{notes.summary}</p>
            {notes.confidenceReasons.length > 0 && (
              <ul className="admin-coach-notes-list admin-coach-notes-list-compact">
                {notes.confidenceReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="admin-coach-notes-section">
          <h4>Качество данных</h4>
          <SignalList items={notes.dataQualityFlags} />
        </section>

        <section className="admin-coach-notes-section">
          <h4>Тренировочные сигналы</h4>
          <SignalList items={notes.trainingSignals} />
        </section>

        <section className="admin-coach-notes-section">
          <h4>Восстановление</h4>
          <SignalList items={notes.recoverySignals} />
        </section>

        <section className="admin-coach-notes-section">
          <h4>Follow-up</h4>
          <StringList items={notes.followUpSuggestions} />
        </section>

        <section className="admin-coach-notes-section">
          <h4>Планирование</h4>
          <StringList items={notes.planningNotes} />
        </section>

        <section className="admin-coach-notes-section">
          <h4>На контроле</h4>
          <SignalList items={notes.watchFlags} />
        </section>
      </div>
    </details>
  );
}
