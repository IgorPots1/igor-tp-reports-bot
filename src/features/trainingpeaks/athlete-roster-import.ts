// Relative .ts import (not the @/ alias) so this module is resolvable under bare
// `node --experimental-strip-types` in unit tests, which does not honor tsconfig
// path aliases. This module is pulled into tp-api-client.ts's graph, which IS tested.
import { normalizeTrainingPeaksStudentId } from "../../lib/trainingpeaks-student-id.ts";

/**
 * Pure TrainingPeaks roster-import engine.
 *
 * Extracted from tools/trainingpeaks-export/scripts/tp-import-athletes.ts so the
 * exact same diff logic backs BOTH the local CLI importer and the live "Sync from
 * TrainingPeaks" admin button. This module has NO I/O: no Supabase, no fetch, no
 * filesystem -- callers supply the discovered roster and the existing students,
 * and get back a plan describing what WOULD be inserted (and why the rest is skipped).
 *
 * Insert-only by design: buildImportPlan never proposes updates or archives. The
 * would_insert rows are the only thing a caller should act on; everything else
 * (already_exists, archived_existing, slug_collisions, name_warnings,
 * supabase_not_in_tp) is informational.
 *
 * Boundary rule: src/ must not import from the tools/ Playwright subproject, so
 * this lives in src/ and the tools CLI imports it (tools -> src is allowed).
 */

const SAMPLE_WOULD_INSERT_LIMIT = 15;

// ─── roster parsing (GET /users/v3/user -> user.athletes[]) ──────────────────

export type DiscoveredAthlete = {
  athleteId: number;
  displayName: string;
  trainingpeaksAthleteUrl: string;
  source: string;
};

