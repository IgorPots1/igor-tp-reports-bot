/**
 * ЖИВОЙ ПРОГОН КОНТУРА НА НАСТОЯЩИХ СТРОКАХ.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ ПРОВЕРОК. Все существующие check-скрипты работают в
 * песочнице: заводят свою карточку, гоняют путь и убирают за собой. Это ловит
 * ошибки в логике, но НЕ отвечает на вопрос «работает ли это на живой карточке
 * с живой анкетой». Разница не теоретическая: песочница создаёт данные ровно
 * такими, какими их ждёт код, а живая карточка приходит из формы, из OAuth и из
 * раннера, и в ней бывает пусто там, где песочница всегда что-то кладёт.
 *
 * ЧТО ДЕЛАЕТ. По порядку, теми же функциями, которые дёргают кнопки и экраны:
 *   1. находит живую карточку ученика Intervals и её источник;
 *   2. генерирует план настоящим генератором (отдельным процессом, с --commit);
 *   3. показывает, что ученица плана ещё НЕ видит (черновик);
 *   4. публикует его тем же вызовом, что кнопка «Показать ученице»;
 *   5. читает экран ученицы: карточка сегодня, ближайшие дни, ступень;
 *   6. отмечается за неё (чек-ин) и показывает сдвиг ступени;
 *   7. переносит тренировку;
 *   8. пишет ей текст тренера и показывает, куда он делся.
 *
 * НИЧЕГО НАРУЖУ НЕ УХОДИТ. Доставка в телеграм останется отказом, пока у
 * карточки выключен telegram_delivery_enabled; скрипт этого флага не трогает.
 *
 * Запуск:
 *   npm run intervals:live-run
 * Уборка (спрашивает подтверждение отдельно, см. --cleanup):
 *   npm run intervals:live-run -- --cleanup
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

import { todayIsoInZone } from "@/features/intervals/loop/clock";
import { buildCoachMessageContext, deliverCoachMessage } from "@/features/intervals/loop/coach-message";
import {
  getLatestCycle,
  getProgression,
  getPublishedCycle,
  listActivitiesInRange,
  listCheckins,
  listCoachMessages,
  listSessionsInRange,
  markCoachMessageDelivered,
  markCoachMessageVisibleToStudent,
  publishCycle,
  saveCoachMessage,
} from "@/features/intervals/loop/repository";
import { loadStudentView, moveStudentSession, submitCheckin } from "@/features/intervals/loop/service";
import { createSupabaseServerClient } from "@/features/supabase/server";

const CLEANUP = process.argv.includes("--cleanup");
/**
 * Ветка лестницы новичка.
 *
 * ЗАЧЕМ ФЛАГ. У карточки без истории в Intervals цикл по объёму собрать не из
 * чего: конверту нужны наблюдённые недели, а их ноль. Это не поломка, это
 * честный отказ генератора. Человека без истории ведёт лестница шаг-бега, и
 * чтобы прогнать её живьём, анкете нужна цель start_running. Флаг ПЕРЕЗАПИШЕТ
 * цель в живой анкете, поэтому он явный и об этом сказано вслух.
 */
const AS_BEGINNER = process.argv.includes("--as-beginner");
const CONFIRM = process.argv.includes("--yes-delete-live-rows");

