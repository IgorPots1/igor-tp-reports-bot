/**
 * «Подключено, а данных нет»: когда сигнал обязан сработать и когда обязан
 * промолчать. Чистая функция, базы не трогает.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     scripts/check-connection-health.ts
 */
import process from "node:process";

import {
  assessConnectionHealth,
  SILENT_DAYS_THRESHOLD,
} from "@/features/intervals/loop/connection-health";
import { DEVICE_GUIDES, WHY_NOT_STRAVA_RU } from "@/features/intervals/device-guide";

let failures = 0;
function expect(condition: boolean, message: string): void {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures += 1;
}
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 56 - title.length))}`);
}

const TODAY = "2026-09-20";
const connected = (at: string) => ({ connectedAtIso: at, authFailedAtIso: null, isActive: true });

function main(): void {
  console.log("ПРИЗНАК «ПОДКЛЮЧЕНО, А ДАННЫХ НЕТ»");
  console.log(`порог молчания: ${SILENT_DAYS_THRESHOLD} суток`);

  step("СРАБАТЫВАЕТ, КОГДА ДОЛЖЕН");
  const alarm = assessConnectionHealth({
    todayIso: TODAY,
    connection: connected("2026-09-10"),
    activityDates: [],
    checkinDates: ["2026-09-19", "2026-09-20"],
  });
  expect(alarm.state === "connected_but_silent", "бегает, отмечается, тренировок ноль → тревога");
  if (alarm.state === "connected_but_silent") {
    console.log(`     ${alarm.messageRu}`);
    expect(alarm.checkinDates.length === 2, "в сообщении названы конкретные дни чек-инов");
  }

  step("МОЛЧИТ, КОГДА ДОЛЖЕН МОЛЧАТЬ");
  expect(
    assessConnectionHealth({
      todayIso: TODAY,
      connection: connected("2026-09-10"),
      activityDates: ["2026-09-19"],
      checkinDates: ["2026-09-19"],
    }).state === "ok",
    "тренировка приехала → тишина"
  );
  expect(
    assessConnectionHealth({
      todayIso: TODAY,
      connection: connected("2026-09-10"),
      activityDates: [],
      checkinDates: [],
    }).state === "ok",
    "нет тренировок и человек не отмечался → это «не бегал», а не поломка"
  );
  expect(
    assessConnectionHealth({
      todayIso: TODAY,
      // Подключился сегодня: данных ещё и не должно быть.
      connection: connected("2026-09-20"),
      activityDates: [],
      checkinDates: ["2026-09-20"],
    }).state === "ok",
    "подключился сегодня → не обвиняем, окно ещё не набрано"
  );
  expect(
    assessConnectionHealth({
      todayIso: TODAY,
      connection: connected("2026-09-10"),
      // Тренировки есть, но все ДО подключения: к вопросу «идут ли данные
      // сейчас» они отношения не имеют.
      activityDates: ["2026-09-01", "2026-09-05"],
      checkinDates: ["2026-09-19"],
    }).state === "connected_but_silent",
    "старые тренировки до подключения не считаются свежими данными"
  );

  step("ОТЛИЧАЕТ ОТ ДРУГИХ СОСТОЯНИЙ");
  expect(
    assessConnectionHealth({ todayIso: TODAY, connection: null, activityDates: [], checkinDates: [] })
      .state === "not_connected",
    "источника нет → «не подключено», а не тревога"
  );
  const revoked = assessConnectionHealth({
    todayIso: TODAY,
    connection: { connectedAtIso: "2026-09-10", authFailedAtIso: "2026-09-18T10:00:00Z", isActive: true },
    activityDates: [],
    checkinDates: ["2026-09-19"],
  });
  expect(revoked.state === "auth_revoked", "отозванный доступ имеет свой диагноз, а не этот");

  step("СПИСОК ГАЛОЧЕК");
  expect(DEVICE_GUIDES.length === 6, `часов в списке: ${DEVICE_GUIDES.length}`);
  for (const guide of DEVICE_GUIDES) {
    const required = guide.steps.filter((s) => s.kind === "required");
    const recommended = guide.steps.filter((s) => s.kind === "recommended");
    expect(
      required.length === 1 && recommended.length === 1,
      `${guide.labelRu}: ровно одна обязательная галочка и одна желательная`
    );
  }
  const withPlanned = DEVICE_GUIDES.filter((g) => g.steps.some((s) => s.kind === "later"));
  console.log(`     где сказано про плановые тренировки: ${withPlanned.map((g) => g.labelRu).join(", ")}`);
  expect(
    DEVICE_GUIDES.every((g) => g.steps[0].kind === "required"),
    "обязательная галочка всегда первая в списке"
  );
  expect(WHY_NOT_STRAVA_RU.pointsRu.length >= 3, "блок про Strava не пустой");

  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main();
