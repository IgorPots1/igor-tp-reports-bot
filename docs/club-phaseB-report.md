# Club Phase B — старты live (автоподстановка из race_events) — отчёт

Ветка `feature/club-races-live`, стек на `feature/club-coach-aggregates`. Свёл на календарь Фазы 5 —
отдельный раздел НЕ плодил.

## Автоподстановка из trainingpeaks_race_events
- `getClubCalendar` теперь возвращает `raceSuggestions` — известные предстоящие забеги ЭТОГО ученика
  из `trainingpeaks_race_events` в окне 45 дней (`loadRaceSuggestions`, read-only, толерантно к
  отсутствию таблицы/ошибке → []). Показывается `distance_raw` как есть (distance_km ненадёжен,
  репозиторий его намеренно не отдаёт).
- UI: в CalendarOverlay блок «Известные забеги - тапни, чтобы заявить». Тап по чипу выбирает день
  забега и подставляет название+дистанцию в форму забега — остаётся подтвердить «Заявить забег».

## Статусы и пакетное подтверждение
Уже есть из Фазы 5: заявки забега (kind=race) в `club_calendar_entries` со статусами
pending/approved/rejected, админ-инбокс `/admin/club/calendar` с ✓/✕ и «Подтвердить все». Отдельного
раздела стартов не создавал — всё на календаре.

## Проверки
tsc 0, eslint 0, build OK, check-initdata-auth 8/8, smoke-feedback-sweep PASSED. Общие модули не тронуты.
Длинные тире в новом тексте не использовал (просьба Игоря).
