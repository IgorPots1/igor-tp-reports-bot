# Coach OS Running Methodology — Current State

Date: 2026-06-06
Repo: igor-tp-reports-bot
Purpose: consolidated current-state methodology document for periodization/cycle review

## 1. Executive summary

Методология бегового планирования в Coach OS уже существует, но она разбросана по коду, каталогам шаблонов, baseline-логике и эмпирическим отчётам. Единого документа по периодизации до сих пор не было.

Сейчас система умеет безопасно собирать недельный draft-план: взять baseline v2, проверить readiness, сгенерировать черновик недели, выбрать quality-тренировку по явным правилам (v0), провалидировать структуру и recovery, и показать writer dry-run без записи в TrainingPeaks.

Реализована первая версия VO2-прогрессии «короткие → длинные интервалы» и жёсткие recovery-правила. Есть каталог quality intent, writer guard и небольшой набор проверок.

Полноценного движка мезо-/макроцикла, фаз тренировки и race-aware планирования пока нет. Планирование по сути недельное: система смотрит на caps, readiness и последнюю quality-сессию, но не помнит «неделю блока» и не выбирает фазу (база / порог / VO2 / специфика).

Следующий методологический разрыв — определение тренировочного цикла, фаз и периодизации (включая reverse periodization), а не только выбор одной quality-тренировки на неделю.

**Текущая методологическая цепочка коммитов:** `0d163ba` (quality intent catalog + writer guard), `2f39bd9` (recovery rules), `8f2f72f` (VO2 progression selector). Каталог (`plan-quality-methodology-catalog.ts`) хранит структуры и metadata; детерминированный выбор следующей VO2-тренировки вынесен в `plan-quality-progression-selector.ts`.

## 2. What the system can already do

**Baseline caps (v2).** Из истории completed running считаются frequency cap, weekly minutes cap, long run cap, quality count cap. Race/taper/post-race/illness недели исключаются из «нормального» baseline.

**Readiness gating.** Перед draft проверяется: illness/injury, race context, planned vs completed, confidence baseline, operational signals, data quality. Решение: `ready_for_plan`, `needs_coach_review` или `blocked`.

**Quality intent.** Три явных intent: `vo2max_intervals`, `controlled_sub_threshold`, `threshold_tempo`. У каждого — ключ (`QualityWorkoutKey`), структура (разминка / repeats / заминка), recovery label.

**Explicit structures.** Quality-тренировка не «придумывается» текстом — она берётся из каталога с фиксированными repeat_count, work_minutes, recovery_minutes, total_minutes.

**Writer guard.** Writer dry-run блокирует preview, если нет `quality_intent`, `quality_workout_key` или валидной структуры. `controlled_3x6` (3×6 / 3 min recovery) явно запрещён как v0 default.

**VO2 progression selector (v1).** Семейство `vo2_short_to_long_intervals` с этапами 1–5. Каталог даёт metadata и `getNextProgressionCandidates`; draft generator вызывает `selectNextQualityWorkoutFromProgression` из отдельного selector-модуля. Для Anna: 20×1 → `vo2_10x2`, без invented 3×6.

**Recovery validation.** Recovery между интервалами проверяется по intent и длительности work. Недопустимые комбинации отклоняются.

**Dry-run writer preview.** Локальный preview payload с маркером `NO_TP_WRITE`, без сетевых запросов в TrainingPeaks.

## 3. Current weekly planning flow

### Текущий поток (реализован)

```text
Baseline v2
→ readiness (tp-plan-readiness-dry-run)
→ draft generator (tp-plan-draft-generator-v0)
→ quality catalog (plan-quality-methodology-catalog)
→ VO2 progression selector (plan-quality-progression-selector)
→ writer dry-run (tp-plan-writer-dry-run-v0)
```

**Шаги подробнее:**

1. **Baseline v2** — диагностика/импорт caps из completed running, исключая race/taper/post-race недели.
2. **Readiness** — читает baseline report + Supabase (read-only) + operational signals. Выдаёт decision per athlete.
3. **Draft generator** — для `ready_for_plan`: 3 пробежки (easy + quality + long), 90% weekly cap, 90% long run cap, coach-style rounding. Quality: сначала `selectNextQualityWorkoutFromProgression`, fallback — `selectQualityMethodologyV0`.
4. **Quality catalog** — структура, recovery rules, progression metadata (`next_preferred_keys`, stages).
5. **VO2 progression selector** — детерминированный выбор следующего `QualityWorkoutKey` по recent pattern + completion/fatigue signals.
6. **Writer dry-run** — маппинг draft → TP payload preview, safety checks, `NO_TP_WRITE`.

