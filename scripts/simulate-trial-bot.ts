/**
 * Прогон пробной недели по персонажам: что именно бот пришлёт человеку и тренеру.
 *
 * Без базы и без сети: хранилище в памяти (то же, что в check:trial-bot), Telegram пишет
 * каждое сообщение в стенограмму, часы двигаются тиками по :11 и :41, как pg_cron в бою,
 * поэтому утро, вечер, истории, день 4, итог и дожимы приходят настоящим dueActions.
 * Тексты тренировок идут запасным путём (методика), библиотека из базы не читается.
 *
 *   npm run trial-bot:simulate [-- <путь к .md>]
 */

import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTrialBot } from "@/features/trial-bot/bot";
import { ALL_DAY_PATTERNS, QUESTIONS, mskNow, parseTrialCallback, patternsFor, type Checkin } from "@/features/trial-bot/logic";
import type { Keyboard } from "@/features/trial-bot/texts";

import { memStore } from "./lib/trial-bot-memstore";

const COACH = "999";
const START = new Date("2026-11-02T10:00:00+03:00"); // понедельник
const END = new Date("2026-11-16T23:59:00+03:00");

type Persona = {
  name: string;
  /** Коды ответов по пути анкеты своей цели, последний про здоровье (none = «Ничего из этого»). */
  answers: string[];
  week: boolean; // «Да, веди» или «Пока только посмотрю»
  pattern?: string; // по умолчанию первый набор дней
  checkins: Checkin[];
  base?: "y" | "n"; // ответ на итог дня 7
};

/* По персонажу на каждую ветку анкеты [29.10.2026]: начать, вернуться, регулярно, к старту,
 * плюс здоровье и «только посмотрю». Максим раньше получал «неделя тебе не нужна». */
const PERSONAS: Persona[] = [
  { name: "Анна, с нуля", answers: ["start", "rarely", "lt5", "3", "none", "none"], week: true, checkins: ["ok", "easy", "ok"], base: "y" },
  { name: "Ольга, бегает без режима, 5-30 минут", answers: ["start", "sometimes", "5_30", "3", "past", "none"], week: true, checkins: ["easy", "easy", "easy"], base: "n" },
  { name: "Ирина, возвращение после полугода", answers: ["return", "6m_plus", "5k", "3", "now", "none"], week: true, checkins: ["ok", "pain", "ok"] },
  { name: "Сергей, возвращение, 2 раза", answers: ["return", "3_6m", "10k", "2", "none", "none"], week: true, checkins: ["hard", "miss"] },
  { name: "Максим, бегает регулярно, без интервалов", answers: ["regular", "15_30", "10_15", "easy_only", "4", "none", "none"], week: true, checkins: ["ok", "easy", "ok"], base: "y" },
  { name: "Дина, регулярно 2 раза", answers: ["regular", "5_15", "5_10", "sometimes", "2", "past", "none"], week: true, checkins: ["ok", "ok"] },
  { name: "Павел, полумарафон, интервалы регулярно", answers: ["race", "21k", "t2", "30_50", "regularly", "4", "none", "none"], week: true, checkins: ["easy", "hard", "ok"] },
  { name: "Света, 10 км, дискомфорт", answers: ["race", "10k", "t3", "15_30", "sometimes", "3", "now", "none"], week: true, checkins: ["ok", "ok", "ok"] },
  { name: "Елена, давление", answers: ["start", "rarely", "lt5", "3", "none", "heart"], week: true, checkins: [] },
  { name: "Катя, только смотрит", answers: ["regular", "30_50", "15_21", "regularly", "3", "none", "none"], week: false, checkins: [] },
];

const WD = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];
function stamp(d: Date): string {
  const m = mskNow(d);
  const [, mo, da] = m.date.split("-");
  const hh = String(Math.floor(m.minutes / 60)).padStart(2, "0");
  const mm = String(m.minutes % 60).padStart(2, "0");
  return `${WD[m.weekday]} ${da}.${mo} ${hh}:${mm}`;
}

function kbText(kb?: Keyboard): string {
  if (!kb || kb.length === 0) return "";
  return "\n" + kb.map((row) => row.map((b) => ("url" in b ? `[${b.text} → ${b.url}]` : `[${b.text}]`)).join(" ")).join("\n");
}

function quote(text: string): string {
  return text.split("\n").map((l) => `> ${l}`).join("\n");
}

