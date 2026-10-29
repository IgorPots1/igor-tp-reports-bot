/* In-memory store of the free week: for check:en-week and en-week:simulate. Mirrors the unique
 * keys of the real tables: token unique, (user, idx) for sessions, (user, dedupe_key) for events. */

import type { EnWeekSession, EnWeekUser } from "@/features/en-week/model";
import { screenshotPath, type Screenshot } from "@/features/en-week/screenshots";
import type { EnWeekEventKind, EnWeekStore, NewUser } from "@/features/en-week/service";

export type MemEvent = { userId: string | null; kind: EnWeekEventKind; key?: string; meta?: Record<string, unknown> };

export function enWeekMemStore() {
  const users: EnWeekUser[] = [];
  const sessions = new Map<string, EnWeekSession[]>();
  const keys = new Set<string>();
  const events: MemEvent[] = [];
  const shots: Array<Screenshot & { userId: string; bytes: number }> = [];
  let seq = 0;
  const store: EnWeekStore = {
    async findByClient(c) {
      const u = [...users].reverse().find((x) => x.chatplace_client_id === c);
      return u ? structuredClone(u) : null;
    },
    async findByToken(t) {
      const u = users.find((x) => x.token === t);
      return u ? structuredClone(u) : null;
    },
    async insertUser(row: NewUser) {
      if (users.some((x) => x.token === row.token)) throw new Error("token not unique");
      const u: EnWeekUser = { ...structuredClone(row), id: `u${++seq}`, created_at: new Date(seq * 1000).toISOString() };
      users.push(u);
      return structuredClone(u);
    },
    async updateUser(id, patch) {
      const u = users.find((x) => x.id === id);
      if (u) Object.assign(u, structuredClone(patch));
    },
    async getSessions(id) {
      return structuredClone(sessions.get(id) ?? []);
    },
    async saveSessions(id, rows) {
      const cur = sessions.get(id) ?? [];
      for (const r of rows) {
        const i = cur.findIndex((x) => x.idx === r.idx);
        if (i >= 0) cur[i] = structuredClone(r);
        else cur.push(structuredClone(r));
      }
      sessions.set(id, cur.sort((a, b) => a.idx - b.idx));
    },
    async claimKey(id, key, kind, meta) {
      const k = `${id}|${key}`;
      if (keys.has(k)) return false;
      keys.add(k);
      events.push({ userId: id, kind, key, meta });
      return true;
    },
    async logEvent(id, kind, meta) {
      events.push({ userId: id, kind, meta });
    },
    async addScreenshot(userId, idx, image) {
      const id = `s${++seq}`;
      const row = { id, idx, path: screenshotPath(userId, idx, image.ext, id), userId, bytes: image.bytes.length };
      shots.push(row);
      return { id, idx, path: row.path };
    },
    async listScreenshots(userId) {
      return shots.filter((x) => x.userId === userId).map(({ id, idx, path }) => ({ id, idx, path }));
    },
    async deleteScreenshot(userId, id) {
      const i = shots.findIndex((x) => x.userId === userId && x.id === id);
      if (i < 0) return false;
      shots.splice(i, 1);
      return true;
    },
    async signScreenshotUrls(paths) {
      return Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}?token=t`]));
    },
  };
  return { store, users, sessions, events, shots };
}