### Желаемый будущий поток (ещё не реализован)

```text
Baseline v2
→ readiness
→ cycle diagnostic
→ phase-aware draft
→ writer dry-run
→ coach review
→ guarded real write
```

Сейчас нет `cycle diagnostic`, нет `phase-aware draft`, нет guarded real write.

## 4. Workout taxonomy and families

### Классификатор исторических тренировок (`athlete-training-baseline.ts`)

Семейства `TrainingFamily`:

| Семейство | Смысл |
|-----------|-------|
| `easy` | Лёгкий аэробный бег |
| `easy_with_strides` | Лёгкий + ускорения |
| `long_run` | Длительный |
| `tempo_continuous` | Непрерывный темп/порог |
| `threshold_subthreshold_intervals` | Интервалы порог/ниже порога |
| `vo2_short_candidate` | Короткие VO2-кандидаты |
| `race_specific` | Старт-специфика |
| `pre_race_activation` | Предстартовая активация |
| `race_week_sharpening` | Подводка / race week |
| `beginner_run_walk` | Бег/ходьба |
| `strength`, `cross_training`, `rest`, `other_unknown` | Вне беговой методологии |

Quality-like семейства: tempo, threshold intervals, vo2, race_specific, race_week_sharpening.

### Каталог шаблонов (`workout-template-catalog.ts`)

Семейства `WORKOUT_TEMPLATE_FAMILY_CODES`:

- `beginner_run_walk` — отдельный scope
- `easy` — лёгкий аэроб
- `long_run` — длительный (включая `marathon_specific` variant)
- `steady_tempo` — темповый непрерывный
- `intervals` — интервалы (controlled_threshold, vo2 и др.)
- `race_specific` — 10K / HM / marathon pace
- `pre_race` — предстартовая активация
- `race_week` — соревновательная неделя / подводка
- `optional_development` — опциональное развитие

**Strength** вынесен в отдельный WIP-трек и в этот документ не входит.

### Baseline v2 week tags

Недели помечаются тегами: `normal_training`, `race_week`, `taper_week`, `post_race_recovery`, `marathon_specific_block`, `illness_low_volume`, `low_data`. Только `normal_training` идёт в normal baseline.

### Эмпирическая таксономия (отчёт 20260603-130837)

По ~19k тренировок / 102 атлета за год:

- **easy** — по ключевым словам, continuous
- **long_run** — 75–120+ min buckets
- **threshold_intervals** — топ: 5×5, 6×5, 6×4, 5×4, 8×4, 4×8, 6×6
- **vo2_short** — топ: 10×2, 6×3, 7×3, 20×1, 8×3
- **race_specific** — мало данных (4×2 km → 10K)
- Recovery — не отдельное семейство, а модификатор easy/rest/load reduction

## 5. Quality workout methodology

### Концепции

- **`QualityIntent`** — зачем quality-сессия: VO2, controlled below threshold, threshold tempo.
- **`QualityWorkoutKey`** — конкретная предустановленная структура из каталога.
- **`QualityStructure`** — warmup + repeats (count/work/recovery) + cooldown + total_minutes.

### Текущие intents

| Intent | Ключи в каталоге v0 |
|--------|---------------------|
| `vo2max_intervals` | `vo2_20x1`, `vo2_24x1`, `vo2_15x400`, `vo2_20x90sec`, `vo2_10x2`, `vo2_12x2`, `vo2_6x3`, `vo2_7x3`, `vo2_4x4` |
| `controlled_sub_threshold` | `controlled_3x6` (только reference, не v0 default) |
| `threshold_tempo` | `threshold_tempo_block` (непрерывный блок, progression coach-selected) |

### Draft generator v0 vs broader library

Draft generator использует **меньший v0-каталог** (`plan-quality-methodology-catalog.ts`, 11 ключей). Широкий `workout-template-catalog.ts` содержит десятки preset-ов (threshold 5×4, 6×5, vo2, race-specific и т.д.) — он **не подключён** к draft generator v0.

