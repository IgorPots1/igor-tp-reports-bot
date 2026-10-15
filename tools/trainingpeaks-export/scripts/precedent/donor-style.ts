/**
 * НАЗВАНИЯ И ТЕКСТЫ ЧУЖОГО ДОНОРА → ОБЫЧНЫЕ СЕССИИ САМОГО АТЛЕТА (решение Игоря 15.10).
 *
 * Прецедент берёт неделю другого атлета, а вместе с ней его стиль: у 14 из 87 чужих доноров («по пульсу» / «по темпу»)
 * стиль был противоположен стилю самого атлета, «ученик заметит сразу». Поэтому в боевом пути названия и тексты лёгких и
 * длительной ПОДМЕНЯЮТСЯ его собственными обычными сессиями (так же, как качество после марафона), а не помечаются.
 *
 *  - подменяется только лёгкая и длительная БЕЗ качества по содержанию; качественная — рецепт («6 х 4 мин»), её название остаётся;
 *  - дни, ролевая раскладка и МИНУТЫ остаются донорскими (уже приведёнными к уровню атлета): меняются заголовок, описание и структура;
 *  - шаблон — собственная «чистая» сессия того же вида за последние 12 недель, ближайшая по минутам (чтобы тайминги в тексте,
 *    например гели в длительной, не уезжали), при равенстве — самая свежая; нет такого вида — донорская сессия остаётся;
 *  - свой донор (неделя самого атлета) не трогается: у него и так свой стиль.
 */
import type { CSess, CWeek, Kind } from "./corpus.ts";
import type { Index, PSess } from "./precedent.ts";
import { hasQualityContent } from "./validate.ts";
import { WARMUP_TITLE_RE } from "../lib/practice-signals.ts";

/**
 * wantWarmup: донорская сессия сама разминка/активация — тогда и шаблон ищется среди таких; иначе разминки в шаблоны НЕ берутся
 * (поймано сухим прогоном 15.10: у Паниной «Легкий бег» 30 мин получил заголовок «Разминка» — в её истории есть отдельные тренировки «Разминка»).
 */
export function ownTemplateNear(ix: Index, aid: number, before: string, kinds: Kind[], minutes: number, wantWarmup = false): CSess | null {
  const own = (ix.byAid.get(aid) ?? []).filter((w) => w.weekStart < before).slice(-12);
  for (const k of kinds) {
    let best: CSess | null = null; let bestD = Infinity;
    for (const w of own) for (const s of w.sessions) {
      if (s.race || s.kind !== k || hasQualityContent({ kind: s.kind, title: s.title, description: s.desc })) continue;
      if (WARMUP_TITLE_RE.test(s.title) !== wantWarmup) continue;
      const d = Math.abs(s.minutes - minutes);
      if (d <= bestD) { best = s; bestD = d; } // «<=»: при равенстве берётся более поздняя (недели идут по возрастанию)
    }
    if (best) return best;
  }
  return null;
}

export type StyleResult = { sessions: PSess[]; replaced: number; considered: number; notes: string[] };

export function substituteDonorStyle(ix: Index, t: CWeek, sessions: PSess[], donorAid: number): StyleResult {
  if (donorAid === t.aid) return { sessions, replaced: 0, considered: 0, notes: [] };
  let replaced = 0, considered = 0; const shown: string[] = [];
  const out = sessions.map((s) => {
    if (s.kind === "quality" || hasQualityContent({ kind: s.kind, title: s.title, description: s.src.desc })) return s;
    considered++;
    const tpl = ownTemplateNear(ix, t.aid, t.weekStart, s.kind === "long" ? ["long", "easy"] : ["easy"], s.minutes, WARMUP_TITLE_RE.test(s.title));
    if (!tpl) return s;
    replaced++; if (tpl.title !== s.title) shown.push(`«${s.title}» → «${tpl.title}»`);
    return { ...s, title: tpl.title, src: tpl } as PSess;
  });
  const notes = considered ? [`названия донора заменены обычными сессиями атлета: ${replaced} из ${considered}${shown.length ? ` (${shown.join("; ")})` : ""}`] : [];
  return { sessions: out, replaced, considered, notes };
}
