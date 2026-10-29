/* Coach ping when someone starts the free week [Igor, 28.10.2026]: ONE short message per new
 * plan, nothing else (no ping on health stop, on reopening, on check-ins, on pain).
 * Same channel as the Russian trial bot: main bot (TELEGRAM_BOT_TOKEN) → first id of
 * TELEGRAM_COACH_CHAT_IDS. Best effort: a failed ping never breaks the person's plan. */

import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { assertNotPreviewEnvironment } from "@/lib/environment-guard";

import {
  GOALS,
  LONGEST_RUN,
  QUALITY,
  RACE_DISTANCES,
  RETURN_LAST,
  RETURN_LEVEL,
  START_LONGEST,
  START_NOW,
  WEEKLY_KM,
  monthLabelEn,
  patternLabelEn,
  planKindFor,
  type Answers,
  type Track,
} from "./logic";
import { formatDuration } from "./paces";

export type PlanStartedInfo = {
  username: string | null;
  clientId: string | null;
  country: string | null;
  answers: Answers;
  track: Track;
};

const label = <T extends string>(opts: Array<{ code: T; label: string }>, v: T | null | undefined) => (v ? opts.find((o) => o.code === v)?.label ?? v : null);

const KIND_RU = { ladder: "лестница новичка", return: "возвращение (тестовый бег)", regular: "регулярный бег", race: "к старту, с интервалами" } as const;

/** Russian, for Igor. Lines only for what was asked. */
export function planStartedText(i: PlanStartedInfo): string {
  const a = i.answers;
  const who = i.username ? `@${i.username}` : i.clientId ? `ChatPlace ${i.clientId}` : "без Instagram (открыли ссылку напрямую)";
  const lines = [
    `Бесплатная неделя @runnigor: новый участник ${who}.`,
    `Цель: ${label(GOALS, a.goal)}. Трек: ${i.track === "runner" ? "бегун" : "новичок"}, план: ${KIND_RU[planKindFor(a.goal)]}.`,
  ];
  if (a.start_now) lines.push(`Сейчас: ${label(START_NOW, a.start_now)}; без остановки: ${label(START_LONGEST, a.start_longest)}.`);
  if (a.return_last) lines.push(`Последний регулярный бег: ${label(RETURN_LAST, a.return_last)}; тогда: ${label(RETURN_LEVEL, a.return_level)}.`);
  if (a.race_distance) lines.push(`Старт: ${label(RACE_DISTANCES, a.race_distance)}, ${a.race_month ? monthLabelEn(a.race_month) : "?"}.`);
  if (a.race_distance) lines.push(`Результат: ${a.result_distance && a.result_seconds ? `${label(RACE_DISTANCES, a.result_distance)} ${formatDuration(a.result_seconds)}` : "нет"}.`);
  if (a.weekly_km) lines.push(`Объём: ${label(WEEKLY_KM, a.weekly_km)}; самая длинная: ${label(LONGEST_RUN, a.longest_run)}; качество: ${label(QUALITY, a.quality)}.`);
  lines.push(`Дни: ${patternLabelEn(a.pattern)} (${a.runs}). Страна: ${i.country ?? "?"}.`);
  return lines.join("\n");
}

export async function notifyCoach(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = getTrainingPeaksCoachChatIds()[0];
  if (!token || !chatId) return;
  try {
    assertNotPreviewEnvironment("Telegram sendMessage (en-week coach ping)");
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
    });
    if (!res.ok) console.error(`[en-week] coach ping: HTTP ${res.status}`);
  } catch (e) {
    console.error(`[en-week] coach ping: ${e instanceof Error ? e.message : String(e)}`);
  }
}
