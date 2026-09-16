-- Структура тренировки (разминка/работа/заминка) до сих пор считалась при
-- сборке недели (autoplanner-week.ts: Session.segments), но в базу писалась
-- только СПЛЮЩЕННАЯ строка description — структура терялась безвозвратно, а
-- мини-приложение показывало один абзац текста вместо разминки/работы/заминки.
--
-- Аддитивно: nullable-колонка, старые строки остаются NULL и рендерятся, как
-- раньше, прозой. Заполняется только у новых/перегенерированных сессий.
alter table public.intervals_plan_sessions
  add column if not exists segments jsonb;

comment on column public.intervals_plan_sessions.segments is
  'Структура тренировки по сегментам: [{minutes, fastSec, slowSec, label, noPaceText?}, ...] — тот же Segment[], что строит autoplanner-week.ts, до сплющивания в description. NULL у сессий, сгенерированных до этой колонки.';
