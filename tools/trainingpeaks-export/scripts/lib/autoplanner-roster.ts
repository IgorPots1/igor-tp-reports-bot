/**
 * autoplanner-roster — КТО ВООБЩЕ ПОДЛЕЖИТ ПЛАНИРОВАНИЮ. Единый фильтр «действующий ученик».
 *
 * ЗАЧЕМ. До 16.08 ростер автопланировщика был «все, у кого есть пробежки в кэше»: ни один файл
 * автопланировщика не читал trainingpeaks_students вообще. Из-за этого недели генерировались
 * архивным и уже ушедшим ученикам, а заодно и служебному аккаунту тренера. Это не косметика:
 * такие люди попадали в теневое сравнение и портили метрику (у одного потолок 30 мин и пометка
 * «не тренируется 11 недель подряд» — планировать ему нечего, а в статистику он входил),
 * и они же занимали места в пакете на приёмку.
 *
 * ПРИЗНАК ДЕЙСТВУЮЩЕГО (проверен по данным 16.08, не угадан):
 *   is_active === true  И  archived_at === null  И  is_service_account !== true
 *
 * ПОЧЕМУ ИМЕННО ТАК:
 *   - archived_at ⊂ is_active=false: из 126 записей 12 неактивных, все 7 архивных внутри них,
 *     «активен И в архиве» — ноль. То есть флаги не спорят друг с другом.
 *   - служебный аккаунт (1 шт.) — не ученик, но БЕГАЕТ и активен, так что одним is_active
 *     он не отсеивается: последняя пробежка у него была позавчера.
 *   - weekly_report_enabled активностью НЕ является: true всего у 31 из 126. Это настройка
 *     рассылки, и брать её за признак «ученик» — значит выбросить три четверти ростера.
 *
 * ПРОВЕРЕНО, ЧТО ФИЛЬТР НЕ РЕЖЕТ ЖИВЫХ: у всех 12 неактивных последняя пробежка и последний
 * план старше месяца (самый свежий — 08.07 при замере 11.08). Ни новичков, ни паузы, ни смены
 * тарифа под флагом не прячется.
 *
 * СВЯЗЬ С TP ХРУПКАЯ: отдельной колонки trainingpeaks_athlete_id в trainingpeaks_students НЕТ,
 * id приходится доставать разбором trainingpeaks_athlete_url. Поменяется формат ссылки — связь
 * порвётся МОЛЧА. Починка предложена миграцией 20260916000000, здесь же связь строится ровно
 * в одном месте (parseAthleteId), чтобы чинить потом тоже в одном.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Единственное место, где id атлета достаётся из ссылки. Не копировать по вызовам. */
export function parseAthleteId(url: string | null): number | null {
  const m = /athletes\/(\d+)/.exec(url ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export type RosterRow = {
  athleteId: number;
  isActive: boolean;
  archived: boolean;
  serviceAccount: boolean;
};

export type Roster = {
  /** id действующих учеников — этим и планируем */
  active: Set<number>;
  /** всё, что вернула таблица, с разобранным id (для диагностики) */
  all: RosterRow[];
  /** записи, у которых id из ссылки не достался — связь порвана, молчать нельзя */
  unparsed: number;
};

export async function loadRoster(sb: SupabaseClient): Promise<Roster> {
  const { data, error } = await sb.from("trainingpeaks_students")
    .select("trainingpeaks_athlete_url, is_active, archived_at, is_service_account");
  if (error) throw new Error(`trainingpeaks_students: ${error.message}`);
  const all: RosterRow[] = [];
  let unparsed = 0;
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const athleteId = parseAthleteId(r.trainingpeaks_athlete_url as string | null);
    if (athleteId == null) { unparsed++; continue; }
    all.push({
      athleteId,
      isActive: r.is_active === true,
      archived: r.archived_at != null,
      serviceAccount: r.is_service_account === true,
    });
  }
  const active = new Set(all.filter((r) => r.isActive && !r.archived && !r.serviceAccount).map((r) => r.athleteId));
  return { active, all, unparsed };
}

/** Строка для отчётов: сколько всего, сколько действующих, кто отсеян и почему. */
export function rosterSummary(r: Roster): string {
  const arch = r.all.filter((x) => x.archived).length;
  const inact = r.all.filter((x) => !x.isActive && !x.archived).length;
  const svc = r.all.filter((x) => x.serviceAccount).length;
  return `ростер: всего ${r.all.length + r.unparsed} · действующих ${r.active.size}`
    + ` · отсеяно ${r.all.length - r.active.size + r.unparsed}`
    + ` (архив ${arch} · неактивен без архива ${inact} · служебный ${svc} · id не разобран ${r.unparsed})`;
}
