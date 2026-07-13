# CLAUDE.md - High-Risk Operating Instructions

This file defines stable Claude Code / Cursor operating instructions for `igor-tp-reports-bot`.

## 1. Project purpose

`igor-tp-reports-bot` powers Igor's coach operating system in real workflows:

- TrainingPeaks reports and automation
- Telegram coach/student workflows
- billing/payment admin
- reminders, digests, and attention signals
- local runner workflows for sensitive TrainingPeaks actions

This is production-like coach infrastructure, not a toy app and not a generic demo repo.

Primary workflow must stay attended:
planning -> task prompt -> Cursor/Claude Code implementation -> checks -> human review -> manual commit/push.

No autonomous high-risk execution.

## 2. Risk level

This is a high-risk repository.

Reasons include:

- real student data
- real Telegram messages
- real billing/payment logic
- real TrainingPeaks plans/actions
- real production integrations
- local secrets and cookies may exist outside git

## 3. Hard safety rules

- Never commit unless explicitly asked.
- Never push unless explicitly asked.
- Never deploy unless explicitly asked.
- Never modify `.env*` files or print secrets.
- Never loosen auth, cron, token, webhook, Telegram, billing, or TrainingPeaks safety checks.
- Never run destructive database operations.
- Never run production migrations unless explicitly requested.
- Never send Telegram messages unless explicitly requested.
- Never perform real TrainingPeaks mutations unless explicitly requested.
- Never change billing/payment allocation logic casually.
- Never broaden automation permissions without explicit approval.
- Never add autonomous execution for high-risk actions.
- Prefer dry-run, read-only, or prepare-only modes when available.

## 4. TrainingPeaks rules

TrainingPeaks mutations are high-risk.

Local Mac runner and browser/API automation must remain guarded. Prefer dry-run and verification-first behavior.

Fingerprints, source date checks, confidence gates, and human confirmation must not be weakened.

Move-workout automation must remain conservative.

If uncertain, ask for clarification or create a review case instead of executing.

Sensitive areas include:

- workout move actions
- source date inference
- TrainingPeaks API calls
- race/event scanner
- weekly report generation
- FIT parsing and segment analysis
- E-Predictor logic

## 5. Telegram rules

Telegram messages may contain private student context.

- Do not add broad group replies.
- Do not send messages automatically unless the task explicitly requires it.
- Do not weaken allowlists or coach-only protections.
- Preserve formality and tone logic when present.
- Prefer coach review before student-facing replies.
- Handle Business DM workflows and topic/group workflows carefully.

## 6. Billing rules

Billing and payment logic is sensitive.

- Do not auto-match payments more aggressively without explicit instruction.
- Do not modify payment allocation, payer identities, monthly payment state, or cron import behavior casually.
- Prefer manual review for ambiguous payments.
- Never print bank or payment secrets.

## 7. Development workflow

Claude/Cursor should:

- keep changes narrow
- inspect current code before editing
- avoid unrelated refactors
- preserve existing contracts
- update focused tests for behavior changes
- run the smallest relevant checks first
- run full checks when risk is high or broad files changed
- report exact files changed and commands run

Default checks:

- `npm run lint`
- `npm run build`

When relevant:

- focused scripts/checks from `package.json`
- focused parser/TrainingPeaks/Billing checks
- TypeScript checks if available
- no real external mutations unless explicitly requested

## 8. Expected report format

Every task report should include:

1. Summary of changes
2. Files changed
3. Behavior before/after
4. Checks run and results
5. Safety confirmation:
   - no secrets touched
   - no push
   - no deploy
   - no unintended Telegram sends
   - no unintended TrainingPeaks mutations
   - no unintended billing imports or allocations
6. Commit hash only if explicitly asked to commit

## 9. What not to build

- no custom multi-agent runtime inside this repo
- no autonomous high-risk TrainingPeaks execution without human approval
- no broad Telegram auto-reply system without review gates
- no aggressive billing auto-matching without manual review
- no hidden background jobs that mutate production state without clear cron/auth guards
- no large dashboard/product expansion unless explicitly requested

## 10. Igor's preferred implementation style

- simple, narrow, production-minded changes
- no big rewrite unless explicitly requested
- avoid clever abstractions
- preserve working flows
- prefer readable code and practical checks
- communicate in clear summaries

## 11. Cowork (Claude desktop) рабочий процесс и контекст

Полная памятка: `docs/cowork-workflow.md`. Кратко:

- **Поток фичи:** Claude делает работу в отдельной ветке + проверки (`npm run lint`, `npx tsc --noEmit`, относящиеся `check-*`). Игорь пушит ветку (Vercel preview) → смотрит → Claude делает fast-forward `main` → Игорь один раз `git push origin main`. Без PR-кликанья. Максимум 2 `git push` от Игоря на фичу.
- **Прод-push и деплой делает только Игорь.** Claude не пушит (нет кредов в песочнице) и не запускает прод-миграции; при необходимости миграции пишет файл в `supabase/migrations/` + команду применить (до деплоя).
- **Obsidian как контекст:** волт «Igor Second Brain» (`~/Library/Mobile Documents/iCloud~md~obsidian/Documents`) можно подключать как папку — Claude читает/ищет по заметкам (теги во фронтматтере, папки Agent-Hub / AI-Running-Coach / Ученики / Inbox) и складывает итоги задач туда же в том же формате (`ГГГГ-ММ-ДД - превью - хэш.md`, фронтматтер `type/source/category/tags`). Dev-summary по этому репозиторию → папка `Agent-Hub`.
- **Координация с Cursor:** пока активна сессия Claude, не давать Cursor делать git-операции (коммиты/checkout) — общий рабочий каталог, чужие коммиты «прилипают» к веткам Claude.

