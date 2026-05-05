import {
  getLatestTrainingPeaksWeek,
  listAllTrainingPeaksReports,
  listTrainingPeaksReportsForWeek,
  type TrainingPeaksWeek,
  type TrainingPeaksWeeklyReport,
} from "@/features/trainingpeaks/repository";

export type TrainingPeaksWeekReports = {
  week: TrainingPeaksWeek;
  reports: TrainingPeaksWeeklyReport[];
};

export type TrainingPeaksStudentStatus = {
  studentId: string;
  studentName: string;
  weekFrom: string;
  weekTo: string;
  status: string;
  reportMarkdown: string | null;
  syncedAt: string;
};

function normalizeStudentQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

function compareStudentReports(
  left: TrainingPeaksWeeklyReport,
  right: TrainingPeaksWeeklyReport
): number {
  return (
    right.weekFrom.localeCompare(left.weekFrom) ||
    right.weekTo.localeCompare(left.weekTo) ||
    right.syncedAt.localeCompare(left.syncedAt)
  );
}

function pickMatchingStudentReport(
  reports: TrainingPeaksWeeklyReport[],
  studentQuery: string
): TrainingPeaksWeeklyReport | null {
  const normalizedQuery = normalizeStudentQuery(studentQuery);

  if (!normalizedQuery) {
    return null;
  }

  const exactMatches = reports.filter((report) => {
    const normalizedStudentName = normalizeStudentQuery(report.studentName);
    const normalizedStudentId = normalizeStudentQuery(report.studentId);
    return normalizedStudentName === normalizedQuery || normalizedStudentId === normalizedQuery;
  });

  if (exactMatches.length > 0) {
    return exactMatches.sort(compareStudentReports)[0] ?? null;
  }

  const prefixMatches = reports.filter((report) => {
    const normalizedStudentName = normalizeStudentQuery(report.studentName);
    const normalizedStudentId = normalizeStudentQuery(report.studentId);
    return (
      normalizedStudentName.startsWith(normalizedQuery) ||
      normalizedStudentId.startsWith(normalizedQuery)
    );
  });

  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }

  const containsMatches = reports.filter((report) => {
    const normalizedStudentName = normalizeStudentQuery(report.studentName);
    const normalizedStudentId = normalizeStudentQuery(report.studentId);
    return (
      normalizedStudentName.includes(normalizedQuery) ||
      normalizedStudentId.includes(normalizedQuery)
    );
  });

  return containsMatches.length === 1 ? containsMatches[0] : null;
}

export async function getTrainingPeaksReportsForWeek(
  week: TrainingPeaksWeek
): Promise<TrainingPeaksWeekReports> {
  const reports = await listTrainingPeaksReportsForWeek(week.weekFrom, week.weekTo);
  return { week, reports };
}

export async function getLatestTrainingPeaksWeekReports(): Promise<TrainingPeaksWeekReports | null> {
  const week = await getLatestTrainingPeaksWeek();

  if (!week) {
    return null;
  }

  return getTrainingPeaksReportsForWeek(week);
}

export async function getTrainingPeaksStudentStatuses(): Promise<TrainingPeaksStudentStatus[]> {
  const reports = await listAllTrainingPeaksReports();
  const latestByStudent = new Map<string, TrainingPeaksStudentStatus>();

  for (const report of reports) {
    if (latestByStudent.has(report.studentId)) {
      continue;
    }

    latestByStudent.set(report.studentId, {
      studentId: report.studentId,
      studentName: report.studentName,
      weekFrom: report.weekFrom,
      weekTo: report.weekTo,
      status: report.status,
      reportMarkdown: report.reportMarkdown,
      syncedAt: report.syncedAt,
    });
  }

  return Array.from(latestByStudent.values()).sort((left, right) =>
    left.studentName.localeCompare(right.studentName, "ru")
  );
}

export async function getTrainingPeaksReportForStudent(
  studentQuery: string,
  week?: TrainingPeaksWeek
): Promise<{ week: TrainingPeaksWeek; report: TrainingPeaksWeeklyReport } | null> {
  if (week) {
    const reports = await listTrainingPeaksReportsForWeek(week.weekFrom, week.weekTo);
    const report = pickMatchingStudentReport(reports, studentQuery);
    return report ? { week, report } : null;
  }

  const reports = await listAllTrainingPeaksReports();
  const report = pickMatchingStudentReport(reports, studentQuery);

  if (!report) {
    return null;
  }

  return {
    week: {
      weekFrom: report.weekFrom,
      weekTo: report.weekTo,
    },
    report,
  };
}
