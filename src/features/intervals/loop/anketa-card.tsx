/**
 * Анкета ученика Intervals — общий блок для карточки /admin/coach-os/beginner/[studentUuid]
 * и общей карточки /admin/students/[studentId] (не только «начинающие» — коуч открывает
 * второй экран для ЛЮБОГО ученика, и там анкеты не было вовсе, хотя данные есть с самого
 * начала [решение Игоря, 17.09.2026]).
 *
 * Вынесено сюда, а не скопировано: это один и тот же факт о человеке, и расхождение между
 * копиями заметили бы не сразу.
 */

import { dayOffsetFromCoach } from "./clock";
import { fieldLabelRu, PREFILLABLE_FIELDS } from "./prefill";
import type { getOnboardingAnswers } from "./repository";

export type AnketaAnswers = NonNullable<Awaited<ReturnType<typeof getOnboardingAnswers>>>;

const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const weekdayRu = (day: number): string => WEEKDAYS_RU[day] ?? String(day);

/**
 * «Как сейчас проходит ваша обычная пробежка?» — вопрос из формы /m/run,
 * буква в букву те же три варианта, что видит она [решение Игоря,
 * 17.09.2026]. run_style — новая колонка; у строк, заполненных до неё, есть
 * только сжатый boolean canRunContinuously, и различить по нему
 * walk_breaks/mostly_walk нельзя — честно помечаем это в тексте, а не
 * притворяемся, что знаем больше, чем есть.
 */
function runStyleLabelRu(answers: AnketaAnswers): string {
  if (answers.runStyle === "continuous") return "бегает без остановок, двадцать минут и дольше";
  if (answers.runStyle === "walk_breaks") return "бегает, но иногда переходит на шаг";
  if (answers.runStyle === "mostly_walk") return "пока больше ходит, чем бегает";
  if (answers.canRunContinuously === true) return "бегает без остановок (отвечала до трёх вариантов)";
  if (answers.canRunContinuously === false) return "бегает с перерывами на шаг (какими именно — не уточнялось)";
  return "не отвечала";
}

export function IntervalsAnketaCard({
  answers,
  studentTimezone,
}: {
  answers: AnketaAnswers | null;
  studentTimezone: string | null;
}) {
  if (!answers) {
    return <p style={{ margin: 0, color: "#555" }}>Анкета ещё не заполнена.</p>;
  }

  return (
    <>
      {/* КТО ОТВЕЧАЛ — отдельной строкой, а не мелким шрифтом сбоку.
          «Ученица сказала, что бегает непрерывно» и «тренер знал, что она
          бегает непрерывно» — для корпуса разные данные, и различать их
          задним числом по значению невозможно. */}
      <table style={{ borderCollapse: "collapse", marginBottom: 12 }}>
        <tbody>
          {PREFILLABLE_FIELDS.map((field) => {
            const byCoach = answers.coachSetFields.includes(field);
            return (
              <tr key={field}>
                <td style={{ padding: "2px 10px 2px 0", color: "#555" }}>{fieldLabelRu(field)}</td>
                <td
                  style={{
                    padding: "2px 0",
                    color: byCoach ? "#7a4a00" : "#2E7D45",
                    fontWeight: 600,
                  }}
                >
                  {byCoach ? "задал тренер" : "ответила сама"}
                </td>
              </tr>
            );
          })}
          <tr>
            <td style={{ padding: "2px 10px 2px 0", color: "#555" }}>{fieldLabelRu("coachNote")}</td>
            <td style={{ padding: "2px 0", color: "#2E7D45", fontWeight: 600 }}>всегда её</td>
          </tr>
        </tbody>
      </table>
      <p style={{ margin: "0 0 6px" }}>
        цель: <strong>{answers.goalKind}</strong>
        {answers.raceDate ? ` · старт ${answers.raceDate}` : ""}
        {answers.raceDistanceKm ? ` · ${answers.raceDistanceKm} км` : ""}
      </p>
      <p style={{ margin: "0 0 6px" }}>
        неделя:{" "}
        {answers.weekStability === "stable"
          ? "стабильная"
          : answers.weekStability === "varies"
            ? "плавающая (план на переносах)"
            : "не спрашивали"}{" "}
        · дней в неделю: {answers.daysPerWeek}{" "}
        <span style={{ color: "#7a4a00" }}>({answers.daysPerWeekSource})</span>
      </p>
      <p style={{ margin: "0 0 6px" }}>
        свободные дни:{" "}
        {answers.availableWeekdays.length > 0
          ? answers.availableWeekdays.map(weekdayRu).join(", ")
          : "не отмечены"}{" "}
        · занятые:{" "}
        {answers.unavailableWeekdays.length > 0
          ? answers.unavailableWeekdays.map(weekdayRu).join(", ")
          : "нет"}
      </p>
      <p style={{ margin: "0 0 6px" }}>
        длинная:{" "}
        {answers.preferredLongWeekday === null ? "не задана" : weekdayRu(answers.preferredLongWeekday)}{" "}
        · тяжёлая:{" "}
        {answers.preferredQualityWeekday === null
          ? "не задана"
          : weekdayRu(answers.preferredQualityWeekday)}{" "}
        · время:{" "}
        {answers.timeOfDay === "morning"
          ? "утро"
          : answers.timeOfDay === "evening"
            ? "вечер"
            : answers.timeOfDay === "varies"
              ? "по-разному"
              : "не спрашивали"}
      </p>
      <p style={{ margin: "0 0 6px" }}>
        на тренировку есть:{" "}
        {answers.maxSessionMinutes === null ? "без потолка" : `${answers.maxSessionMinutes} мин`}{" "}
        · часовой пояс: {studentTimezone ?? "не определён (считаем по твоей зоне)"}
        {studentTimezone && dayOffsetFromCoach(studentTimezone) !== 0
          ? dayOffsetFromCoach(studentTimezone) > 0
            ? " · у неё уже завтра"
            : " · у неё ещё вчера"
          : ""}
      </p>
      <p style={{ margin: "0 0 6px" }}>
        где бегает: {answers.runSurfaces.length > 0 ? answers.runSurfaces.join(", ") : "не отмечено"}
      </p>
      <p style={{ margin: "0 0 6px" }}>как проходит обычная пробежка: {runStyleLabelRu(answers)}</p>
      {answers.weekBreakers ? (
        <div style={{ marginTop: 10, background: "#fffbe6", padding: "10px 12px", borderRadius: 8 }}>
          <strong>Что срывает неделю:</strong>
          <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{answers.weekBreakers}</p>
        </div>
      ) : null}
      {answers.coachNote ? (
        <div style={{ marginTop: 10, background: "#fffbe6", padding: "10px 12px", borderRadius: 8 }}>
          <strong>Что важно знать тренеру:</strong>
          <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{answers.coachNote}</p>
        </div>
      ) : null}
    </>
  );
}