## 12. Git-протокол репозитория (СТРОГО — ветки не смешивать)

Одна задача = одна ветка = один worktree. Никогда не смешивать несвязанные
задачи в одной ветке.

- НИКОГДА `git add -A` / `git add .`. Только точечно свои файлы: `git add <пути>`.
  Перед каждым commit — `git status`; изменения не своей задачи НЕ добавлять.
- Старт задачи: ветвиться от свежего origin/main —
  `git fetch origin && git worktree add ../wt-<task> -b feature/<task> origin/main`
  (worktree в ~/, НЕ в /tmp). В начале назвать вслух: "Ветка: feature/<task>, worktree: <path>".
- ГДЕ ЛЕЖИТ main — выяснять КАЖДЫЙ РАЗ через `git worktree list` (искать строку с
  `[main]`) и делать все операции с main (checkout/merge/pull) ИМЕННО В ТОЙ папке.
  НЕ полагаться на путь из этого документа или из наряда: main переезжает между
  worktree, а текст устаревает молча. На 2026-07-14 main выгружен в
  /Users/igor/igor-tp-reports-bot; раньше он был в /Users/igor/igor-run-analysis, и
  та папка теперь в detached HEAD. Эта дата — не гарантия, а отметка: сверяйся с git.
  СИМПТОМ ПРОМАХА: `git merge --ff-only <branch>` в папке с detached HEAD проходит
  «успешно», но main не двигается — коммит тихо остаётся невлитым.
- Если оказался на чужой ветке или коммиты смешались — СТОП, показать
  `git log --oneline -10`, `git status`, `git branch --show-current`, спросить Игоря.
  НЕ делать reset --hard / rebase / merge между несвязанными ветками без явного
  подтверждения Игоря в текущем сообщении.
- "Доделай / влей / смёржи" = Claude выполняет САМ: commit в feature-ветке →
  checkout/merge в папке где main → нужные коммиты → и ОСТАНАВЛИВАЕТСЯ перед push.
  Показывает branch/log/status. Push и деплой — ТОЛЬКО по явной команде Игоря "пушь".
- ФАКТ ВЛИТИЯ ПОДТВЕРЖДАТЬ ЧЕРЕЗ `git cherry`, не «на глаз» и не по своему отчёту:
  `git cherry main <branch>` — пусто = все патчи ветки уже в main;
  `git cherry origin/main <branch>` — пусто = коммит реально ушёл пушем.
  Именно patch-equivalence, а НЕ `git rev-list --count main..branch`: счётчик предков
  врёт, когда патч попал в main через cherry-pick/rebase (хэш другой, содержимое то же).
  Правило уже трижды ловило тихую потерю: «влил в detached HEAD, main не сдвинулся»,
  «ветка на самом деле давно в main», «коммит не дошёл до origin».
- Перед ВЛИТИЕМ, а не только перед стартом, — `git fetch origin` и проверить, не уехал
  ли main вперёд (параллельные сессии вливаются в него на ходу). Если уехал: rebase
  своей ветки на свежий origin/main и ПЕРЕГНАТЬ проверки на объединённом коде —
  зелёные чеки на старой базе ничего не доказывают.

### Параллельные сессии (агентов несколько, репозиторий один)

Над репозиторием одновременно работают несколько агентов. Они коммитят в main, пока
идёт твой наряд. Исходить из того, что мир вокруг ветки СТОИТ, — нельзя.

ПРИЧИНА, ПОЧЕМУ ЭТО ЗАПИСАНО (одна сессия, 13–14.07): main сдвинулся 5 РАЗ по ходу
работы; один коммит был влит в detached HEAD, потому что агент пошёл по устаревшему
п.12 вместо `git worktree list`, и main не сдвинулся вообще; ещё один коммит целиком
ушёл в мусор как дубль — два агента независимо починили один и тот же баг.

- ОДИН УЗЕЛ КОДА — ОДНА СЕССИЯ. Не браться за задачу или файл, который может делать
  другой агент. Если наряд задевает чужой узел — сказать Игорю, а не «заодно поправить».
- ПЕРЕД СТАРТОМ наряда — `git log origin/main` (и `--oneline -15`): свериться, что
  задача ещё НЕ СДЕЛАНА. Цена пропуска: за одну сессию целый коммит ушёл в мусор как
  дубль — два агента независимо починили один и тот же баг.
- ПЕРЕД ВЛИТИЕМ — `git worktree list` (где реально [main]; документ устаревает) и
  `git cherry -v main <branch>` (применён ли ПАТЧ, а не «предок ли коммит»).
- `git diff main..branch` — ДВЕ точки: показывает, что реально уедет в main.
  НЕ три точки. `git diff main...branch` показывает, что ветка сделала ОТ ТОЧКИ
  РАСХОЖДЕНИЯ, — то есть её собственную историю, а не разницу с нынешним main.
  На этом легко обмануться: превзойдённая ветка, чья работа давно влита другим
  агентом, в три точки выглядит «уникальной». В две точки сразу видно обратное —
  что она ОТСТАЁТ от main и влитие СНЕСЛО БЫ более позднюю работу.
- ПОСЛЕ ВЛИТИЯ И ПУША — подтвердить ФАКТОМ, а не отчётом: `git fetch origin` и
  `git cherry origin/main <branch>` пуст = коммит реально в origin/main. Пока не
  подтверждено — задача не закрыта.
- Если в main появились коммиты, которых ты не делал, — НЕ считать их «чужой работой»
  и не действовать молча: показать Игорю (`git log --format='%h %an %ad · %s'`) и
  спросить. Они могут быть согласованными частями твоих же задач.
