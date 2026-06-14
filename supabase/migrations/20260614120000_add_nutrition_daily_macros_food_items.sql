-- Detailed reports (FatSecret RU PDF) expose per-product rows with meal sections.
-- Persist them alongside the daily totals so the review composer can reference
-- notable foods (coach-only by default). Nullable + defaulting to '[]' keeps all
-- existing rows valid; daily totals are never recomputed from these items.

alter table public.nutrition_daily_macros
  add column if not exists food_items jsonb not null default '[]'::jsonb;
