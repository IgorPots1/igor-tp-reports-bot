import Link from "next/link";

import { listIntervalsStudents } from "@/features/intervals/loop/coach-view";

export const dynamic = "force-dynamic";

export default async function BeginnerIndexPage() {
  const students = await listIntervalsStudents();

  return (
    <section>
      <h1>Ученики Intervals</h1>
      <p style={{ color: "#555", maxWidth: 680, lineHeight: 1.5 }}>
        Те, кого ведём не в TrainingPeaks: план лежит в нашей базе, тренировки приезжают из
        Intervals.icu. В ростер автопланировщика TP они не попадают.
      </p>

      {students.length === 0 ? (
        <p style={{ marginTop: 24 }}>
          Пока никого. Ученик появляется здесь, когда у его карточки{" "}
          <code>coaching_platform = &apos;intervals&apos;</code> и заведён источник Intervals.
        </p>
      ) : (
        <table style={{ marginTop: 20, borderCollapse: "collapse", width: "100%", maxWidth: 900 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th style={{ padding: "8px 10px" }}>Ученик</th>
              <th style={{ padding: "8px 10px" }}>Intervals</th>
              <th style={{ padding: "8px 10px" }}>Telegram</th>
              <th style={{ padding: "8px 10px" }}>Последняя синхронизация</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.studentUuid} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px 10px" }}>
                  <Link href={`/admin/coach-os/beginner/${student.studentUuid}`}>
                    {student.studentName}
                  </Link>
                </td>
                <td style={{ padding: "8px 10px" }}>{student.externalAthleteId ?? "— не подключён"}</td>
                <td style={{ padding: "8px 10px" }}>
                  {student.telegramChatId
                    ? student.telegramDeliveryEnabled
                      ? "привязан"
                      : "привязан, доставка выключена"
                    : "не привязан"}
                </td>
                <td style={{ padding: "8px 10px" }}>{student.lastSyncedAt ?? "никогда"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