### Правила выбора quality в v0

**Primary path — `selectNextQualityWorkoutFromProgression`** (commit `8f2f72f`):

Draft generator читает recent quality diagnostic и вызывает selector с `intent: vo2max_intervals`, recent pattern, completion status, fatigue flag, `noRaceGeneralDevelopment`.

Если selector вернул `selectedKey` — draft использует его (структура из каталога).

**Fallback — `selectQualityMethodologyV0`** (если diagnostic недоступен или selector не дал key):

- `quality_count_cap >= 1` и `planned_run_count >= 3`
- нет active illness/injury, нет race context
- legacy path для 20×1 candidate

Иначе — `draft_needs_quality_intent`, без случайного fallback.

### Progression context signals

Для selector (`selectNextQualityWorkoutFromProgression`) и catalog helper (`getNextProgressionCandidates`):

- **repeat** — partial completion, unclear recovery, coach_review_blocker, RPE high
- **regress** — missed workout, illness/pain, very_high RPE, failed controlled effort
- **progress** — completed, RPE low/moderate/unknown, нет blockers
- **no_progression_rule** — unknown pattern или неподдерживаемое семейство

## 6. VO2 / МПК methodology

### Семейство прогрессии `vo2_short_to_long_intervals`

Логическая цепочка (этапы 1→5):

```text
Этап 1: 20×1 / 24×1
Этап 2: 15×400 / 20×1:30
Этап 3: 10×2 / 12×2
Этап 4: 6×3 / 7×3
Этап 5: 4×4
```

### Поведение VO2 progression selector (`selectNextQualityWorkoutFromProgression`)

Реализовано в `plan-quality-progression-selector.ts` (commit `8f2f72f`). Каталог (`getNextProgressionCandidates`) остаётся как metadata/helper; draft использует selector.

| Предыдущая | При `action=progress` | Примечание |
|------------|----------------------|------------|
| `20x1` / `24x1` | `vo2_10x2` | Специальное правило selector (не все catalog candidates) |
| `15x400` / `20x1:30` | следующий по catalog order | `selectProgressionCandidate`: higher stage из `next_preferred_keys`, иначе первый candidate |
| `10x2` | `vo2_6x3` или `vo2_7x3` | Специальное правило: первый из 6×3 / 7×3 по catalog order |
| `12x2` | `vo2_6x3` / `vo2_7x3` | Через catalog progression |
| `6x3` / `7x3` / `4x4` | — | `manual_review` (advanced end-block в v0) |

**Fatigue / partial** → `repeat` (тот же ключ, не progress).

**Missed** → `regress` (`selectedKey: null`, coach должен выбрать шаг назад).

**Unknown pattern** → `manual_review`, без random fallback.

**Advanced end-block** (`vo2_6x3`, `vo2_7x3`, `vo2_4x4`) → `manual_review` в v0.

**Non-VO2 intent** → `manual_review` (selector v0 только для `vo2max_intervals`).

### Методологический принцип VO2

VO2-oriented, но **controlled** — не all-out sprint. Recovery — обязательно easy jog (`recovery_label: easy_jog`).

## 7. Recovery rules between intervals

### VO2 (`vo2max_intervals`)

| Work | Default recovery | Allowed |
|------|------------------|---------|
| 1:00 | 1:00 easy jog | 1:00 |
| 1:30 | 1:30 easy jog | 1:30 |
| 2:00 | **1:30** easy jog (methodology default) | 1:30–2:00 |
| 3:00 | 2:00 easy jog | 2:00 |
| 4:00 | 3:00 easy jog | 3:00 |

Для Anna v0 `vo2_10x2` использует 2:00 recovery (явно разрешённый safe v0 variant), total 55 min.

### Controlled / below threshold (`controlled_sub_threshold`)

- Default: **1:30** easy jog
- Beginner/cautious: **2:00** easy jog
- **3×6 / 3 min recovery — invalid** как deterministic default (hard block в validation)

### Threshold / tempo (`threshold_tempo`)

- 5–8 min intervals: default **2:00**, allowed 1:30 / 2:00 / 2:30
- >8 min blocks: default **2:00**, allowed 2:00–2:30
- **3:00 recovery — не default**

### Методологический принцип

```text
If the athlete needs much more recovery, the intensity is probably too high.
Recovery duration controls intensity; it should not enable overcooking.
```

