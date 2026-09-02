/**
 * Разбор robots.txt и проверка пути под наш User-Agent.
 *
 * Написано руками, а не взято пакетом, по одной причине: правило наряда — не
 * «примерно соблюдать», а не включать источник вовсе. Значит решение должно
 * быть читаемым и объяснимым в отчёте, вплоть до строки robots.txt, по которой
 * путь отклонён.
 *
 * Реализован стандартный разбор: группы User-agent, Allow/Disallow, победа
 * САМОГО ДЛИННОГО совпавшего правила (при равной длине выигрывает Allow),
 * поддержка * и $. Точная группа под наш агент важнее группы *.
 */

export type RobotsRule = { type: "allow" | "disallow"; pattern: string };
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

export type Robots = {
  groups: RobotsGroup[];
  crawlDelaySec: number | null;
  /** true — robots.txt не отдался (нет файла, ошибка сети). */
  missing: boolean;
  raw: string;
};

export function parseRobots(text: string, missing = false): Robots {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  let crawlDelaySec: number | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Подряд идущие User-agent относятся к одной группе.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;

    if (field === "allow" || field === "disallow") {
      current.rules.push({ type: field, pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n)) crawlDelaySec = n;
    }
  }
  return { groups, crawlDelaySec, missing, raw: text };
}

/** Правило robots в регулярное выражение: * — любая последовательность, $ — конец. */
function patternToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") out += ".*";
    else if (ch === "$" && i === pattern.length - 1) out += "$";
    else out += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out);
}

/** Группа, относящаяся к нашему агенту: точное совпадение важнее «*». */
function groupFor(robots: Robots, userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();
  let star: RobotsGroup | null = null;
  let exact: RobotsGroup | null = null;
  for (const g of robots.groups) {
    for (const a of g.agents) {
      if (a === "*") star = star ?? g;
      else if (ua.includes(a)) exact = exact ?? g;
    }
  }
  return exact ?? star;
}

export type RobotsDecision = {
  allowed: boolean;
  /** Правило, которое решило исход, — для отчёта. */
  reason: string;
};

export function isAllowed(robots: Robots, path: string, userAgent: string): RobotsDecision {
  if (robots.missing) {
    // Нет robots.txt — формально можно. Но молча считать «раз файла нет, значит
    // всё разрешено» мы не будем: это попадёт в отчёт отдельной пометкой.
    return { allowed: true, reason: "robots.txt отсутствует" };
  }
  const group = groupFor(robots, userAgent);
  if (!group) return { allowed: true, reason: "нет группы правил для нашего агента" };

  let best: { rule: RobotsRule; len: number } | null = null;
  for (const rule of group.rules) {
    if (rule.pattern === "") continue;
    if (!patternToRegExp(rule.pattern).test(path)) continue;
    const len = rule.pattern.length;
    if (!best || len > best.len || (len === best.len && rule.type === "allow")) {
      best = { rule, len };
    }
  }

  // Пустой Disallow: означает «разрешено всё».
  const blanketAllow = group.rules.some((r) => r.type === "disallow" && r.pattern === "");
  if (!best) {
    return {
      allowed: true,
      reason: blanketAllow ? "Disallow: (пусто) — разрешено всё" : "нет правила под этот путь",
    };
  }
  return {
    allowed: best.rule.type === "allow",
    reason: `${best.rule.type === "allow" ? "Allow" : "Disallow"}: ${best.rule.pattern}`,
  };
}
