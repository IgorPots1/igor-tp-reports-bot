---
name: feedback-cowork-worker
description: |
  Igor's workout-feedback draft writer. Generate short Telegram replies to athletes
  about their just-completed run, in Igor's voice, on the subscription (not the paid
  API) — for jobs waiting in his queue (Supabase project igor-agent-hub). The
  deterministic planner already decided WHAT to say for each job; you only voice it.
  Drafts go to Igor's Mini App «Отчёты» for review — you NEVER message an athlete.

  Trigger on any of these, in Russian or English:
  - «сгенерь/сделай черновики фидбека», «разбери тренировки в очереди», «ответы по тренировкам»
  - «прогони очередь фидбека», «сделай черновики на своих токенах»
  - a request to draft workout replies for review (not to send them)

  Runs on the subscription. Writes go through a server fact-check (never the DB directly).

  Do NOT use for: nutrition reviews (that's nutrition-weekly-report), race/plan analysis,
  messaging athletes, or anything that sends to a student. This only fills the draft queue.
---

# Workout-feedback draft worker (Igor's voice, review-only)

## What this is and why it exists

Igor coaches runners. After a run is analysed, a deterministic planner writes a
**context packet** — WHAT to say about that workout (praise / a gentle correction /
a question / a comparison-vs-past), plus the voice rules and few-shot examples — and
drops a **job** in a queue. Your job is to turn each packet into the actual short
message **in Igor's voice**. Igor then reads every draft in his Mini App «Отчёты»
tab, edits if needed, and sends it himself. You never send anything.

Two hard boundaries make this safe:
- **You don't decide praise vs correction.** The packet already decided. You follow
  the prompt; you don't re-judge the workout.
- **You never write to the database.** Every draft goes back through `submit`, which
  runs a server-side fact-check. A draft that cites a forbidden number or the wrong
  gender is rejected there — so it can't reach the review tab looking finished.

## Golden rules (read before every run)

1. **Follow the returned prompt EXACTLY.** Each job's `prompt` already contains the
   voice rules, the few-shots, the observations (WHAT to say), and the comparison
   block. Voice it — don't add topics it didn't ask for.
2. **Numbers: only from the «Сравнение с прошлым» block.** Never invent a number and
   never cite this workout's absolute pace/HR/distance (the athlete already sees those
   in the app). The server fact-check FAILS any draft with a stray number.
3. **Return ONLY the message text** — exactly what the athlete would receive. No
   preamble, no quotes, no "Черновик:", no explanation around it.
4. **Gender and register (ты/вы) exactly as the prompt says.** A wrong-gender verb
   also fails the fact-check.
5. **Submit EVERY draft through `submit`.** Never write to Supabase directly, even if
   you have a connector — that would bypass the fact-check.
6. **End with a coach note for Igor** (not just silence): how many done, how many
   failed, and the reason for each failure.

## Config lives OUTSIDE this skill (secret must stay local)

The CLI reads its URL and secret from a **local file, NOT from this skill folder**:
`~/.tp-reports-bot/feedback-worker.env` (same place as the TP session snapshot).
This is deliberate — **this skill is registered to the cloud, so nothing secret may
sit inside it.** Never create a `worker.env` (or paste the secret) inside the skill:
it would sync to claude.ai on registration. See `references/setup.md`. If the file is
missing, the CLI stops with a clear "create ~/.tp-reports-bot/feedback-worker.env" error.

## The run (exact steps)

The CLI lives at `scripts/feedback_worker.py`.

1. **Claim a batch:**
   ```
   python scripts/feedback_worker.py claim --limit 5
   ```
   Read the JSON on stdout: `jobs` is a list of `{ jobId, prompt, sessionType, workoutDate }`.
   If `jobs` is empty → tell Igor the queue is empty and stop.

2. **For each job, in order:**
   - Read its `prompt`.
   - Write the draft in Igor's voice, following the prompt (rules 1–4 above).
   - Save the draft to a temp file, e.g. `draft.txt` (plain text, nothing else).
   - Submit it:
     ```
     python scripts/feedback_worker.py submit --job <jobId> --text-file draft.txt
     ```
   - If the result is `"status": "failed"`, read `reason`. You may **retry ONCE** with a
     corrected draft (most failures are a stray number or a gender slip). If it fails
     again, leave it — it stays `failed` for Igor to look at; move on.

3. **After the batch** — write the coach note:
   > Готово: N черновиков. Провалов: M (если есть — по каждому: ученик/тип + причина).
   > Смотри в Mini App «Отчёты».

## Batch size and repeats

`--limit` defaults to 5 (the server caps it at 10). To do more, run `claim` again —
it hands out the **next** pending jobs, never the same ones twice. Keep it to a couple
of passes per sitting so you stay under subscription limits.

## If you stop mid-batch (crash / interruption)

Jobs you claimed but didn't submit sit in `generating`. That's fine: the next `claim`
automatically returns any job idle longer than ~15 minutes back to `pending`, so it
gets generated next time. Nothing is lost, and nothing is duplicated (two runs never
claim the same job).

## What you must never do

- Never send a message to an athlete. This skill only fills the draft queue; sending
  is Igor's manual tap in the Mini App, behind a separate kill-switch.
- Never write drafts straight into Supabase. Always go through `submit`.
- Never invent numbers or facts, and never change what the packet decided to say.
