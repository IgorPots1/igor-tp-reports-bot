"use client";

import { useMemo, useState } from "react";

import {
  normalizeTrainingPeaksStudentId,
  validateTrainingPeaksStudentId,
} from "@/lib/trainingpeaks-student-id";

type StudentIdentityFieldsProps = {
  initialStudentId?: string;
  initialStudentName?: string;
};

export default function StudentIdentityFields({
  initialStudentId = "",
  initialStudentName = "",
}: StudentIdentityFieldsProps) {
  const [studentName, setStudentName] = useState(initialStudentName);
  const [studentId, setStudentId] = useState(
    initialStudentId || normalizeTrainingPeaksStudentId(initialStudentName)
  );
  const [studentIdManuallyEdited, setStudentIdManuallyEdited] = useState(Boolean(initialStudentId));

  const studentIdError = useMemo(() => validateTrainingPeaksStudentId(studentId), [studentId]);

  return (
    <>
      <label className="admin-field">
        <span>Имя ученика</span>
        <input
          className="admin-input"
          name="student_name"
          placeholder="Ольга Смирнова"
          value={studentName}
          onChange={(event) => {
            const nextStudentName = event.target.value;
            setStudentName(nextStudentName);

            if (!studentIdManuallyEdited) {
              setStudentId(normalizeTrainingPeaksStudentId(nextStudentName));
            }
          }}
          required
        />
      </label>

      <label className="admin-field">
        <span>Технический код ученика</span>
        <input
          className="admin-input"
          name="student_id"
          placeholder="lyubov-selezneva"
          autoComplete="off"
          value={studentId}
          onChange={(event) => {
            setStudentIdManuallyEdited(true);
            setStudentId(normalizeTrainingPeaksStudentId(event.target.value));
          }}
          aria-describedby="student-id-help student-id-error"
          required
        />
        <span className="admin-muted" id="student-id-help">
          Технический код используется локальным TrainingPeaks pipeline и папками. Обычно: имя-фамилия латиницей,
          например <code>lyubov-selezneva</code>.
        </span>
        {studentIdError ? (
          <span className="admin-field-error" id="student-id-error">
            {studentIdError}
          </span>
        ) : (
          <span className="admin-muted" id="student-id-error">
            Будет сохранён как <code>{studentId || "—"}</code>.
          </span>
        )}
        <div className="admin-actions admin-inline-actions">
          <button
            className="admin-button admin-button-secondary"
            type="button"
            onClick={() => {
              setStudentId(normalizeTrainingPeaksStudentId(studentName));
              setStudentIdManuallyEdited(false);
            }}
          >
            Сгенерировать заново из имени
          </button>
        </div>
      </label>
    </>
  );
}
