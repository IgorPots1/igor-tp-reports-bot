import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

import { configRoot, studentsConfigPath, studentsExamplePath } from "./paths.ts";

type LegacyStudentConfigEntry = {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  is_active?: unknown;
  weekly_report_enabled?: unknown;
  data_quality_status?: unknown;
  notes?: unknown;
};

type NewStudentConfigEntry = {
  student_id?: unknown;
  name?: unknown;
  trainingpeaks_athlete_url?: unknown;
  is_active?: unknown;
  weekly_report_enabled?: unknown;
  data_quality_status?: unknown;
  notes?: unknown;
};

type LegacyConfigFile = {
  students?: unknown;
};

export type StudentConfig = {
  student_id: string;
  name?: string;
  trainingpeaks_athlete_url: string;
  is_active: boolean;
  weekly_report_enabled: boolean;
  data_quality_status?: string;
  notes?: string;
};

export type WritableStudentConfig = {
  student_id: string;
  name?: string;
  trainingpeaks_athlete_url: string;
  is_active?: boolean;
  weekly_report_enabled?: boolean;
  data_quality_status?: string;
  notes?: string;
};

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value;
}

function normalizeStudent(entry: unknown): StudentConfig {
  if (!entry || typeof entry !== "object") {
    throw new Error("Each student entry must be an object.");
  }

  const candidate = entry as LegacyStudentConfigEntry & NewStudentConfigEntry;
  const studentId = normalizeOptionalString(candidate.student_id) ?? normalizeOptionalString(candidate.id);
  const athleteUrl =
    normalizeOptionalString(candidate.trainingpeaks_athlete_url) ?? normalizeOptionalString(candidate.url);

  if (!studentId || !athleteUrl) {
    throw new Error(
      "Each student entry must include either `student_id` + `trainingpeaks_athlete_url` or legacy `id` + `url`."
    );
  }

  return {
    student_id: studentId,
    name: normalizeOptionalString(candidate.name),
    trainingpeaks_athlete_url: athleteUrl,
    is_active: candidate.is_active === undefined ? true : candidate.is_active === true,
    weekly_report_enabled:
      candidate.weekly_report_enabled === undefined ? false : candidate.weekly_report_enabled === true,
    data_quality_status: normalizeOptionalString(candidate.data_quality_status),
    notes: normalizeOptionalString(candidate.notes)
  };
}

function parseStudentsConfig(raw: string): StudentConfig[] {
  const parsed = JSON.parse(raw) as unknown;
  const legacyWrapper =
    parsed && typeof parsed === "object" ? (parsed as LegacyConfigFile) : undefined;
  const entries = Array.isArray(parsed)
    ? parsed
    : Array.isArray(legacyWrapper?.students)
      ? (legacyWrapper.students as unknown[])
      : null;

  if (!entries) {
    throw new Error("config/students.json must be an array or an object with a `students` array.");
  }

  return entries.map(normalizeStudent);
}

export async function ensureStudentsConfigExists(): Promise<void> {
  if (existsSync(studentsConfigPath)) {
    return;
  }

  if (!existsSync(studentsExamplePath)) {
    throw new Error("Missing config/students.example.json.");
  }

  await mkdir(configRoot, { recursive: true });
  await copyFile(studentsExamplePath, studentsConfigPath);
}

export async function readStudentsConfig(): Promise<StudentConfig[]> {
  if (!existsSync(studentsConfigPath)) {
    throw new Error(
      "Missing config/students.json.\nCopy config/students.example.json to config/students.json and fill in your student URLs."
    );
  }

  const raw = await readFile(studentsConfigPath, "utf8");
  return parseStudentsConfig(raw);
}

export async function writeStudentsConfig(students: WritableStudentConfig[]): Promise<void> {
  await mkdir(configRoot, { recursive: true });
  await writeFile(studentsConfigPath, `${JSON.stringify(students, null, 2)}\n`, "utf8");
}

export function findStudentById(students: StudentConfig[], studentId: string): StudentConfig | undefined {
  return students.find((student) => student.student_id === studentId);
}

export function formatStudentLabel(student: Pick<StudentConfig, "student_id" | "name">): string {
  if (student.name && student.name !== student.student_id) {
    return `${student.student_id} (${student.name})`;
  }

  return student.student_id;
}