Если атлету нужно сильно больше recovery, чем правило — скорее всего интенсивность завышена. Recovery контролирует нагрузку, а не служит способом «переварить» слишком жёсткую работу.

## 8. Controlled / below-threshold methodology

### Что есть

- Intent `controlled_sub_threshold` в quality catalog
- Reference entry `controlled_3x6` (3×6 min / 3 min recovery) — **catalog reference only**
- Recovery rules: default 1:30, beginner 2:00
- Guardrail `threshold_numbers_not_vo2_default` — пороговые preset-ы не становятся VO2 без явного coach choice
- В template catalog — семейство `intervals` / variant `controlled_threshold` с preset-ами (5×4, 6×5 и др.), `coachReviewRequired: true`

### Известный gap

- **Нет progression family** для controlled work
- **Нет wired selector** в draft generator — controlled не выбирается автоматически
- **`3×6 / 3 min` отклонён** как v0 default: validation reason `controlled_sub_threshold_6x3_not_allowed_as_v0_default`
- Diagnostic hint для Anna явно предупреждает: generic 3×6 threshold block игнорирует недавний VO2 stimulus 20×1

## 9. Threshold / tempo methodology

### Что есть

- `threshold_tempo_block` — непрерывный 50 min блок (warmup 10 + continuous + cooldown 10), progression coach-selected
- Template catalog: preset-ы `thr_5x4`, `thr_4x5`, `thr_8x4`, `thr_6x5`, `thr_6x6`, `thr_4x9`, `thr_5x7` в family `steady_tempo` / `intervals`
- Recovery rules для 5–8 min и >8 min threshold intervals
- Эмпирика: 5×5, 6×5, 6×4 — самые частые пороговые паттерны

### Что отсутствует

- **Threshold progression family** не реализована (нет `getNextProgressionCandidates` для threshold)
- Draft generator v0 **не назначает** threshold/tempo quality автоматически
- Нет связи «неделя цикла → threshold vs VO2 vs base»

## 10. Easy runs and long runs

### Easy runs

- Роль: объём / аэробная база, поддержка frequency
- Draft: `easy_run`, target «easy / conversational», 70–80% THR в writer
- Rounding: coach-style значения 30, 35, 40, 45, 50, 55, 60, 65, 70 min
- При превышении weekly cap — step down сначала easy, потом quality, потом long

### Long runs

- Роль: недельный объём, аэробная выносливость
- Capped: `long_run_cap_min` из baseline v2 (75-й перцентиль longest run в normal weeks)
- Draft: 90% от long run cap (консервативно)
- Rounding: 75, 80, 85, 90, 95, 100, 105, 110, 115, 120 min
- Coach notes: без hard finish, последние 10–15 min не ускоряться
- **Не phase-aware** — длительность не зависит от weeks-to-race или фазы цикла

## 11. Race-specific / pre-race / taper logic currently present

### Detection / tagging (baseline v2 + classifiers)

- Week tags: `race_week`, `taper_week`, `post_race_recovery`, `marathon_specific_block`
- Race candidates: keyword, events API, distance, pace context
- Classifier keywords: pre_race_activation, race_week_sharpening, race_specific
- Template families: `race_specific` (10K/HM/marathon), `pre_race` (activation), `race_week` (sharpening)

### Guardrails

- `no_vo2_before_priority_race` — VO2 блокируется <5 дней до приоритетного старта
- `marathon_long_coach_only` — марафонская специфическая длительная требует coach review
- Readiness: `race_context_present` → `needs_coach_review`
- Draft generator: `has_race_context` → quality selection blocked

### Что это НЕ делает

Это **в основном detection/tagging/guardrail context**, а не полноценный race-aware planner. Нет автоматического taper schedule, нет weeks-to-race progression, нет выбора race-specific workout в draft generator v0.

## 12. Baseline v2 and load caps

### Plain language

Baseline v2 отвечает на вопрос: «сколько этот атлет реально бегает в нормальных неделях?»

Считается из **completed running** за анализируемое окно. Недели с гонкой, taper, post-race, illness, low data **исключаются** из normal baseline.

### Caps

