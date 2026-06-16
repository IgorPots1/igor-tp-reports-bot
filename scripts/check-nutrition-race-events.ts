import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isNutritionRaceTitle, normalizeTrainingType } from "@/features/nutrition/methodology";
import { computeNutritionRaceProtocol } from "@/features/nutrition/weekly-plan-formulas";

// Наряд 3 Шаг 1: recognise a race (race-day / race-week) from the TP event
// scanner (auto, source 'scan') + a coach manual mark (source 'manual'), without
// misreading marathon-PACE training runs as races. Static + unit checks; live
// behaviour shown by the checkpoint.

const root = process.cwd();

// --- Race title recognition (the false-positive guard is the whole point) -----
for (const raceTitle of [
  "Ночной забег",
  "Казанский полумарафон",
  "Полумарафон",
  "Московский марафон (10 км)",
  "Ночной паркран",
  "Гонка героев",
  "Соревнования по трейлу",
]) {
  assert.ok(isNutritionRaceTitle(raceTitle), `must recognise race: ${raceTitle}`);
}
for (const notRace of [
  "Бег в темпе марафона",
  "15 км в темпе марафона",
  "Длительный бег в темпе марафона",
  "Бег марафонским темпом",
  "30 мин (с горками по маршруту забега)",
  "Подготовка к марафону",
  "Лёгкий бег",
  "6 x 6 мин",
]) {
  assert.ok(!isNutritionRaceTitle(notRace), `must NOT misread as race: ${notRace}`);
}

// Injected race events (type === "race") win regardless of title wording.
assert.equal(normalizeTrainingType("race", "Ночной забег"), "race", "explicit race entity → race");
assert.equal(normalizeTrainingType(null, "Казанский полумарафон"), "race", "race-titled workout → race");
assert.equal(normalizeTrainingType("run", "Бег в темпе марафона"), "easy", "marathon-pace run is NOT a race");

// --- Шаг 2: race protocol by distance (gel / loading guardrail / night timing) -
const k10night = computeNutritionRaceProtocol({ distanceKm: 10, title: "Ночной забег" });
assert.equal(k10night.gel_before, true, "10 км → гель");
assert.equal(k10night.loading, null, "10 км (<90 мин) → загрузки НЕТ");
assert.equal(k10night.effort_over_90min, false, "10 км не >90 мин");
assert.equal(k10night.timing, "evening_or_night", "«Ночной» в названии → вечерний/ночной тайминг");
assert.equal(k10night.recovery_after, true, "после старта — восстановление");

const k5 = computeNutritionRaceProtocol({ distanceKm: 5, title: "Городской забег" });
assert.equal(k5.gel_before, false, "5 км → без геля");
assert.equal(k5.loading, null, "5 км → без загрузки");

const half = computeNutritionRaceProtocol({ distanceKm: 21.1, title: "Казанский полумарафон" });
assert.equal(half.gel_before, true, "полумарафон → гель");
assert.ok(half.loading && half.loading.g_per_kg_low === 6 && half.loading.g_per_kg_high === 8, "полумарафон → загрузка 6-8 г/кг");
assert.equal(half.timing, "morning", "без маркера времени → утро по умолчанию");

const marathon = computeNutritionRaceProtocol({ distanceKm: 42.2, title: "Марафон" });
assert.ok(marathon.loading && marathon.loading.g_per_kg_low === 7 && marathon.loading.g_per_kg_high === 9, "марафон → 7-9 г/кг");

const renderer = readFileSync(join(root, "src/features/nutrition/telegram-renderer.ts"), "utf8");
assert.match(renderer, /buildRaceDayBlock/, "renderer has a deterministic race-day block");
assert.match(renderer, /обязательно для 10 км и длиннее/, "race block states the gel rule (≥10 km)");
assert.match(renderer, /загрузка НЕ нужна/, "race block says no loading for short races");

const draft = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
assert.match(draft, /СТАРТ\/ГОНКА в next_week_plan/, "prompt has the race-protocol rule");

// --- Migration + repository bridge -------------------------------------------
const migration = readFileSync(join(root, "supabase/migrations/20260616140000_add_trainingpeaks_race_events.sql"), "utf8");
assert.match(migration, /create table if not exists public\.trainingpeaks_race_events/, "migration creates the table");
assert.match(migration, /source text not null default 'scan' check \(source in \('scan', 'manual'\)\)/, "source scan|manual");

const repo = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");
assert.match(repo, /export async function listNutritionRaceEventsForStudentWindow/, "nutrition read exists");
assert.match(repo, /event\.source === "manual" && existing\.source === "scan"/, "manual overrides scan at read time");
assert.match(repo, /could not find the table|schema cache/i, "read degrades gracefully when the table is missing");
assert.match(repo, /export async function upsertNutritionManualRaceEvent/, "manual upsert exists");
assert.match(repo, /export async function deleteNutritionManualRaceEvent/, "manual delete exists");

// --- Context injects race-days into both review + plan windows -----------------
const context = readFileSync(join(root, "src/features/nutrition/context.ts"), "utf8");
assert.match(context, /raceEvents: NutritionRaceEvent\[\]/, "context type carries raceEvents");
assert.match(context, /injectRaceEventsIntoWeekContext\(tpPastWeek, raceEvents\)/, "injects into review week");
assert.match(context, /injectRaceEventsIntoWeekContext\(tpNextWeek, raceEvents\)/, "injects into plan week");
assert.match(context, /type: "race"/, "injected workout typed as race");

// --- Plan side recognises race + excludes pace runs ---------------------------
const planFormulas = readFileSync(join(root, "src/features/nutrition/weekly-plan-formulas.ts"), "utf8");
assert.match(planFormulas, /racePaceOrPrep/, "plan day-type guards against marathon-pace runs");
assert.match(planFormulas, /забег\|старт\|ультра/, "plan day-type recognises забег/старт via Unicode boundaries");

// --- Manual override UI + actions (path B) ------------------------------------
const actions = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
assert.match(actions, /export async function addNutritionRaceEventAction/, "add manual race action");
assert.match(actions, /export async function deleteNutritionRaceEventAction/, "delete manual race action");
const page = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
assert.match(page, /Старты \(углеводная загрузка\)/, "races card present");
assert.match(page, /addNutritionRaceEventAction/, "card wires the add action");

// --- Scanner persist (path A) -------------------------------------------------
const runner = readFileSync(join(root, "tools/trainingpeaks-export/scripts/tp-races-requests-once.ts"), "utf8");
assert.match(runner, /persistScannedRaceEvents/, "scanner runner persists races to the table");
assert.match(runner, /source: "scan"/, "scanner writes source=scan");

const packageJson = readFileSync(join(root, "package.json"), "utf8");
assert.match(packageJson, /check:nutrition-race-events/, "package.json registers this check");

console.log("PASS check-nutrition-race-events");
