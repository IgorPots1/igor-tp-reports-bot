import {
  listTrainingPeaksStudentTelegramContextObservations,
  updateTrainingPeaksStudentTelegramContextByInternalId,
} from "@/features/trainingpeaks/service";
import type {
  TrainingPeaksTelegramContextObservation,
  TrainingPeaksTelegramFormality,
} from "@/features/trainingpeaks/repository";

export async function listTrainingPeaksAdminStudentContextObservations(
  studentId: string
): Promise<TrainingPeaksTelegramContextObservation[]> {
  return listTrainingPeaksStudentTelegramContextObservations(studentId, 10);
}

export async function updateTrainingPeaksAdminStudentTelegramContext(
  studentId: string,
  input: {
    telegramFormality: TrainingPeaksTelegramFormality;
    telegramContextNotes: string | null;
  }
): Promise<
  | { ok: true; studentName: string }
  | { ok: false; message: string }
> {
  const student = await updateTrainingPeaksStudentTelegramContextByInternalId(studentId, {
    telegramFormality: input.telegramFormality,
    telegramContextNotes: input.telegramContextNotes,
  });

  if (!student) {
    return {
      ok: false,
      message: "Ученик не найден.",
    };
  }

  return {
    ok: true,
    studentName: student.studentName,
  };
}

function normalizeTelegramFormality(value: string | null | undefined): TrainingPeaksTelegramFormality {
  if (value === "ty" || value === "vy") {
    return value;
  }

  return "unknown";
}

export function parseTrainingPeaksAdminTelegramFormality(
  value: FormDataEntryValue | null
): TrainingPeaksTelegramFormality {
  if (typeof value !== "string") {
    return "unknown";
  }

  return normalizeTelegramFormality(value.trim());
}

export function parseTrainingPeaksAdminTelegramContextNotes(
  value: FormDataEntryValue | null
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized || null;
}
