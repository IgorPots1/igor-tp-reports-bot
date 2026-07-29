// Club — classify + LOG a Supabase/Postgres error so a real failure (missing column,
// permission/RLS, truncation, etc.) is never silently turned into "empty" / "disabled" /
// "not found". Three incidents motivated this: a 42501 swallowed as empty, a truncated read
// that looked like missing data, and a missing-column error that surfaced as "Календарь пока
// не активен" (looked like a flag being off).
//
// Rule: ONLY an absent TABLE (migration not applied) is a benign, expected pre-deploy state.
// A missing COLUMN, a permission/RLS denial, or anything else is a REAL problem the coach must
// see. The existing trainingpeaks helper lumps "column does not exist" in with "table does not
// exist" (it matches the bare substring "does not exist"); this one keeps them apart.

export type ClubDbErrorKind = "missing_table" | "missing_column" | "permission" | "other";

type PgLikeError = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined;

function code(e: PgLikeError): string {
  return (e?.code ?? "").toUpperCase();
}
function msg(e: PgLikeError): string {
  return (e?.message ?? "").toLowerCase();
}

/** Classify a Supabase error, or null when there is no error. */
export function classifyClubDbError(error: PgLikeError): ClubDbErrorKind | null {
  if (!error) return null;
  const c = code(error);
  const m = msg(error);
  // Permission / RLS first — never let it read as "empty".
  if (c === "42501" || m.includes("permission denied") || m.includes("row-level security") || m.includes("row level security")) {
    return "permission";
  }
  // Missing TABLE (benign, migration not applied): 42P01, PostgREST schema-cache miss.
  if (c === "42P01" || c === "PGRST205" || m.includes("could not find the table") || m.includes("schema cache")) {
    return "missing_table";
  }
  // Missing COLUMN (a REAL schema drift): 42703 / "column ... does not exist".
  if (c === "42703" || (m.includes("column") && m.includes("does not exist"))) {
    return "missing_column";
  }
  return "other";
}

/**
 * Log a club DB error with its REAL cause (code + message + details) and a context tag, then
 * return the classified kind so the caller can branch. Returns null when there was no error.
 * The `[club.db]` prefix makes these greppable in Vercel logs.
 */
export function logClubDbError(where: string, error: PgLikeError): ClubDbErrorKind | null {
  const kind = classifyClubDbError(error);
  if (kind && error) {
    console.error(
      `[club.db] ${where} kind=${kind} code=${error.code ?? ""} msg=${error.message ?? ""}` +
        (error.details ? ` details=${error.details}` : "") +
        (error.hint ? ` hint=${error.hint}` : "")
    );
  }
  return kind;
}

/**
 * True ONLY when the table itself is absent (migration not applied) — the one benign case a
 * read may treat as "empty/inactive". A missing column, permission denial, or other error is a
 * REAL failure and must NOT be treated as benign (surface it, don't hide it).
 */
export function isBenignMissingTable(error: PgLikeError): boolean {
  return classifyClubDbError(error) === "missing_table";
}

/** Generic student-facing line for a real DB failure — same everywhere, never blames the user. */
export const CLUB_DB_ERROR_STUDENT_MESSAGE = "Не получилось. Напиши тренеру.";
