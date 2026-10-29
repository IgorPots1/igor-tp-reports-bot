-- Робот календаря: облачный сбор runc.run выключен (решение Игоря 29.10.2026). runc.run не отвечает
-- адресам облака Supabase (TLS проходит, ответа нет и за 30 с), первый прогон упал по пределу функции.
-- Сбор теперь с мака: понедельничный раннер races-weekly → scripts/races-manual.ts runc-feed --apply
-- присылает скачанные страницы в ту же стадию scrape&sources=runc. Задание не удаляется, а
-- выключается — обратимо (active := true). Применено 29.10.2026 через Supabase-MCP.
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'race-calendar-scrape-runc'), active := false);
