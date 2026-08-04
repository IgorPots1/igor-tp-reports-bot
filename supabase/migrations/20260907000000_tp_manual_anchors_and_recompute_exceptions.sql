-- Ручные оверрайды непрерывного пересчёта структур.
--
-- tp_manual_anchors: одобренный тренером лёгкий якорь (сек/км) для атлета, у которого <5 лёгких
--   FIT-бегов → авто-якорь ненадёжен и recompute деферит его вечно. Ручной якорь ПЕРЕБИВАЕТ
--   вычисленный; если он есть — n<5 больше не блокирует. Читают restore и ночной джоб.
-- tp_recompute_exceptions: атлеты, которых тренер ведёт руками — НИКОГДА не пересчитываем автоматом,
--   убираем из активного списка деферов. Читают ночной джоб и verify.

create table if not exists tp_manual_anchors (
  athlete_id  bigint primary key,
  anchor_sec  integer not null check (anchor_sec > 60 and anchor_sec < 900),
  set_by      text,
  reason      text,
  created_at  timestamptz not null default now()
);

create table if not exists tp_recompute_exceptions (
  athlete_id  bigint primary key,
  reason      text,
  set_by      text,
  created_at  timestamptz not null default now()
);

alter table tp_manual_anchors        enable row level security;
alter table tp_recompute_exceptions  enable row level security;
grant select, insert, update, delete on tp_manual_anchors       to service_role;
grant select, insert, update, delete on tp_recompute_exceptions to service_role;

-- Кузнецова (5489452): одобренный якорь 6:35 = 395с (n<5 лёгких бегов).
insert into tp_manual_anchors (athlete_id, anchor_sec, set_by, reason)
values (5489452, 395, 'igor', 'n<5 лёгких бегов; одобрено 2026-08-04')
on conflict (athlete_id) do update
  set anchor_sec = excluded.anchor_sec, set_by = excluded.set_by, reason = excluded.reason, created_at = now();

-- Постоянные исключения: Романовский (5225588), Чернышова (6030663) — намеренно не чиним, ведёт вручную.
insert into tp_recompute_exceptions (athlete_id, reason, set_by)
values
  (5225588, 'намеренно не чиним — Игорь ведёт вручную (темп задан «12 km/h», парсер не берёт)', 'igor'),
  (6030663, 'намеренно не чиним — Игорь ведёт вручную (у рабочих повторов нет темпа в описании)', 'igor')
on conflict (athlete_id) do nothing;