/** Minimal shape of an existing Supabase student row the diff engine reads. */
export type ExistingStudentRowForImport = {
  id: string;
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_url: string;
  archived_at: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildAthleteUrl(athleteId: number): string {
  return `https://app.trainingpeaks.com/#calendar/athletes/${athleteId}`;
}

function pickRosterDisplayName(record: Record<string, unknown>): { displayName: string; usedFallback: boolean } {
  const fullName = readString(record.fullName ?? record.full_name ?? record.FullName);
  if (fullName) {
    return { displayName: fullName, usedFallback: false };
  }

  const firstName = readString(record.firstName ?? record.first_name ?? record.FirstName);
  const lastName = readString(record.lastName ?? record.last_name ?? record.LastName);
  if (firstName && lastName) {
    return { displayName: `${firstName} ${lastName}`.trim(), usedFallback: false };
  }
  if (firstName) {
    return { displayName: firstName, usedFallback: false };
  }
  if (lastName) {
    return { displayName: lastName, usedFallback: false };
  }

  return { displayName: "", usedFallback: true };
}

/**
 * Extracts the coached-athlete roster from a GET /users/v3/user response body.
 * Mirrors the proven extraction in tp-discover-athletes.ts (item path
 * `user.athletes`, name priority fullName -> first+last -> first -> last ->
 * `Athlete {id}`), deduped by athleteId and sorted by display name.
 *
 * Returns [] for a legitimately empty roster (`user.athletes: []`). Throws for a
 * structurally wrong body (missing `user`, or `user.athletes` not an array) so a
 * silent TP contract change is loud, not an empty import.
 */
export function extractRosterFromUsersV3Body(body: unknown): DiscoveredAthlete[] {
  const user = isRecord(body) && isRecord(body.user) ? body.user : null;
  if (!user) {
    throw new Error("users/v3/user response missing `user` object.");
  }
  if (!Array.isArray(user.athletes)) {
    throw new Error("users/v3/user response missing `user.athletes` array.");
  }

  const byId = new Map<number, DiscoveredAthlete>();
  for (const item of user.athletes) {
    if (!isRecord(item)) continue;
    const athleteId = readPositiveInt(item.athleteId);
    if (!athleteId) continue;

    const { displayName, usedFallback } = pickRosterDisplayName(item);
    byId.set(athleteId, {
      athleteId,
      displayName: usedFallback ? `Athlete ${athleteId}` : displayName,
      trainingpeaksAthleteUrl: buildAthleteUrl(athleteId),
      source: "users_v3_user",
    });
  }

  return [...byId.values()].sort(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.athleteId - b.athleteId,
  );
}

// ─── diff plan types ─────────────────────────────────────────────────────────

export type WouldInsertRow = {
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_url: string;
  athlete_id: number;
  base_slug: string;
  slug_suffix: number | null;
};

export type AlreadyExistsRow = {
  athlete_id: number;
  display_name: string;
  trainingpeaks_athlete_url: string;
  existing_student_id: string;
  existing_student_name: string;
  match_by: "athlete_id" | "trainingpeaks_athlete_url" | "student_id";
  archived: boolean;
};

export type ArchivedExistingRow = AlreadyExistsRow;

export type SlugCollisionRow = {
  athlete_id: number;
  display_name: string;
  base_slug: string;
  resolved_student_id: string;
  conflicting_existing_student_id: string;
};

export type NameWarningRow = {
  athlete_id: number;
  display_name: string;
  existing_student_id: string;
  existing_student_name: string;
  existing_athlete_id: number | null;
};

export type SupabaseNotInTpRow = {
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_url: string;
  athlete_id: number | null;
  archived: boolean;
};

export type ImportPlan = {
  summary: {
    discovered_total: number;
    existing_total: number;
    already_exists: number;
    would_insert: number;
    slug_collisions: number;
    name_warnings: number;
    archived_existing: number;
    supabase_not_in_tp: number;
    inserted?: number;
    insert_errors?: number;
  };
  already_exists: AlreadyExistsRow[];
  archived_existing: ArchivedExistingRow[];
  would_insert: WouldInsertRow[];
  slug_collisions: SlugCollisionRow[];
  name_warnings: NameWarningRow[];
  supabase_not_in_tp: SupabaseNotInTpRow[];
  would_insert_sample: WouldInsertRow[];
};

// ─── diff helpers ────────────────────────────────────────────────────────────

export function parseAthleteIdFromUrl(value: string): number | null {
  const match = value.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function normalizeDisplayName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildBaseSlug(displayName: string, athleteId: number): string {
  const slug = normalizeTrainingPeaksStudentId(displayName);
  if (slug) return slug;
  return `athlete-${athleteId}`;
}

type SlugOwner = {
  athleteId: number;
  studentId: string;
  source: "existing" | "planned";
};

export function resolveUniqueSlug(
  baseSlug: string,
  athleteId: number,
  displayName: string,
  takenSlugs: Map<string, SlugOwner>,
): { studentId: string; suffix: number | null; collision: SlugCollisionRow | null } {
  const owner = takenSlugs.get(baseSlug);
  if (!owner || owner.athleteId === athleteId) {
    return { studentId: baseSlug, suffix: null, collision: null };
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseSlug}-${suffix}`;
    const candidateOwner = takenSlugs.get(candidate);
    if (!candidateOwner || candidateOwner.athleteId === athleteId) {
      return {
        studentId: candidate,
        suffix,
        collision: {
          athlete_id: athleteId,
          display_name: displayName,
          base_slug: baseSlug,
          resolved_student_id: candidate,
          conflicting_existing_student_id: owner.studentId,
        },
      };
    }
    suffix += 1;
  }

  throw new Error(`Could not resolve unique slug for athlete ${athleteId} (base: ${baseSlug})`);
}

export function findExistingMatch(
  athlete: DiscoveredAthlete,
  indexes: {
    byAthleteId: Map<number, ExistingStudentRowForImport>;
    byUrl: Map<string, ExistingStudentRowForImport>;
    byStudentId: Map<string, ExistingStudentRowForImport>;
  },
): { row: ExistingStudentRowForImport; matchBy: AlreadyExistsRow["match_by"] } | null {
  const byId = indexes.byAthleteId.get(athlete.athleteId);
  if (byId) {
    return { row: byId, matchBy: "athlete_id" };
  }

  const byUrl = indexes.byUrl.get(normalizeUrl(athlete.trainingpeaksAthleteUrl));
  if (byUrl) {
    return { row: byUrl, matchBy: "trainingpeaks_athlete_url" };
  }

  const baseSlug = buildBaseSlug(athlete.displayName, athlete.athleteId);
  const bySlug = indexes.byStudentId.get(baseSlug);
  if (bySlug) {
    return { row: bySlug, matchBy: "student_id" };
  }

  return null;
}

export function buildExistingIndexes(rows: ExistingStudentRowForImport[]): {
  byAthleteId: Map<number, ExistingStudentRowForImport>;
  byUrl: Map<string, ExistingStudentRowForImport>;
  byStudentId: Map<string, ExistingStudentRowForImport>;
  byNormalizedName: Map<string, ExistingStudentRowForImport[]>;
} {
  const byAthleteId = new Map<number, ExistingStudentRowForImport>();
  const byUrl = new Map<string, ExistingStudentRowForImport>();
  const byStudentId = new Map<string, ExistingStudentRowForImport>();
  const byNormalizedName = new Map<string, ExistingStudentRowForImport[]>();

  for (const row of rows) {
    const athleteId = parseAthleteIdFromUrl(row.trainingpeaks_athlete_url);
    if (athleteId) {
      byAthleteId.set(athleteId, row);
    }
    byUrl.set(normalizeUrl(row.trainingpeaks_athlete_url), row);
    byStudentId.set(row.student_id, row);

    const normalizedName = normalizeDisplayName(row.student_name);
    const bucket = byNormalizedName.get(normalizedName) ?? [];
    bucket.push(row);
    byNormalizedName.set(normalizedName, bucket);
  }

  return { byAthleteId, byUrl, byStudentId, byNormalizedName };
}

/**
 * Diffs the discovered TP roster against existing Supabase students. Pure: no I/O.
 * Insert-only -- would_insert is the only actionable output.
 */
export function buildImportPlan(
  discovered: DiscoveredAthlete[],
  existing: ExistingStudentRowForImport[],
): ImportPlan {
  const indexes = buildExistingIndexes(existing);
  const matchedExistingIds = new Set<string>();

  const alreadyExists: AlreadyExistsRow[] = [];
  const archivedExisting: ArchivedExistingRow[] = [];
  const wouldInsert: WouldInsertRow[] = [];
  const slugCollisions: SlugCollisionRow[] = [];
  const nameWarnings: NameWarningRow[] = [];

  const takenSlugs = new Map<string, SlugOwner>();
  for (const row of existing) {
    const athleteId = parseAthleteIdFromUrl(row.trainingpeaks_athlete_url);
    if (!athleteId) continue;
    takenSlugs.set(row.student_id, { athleteId, studentId: row.student_id, source: "existing" });
  }

  for (const athlete of discovered) {
    const match = findExistingMatch(athlete, indexes);
    if (match) {
      matchedExistingIds.add(match.row.id);
      const entry: AlreadyExistsRow = {
        athlete_id: athlete.athleteId,
        display_name: athlete.displayName,
        trainingpeaks_athlete_url: athlete.trainingpeaksAthleteUrl,
        existing_student_id: match.row.student_id,
        existing_student_name: match.row.student_name,
        match_by: match.matchBy,
        archived: Boolean(match.row.archived_at),
      };

      if (match.row.archived_at) {
        archivedExisting.push(entry);
      } else {
        alreadyExists.push(entry);
      }
      continue;
    }

    const baseSlug = buildBaseSlug(athlete.displayName, athlete.athleteId);
    const resolved = resolveUniqueSlug(baseSlug, athlete.athleteId, athlete.displayName, takenSlugs);
    if (resolved.collision) {
      slugCollisions.push(resolved.collision);
    }

    const normalizedName = normalizeDisplayName(athlete.displayName);
    const sameNameRows = indexes.byNormalizedName.get(normalizedName) ?? [];
    for (const row of sameNameRows) {
      const existingAthleteId = parseAthleteIdFromUrl(row.trainingpeaks_athlete_url);
      if (existingAthleteId === athlete.athleteId) continue;
      nameWarnings.push({
        athlete_id: athlete.athleteId,
        display_name: athlete.displayName,
        existing_student_id: row.student_id,
        existing_student_name: row.student_name,
        existing_athlete_id: existingAthleteId,
      });
    }

    takenSlugs.set(resolved.studentId, {
      athleteId: athlete.athleteId,
      studentId: resolved.studentId,
      source: "planned",
    });
    wouldInsert.push({
      student_id: resolved.studentId,
      student_name: athlete.displayName,
      trainingpeaks_athlete_url: athlete.trainingpeaksAthleteUrl,
      athlete_id: athlete.athleteId,
      base_slug: baseSlug,
      slug_suffix: resolved.suffix,
    });
  }

  const discoveredAthleteIds = new Set(discovered.map((row) => row.athleteId));
  const supabaseNotInTp: SupabaseNotInTpRow[] = [];

  for (const row of existing) {
    if (matchedExistingIds.has(row.id)) continue;

    const athleteId = parseAthleteIdFromUrl(row.trainingpeaks_athlete_url);
    if (athleteId && discoveredAthleteIds.has(athleteId)) {
      matchedExistingIds.add(row.id);
      continue;
    }

    supabaseNotInTp.push({
      student_id: row.student_id,
      student_name: row.student_name,
      trainingpeaks_athlete_url: row.trainingpeaks_athlete_url,
      athlete_id: athleteId,
      archived: Boolean(row.archived_at),
    });
  }

  return {
    summary: {
      discovered_total: discovered.length,
      existing_total: existing.length,
      already_exists: alreadyExists.length,
      would_insert: wouldInsert.length,
      slug_collisions: slugCollisions.length,
      name_warnings: nameWarnings.length,
      archived_existing: archivedExisting.length,
      supabase_not_in_tp: supabaseNotInTp.length,
    },
    already_exists: alreadyExists,
    archived_existing: archivedExisting,
    would_insert: wouldInsert,
    slug_collisions: slugCollisions,
    name_warnings: nameWarnings,
    supabase_not_in_tp: supabaseNotInTp,
    would_insert_sample: wouldInsert.slice(0, SAMPLE_WOULD_INSERT_LIMIT),
  };
}
