/* Хранилище бота «Забеги России» в памяти: для check:races-bot и прогона сценариев
 * (scripts/races-bot-scenarios.ts). Ведёт себя как supabaseStore, включая защиту от повторов. */

import type { BotFollow, BotStore, BotUser } from "@/features/races-bot/bot";
import { computeBotStats, type StatEvent } from "@/features/races-bot/stats";

export function memStore(kit: { now: () => Date; announced: Map<string, string>; clock?: () => number }): BotStore & { users: Map<number, BotUser>; follows: BotFollow[]; sends: { tg_id: number; kind: string; race_id: string | null }[]; config: Map<string, string>; events: StatEvent[]; seen: Map<string, number> } {
  const events: StatEvent[] = [];
  const watches: { id: number; tg_id: number; expected_id: string; notified_at: string | null }[] = [];
  const users = new Map<number, BotUser>();
  const follows: BotFollow[] = [];
  const sends: { tg_id: number; kind: string; race_id: string | null }[] = [];
  const config = new Map<string, string>();
  const blank = (tg_id: number): BotUser => ({
    tg_id, first_name: null, username: null, city: null, types: [], distances: [], digest_on: false, digest_every_weeks: 1,
    digest_last_at: null, paused_until: null, tz: "Europe/Moscow", source: null, state: null, consult_offered_at: null,
    consult_requested_at: null, blocked: false, created_at: "2026-10-01T00:00:00Z",
  });
  const seen = new Map<string, number>();
  const clock = kit.clock ?? (() => Date.now());
  return {
    users, follows, sends, config, events, seen,
    // Как race_bot_seen_once: true — ключ новый или старше окна; false — повтор в окне.
    async seenOnce(key, windowSec) {
      const t = clock();
      const at = seen.get(key);
      if (at !== undefined && t - at < windowSec * 1000) return false;
      seen.set(key, t);
      return true;
    },
    async pruneSeen() {
      const t = clock();
      for (const [k, at] of seen) if (t - at > 3 * 864e5) seen.delete(k);
    },
    async getUser(id) { return users.get(id) ?? null; },
    async saveUser(p) { const u = { ...(users.get(p.tg_id) ?? blank(p.tg_id)), ...p }; users.set(p.tg_id, u); return u; },
    async deleteUser(id) {
      users.delete(id);
      for (let i = follows.length - 1; i >= 0; i--) if (follows[i].tg_id === id) follows.splice(i, 1);
      for (let i = sends.length - 1; i >= 0; i--) if (sends[i].tg_id === id) sends.splice(i, 1);
      for (let i = events.length - 1; i >= 0; i--) if (events[i].tg_id === id) events.splice(i, 1);
    },
    async listFollows(id) { return follows.filter((f) => f.tg_id === id); },
    async addFollow(id, r) {
      if (!follows.some((f) => f.tg_id === id && f.race_id === r.id)) {
        follows.push({ tg_id: id, race_id: r.id, race_name: r.name, race_date: r.ds, race_end: r.de, race_city: r.city, created_at: kit.now().toISOString() });
      }
    },
    async removeFollow(id, rid) { const i = follows.findIndex((f) => f.tg_id === id && f.race_id === rid); if (i >= 0) follows.splice(i, 1); },
    async removeAllFollows(id) { for (let i = follows.length - 1; i >= 0; i--) if (follows[i].tg_id === id) follows.splice(i, 1); },
    async getConfig(k) { return config.get(k) ?? null; },
    async setConfig(k, v) { config.set(k, v); },
    async claimSend(id, kind, rid) {
      if (rid !== null && sends.some((s) => s.tg_id === id && s.kind === kind && s.race_id === rid)) return false;
      sends.push({ tg_id: id, kind, race_id: rid });
      return true;
    },
    async releaseSend(id, kind, rid) { const i = sends.findIndex((s) => s.tg_id === id && s.kind === kind && s.race_id === rid); if (i >= 0) sends.splice(i, 1); },
    async listActiveUsers() { return [...users.values()].filter((u) => !u.blocked); },
    async listAllFollows() { return [...follows]; },
    async listSentKeys() {
      const m = new Map<number, Set<string>>();
      for (const s of sends) if (s.race_id) { if (!m.has(s.tg_id)) m.set(s.tg_id, new Set()); m.get(s.tg_id)!.add(`${s.kind}:${s.race_id}`); }
      return m;
    },
    async logEvent(tg, event, opts) {
      events.push({ tg_id: tg, event, race_id: opts?.raceId ?? null, source: opts?.source ?? null, meta: opts?.meta ?? {}, created_at: kit.now().toISOString() });
    },
    async addExpectedWatch(tg, eid) { if (!watches.some((w) => w.tg_id === tg && w.expected_id === eid)) watches.push({ id: watches.length + 1, tg_id: tg, expected_id: eid, notified_at: null }); },
    async listExpectedWatches(tg) { return watches.filter((w) => w.tg_id === tg && !w.notified_at).map((w) => w.expected_id); },
    async listDueAnnouncements() {
      return watches.filter((w) => !w.notified_at && kit.announced.has(w.expected_id)).map((w) => ({ id: w.id, tg_id: w.tg_id, expected_id: w.expected_id, race_id: kit.announced.get(w.expected_id)! }));
    },
    async markWatchNotified(id) { const w = watches.find((x) => x.id === id); if (w) w.notified_at = kit.now().toISOString(); },
    async loadStats(period, now) {
      const coach = config.get("coach_chat_id");
      const exclude = new Set<number>([...(coach ? [Number(coach)] : []), ...(config.get("stats_exclude") || "").split(",").filter(Boolean).map(Number)]);
      return computeBotStats({
        exclude,
        users: [...users.values()].map((u) => ({ tg_id: u.tg_id, first_name: u.first_name, username: u.username, city: u.city, source: u.source, created_at: u.created_at, blocked: u.blocked })),
        events, follows: follows.map((f) => ({ tg_id: f.tg_id, race_id: f.race_id, race_name: f.race_name, race_city: f.race_city, created_at: f.created_at })), now, period,
      });
    },
  };
}