function head(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

function fail(message: string): never {
  console.error(`⛔ ${message}`);
  process.exit(1);
}

type Card = {
  studentUuid: string;
  studentName: string;
  sourceId: string;
  athleteId: string;
  timezone: string | null;
  telegramChatId: string | null;
  telegramDeliveryEnabled: boolean;
};

async function resolveCard(): Promise<Card> {
  const supabase = createSupabaseServerClient();
  const { data: students, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name, timezone, telegram_chat_id, telegram_delivery_enabled")
    .eq("coaching_platform", "intervals")
    .eq("is_active", true);
  if (error) fail(`не читаются карточки: ${error.message}`);
  const rows = students ?? [];
  if (rows.length === 0) fail("нет ни одной активной карточки с coaching_platform='intervals'");
  if (rows.length > 1) {
    console.log("Живых карточек больше одной, беру первую:");
    for (const row of rows) console.log(`  · ${(row as { student_name: string }).student_name}`);
  }
  const student = rows[0] as {
    id: string;
    student_name: string;
    timezone: string | null;
    telegram_chat_id: string | null;
    telegram_delivery_enabled: boolean;
  };

  const { data: sources } = await supabase
    .from("student_data_sources")
    .select("id, external_athlete_id, kind")
    .eq("provider", "intervals")
    .eq("student_id", student.id)
    .eq("is_active", true);
  const source = (sources ?? [])[0] as { id: string; external_athlete_id: string; kind: string } | undefined;
  if (!source) fail(`у карточки «${student.student_name}» нет активного источника Intervals`);

  return {
    studentUuid: student.id,
    studentName: student.student_name,
    sourceId: source.id,
    athleteId: source.external_athlete_id,
    timezone: student.timezone,
    telegramChatId: student.telegram_chat_id,
    telegramDeliveryEnabled: student.telegram_delivery_enabled === true,
  };
}

/** Удаление живых строк. Отдельное подтверждение обязательно. */
async function cleanup(card: Card): Promise<void> {
  const supabase = createSupabaseServerClient();
  head("УБОРКА");
  const counts: Array<[string, number]> = [];
  for (const table of ["intervals_checkins", "intervals_coach_messages", "intervals_plan_cycles"]) {
    const { count } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("source_id", card.sourceId);
    counts.push([table, count ?? 0]);
  }
  const { data: cycles } = await supabase
    .from("intervals_plan_cycles")
    .select("id")
    .eq("source_id", card.sourceId);
  const cycleIds = (cycles ?? []).map((row) => (row as { id: string }).id);
  let sessionCount = 0;
  if (cycleIds.length > 0) {
    const { count } = await supabase
      .from("intervals_plan_sessions")
      .select("*", { count: "exact", head: true })
      .in("cycle_id", cycleIds);
    sessionCount = count ?? 0;
  }
  counts.push(["intervals_plan_sessions", sessionCount]);
  counts.push(["intervals_beginner_progression", 1]);

  for (const [table, count] of counts) console.log(`  ${table}: ${count}`);

  if (!CONFIRM) {
    console.log("");
    console.log("Ничего не удалено. Это разрушительная операция, поэтому нужен второй флаг:");
    console.log("  npm run intervals:live-run -- --cleanup --yes-delete-live-rows");
    return;
  }

  await supabase.from("intervals_checkins").delete().eq("source_id", card.sourceId);
  await supabase.from("intervals_coach_messages").delete().eq("source_id", card.sourceId);
  if (cycleIds.length > 0) {
    await supabase.from("intervals_plan_sessions").delete().in("cycle_id", cycleIds);
    await supabase.from("intervals_plan_cycles").delete().eq("source_id", card.sourceId);
  }
  await supabase.from("intervals_beginner_progression").delete().eq("source_id", card.sourceId);
  console.log("Удалено. Анкета и источник оставлены: они не от прогона.");
}

async function main(): Promise<void> {
  console.log("ЖИВОЙ ПРОГОН КОНТУРА");
  const card = await resolveCard();
  const today = todayIsoInZone(card.timezone);
  console.log(`Ученик: ${card.studentName}`);
  console.log(`Источник: ${card.sourceId} · атлет ${card.athleteId}`);
  console.log(`Сегодня по её зоне (${card.timezone ?? "зона не определена"}): ${today}`);

  if (CLEANUP) {
    await cleanup(card);
    return;
  }

  // ── 1. План ───────────────────────────────────────────────────────────────
  head("1. ГЕНЕРАЦИЯ ПЛАНА");
  let existing = await getLatestCycle(card.sourceId);
  if (existing) {
    // Пустой цикл — артефакт прошлого прогона, когда генератор ещё умел писать
    // план без единой тренировки. Оставлять его значит блокировать прогон
    // навсегда; это единственное удаление, которое скрипт делает сам, и только
    // для цикла, в котором НОЛЬ тренировок.
    const sessions = await listSessionsInRange(existing.id, "2000-01-01", "2100-01-01");
    if (sessions.length === 0) {
      console.log(`Найден пустой цикл ${existing.id.slice(0, 8)} (ноль тренировок) — это артефакт, удаляю и генерирую заново.`);
      const supabase = createSupabaseServerClient();
      await supabase.from("intervals_plan_cycles").delete().eq("id", existing.id);
      existing = null;
    }
  }
  if (existing) {
    console.log(`Цикл уже есть: ${existing.id.slice(0, 8)} · статус ${existing.status}. Генерацию пропускаю.`);
  } else {
    console.log("Запускаю настоящий генератор отдельным процессом (тот же, что и руками)…");
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--loader",
        "./scripts/_alias-loader.mjs",
        // БЕЗ --env-file: переменные уже загружены в этот процесс и наследуются
        // дочерним. Иначе генератор искал бы .env.local в текущей папке, а в
        // рабочем дереве ветки его нет и быть не должно.
        "tools/trainingpeaks-export/scripts/intervals-onboarding-plan.ts",
        `--athlete=${card.athleteId}`,
        // --days обязателен вместе с --goal: генератор строит анкету из флагов
        // целиком, и без него подставится значение по умолчанию, которое
        // упрётся в ограничение методики новичка (не больше трёх дней).
        ...(AS_BEGINNER
          ? ["--goal=start_running", "--can-run-continuously=true", "--days=3"]
          : []),
        "--commit",
      ],
      { encoding: "utf8", cwd: process.cwd() }
    );
    if (AS_BEGINNER) {
      console.log("  --as-beginner: цель в анкете будет перезаписана на start_running (лестница шаг-бега)");
    }
    const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    for (const line of out.split("\n")) {
      if (/Записано|ступень|Отказ|неделя|⛔|Ошибка|Error|·/u.test(line)) console.log(`  ${line.trim()}`);
    }
    if (result.status !== 0) {
      fail(
        `генератор отказался (код ${result.status}). Это не сбой скрипта: причина названа выше. ` +
          (AS_BEGINNER ? "" : "Если у человека нет истории в Intervals, прогоняйте с --as-beginner.")
      );
    }
  }

  const cycle = await getLatestCycle(card.sourceId);
  if (!cycle) fail("цикла нет даже после генерации");
  console.log(`Цикл ${cycle.id.slice(0, 8)} · статус ${cycle.status} · ${cycle.lengthWeeks} нед с ${cycle.firstWeekStart}`);

  // ── 2. До публикации ученица плана не видит ───────────────────────────────
  head("2. ДО ПУБЛИКАЦИИ");
  const published0 = await getPublishedCycle(card.sourceId);
  const viewBefore = await loadStudentView(card.sourceId, today);
  console.log(`  опубликованный цикл: ${published0 ? published0.id.slice(0, 8) : "нет"}`);
  console.log(`  экран ученицы: ${viewBefore.state}`);
  if (viewBefore.state === "no_plan") console.log(`  текст: ${viewBefore.messageRu}`);

  // ── 3. Публикация ─────────────────────────────────────────────────────────
  head("3. ПУБЛИКАЦИЯ (то же, что кнопка «Показать ученице»)");
  if (cycle.status !== "published") {
    await publishCycle(cycle.id, card.sourceId, "coach:live-run");
    console.log("  опубликовано");
  } else {
    console.log("  уже было опубликовано");
  }
  const published = await getPublishedCycle(card.sourceId);
  console.log(`  опубликованный цикл: ${published ? published.id.slice(0, 8) : "нет"}`);

  // ── 4. Экран ученицы ──────────────────────────────────────────────────────
  head("4. ЭКРАН УЧЕНИЦЫ");
  const view = await loadStudentView(card.sourceId, today);
  if (view.state !== "ready") fail(`после публикации экран всё ещё ${view.state}`);
  console.log(`  сегодня: ${view.today ? `${view.today.dateLabel} · ${view.today.title} · ${view.today.minutes} мин` : "отдых"}`);
  if (view.restNoteRu) console.log(`  про отдых: ${view.restNoteRu}`);
  for (const card2 of view.upcoming.slice(0, 4)) {
    console.log(`  дальше: ${card2.weekdayLabel} ${card2.dateLabel} · ${card2.title} · ${card2.minutes} мин`);
  }
  if (view.ladder) {
    console.log(`  ступень: ${view.ladder.step} из ${view.ladder.totalSteps} — ${view.ladder.labelRu}`);
    console.log(`  что дальше: ${view.ladder.progressNoteRu}`);
  }

  // ── 5. Чек-ин ─────────────────────────────────────────────────────────────
  head("5. ЧЕК-ИН И СДВИГ СТУПЕНИ");
  const progressionBefore = await getProgression(card.sourceId);
  console.log(`  ступень до: ${progressionBefore ? progressionBefore.currentStep : "состояния нет"}`);
  const alreadyToday = (await listCheckins(card.sourceId, 40)).some((row) => row.sessionDate === today);
  if (alreadyToday) {
    console.log("  на сегодня чек-ин уже есть, второй в тот же день не заводим");
  } else {
    const target = view.today ?? view.upcoming[0] ?? null;
    const planned = view.today ? view.today.sessionId : null;
    const checkin = await submitCheckin({
      sourceId: card.sourceId,
      planSessionId: planned,
      sessionDate: today,
      effortCode: "easy",
      painCode: "no_pain",
      commentText: "живой прогон контура, ответ тренера жду здесь",
      voiceFileId: null,
    });
    if (!checkin.ok) fail(`чек-ин не прошёл: ${checkin.code} · ${checkin.messageRu}`);
    console.log(`  отмечено: ${planned ? "по плановой тренировке" : "без тренировки в плане"}${target ? "" : ""}`);
    console.log(`  ответ ученице: ${checkin.replyRu}`);
    console.log(`  ступень: ${checkin.stepBefore} → ${checkin.stepAfter} · ${checkin.action} · ${checkin.reason}`);
  }
  const progressionAfter = await getProgression(card.sourceId);
  console.log(`  ступень после: ${progressionAfter ? progressionAfter.currentStep : "состояния нет"} · сессий на ступени: ${progressionAfter?.sessionsAtStep ?? "—"}`);

  // ── 6. Перенос ────────────────────────────────────────────────────────────
  head("6. ПЕРЕНОС ТРЕНИРОВКИ");
  const viewAfterCheckin = await loadStudentView(card.sourceId, today);
  const movable =
    viewAfterCheckin.state === "ready"
      ? viewAfterCheckin.upcoming.find((row) => row.moveTargets.length > 0 && !row.checkedIn)
      : undefined;
  if (!movable) {
    console.log("  нечего переносить: у ближайших дней нет разрешённых целей");
  } else {
    const to = movable.moveTargets[0];
    const moved = await moveStudentSession({
      sourceId: card.sourceId,
      sessionId: movable.sessionId,
      toDate: to.date,
      todayIso: today,
      movedBy: "student:live-run",
    });
    console.log(
      moved.ok
        ? `  перенесено: ${movable.date} → ${moved.toDate} (${movable.title})`
        : `  отказ: ${moved.code} · ${moved.messageRu}`
    );
  }

  // ── 7. Текст тренера ──────────────────────────────────────────────────────
  head("7. ТЕКСТ ТРЕНЕРА");
  const checkins = await listCheckins(card.sourceId, 10);
  const lastCheckin = checkins[0] ?? null;
  if (!lastCheckin) {
    console.log("  чек-инов нет, писать не на что");
  } else {
    const sessions = await listSessionsInRange(cycle.id, lastCheckin.sessionDate, lastCheckin.sessionDate);
    const activities = await listActivitiesInRange(card.sourceId, lastCheckin.sessionDate, lastCheckin.sessionDate);
    const context = buildCoachMessageContext({
      progression: progressionAfter,
      session: sessions[0] ?? null,
      checkin: lastCheckin,
      activity: activities[0] ?? null,
    });
    const body =
      "Хорошо, что отметились. Лёгкая работа сейчас и должна быть лёгкой, " +
      "на следующей ступени добавим немного бега.";
    const saved = await saveCoachMessage({
      sourceId: card.sourceId,
      planSessionId: sessions[0]?.id ?? null,
      checkinId: lastCheckin.id,
      activityId: activities[0]?.activityId ?? null,
      body,
      context: context as unknown as Record<string, unknown>,
    });
    // Отдаём ученице: ровно это делает кнопка тренера.
    await markCoachMessageVisibleToStudent(saved.id);
    const delivery = await deliverCoachMessage({
      body,
      chatId: card.telegramChatId,
      telegramDeliveryEnabled: card.telegramDeliveryEnabled,
    });
    if (delivery.kind === "sent") {
      await markCoachMessageDelivered({ messageId: saved.id, status: "sent", chatId: delivery.chatId, telegramMessageId: null });
    } else if (delivery.kind === "prepared") {
      await markCoachMessageDelivered({ messageId: saved.id, status: "prepared", chatId: null, telegramMessageId: null });
    }
    console.log(`  текст сохранён: ${saved.id.slice(0, 8)}`);
    console.log(
      `  доставка: ${delivery.kind}${delivery.kind === "refused" ? ` · ${delivery.code} · ${delivery.messageRu}` : ""}`
    );
    console.log(`  снимок контекста: ступень ${context.step?.index ?? "—"}, чек-ин ${context.checkin?.effortLabel ?? "—"}`);

    // Главная проверка петли: видит ли его ученица У СЕБЯ, а не только в чате.
    const afterReply = await loadStudentView(card.sourceId, today);
    const replies = afterReply.state === "ready" ? afterReply.coachReplies : [];
    console.log(`  видно ученице в приложении: ${replies.length > 0 ? "да" : "НЕТ"}`);
    for (const reply of replies.slice(0, 2)) {
      console.log(`    · ${reply.aboutDateLabel ? `про ${reply.aboutDateLabel}` : reply.dateLabel}${reply.isNew ? " · новое" : ""}: ${reply.body.slice(0, 60)}…`);
    }
  }

  // ── 8. Что осталось в базе ────────────────────────────────────────────────
  head("8. ЧТО ТЕПЕРЬ ЛЕЖИТ В БАЗЕ");
  const finalSessions = await listSessionsInRange(cycle.id, "2000-01-01", "2100-01-01");
  const finalCheckins = await listCheckins(card.sourceId, 50);
  const finalMessages = await listCoachMessages(card.sourceId, 50);
  console.log(`  циклов: 1 (${cycle.status === "draft" ? "черновик" : "опубликован"})`);
  console.log(`  тренировок в плане: ${finalSessions.length}`);
  console.log(`  чек-инов: ${finalCheckins.length}`);
  console.log(`  текстов тренера: ${finalMessages.length}`);
  console.log("");
  console.log("Живые строки на месте. Убрать их: npm run intervals:live-run -- --cleanup");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
