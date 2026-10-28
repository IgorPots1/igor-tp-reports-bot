/* Хранилище пробной недели в памяти: для check:trial-bot и trial-bot:simulate. */

import type { TrialEventKind, TrialSession, TrialStore, TrialUser } from "@/features/trial-bot/bot";

export function memStore() {
  const users = new Map<number, TrialUser>();
  const sessions = new Map<number, TrialSession[]>();
  const sends = new Set<string>();
  const events: Array<{ id: number; kind: TrialEventKind; meta?: Record<string, unknown> }> = [];
  const blank = (id: number): TrialUser => ({
    telegram_user_id: id, chat_id: id, first_name: null, username: null, first_source: null, last_source: null,
    stage: "intro", test_q: null, answers: {}, health_flag: null, result_type: null, start_rung: null, weekly_runs: null,
    days_pattern: null, week_start: null, test_started_at: null, test_completed_at: null, week_opted_at: null,
    week_declined_at: null, offer4_at: null, day7_at: null, base_requested_at: null, followup8_at: null,
    followup10_at: null, channel_at: null, stopped_at: null, last_action_at: null,
  });
  const store: TrialStore = {
    async getUser(id) { const u = users.get(id); return u ? structuredClone(u) : null; },
    async saveUser(p) { users.set(p.telegram_user_id, { ...(users.get(p.telegram_user_id) ?? blank(p.telegram_user_id)), ...p }); },
    async listScheduled() { return [...users.values()].filter((u) => ["test", "week", "post"].includes(u.stage) && !u.stopped_at).map((u) => structuredClone(u)); },
    async getSessions(id) { return structuredClone(sessions.get(id) ?? []); },
    async replaceSessions(id, rows) { sessions.set(id, structuredClone(rows)); },
    async updateSession(id, idx, p) { const s = (sessions.get(id) ?? []).find((x) => x.idx === idx); if (s) Object.assign(s, p); },
    async claimSend(id, key) { const k = `${id}|${key}`; if (sends.has(k)) return false; sends.add(k); return true; },
    async releaseSend(id, key) { sends.delete(`${id}|${key}`); },
    async logEvent(id, kind, meta) { events.push({ id, kind, meta }); },
  };
  return { store, users, sessions, sends, events };
}
