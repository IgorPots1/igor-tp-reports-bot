import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildImportPlan,
  extractRosterFromUsersV3Body,
  type DiscoveredAthlete,
  type ExistingStudentRowForImport,
} from "./athlete-roster-import.ts";

/**
 * Unit tests for the pure roster-import engine shared by the local CLI
 * (tp-import-athletes.ts) and the live admin "Sync from TrainingPeaks" button.
 *
 * Run: node --experimental-strip-types --test src/features/trainingpeaks/athlete-roster-import.test.ts
 */

function athlete(athleteId: number, displayName: string): DiscoveredAthlete {
  return {
    athleteId,
    displayName,
    trainingpeaksAthleteUrl: `https://app.trainingpeaks.com/#calendar/athletes/${athleteId}`,
    source: "users_v3_user",
  };
}

function existing(overrides: Partial<ExistingStudentRowForImport> & { id: string }): ExistingStudentRowForImport {
  return {
    student_id: overrides.student_id ?? "existing-student",
    student_name: overrides.student_name ?? "Existing Student",
    trainingpeaks_athlete_url:
      overrides.trainingpeaks_athlete_url ?? "https://app.trainingpeaks.com/#calendar/athletes/900001",
    archived_at: overrides.archived_at ?? null,
    id: overrides.id,
  };
}

// ─── extractRosterFromUsersV3Body ─────────────────────────────────────────────

describe("extractRosterFromUsersV3Body", () => {
  test("name priority ladder: fullName > first+last > first > last > Athlete {id}", () => {
    const roster = extractRosterFromUsersV3Body({
      user: {
        athletes: [
          { athleteId: 1, fullName: "Full Name", firstName: "Ignored" },
          { athleteId: 2, firstName: "First", lastName: "Last" },
          { athleteId: 3, firstName: "OnlyFirst" },
          { athleteId: 4, lastName: "OnlyLast" },
          { athleteId: 5 },
        ],
      },
    });
    const byId = new Map(roster.map((r) => [r.athleteId, r.displayName]));
    assert.equal(byId.get(1), "Full Name");
    assert.equal(byId.get(2), "First Last");
    assert.equal(byId.get(3), "OnlyFirst");
    assert.equal(byId.get(4), "OnlyLast");
    assert.equal(byId.get(5), "Athlete 5");
  });

  test("builds the calendar athlete URL and sorts by display name", () => {
    const roster = extractRosterFromUsersV3Body({
      user: { athletes: [{ athleteId: 7, fullName: "Zoe" }, { athleteId: 8, fullName: "Amy" }] },
    });
    assert.deepEqual(
      roster.map((r) => r.displayName),
      ["Amy", "Zoe"],
    );
    assert.equal(roster[0].trainingpeaksAthleteUrl, "https://app.trainingpeaks.com/#calendar/athletes/8");
  });

  test("dedupes repeated athleteId (last wins)", () => {
    const roster = extractRosterFromUsersV3Body({
      user: { athletes: [{ athleteId: 9, fullName: "First Copy" }, { athleteId: 9, fullName: "Second Copy" }] },
    });
    assert.equal(roster.length, 1);
    assert.equal(roster[0].displayName, "Second Copy");
  });

  test("skips non-record items and non-positive ids", () => {
    const roster = extractRosterFromUsersV3Body({
      user: { athletes: [null, 42, { athleteId: 0, fullName: "Zero" }, { athleteId: -1 }, { athleteId: 5, fullName: "Ok" }] },
    });
    assert.deepEqual(roster.map((r) => r.athleteId), [5]);
  });

  test("empty athletes array returns []", () => {
    assert.deepEqual(extractRosterFromUsersV3Body({ user: { athletes: [] } }), []);
  });

  test("throws when user is missing", () => {
    assert.throws(() => extractRosterFromUsersV3Body({ profile: {} }), /missing `user`/);
  });

  test("throws when user.athletes is not an array", () => {
    assert.throws(() => extractRosterFromUsersV3Body({ user: { athletes: {} } }), /user\.athletes/);
  });
});

// ─── buildImportPlan ──────────────────────────────────────────────────────────

