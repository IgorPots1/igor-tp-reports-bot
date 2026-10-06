// Reconcile of scanned race events: a start that was moved or deleted in TrainingPeaks used to
// stay in trainingpeaks_race_events forever (the scan only upserts). On 2026-10-06 six such
// ghosts sat in the forward window — a marathon that no longer existed, two starts left on the
// date they had been moved away from — and nutrition plans were built around them.
//
// Deleting is only safe where the scan PROVES absence. A failure must never read as «the
// calendar is empty», or one bad run wipes real starts. Hence the guards (Igor, 2026-10-06):
//   1. only athletes TP answered for: HTTP 200 with a JSON array (not 403, not a timeout,
//      not an unparseable body);
//   2. an answered athlete with ZERO events in the window while the table holds some is
//      treated as a failure, not as an empty calendar — nothing of theirs is deleted;
//   3. only source='scan' rows inside the scanned window — manual marks are never touched;
//   4. everything deleted is reported by name, like everything added.
// This module only DECIDES; the runner executes and reports.

export type ReconcileDbRow = {
  id: string;
  studentId: string;
  studentName: string | null;
  eventDate: string;
  title: string | null;
  source: string;
};

export type ReconcileAthleteOutcome = {
  studentId: string;
  studentName: string;
  /** HTTP 200 with a JSON array body. */
  answered: boolean;
  /** Running events this athlete returned inside the window. */
  rowsCount: number;
};

export type ReconcileSkip = {
  studentId: string;
  studentName: string | null;
  reason: "not_scanned" | "no_answer" | "zero_events_in_answer";
  rowsKept: number;
};

export function planRaceEventReconcile(input: {
  dbRows: ReconcileDbRow[];
  scannedEvents: Array<{ studentId: string; eventDate: string }>;
  athletes: ReconcileAthleteOutcome[];
  from: string;
  to: string;
}): { toDelete: ReconcileDbRow[]; skipped: ReconcileSkip[] } {
  const scannedKeys = new Set(input.scannedEvents.map((event) => `${event.studentId}|${event.eventDate}`));

  // One student can map to several outcomes (a duplicated roster row): any failed answer
  // means no proof for that student.
  const outcomeByStudent = new Map<string, { answered: boolean; rowsCount: number }>();
  for (const athlete of input.athletes) {
    const previous = outcomeByStudent.get(athlete.studentId);
    outcomeByStudent.set(athlete.studentId, {
      answered: (previous?.answered ?? true) && athlete.answered,
      rowsCount: (previous?.rowsCount ?? 0) + athlete.rowsCount,
    });
  }

  const vanishedByStudent = new Map<string, ReconcileDbRow[]>();
  for (const row of input.dbRows) {
    if (row.source !== "scan" || row.eventDate < input.from || row.eventDate > input.to) {
      continue;
    }
    if (scannedKeys.has(`${row.studentId}|${row.eventDate}`)) {
      continue;
    }
    const rows = vanishedByStudent.get(row.studentId) ?? [];
    rows.push(row);
    vanishedByStudent.set(row.studentId, rows);
  }

  const toDelete: ReconcileDbRow[] = [];
  const skipped: ReconcileSkip[] = [];
  for (const [studentId, rows] of vanishedByStudent) {
    const outcome = outcomeByStudent.get(studentId);
    const studentName = rows[0]?.studentName ?? null;
    if (!outcome) {
      skipped.push({ studentId, studentName, reason: "not_scanned", rowsKept: rows.length });
    } else if (!outcome.answered) {
      skipped.push({ studentId, studentName, reason: "no_answer", rowsKept: rows.length });
    } else if (outcome.rowsCount === 0) {
      skipped.push({ studentId, studentName, reason: "zero_events_in_answer", rowsKept: rows.length });
    } else {
      toDelete.push(...rows);
    }
  }
  toDelete.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.id.localeCompare(b.id));
  return { toDelete, skipped };
}
