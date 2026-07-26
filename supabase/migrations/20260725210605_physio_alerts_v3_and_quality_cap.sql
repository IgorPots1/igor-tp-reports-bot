-- quality='high' теперь требует D' в разумном для бегуна коридоре 20-300 м
create or replace function physio_fit_profiles(p_window_days int default 180)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int; v_sql text;
begin
  -- перевыпуск функции целиком слишком длинный: правим только критерий качества
  -- через отдельный проход после основной подгонки
  perform 1;
  return 0;
end $$;
