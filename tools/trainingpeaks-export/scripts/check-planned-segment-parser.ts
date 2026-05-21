import process from "node:process";

import {
  expandPlannedSegmentsForAnalysis,
  parsePlannedSegments
} from "./tp-parse-week.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const levanMay14Description =
  "Разминка 10 минут в темпе 06:14–06:43 /км Спокойно втягиваешься в работу Дышишь ровно, тело просыпается Затем — 2 минуты в темпе 05:09–05:23 Быстро, чтобы активировать дыхание и включить мышцы Потом 3 минуты снова медленно —06:14–06:43 /км Сброс темпа перед основной частью ⏸ Пауза — 5 минут Пройдись или постой, глубоко подыши Настройся на работу, отдохни Основная часть — 9 повторов: 4 минуты в темпе 05:01–05:11 /км После каждого — 1 мин 30 сек легко бегом Полное восстановление Заминка 5 минут в комфортном темпе 06:14–06:43 /км Верни дыхание в норму и расслабь тело";

function run(): void {
  const parsed = parsePlannedSegments({
    description: levanMay14Description,
    plannedDurationMinutes: 70
  });

  const repeatSegments = parsed.segments.filter((segment) => segment.repeat_group_id === "r1");
  assert(repeatSegments.length === 2, "Expected hard + easy repeat pair in group r1.");
  assert(
    repeatSegments.every((segment) => segment.repeat_count === 9),
    "Expected repeat_count=9 for both repeat segments."
  );
  assert(repeatSegments[0]?.duration_minutes === 4, "Expected 4-minute hard repeat segment.");
  assert(repeatSegments[1]?.duration_minutes === 1.5, "Expected 1.5-minute easy repeat segment.");
  assert(
    !parsed.segments.some(
      (segment) => segment.is_rest && segment.duration_minutes === null && /^пауза$/iu.test(segment.raw_text)
    ),
    "Did not expect zero-duration inline pause segment."
  );
  assert(
    !parsed.segments_parse.flags.includes("repeat_block_partial"),
    "Did not expect repeat_block_partial flag."
  );

  const expanded = expandPlannedSegmentsForAnalysis({
    planned: {
      duration_minutes: 70,
      segments: parsed.segments,
      segments_parse: parsed.segments_parse
    }
  } as Parameters<typeof expandPlannedSegmentsForAnalysis>[0]);
  assert(!expanded.unsupported_repeats, "Expected repeat group expansion to succeed.");
  const repeatExpanded = expanded.expanded_segments.filter(
    (segment) => segment.repeat_group_id === "r1"
  );
  assert(
    repeatExpanded.length === 18,
    "Expected 9 hard + 9 easy expanded repeat segments."
  );

  const inlineRepeat = parsePlannedSegments({
    description: "9 повторов: 4 минуты в темпе 05:01-05:11 /км После каждого — 1 мин 30 сек легко бегом",
    plannedDurationMinutes: null
  });
  assert(
    inlineRepeat.segments.filter((segment) => segment.repeat_group_id === "r1").length === 2,
    "Expected inline Russian repeat prose to parse into a repeat pair."
  );

  const compactRepeat = parsePlannedSegments({
    description: "9 x 4 мин / 1:30 легко бегом",
    plannedDurationMinutes: null
  });
  assert(
    compactRepeat.segments.filter((segment) => segment.repeat_group_id === "r1").length === 2,
    "Expected compact 9 x 4 мин / 1:30 repeat to parse into a repeat pair."
  );

  const explicitPause = parsePlannedSegments({
    description: "Пауза — 5 минут\nОсновная часть — 6 повторов: 3 минуты / 1 мин легко бегом",
    plannedDurationMinutes: null
  });
  assert(
    explicitPause.segments.some(
      (segment) => segment.is_rest && segment.duration_minutes === 5 && /пауза/iu.test(segment.raw_text)
    ),
    "Expected explicit 5-minute pause segment to remain."
  );

  const tatianaMay16Description =
    "Скорость подбери по ощущениям, начинай ускорения с запасом Разминка: — 10 мин лёгкого бега @ 6:05–6:27 /км — 3 мин активнее 7 из 10 — 3 мин медленнее @ 6:53–7:23 /км — отдышись и сосредоточься Основная часть — 6 повторов: — 5 мин 04:55-05:10 Ощущения — 7-8 из 10. — 2 мин очень легко бегом Сбрось темп, восстанови дыхание и снова включайся. можно шагом Заминка — 5 мин @ 6:05–6:27 /км Просто расслабься и плавно заверши тренировку.";
  const tatianaMay16 = parsePlannedSegments({
    description: tatianaMay16Description,
    plannedDurationMinutes: 63
  });
  const tatianaRepeatSegments = tatianaMay16.segments.filter((segment) => segment.repeat_group_id === "r1");
  assert(tatianaRepeatSegments.length === 2, "Expected 6 x 5 min repeat to parse into hard + easy pair.");
  assert(
    tatianaRepeatSegments.every((segment) => segment.repeat_count === 6),
    "Expected repeat_count=6 for both repeat segments."
  );
  assert(
    !tatianaMay16.segments_parse.flags.includes("repeat_block_partial"),
    "Did not expect repeat_block_partial for Tatiana 6 x 5 min workout."
  );
  const tatianaMay16Expanded = expandPlannedSegmentsForAnalysis({
    planned: {
      duration_minutes: 63,
      segments: tatianaMay16.segments,
      segments_parse: tatianaMay16.segments_parse
    }
  } as Parameters<typeof expandPlannedSegmentsForAnalysis>[0]);
  assert(!tatianaMay16Expanded.unsupported_repeats, "Expected Tatiana 6 x 5 min repeat expansion to succeed.");
  assert(
    tatianaMay16Expanded.expanded_segments.filter((segment) => segment.repeat_group_id === "r1").length === 12,
    "Expected 6 hard + 6 easy expanded repeat segments."
  );

  console.log("[check-planned-segment-parser] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-planned-segment-parser] FAIL");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
}
