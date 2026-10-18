-- bd_uploads: журнал заливки разборов Strava (scripts/bd-upload.py, раннер
-- com.igor.trainingpeaks.bd-upload). Таблица заведена руками вне репозитория;
-- на 2026-10-18 у service_role на ней были только REFERENCES/TRIGGER/TRUNCATE —
-- ни писать, ни читать раннер не мог. Только гранты, схема не меняется.
grant select, insert on table public.bd_uploads to service_role;
grant usage, select on sequence public.bd_uploads_id_seq to service_role;
