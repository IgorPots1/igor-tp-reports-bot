import Link from "next/link";

import { todayIsoInCoachTimezone } from "@/features/intervals/loop/clock";
import {
  listIntervalsStudents,
  loadStudentsSignals,
  signalLabelsRu,
  signalWeight,
} from "@/features/intervals/loop/coach-view";

export const dynamic = "force-dynamic";

// СПИСОК СУЩЕСТВУЕТ, ЧТОБЫ НЕ ОТКРЫВАТЬ КАРТОЧКИ ЗРЯ.
//
// Раньше здесь были имя, id атлета, телеграм и дата синхронизации, то есть
// ничего о том, нужен ли этому человеку тренер сегодня. На десяти учениках это
// полсотни кликов каждое утро: открыть, прокрутить, закрыть, и так десять раз,
// хотя писать обычно надо троим.
//
// Теперь наверху те, у кого горит, и видно, что именно. Порядок считает
// signalWeight: сломанная связь выше неотвеченных чек-инов, потому что без
// данных разбирать нечего.

const cell = { padding: "8px 10px", verticalAlign: "top" as const };

export default async function BeginnerIndexPage() {
  const students = await listIntervalsStudents();
  const today = todayIsoInCoachTimezone();
  const signals = await loadStudentsSignals(students, today);

  const ordered = [...students].sort((a, b) => {
    const left = signals.get(a.studentUuid);
    const right = signals.get(b.studentUuid);
    const diff = (right ? signalWeight(right) : 0) - (left ? signalWeight(left) : 0);
    return diff !== 0 ? diff : a.studentName.localeCompare(b.studentName);
  });

  const needAttention = ordered.filter((student) => {
    const own = signals.get(student.studentUuid);
    return own ? signalWeight(own) > 0 : false;
  }).length;

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
        <>
          <p style={{ marginTop: 18, fontSize: 16 }}>
            {needAttention === 0 ? (
              <strong style={{ color: "#2E7D45" }}>Сегодня открывать никого не нужно.</strong>
            ) : (
              <>
                <strong>
                  Открыть: {needAttention} из {students.length}
                </strong>
                <span style={{ color: "#555" }}> — они сверху.</span>
              </>
            )}
          </p>

          <table style={{ marginTop: 14, borderCollapse: "collapse", width: "100%", maxWidth: 1000 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
                <th style={cell}>Ученик</th>
                <th style={cell}>Что делать</th>
                <th style={cell}>Ответить</th>
                <th style={cell}>Не отметилась</th>
                <th style={cell}>Связь</th>
                <th style={cell}>План</th>
                <th style={cell}>Синхронизация</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((student) => {
                const own = signals.get(student.studentUuid);
                const labels = own ? signalLabelsRu(own) : [];
                const hot = own ? signalWeight(own) > 0 : false;
                return (
                  <tr
                    key={student.studentUuid}
                    style={{
                      borderBottom: "1px solid #eee",
                      background: hot ? "#FFF8F5" : undefined,
                    }}
                  >
                    <td style={cell}>
                      <Link href={`/admin/coach-os/beginner/${student.studentUuid}`}>
                        {student.studentName}
                      </Link>
                      <span style={{ display: "block", color: "#888", fontSize: 12 }}>
                        {student.externalAthleteId ?? "источник не заведён"}
                      </span>
                    </td>
                    <td style={{ ...cell, fontWeight: 600, color: hot ? "#a3330a" : "#2E7D45" }}>
                      {labels.length > 0 ? labels.join(" · ") : "всё спокойно"}
                    </td>
                    <td style={cell}>
                      {own && own.unansweredCheckins > 0 ? <strong>{own.unansweredCheckins}</strong> : "—"}
                    </td>
                    <td style={cell}>
                      {own && own.missedCheckinDates.length > 0
                        ? own.missedCheckinDates.join(", ")
                        : "—"}
                    </td>
                    <td style={cell}>
                      {own?.connection === "ok"
                        ? "идёт"
                        : own?.connection === "connected_but_silent"
                          ? "молчит"
                          : own?.connection === "auth_revoked"
                            ? "отозван"
                            : "не подключены"}
                    </td>
                    <td style={cell}>
                      {own?.noPlan ? "нет" : own?.planWaitingPublish ? "черновик" : "опубликован"}
                    </td>
                    <td style={cell}>
                      {student.lastSyncedAt
                        ? student.lastSyncedAt.slice(0, 16).replace("T", " ")
                        : "никогда"}
                      <span style={{ display: "block", color: "#888", fontSize: 12 }}>
                        {student.telegramChatId
                          ? student.telegramDeliveryEnabled
                            ? "telegram: доставка включена"
                            : "telegram: доставка выключена"
                          : "telegram: не привязан"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
