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
import {
  DEVICE_GUIDES,
  MARK_ALL_RU,
  STEP_LEAD_RU,
  WHY_NOT_STRAVA_RU,
} from "@/features/intervals/device-guide";

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
  console.log(`     карточек: ${DEVICE_GUIDES.map((g) => g.labelRu).join(", ")}`);

  // Градаций больше нет: отмечаем все галочки. Проверяем не метки, а то, что
  // карточка вообще что-то говорит человеку.
  expect(MARK_ALL_RU.length > 0, "правило «отметьте все» сказано словами");
  for (const guide of DEVICE_GUIDES) {
    const hasSteps = guide.steps.length > 0;
    const hasBridge = guide.bridgeRu.length > 0;
    expect(
      hasSteps !== hasBridge,
      `${guide.labelRu}: либо галочки, либо объяснение вместо них, но не пусто и не оба сразу`
    );
    if (hasSteps) {
      expect(
        guide.steps[0].titleRu.includes("Скачивание тренировок"),
        `${guide.labelRu}: галочка про скачивание тренировок стоит первой`
      );
      expect(guide.settingsBoxRu !== null, `${guide.labelRu}: назван блок в настройках`);
    }
  }

  // УРОК ПРО WAHOO, ЗАКРЕПЛЁННЫЙ ПРОВЕРКОЙ. В подводке шага 2 перечислены часы,
  // которые человек найдёт в списке Intervals. Всё, что там названо, обязано
  // иметь карточку; всё, что карточку имеет, но в списке не названо, обязано
  // объяснять, почему его там нет (случай Apple Watch).
  for (const guide of DEVICE_GUIDES) {
    const plainName = guide.labelRu.replace(/\s*\(.*\)$/, "");
    const namedInLead = STEP_LEAD_RU.includes(plainName);
    expect(
      namedInLead || guide.bridgeRu.length > 0,
      `${guide.labelRu}: ${namedInLead ? "назван в подводке" : "не в списке Intervals, и это объяснено"}`
    );
  }

  const apple = DEVICE_GUIDES.find((g) => g.code === "apple");
  expect(apple !== undefined, "Apple Watch есть в списке устройств");
  if (apple) {
    const bridgeText = apple.bridgeRu.join(" ");
    expect(bridgeText.includes("HealthFit"), "Apple Watch: назван рабочий посредник");
    expect(
      bridgeText.includes("план на часы не придёт"),
      "Apple Watch: сказано, что план на часы не придёт"
    );
    expect(apple.settingsBoxRu === null, "Apple Watch: блока в настройках Intervals нет");
  }

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