| Cap | Как считается (normal weeks) |
|-----|------------------------------|
| **frequency_cap** | медиана completed running workouts / week |
| **weekly_minutes_cap** | 75-й перцентиль completed running minutes / week |
| **long_run_cap_min** | 75-й перцентиль longest run minutes |
| **quality_count_cap** | медиана quality sessions / week |

Также считаются: `all_week_baseline` (все недели), `planned_context_baseline` (planned signal), `active_training_window`, `recent_4w_frequency`.

### Planned vs completed gap

- `planned_vs_completed_delta` — разница planned vs completed frequency
- Readiness flag при delta ≥ 1
- Draft guardrail: `no_planned_vs_completed_issue_conflict`

### Race weeks

Race/taper/post-race/marathon_specific недели excluded из normal baseline, но сохраняются как context для readiness и coach review.

## 13. Readiness / safety / guardrails

### Readiness blocking reasons

- `active_illness`, `active_pain_injury`
- `device_upload_issue`
- `no_reliable_completed_data` (< 4 normal training weeks)

### Readiness review reasons (не блокируют, но требуют coach)

- low confidence baseline, baseline needs_review
- return monitoring, operational signal requires coach close
- race context present
- coach target differs from completed baseline
- planned vs completed frequency delta
- recent status differs from baseline
- active_since limited window, normal vs all window shift
- missing/implausible cap fields

### Draft guardrails

- planned_run_count ≤ frequency_cap
- planned_weekly_minutes ≤ weekly_minutes_cap (target 90% cap)
- long_run ≤ long_run_cap (target 90% cap)
- quality_session_count ≤ quality_cap (max 1 in v0)
- no illness/injury, no race context, no device issue, no planned-vs-completed conflict

### Writer guardrails

- missing/invalid quality structure → `writer_preview_needs_manual_review`
- `controlled_3x6` validation fail
- Safety markers: `NO_TP_WRITE`, `PLAN_DRAFT_WRITER_DRY_RUN_V0`

### Template guardrails (seed, DB)

Hard blocks: no_beginner_vo2, hr_chest_only, no_hard_stack, warmup_required_for_quality, threshold_numbers_not_vo2_default, no_vo2_before_priority_race, injury_or_acute_pain_blocks_intensity, insufficient_data_blocks_generation.

Coach review triggers: weekly_minutes +10%, long_run +15min, extra run/quality session, any VO2, any race-specific, marathon specific long.

### No real write yet

Вся цепочка — draft-only + dry-run. Реальная запись в TrainingPeaks не выполняется.

## 14. How Anna Kruglova case currently works

**Athlete:** Anna Kruglova, athlete_id `5905779`, student_id `5f5d400d-6024-4ba4-b6ae-6bbe3a679862`.

### Recent workout diagnostic (20260606-115025)

- Window: 2026-05-12 — 2026-06-08
- Last quality: 2026-06-03, title «20 х 1 мин (восстановление бегом)»
- `found_20x1min_candidate: true`
- Estimated type: `vo2max_intervals`
- Hint: generic 3×6 threshold block игнорировал бы недавний VO2 stimulus

### Draft (week 2026-06-08)

- Readiness: `ready_for_plan`, no flags
- Baseline: freq=3, weekly=235 min, long=102 min, quality=1, confidence high
- Layout: Tue easy 65 min, Thu quality, Sun long 90 min
- Quality selection:
  - intent: `vo2max_intervals`
  - key: `vo2_10x2`
  - title: `Интервалы 10×2 мин`
  - selection_reason: через selector — `recent_quality_session=20x1; continue_vo2_short_interval_progression; progression_action=progress; maintain_controlled_non_all_out_execution`
  - structure: 10 + 10×(2/2) + 5 = 55 min
- **Нет invented 3×6** — controlled_3x6 не используется

### Writer dry-run (20260606-122544)

- `writer_status: writer_dry_run_ready_for_review`
- **3 payloads**, все `preview_create`, 0 manual review
- Маркеры: `NO_TP_WRITE`
- Quality mapped: warmup 10min + 10×(2min strong / 2min easy jog) + cooldown 5min
- Safety: no TP mutations, no DB writes, no Telegram

## 15. What is empirical vs what is hard-coded methodology

### Empirical / observed