async function runPersona(p: Persona, id: number): Promise<{ log: string[]; coach: string[] }> {
  const mem = memStore();
  const log: string[] = [];
  const coach: string[] = [];
  let now = new Date(START);
  let lastKb: Keyboard | undefined;
  let lastMessageId = 0;
  const pendingEvening: number[] = []; // idx тренировок, по которым пришёл вечерний вопрос
  let summaryArrived = false;

  const bot = createTrialBot({
    store: mem.store,
    tg: {
      async send(chatId, text, kb) {
        if (String(chatId) === COACH) {
          coach.push(`**${stamp(now)}** Тренеру:\n\n${quote(text)}`);
          return 1;
        }
        log.push(`**${stamp(now)}** Бот:\n\n${quote(text + kbText(kb))}`);
        if (kb) lastKb = kb;
        for (const b of (kb ?? []).flat()) {
          const cb = "data" in b ? parseTrialCallback(b.data) : null;
          if (cb?.kind === "checkin" && !pendingEvening.includes(cb.idx)) pendingEvening.push(cb.idx);
          if (cb?.kind === "base" && text.startsWith("Неделя закончилась.")) summaryArrived = true;
        }
        return ++lastMessageId;
      },
      async edit(_chatId, _messageId, text, kb) {
        log.push(`**${stamp(now)}** Бот (правит сообщение):\n\n${quote(text + kbText(kb))}`);
        if (kb) lastKb = kb;
      },
      async answer(_id, text) {
        if (text) log.push(`**${stamp(now)}** Бот (всплывашка): ${text}`);
      },
      async sendPhoto(_chatId, photoUrl, caption) {
        log.push(`**${stamp(now)}** Бот (фото ${photoUrl}):\n\n${quote(caption ?? "")}`);
        return ++lastMessageId;
      },
    },
    now: () => now,
    library: async () => new Map(), // запасной путь: тексты методики
    coachChatId: COACH,
    landingUrl: "https://igorp.run/baza",
    isActiveStudent: async () => false, // симуляция ведёт лидов из рилса, не учеников
  });

  const from = { id, first_name: p.name.split(",")[0], username: null };

  async function press(data: string, kb: Keyboard | undefined = lastKb) {
    const label = (kb ?? []).flat().find((b) => "data" in b && b.data === data)?.text ?? data;
    log.push(`**${stamp(now)}** Человек нажал: [${label}]`);
    const cb = parseTrialCallback(data);
    if (!cb) throw new Error(`кнопка ${data} не разбирается`);
    await bot.handleCallback({ from, chatId: id, messageId: lastMessageId, callbackQueryId: "q", cb });
  }

  const later = (min: number) => { now = new Date(now.getTime() + min * 60_000); };

  // вход и тест
  log.push(`**${stamp(now)}** Человек открыл ссылку t.me/<бот>?start=trial_sim`);
  await bot.handleStart({ from, chatId: id, source: "sim" });
  later(1);
  await press("tr:go");
  for (const code of p.answers) {
    later(1);
    // Вопрос берётся с последних кнопок бота: путь анкеты ведёт бот, а не сценарий.
    const b = (lastKb ?? []).flat().find((x) => {
      if (!("data" in x) || !x.data.startsWith("tr:a:")) return false;
      const [, , qid, i] = x.data.split(":");
      return QUESTIONS[qid]?.options[Number(i)]?.code === code;
    });
    if (!b || !("data" in b)) throw new Error(`${p.name}: на экране нет варианта ${code}`);
    await press(b.data);
  }
  const u = mem.users.get(id)!;
  if (u.stage === "result") {
    later(2);
    if (p.week) {
      await press("tr:wk:y");
      later(1);
      const runs = u.weekly_runs === 2 ? 2 : 3;
      const pattern = p.pattern ?? patternsFor(runs)[0];
      if (!ALL_DAY_PATTERNS[pattern]) throw new Error(pattern);
      await press(`tr:days:${pattern}`);
    } else {
      await press("tr:wk:n");
    }
  }

  // неделя и после: тики по :11 и :41, человек отвечает через 10 минут после вопроса
  const checkins = [...p.checkins];
  let t = new Date(START);
  t.setUTCMinutes(11, 0, 0);
  if (t <= START) t = new Date(t.getTime() + 30 * 60_000);
  while (t <= END) {
    now = new Date(t);
    await bot.runTick();
    if (pendingEvening.length) {
      later(10);
      while (pendingEvening.length) {
        const idx = pendingEvening.shift()!;
        const c = checkins.shift();
        if (c) await press(`tr:ci:${idx}:${c}`);
        else log.push(`**${stamp(now)}** Человек не ответил на вопрос про тренировку ${idx}`);
      }
    }
    if (summaryArrived) {
      summaryArrived = false;
      if (p.base) {
        later(5);
        await press(`tr:base:${p.base}`);
      }
    }
    t = new Date(t.getTime() + 30 * 60_000);
  }
  const fin = mem.users.get(id)!;
  log.push(`_Итог в базе: stage=${fin.stage}, result_type=${fin.result_type ?? "-"}, start_rung=${fin.start_rung ?? "-"}, health_flag=${fin.health_flag}_`);
  const sess = mem.sessions.get(id) ?? [];
  if (sess.length) {
    log.push(
      "_Тренировки: " +
        sess.map((s) => `${s.idx}) ${s.scheduled_date} ${s.preset_code} «${s.title}» → ${s.checkin ?? "нет ответа"}`).join("; ") +
        "_",
    );
  }
  return { log, coach };
}

async function main() {
  const out = process.argv[2] ?? path.join(os.tmpdir(), "trial-sim.md");
  const parts: string[] = [
    "# Пробная неделя: прогон по персонажам",
    "",
    `Старт: пн 02.11.2026 10:00 МСК. Тики по :11 и :41. Тексты тренировок: запасной путь (методика). Время в стенограмме московское.`,
    "",
  ];
  let id = 1001;
  for (const p of PERSONAS) {
    const { log, coach } = await runPersona(p, id++);
    parts.push(`## ${p.name}`, "", ...log.flatMap((l) => [l, ""]));
    parts.push(`### Уведомления тренеру (${p.name})`, "", ...(coach.length ? coach.flatMap((l) => [l, ""]) : ["нет", ""]));
  }
  writeFileSync(out, parts.join("\n"));
  console.log(`trial-bot:simulate ok → ${out}`);
}

main().catch((e) => {
  console.error("trial-bot:simulate FAILED:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