describe("buildImportPlan", () => {
  test("empty DB: every discovered athlete becomes a would_insert row", () => {
    const plan = buildImportPlan([athlete(1, "Anna Ivanova"), athlete(2, "Boris Petrov")], []);
    assert.equal(plan.summary.would_insert, 2);
    assert.equal(plan.summary.already_exists, 0);
    assert.equal(plan.would_insert.every((r) => r.slug_suffix === null), true);
  });

  test("already_exists match by athlete_id (existing url carries the same id)", () => {
    const plan = buildImportPlan(
      [athlete(555, "Someone New")],
      [existing({ id: "row-1", trainingpeaks_athlete_url: "https://app.trainingpeaks.com/#calendar/athletes/555" })],
    );
    assert.equal(plan.summary.would_insert, 0);
    assert.equal(plan.already_exists.length, 1);
    assert.equal(plan.already_exists[0].match_by, "athlete_id");
  });

  test("already_exists match by student_id slug", () => {
    // Existing student_id equals the base slug that "Sasha Test" normalizes to.
    const discovered = athlete(777, "Sasha Test");
    const baseSlugRow = buildImportPlan([discovered], []).would_insert[0];
    const plan = buildImportPlan(
      [discovered],
      [
        existing({
          id: "row-slug",
          student_id: baseSlugRow.student_id,
          trainingpeaks_athlete_url: "https://app.trainingpeaks.com/#calendar/athletes/111222", // different id
        }),
      ],
    );
    assert.equal(plan.summary.would_insert, 0);
    assert.equal(plan.already_exists[0].match_by, "student_id");
  });

  test("archived existing routes to archived_existing, not already_exists, and is not re-inserted", () => {
    const plan = buildImportPlan(
      [athlete(42, "Archived Athlete")],
      [
        existing({
          id: "row-arch",
          archived_at: "2026-01-01T00:00:00Z",
          trainingpeaks_athlete_url: "https://app.trainingpeaks.com/#calendar/athletes/42",
        }),
      ],
    );
    assert.equal(plan.summary.would_insert, 0);
    assert.equal(plan.summary.already_exists, 0);
    assert.equal(plan.archived_existing.length, 1);
    assert.equal(plan.archived_existing[0].archived, true);
  });

  test("intra-batch slug collision: two same-named new athletes get suffixed slugs", () => {
    const plan = buildImportPlan([athlete(1, "Ivan Ivanov"), athlete(2, "Ivan Ivanov")], []);
    assert.equal(plan.summary.would_insert, 2);
    assert.equal(plan.would_insert[0].slug_suffix, null);
    assert.equal(plan.would_insert[1].slug_suffix, 2);
    assert.notEqual(plan.would_insert[0].student_id, plan.would_insert[1].student_id);
    assert.equal(plan.summary.slug_collisions, 1);
  });

  test("existing student owning the base slug matches by student_id (deduped, not re-inserted)", () => {
    // When an existing row's student_id already equals the slug a discovered athlete
    // would get, findExistingMatch matches by student_id FIRST -> already_exists. The
    // resolveUniqueSlug-vs-existing collision path is therefore only reachable for
    // planned (intra-batch) owners, which the intra-batch test above covers.
    const discovered = athlete(2, "Ivan Ivanov");
    const baseSlug = buildImportPlan([discovered], []).would_insert[0].student_id;
    const plan = buildImportPlan(
      [discovered],
      [
        existing({
          id: "row-x",
          student_id: baseSlug,
          trainingpeaks_athlete_url: "https://app.trainingpeaks.com/#calendar/athletes/99", // different athlete
        }),
      ],
    );
    assert.equal(plan.summary.would_insert, 0);
    assert.equal(plan.already_exists.length, 1);
    assert.equal(plan.already_exists[0].match_by, "student_id");
    assert.equal(plan.summary.slug_collisions, 0);
  });

  test("name_warning when a new athlete shares a name with a different existing athlete", () => {
    const plan = buildImportPlan(
      [athlete(2, "Maria Popova")],
      [
        existing({
          id: "row-name",
          student_id: "different-slug",
          student_name: "Maria Popova",
          trainingpeaks_athlete_url: "https://app.trainingpeaks.com/#calendar/athletes/98", // different id
        }),
      ],
    );
    assert.equal(plan.summary.would_insert, 1);
    assert.equal(plan.name_warnings.length, 1);
    assert.equal(plan.name_warnings[0].existing_athlete_id, 98);
  });

  test("supabase_not_in_tp lists existing students absent from the TP roster", () => {
    const plan = buildImportPlan(
      [athlete(1, "In Both")],
      [
        existing({ id: "both", trainingpeaks_athlete_url: "https://app.trainingpeaks.com/#calendar/athletes/1" }),
        existing({
          id: "only-db",
          student_id: "only-db",
          student_name: "Only In DB",
          trainingpeaks_athlete_url: "https://app.trainingpeaks.com/#calendar/athletes/2",
        }),
      ],
    );
    assert.equal(plan.summary.would_insert, 0);
    assert.equal(plan.supabase_not_in_tp.length, 1);
    assert.equal(plan.supabase_not_in_tp[0].student_id, "only-db");
  });
});