| Источник | Что дало |
|----------|----------|
| Workout name taxonomy reports | Частоты паттернов (5×5, 10×2, 20×1), family recommendations |
| Methodology extraction reports | Clusters по easy/long/threshold/VO2, title-description mismatches |
| Methodology coverage | 99 athletes, data gaps (coachComments, structure, TSS) |
| Baseline v1/v2 historical classification | Week tags, caps, race candidates из реальных TP данных |
| Anna diagnostic report | Конкретный 20×1 signal для progression decision |

### Hard-coded / explicit methodology

| Источник | Что зафиксировано |
|----------|-------------------|
| `plan-quality-methodology-catalog.ts` | Quality intents, structures, VO2 progression metadata, recovery rules, validation |
| `plan-quality-progression-selector.ts` | Детерминированный VO2 progression selector для draft generator |
| `seed-workout-template-guardrails.ts` | Hard blocks и coach review triggers |
| `workout-template-catalog.ts` | Preset library, families, intensity intents |
| Draft generator rounding tables | Coach-style duration steps |
| Writer validation | Structure checks, 6×3 block for controlled |

## 16. Known gaps

- Нет единого документа периодизации (этот файл — первый consolidated snapshot)
- Нет `TrainingPhase` / `Mesocycle` engine
- Нет памяти cycle start/end / week number in block
- Нет race-aware planner (taper schedule, weeks-to-race)
- Нет threshold progression family
- Нет controlled progression family
- Нет deload/absorption engine в draft generator
- Broader `workout-template-catalog` не подключён к draft generator v0
- Планирование слишком week-by-week
- Selector v0 покрывает только VO2 intent; controlled/threshold progression families отсутствуют
- Selector пока завязан на hardcoded Anna diagnostic path для recent pattern
- Long runs и easy не phase-aware
- Real TP write path не реализован (by design, safety)
- Methodology cache gaps: coachComments, structure, TSS в snapshot

## 17. Questions for periodization research

Вопросы для Claude app / research review:

1. Как должна выглядеть **Igor-style phase taxonomy** (base / build / specific / taper / recovery / general development)?
2. Как структурировать **4–8 week blocks** для recreational runners с 2–4 quality / week caps?
3. Как выбирать **VO2 vs threshold vs base vs race-specific** внутри блока — по weeks-to-race или по адаптации?
4. Как реализовать **reverse periodization** для зимы / low-volume / снег (VO2 indoor → base outdoor)?
5. Как планировать под **10K / half / marathon** от weeks-to-race — разные phase lengths?
6. **Когда deload** — по календарю (каждые 3–4 недели), по RPE/compliance, или по planned-vs-completed gap?
7. Как обрабатывать **no-race general development** — rotation VO2/threshold/base без race anchor?
8. Как безопасно планировать **post-illness return** — отдельная micro-phase или regress в progression family?
9. Как избежать **overfitting к одному атлету** (Anna 20×1 → 10×2) при масштабировании на roster?
10. Нужен ли отдельный **absorption week** после VO2 block перед threshold?
11. Как связать baseline caps с **progressive overload** внутри mesocycle, не только с weekly ceiling?
12. Когда marathon_specific_block tag должен **влиять на plan content**, а не только exclude из baseline?

## 18. Recommended file bundle for Claude app

Для углублённого review приложить:

**Этот summary:**
- `tools/trainingpeaks-export/docs/coach-os-running-methodology-current-state-2026-06-06.md`

**Core planning / methodology code:**
- `tools/trainingpeaks-export/scripts/lib/plan-quality-methodology-catalog.ts`
- `tools/trainingpeaks-export/scripts/lib/plan-quality-progression-selector.ts`
- `tools/trainingpeaks-export/scripts/tp-plan-draft-generator-v0.ts`
- `tools/trainingpeaks-export/scripts/tp-plan-writer-dry-run-v0.ts`
- `tools/trainingpeaks-export/scripts/tp-plan-readiness-dry-run.ts`
- `tools/trainingpeaks-export/scripts/tp-plan-quality-methodology-checks-v0.ts`
- `tools/trainingpeaks-export/scripts/lib/recent-workout-quality-diagnostic.ts`

**Template / guardrail system:**
- `src/features/trainingpeaks/workout-template-catalog.ts`
- `scripts/seed-workout-template-guardrails.ts`

