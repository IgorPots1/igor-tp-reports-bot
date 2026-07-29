# PLAN — club day_off с причиной Injury/Sick → health-сигнал Coach OS

Статус: **план, НЕ реализовано.** Ничего в сигнальную систему пока не пишется.

## Зачем

Когда ученик отмечает выходной с причиной **Injury** (травма) или **Sick** (болезнь),
это не просто пометка в календаре TP — это факт о здоровье. Он должен попадать в
health-корзину системы сигналов Coach OS (`trainingpeaks_student_operational_signals`),
где у тренера уже собраны здоровье-сигналы, с жизненным циклом и закрытием. Иначе травма/
болезнь, заявленная через клуб, теряется — тренер видит только «выходной» в TP.

Причины `Appointment / Vacation / Work / Other` — обычная недоступность, health-сигнал НЕ
порождают (максимум — необязательный `schedule_unavailability_window`, см. ниже).

## Куда подключать (существующая инфраструктура, ничего нового)

Таблица `trainingpeaks_student_operational_signals` уже содержит нужные типы (миграция
`20260605173000_expand_operational_signal_types_for_health_context`):

| Причина заявки | signal_type | requires_coach_close | Как закрывается |
|---|---|---|---|
| `Injury` | `pain_injury` | **true** | Только рукой тренера (принцип: травма не закрывается «побегала, стало легче» — см. `signal-recovery-bridge.ts`). |
| `Sick` | `health_issue_started` | false | Авто-закрытие существующим recovery-bridge при подтверждении выздоровления, либо рукой. |
| (любой day_off, опционально) | `schedule_unavailability_window` | false | По истечении `valid_until` (zombie-cleanup по TTL). |

Поля строки сигнала (уже есть в схеме) заполняются так:
- `student_id` — из заявки.
- `signal_type` — по таблице выше.
- `status` = `active`.
- `source_type` = `club_calendar` (новое значение источника; не наблюдение из Telegram, а
  явная заявка ученика).
- `valid_from` / `valid_until` = диапазон дней выходного (для многодневного — весь диапазон).
- `source_date` = дата заявки.
- `requires_coach_close` = true для Injury, false для Sick.
- `structured_payload` = `{ reason, entry_id, kind: "day_off" }` — чтобы сигнал ссылался на
  запись календаря.
- `dedupe_key` = `club_calendar:<entry_id>` (или `club:<student>:<valid_from>:<reason>`) —
  идемпотентность: повторная обработка той же заявки НЕ плодит второй сигнал.

## Где триггерить

Точка — **одобрение заявки тренером** (переход `pending → approved` в
`club_calendar_entries`), а не создание учеником: сигнал должен появляться, когда тренер
принял факт, чтобы клубная заявка не забивала корзину неподтверждёнными. Вариант «на
создании» тоже возможен, но тогда нужен отдельный фильтр в корзине.

Реализация (когда делаем): в обработчике одобрения day_off-заявки с
`day_off_reason ∈ {Injury, Sick}` — upsert по `dedupe_key` в
`trainingpeaks_student_operational_signals`. При отклонении/удалении заявки или снятии
выходного — закрыть связанный сигнал (`status=resolved`, `resolved_reason=club_entry_removed`),
кроме `pain_injury` (тот только рукой, как и вся травма-логика).

## TTL и закрытие

- **Injury** (`pain_injury`, `requires_coach_close=true`): живёт до ручного закрытия
  тренером. TTL не применяется (травма не истекает сама) — согласовано с текущим правилом
  «injuries close by hand».
- **Sick** (`health_issue_started`): закрывается либо recovery-bridge при подтверждении
  выздоровления (уже существует), либо zombie-cleanup после `valid_until` + grace.
- **schedule_unavailability_window** (если добавим): чисто временной, TTL = `valid_until`.

## Что НЕ делаем в этом плане

- Не трогаем recovery-bridge и pain_injury-логику (только пользуемся ими).
- Не шлём ученику ничего.
- Не автозакрываем травму.
- Реализацию health-сигнала — отдельным нарядом, после того как day_off→Availability
  (флаг `CLUB_DAYOFF_AS_AVAILABILITY`) обкатан на реальных данных.
