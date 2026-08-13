/**
 * athlete-preferences — ПОЖЕЛАНИЯ УЧЕНИКА КАК ВХОД ФОРМЫ НЕДЕЛИ. Чистый модуль, без I/O.
 *
 * ЗАЧЕМ. Инвентаризация 13.08 (docs/athlete-preferences-inventory.md): машиночитаемых
 * пожеланий в базе нет вообще, есть проза от ai_extraction — вперемешку настоящие правила,
 * одноразовые факты и прямо сломанные извлечения. Поэтому пожелание — это РЕШЕНИЕ ТРЕНЕРА
 * из таблицы athlete_week_preferences, а память остаётся источником подсказок.
 *
 * ГЛАВНОЕ ПРАВИЛО КОНТРАКТА: пожелание ЖЁСТЧЕ расчётного дня, но НЕ ОТМЕНЯЕТ ИНВАРИАНТОВ.
 * Инварианты (качество не в смежные дни, после длительной лёгкий) выведены из практики
 * тренера и защищают неделю от бессмыслицы; пожелание — предпочтение того же тренера про
 * образ жизни ученика. Когда они спорят, побеждает инвариант, а НЕДЕЛЯ ПОМЕЧАЕТСЯ: тренер
 * должен увидеть, что его пожелание не исполнено, и решить сам. Молча ломаться нельзя —
 * это ровно тот случай, когда через месяц никто не поймёт, почему план не такой.
 */

export type PreferenceKind = "day_unavailable" | "role_day" | "max_days_per_week" | "day_max_minutes";
export type PreferenceRole = "long" | "quality" | "easy";

export type AthletePreference = {
  kind: PreferenceKind;
  dayOfWeek?: number | null;
  role?: PreferenceRole | null;
  maxDays?: number | null;
  maxMinutes?: number | null;
  activeFrom?: string | null;
  activeTo?: string | null;
  reason?: string | null;
};

/**
 * Действует ли пожелание на неделе, начинающейся с weekStart.
 *
 * ОКНО СРАВНИВАЕТСЯ С ВСЕЙ НЕДЕЛЕЙ, А НЕ С ЕЁ ПОНЕДЕЛЬНИКОМ. «В отпуске до среды»
 * обязано действовать на этой неделе, хотя её понедельник уже позже начала отпуска
 * и раньше его конца. Пересечение отрезков, а не попадание точки.
 */
export function isActiveOnWeek(p: AthletePreference, weekStart: string): boolean {
  const end = new Date(Date.parse(weekStart) + 6 * 86400000).toISOString().slice(0, 10);
  if (p.activeFrom && p.activeFrom > end) return false;
  if (p.activeTo && p.activeTo < weekStart) return false;
  return true;
}

export type PreferenceEffect = {
  /** дни, куда ставить нельзя вообще */
  blockedDays: Set<number>;
  /** роль → её обязательный день (пожелание тренера главнее расчётного) */
  pinnedRole: Map<PreferenceRole, number>;
  /** потолок беговых дней в неделе, null — не задан */
  maxDays: number | null;
  /** день → потолок минут в этот день */
  dayMaxMinutes: Map<number, number>;
  /** пометки тренеру: что именно применено */
  notes: string[];
};

const DAY_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const ROLE_RU: Record<PreferenceRole, string> = { long: "длительная", quality: "качественная", easy: "лёгкая" };

/**
 * Свести список пожеланий к тому, что умеет исполнить сборщик.
 *
 * ПРОТИВОРЕЧИЯ РАЗБИРАЕМ ЗДЕСЬ, А НЕ В СБОРЩИКЕ. «Длинное только в воскресенье» плюс
 * «воскресенье недоступно» — это не ошибка сборщика, это спор двух решений тренера,
 * и увидеть его он должен в понятном виде, а не как странную неделю.
 * Приоритет «недоступен» над «роль в этот день» выбран потому, что недоступность —
 * утверждение о ФАКТЕ (человек не может), а привязка роли — о предпочтении.
 */
export function resolvePreferences(prefs: AthletePreference[], weekStart: string): PreferenceEffect {
  const eff: PreferenceEffect = {
    blockedDays: new Set(), pinnedRole: new Map(), maxDays: null, dayMaxMinutes: new Map(), notes: [],
  };
  const active = prefs.filter((p) => isActiveOnWeek(p, weekStart));

  for (const p of active) {
    if (p.kind === "day_unavailable" && p.dayOfWeek != null) eff.blockedDays.add(p.dayOfWeek);
  }
  for (const p of active) {
    switch (p.kind) {
      case "role_day": {
        if (p.dayOfWeek == null || !p.role) break;
        if (eff.blockedDays.has(p.dayOfWeek)) {
          eff.notes.push(`✋ пожелания спорят: «${ROLE_RU[p.role]} в ${DAY_RU[p.dayOfWeek]}»`
            + ` против «${DAY_RU[p.dayOfWeek]} недоступен». Взята недоступность, привязка роли НЕ применена.`);
          break;
        }
        eff.pinnedRole.set(p.role, p.dayOfWeek);
        break;
      }
      case "max_days_per_week":
        if (p.maxDays != null) eff.maxDays = eff.maxDays == null ? p.maxDays : Math.min(eff.maxDays, p.maxDays);
        break;
      case "day_max_minutes":
        if (p.dayOfWeek != null && p.maxMinutes != null) {
          const prev = eff.dayMaxMinutes.get(p.dayOfWeek);
          eff.dayMaxMinutes.set(p.dayOfWeek, prev == null ? p.maxMinutes : Math.min(prev, p.maxMinutes));
        }
        break;
      default: break;
    }
  }

  if (eff.blockedDays.size) eff.notes.push(`пожелание: недоступны ${[...eff.blockedDays].sort((a, b) => a - b).map((d) => DAY_RU[d]).join(", ")}`);
  for (const [r, d] of eff.pinnedRole) eff.notes.push(`пожелание: ${ROLE_RU[r]} в ${DAY_RU[d]}`);
  if (eff.maxDays != null) eff.notes.push(`пожелание: не больше ${eff.maxDays} беговых дней`);
  for (const [d, m] of eff.dayMaxMinutes) eff.notes.push(`пожелание: в ${DAY_RU[d]} не длиннее ${m} мин`);

  // ВСЕ ДНИ ЗАКРЫТЫ — это не пожелание, это ошибка ввода. Сборщику такое отдавать нельзя:
  // он вернёт отказ «не помещается», и причина будет выглядеть как проблема нагрузки.
  if (eff.blockedDays.size >= 7) {
    eff.notes.push("✋ пожеланиями закрыты ВСЕ семь дней — неделю собрать не из чего, нужен взгляд тренера");
  }
  return eff;
}

/** Сколько дней реально доступно под бег после пожеланий. */
export const availableDayCount = (eff: PreferenceEffect): number => 7 - eff.blockedDays.size;