**Baseline / classification:**
- `tools/trainingpeaks-export/scripts/lib/athlete-training-baseline-v2.ts`
- `tools/trainingpeaks-export/scripts/lib/athlete-training-baseline.ts`
- `tools/trainingpeaks-export/scripts/lib/workout-name-taxonomy.ts`
- `tools/trainingpeaks-export/scripts/lib/methodology-candidate-extraction.ts`

**Empirical reports (если нужен контекст данных):**
- `reports/workout-name-taxonomy/20260603-130837/template-family-recommendations.md`
- `reports/methodology-extraction/20260603-113604/recommended-template-library-v0.md`
- `reports/methodology-extraction/20260603-113604/combined-extraction-report.md`
- `reports/methodology-coverage/20260603-105710/coverage-summary.md`
- `reports/anna-recent-workout-diagnostic-v0/20260606-115025/summary.json`
- `reports/plan-draft-generator-v0/20260606-122541/plan-draft.json`
- `reports/tp-plan-writer-dry-run-v0/20260606-122544/TP-WRITER-DRY-RUN.md`

## 19. Source file index

| Path | Why it matters | Status |
|------|----------------|--------|
| `tools/trainingpeaks-export/scripts/lib/plan-quality-methodology-catalog.ts` | Quality intents, structures, VO2 progression metadata, recovery rules, validation | current |
| `tools/trainingpeaks-export/scripts/lib/plan-quality-progression-selector.ts` | Детерминированный VO2 progression selector (`selectNextQualityWorkoutFromProgression`) | current (8f2f72f) |
| `tools/trainingpeaks-export/scripts/tp-plan-draft-generator-v0.ts` | Weekly draft-only generator, caps, rounding, quality hook | current |
| `tools/trainingpeaks-export/scripts/tp-plan-quality-methodology-checks-v0.ts` | Focused checks: Anna 20×1→10×2, recovery, 6×3 block | current |
| `tools/trainingpeaks-export/scripts/lib/recent-workout-quality-diagnostic.ts` | Parse recent TP workouts, detect 20×1, quality hints | current |
| `tools/trainingpeaks-export/scripts/tp-plan-readiness-dry-run.ts` | Readiness gating before draft | current |
| `tools/trainingpeaks-export/scripts/tp-plan-writer-dry-run-v0.ts` | TP payload preview, writer guard, NO_TP_WRITE | current |
| `src/features/trainingpeaks/workout-template-catalog.ts` | Full template families, presets, intensity intents | current |
| `scripts/seed-workout-template-guardrails.ts` | DB seed for hard blocks and coach review rules | current |
| `scripts/check-workout-template-catalog-invariants.ts` | Catalog invariant checks | current |
| `scripts/check-workout-template-guardrails.ts` | Guardrail seed verification vs DB | current |
| `tools/trainingpeaks-export/scripts/lib/athlete-training-baseline-v2.ts` | Baseline v2 caps, week tags, race context, active window | current |
| `tools/trainingpeaks-export/scripts/lib/athlete-training-baseline.ts` | Workout classification, TrainingFamily, interval patterns | current (untracked in git status) |
| `tools/trainingpeaks-export/scripts/lib/workout-name-taxonomy.ts` | Taxonomy extraction from workout titles | current (untracked) |
| `tools/trainingpeaks-export/scripts/lib/methodology-candidate-extraction.ts` | Cluster-based methodology extraction | current |
| `reports/workout-name-taxonomy/20260603-130837/template-family-recommendations.md` | Empirical family frequencies from 19k workouts | generated |
| `reports/methodology-extraction/20260603-113604/recommended-template-library-v0.md` | Draft template library from clusters | generated |
| `reports/methodology-extraction/20260603-113604/combined-extraction-report.md` | Combined family summary + recommendations | generated |
| `reports/methodology-coverage/20260603-105710/coverage-summary.md` | Cache coverage diagnostic, data gaps | generated |
| `reports/anna-recent-workout-diagnostic-v0/20260606-115025/summary.json` | Anna 20×1 detection for draft | generated |
| `reports/plan-draft-generator-v0/20260606-122541/plan-draft.json` | Anna draft week artifact | generated |
| `reports/tp-plan-writer-dry-run-v0/20260606-122544/TP-WRITER-DRY-RUN.md` | Anna writer preview, 3 payloads | generated |
| `tools/trainingpeaks-export/docs/e-predictor-methodology.md` | E-Predictor (отдельная тема, не running periodization) | optional |
