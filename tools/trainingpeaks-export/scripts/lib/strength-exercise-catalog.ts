import type { NormalizedStrengthExercise } from "./strength-template-matcher.ts";

export type CatalogLibrarySummary = {
  exerciseLibraryId: string | number;
  libraryName: string;
  isDefaultContent?: boolean;
  itemCount: number;
};

export type CatalogKeywordItem = {
  itemName: string;
  exerciseLibraryItemId: string | number;
  exerciseLibraryId: string | number;
  description?: string;
};

export type CatalogKeywordGroup = {
  count: number;
  items: CatalogKeywordItem[];
};

export type CatalogSummaryJson = {
  totalLibraries: number;
  totalExercises: number;
  libraries: CatalogLibrarySummary[];
  keywordGroups: Record<string, CatalogKeywordGroup>;
};

export type CatalogReportBundle = {
  summaryJson: CatalogSummaryJson;
  summaryMarkdown: string;
  byLibraryMarkdown: string;
  searchIndexMarkdown: string;
  keywordGroupsMarkdown: string;
};

const KEYWORD_GROUPS: Array<{ id: string; label: string; patterns: RegExp[] }> = [
  { id: "calf_raise", label: "calf / raise", patterns: [/\bcalf\b/i, /\bcalf raise/i] },
  {
    id: "step_up",
    label: "step / step-up / step up",
    patterns: [/\bstep[\s-]?up\b/i],
  },
  { id: "glute_bridge", label: "glute / bridge", patterns: [/\bglute\b/i, /\bbridge\b/i] },
  { id: "clam_shell", label: "clam / shell", patterns: [/\bclam\b/i, /\bshell\b/i, /\bclamshell\b/i] },
  { id: "squat", label: "squat", patterns: [/\bsquat\b/i] },
  { id: "lunge_split_squat", label: "lunge / split squat", patterns: [/\blunge\b/i, /\bsplit squat\b/i] },
  {
    id: "deadlift_rdl",
    label: "deadlift / rdl / Romanian",
    patterns: [/\bdeadlift\b/i, /\brdl\b/i, /\bromanian\b/i],
  },
  { id: "plank", label: "plank / side plank", patterns: [/\bplank\b/i] },
  {
    id: "hip_abduction",
    label: "hip / abduction / adduction",
    patterns: [/\bhip\b/i, /\babduction\b/i, /\badduction\b/i],
  },
  { id: "hamstring_curl", label: "hamstring / curl", patterns: [/\bhamstring\b/i, /\bcurl\b/i] },
  {
    id: "quad_knee",
    label: "quad / knee / extension",
    patterns: [/\bquad\b/i, /\bknee\b/i, /\bextension\b/i],
  },
  {
    id: "mobility_ankle",
    label: "mobility / ankle / 90-90",
    patterns: [/\bmobility\b/i, /\bankle\b/i, /\b90[\s-]?90\b/i],
  },
  { id: "band", label: "band / mini band", patterns: [/\bband\b/i, /\bmini band\b/i] },
  {
    id: "single_leg",
    label: "single leg / unilateral",
    patterns: [/\bsingle[\s-]?leg\b/i, /\bunilateral\b/i, /\bone leg\b/i],
  },
];

function truncateDescription(description: string | undefined, maxLength = 160): string | undefined {
  if (!description) return undefined;
  const trimmed = description.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function firstLetterBucket(itemName: string): string {
  const match = itemName.trim().match(/[A-Za-z0-9]/);
  if (!match) return "#";
  const letter = match[0].toUpperCase();
  return /[A-Z]/.test(letter) ? letter : "#";
}

function matchesKeywordGroup(exercise: NormalizedStrengthExercise, patterns: RegExp[]): boolean {
  const haystack = exercise.itemName;
  return patterns.some((pattern) => pattern.test(haystack));
}

function buildLibrarySummaries(exercises: NormalizedStrengthExercise[]): CatalogLibrarySummary[] {
  const byLibrary = new Map<string, CatalogLibrarySummary>();

  for (const exercise of exercises) {
    const key = String(exercise.exerciseLibraryId);
    const existing = byLibrary.get(key);
    if (existing) {
      existing.itemCount += 1;
      continue;
    }

    byLibrary.set(key, {
      exerciseLibraryId: exercise.exerciseLibraryId,
      libraryName: exercise.libraryName ?? `Library ${exercise.exerciseLibraryId}`,
      isDefaultContent: exercise.isDefaultContent,
      itemCount: 1,
    });
  }

  return [...byLibrary.values()].sort((left, right) => left.libraryName.localeCompare(right.libraryName));
}

function buildKeywordGroups(exercises: NormalizedStrengthExercise[]): Record<string, CatalogKeywordGroup> {
  const groups: Record<string, CatalogKeywordGroup> = {};

  for (const group of KEYWORD_GROUPS) {
    const items = exercises
      .filter((exercise) => matchesKeywordGroup(exercise, group.patterns))
      .sort((left, right) => left.itemName.localeCompare(right.itemName))
      .map((exercise) => ({
        itemName: exercise.itemName,
        exerciseLibraryItemId: exercise.exerciseLibraryItemId,
        exerciseLibraryId: exercise.exerciseLibraryId,
        description: truncateDescription(exercise.description),
      }));

    groups[group.id] = {
      count: items.length,
      items,
    };
  }

  return groups;
}

function renderSummaryMarkdown(input: {
  exercises: NormalizedStrengthExercise[];
  libraries: CatalogLibrarySummary[];
}): string {
  const defaultLibraries = input.libraries.filter((library) => library.isDefaultContent === true);
  const customLibraries = input.libraries.filter((library) => library.isDefaultContent === false);
  const unknownOwnership = input.libraries.filter((library) => library.isDefaultContent === undefined);

  const lines = [
    "# TrainingPeaks Strength Exercise Catalog Summary",
    "",
    "## Totals",
    "",
    `- Total libraries: ${input.libraries.length}`,
    `- Total exercises: ${input.exercises.length}`,
    "",
    "## Count by library",
    "",
  ];

  for (const library of input.libraries) {
    const ownership =
      library.isDefaultContent === true
        ? "default/official"
        : library.isDefaultContent === false
          ? "custom/owned"
          : "ownership unknown";
    lines.push(
      `- ${library.libraryName} (${ownership}): ${library.itemCount} exercises [libraryId=${library.exerciseLibraryId}]`,
    );
  }

  lines.push(
    "",
    "## Library ownership",
    "",
    `- Default/official libraries: ${defaultLibraries.length}`,
    `- Custom/owned libraries: ${customLibraries.length}`,
    `- Unknown ownership: ${unknownOwnership.length}`,
    "",
    "## Available fields",
    "",
    "Each cached exercise includes:",
    "",
    "- `exerciseLibraryItemId` — stable item id within the library",
    "- `exerciseLibraryId` — parent library id",
    "- `itemName` — exact TrainingPeaks display name",
    "- `description` — optional exercise description text",
    "- `libraryName` — human-readable library name",
    "- `isDefaultContent` — whether the library is default/official content",
    "- `ownerType` — derived ownership hint (`default`, `custom`, or owner name when available)",
    "- `normalizedName` — lowercase normalized name used for matching",
    "",
    "## Notes",
    "",
    "- This catalog is read-only and generated from a local exercise cache.",
    "- Use exact `itemName` values when refining strength templates.",
    "- Prefer default/official library exercises when multiple variants exist.",
    "",
    "## Content type warning",
    "",
    "The `/exerciselibrary/v2/libraries` cache may include **workout templates** (Swim, Run, Bike, etc.), not individual New Strength Builder exercises.",
    "If keyword groups for calf raise, glute bridge, squat, etc. show zero matches, the strength exercise catalog likely lives on a different API surface.",
    "Re-run network capture while searching exercises inside New Strength Builder UI before refining templates.",
  );

  return lines.join("\n");
}

function renderByLibraryMarkdown(exercises: NormalizedStrengthExercise[]): string {
  const grouped = new Map<string, { libraryName: string; exercises: NormalizedStrengthExercise[] }>();

  for (const exercise of exercises) {
    const key = String(exercise.exerciseLibraryId);
    const existing = grouped.get(key);
    if (existing) {
      existing.exercises.push(exercise);
      continue;
    }

    grouped.set(key, {
      libraryName: exercise.libraryName ?? `Library ${exercise.exerciseLibraryId}`,
      exercises: [exercise],
    });
  }

  const lines = ["# TrainingPeaks Strength Exercise Catalog by Library", ""];

  for (const [libraryId, group] of [...grouped.entries()].sort((left, right) =>
    left[1].libraryName.localeCompare(right[1].libraryName),
  )) {
    lines.push(`## ${group.libraryName}`, "", `- exerciseLibraryId: ${libraryId}`, `- exercises: ${group.exercises.length}`, "");

    for (const exercise of group.exercises.sort((left, right) => left.itemName.localeCompare(right.itemName))) {
      lines.push(`- ${exercise.itemName}`);
      lines.push(`  - exerciseLibraryItemId: ${exercise.exerciseLibraryItemId}`);
      const snippet = truncateDescription(exercise.description);
      if (snippet) {
        lines.push(`  - description: ${snippet}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function renderSearchIndexMarkdown(exercises: NormalizedStrengthExercise[]): string {
  const buckets = new Map<string, string[]>();

  for (const exercise of exercises) {
    const bucket = firstLetterBucket(exercise.itemName);
    const names = buckets.get(bucket) ?? [];
    names.push(exercise.itemName);
    buckets.set(bucket, names);
  }

  const lines = ["# TrainingPeaks Strength Exercise Search Index", ""];

  for (const bucket of [...buckets.keys()].sort()) {
    const names = [...new Set(buckets.get(bucket) ?? [])].sort((left, right) => left.localeCompare(right));
    lines.push(`## ${bucket}`, "");
    for (const name of names) {
      lines.push(`- ${name}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderKeywordGroupsMarkdown(keywordGroups: Record<string, CatalogKeywordGroup>): string {
  const lines = ["# TrainingPeaks Strength Exercise Keyword Groups", ""];

  for (const group of KEYWORD_GROUPS) {
    const data = keywordGroups[group.id];
    lines.push(`## ${group.label}`, "", `- count: ${data.count}`, "");

    if (data.count === 0) {
      lines.push("No matches.", "");
      continue;
    }

    for (const item of data.items) {
      lines.push(`- ${item.itemName}`);
      lines.push(`  - exerciseLibraryItemId: ${item.exerciseLibraryItemId}`);
      lines.push(`  - exerciseLibraryId: ${item.exerciseLibraryId}`);
      if (item.description) {
        lines.push(`  - description: ${item.description}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function buildStrengthExerciseCatalog(exercises: NormalizedStrengthExercise[]): CatalogReportBundle {
  const libraries = buildLibrarySummaries(exercises);
  const keywordGroups = buildKeywordGroups(exercises);

  const summaryJson: CatalogSummaryJson = {
    totalLibraries: libraries.length,
    totalExercises: exercises.length,
    libraries,
    keywordGroups,
  };

  return {
    summaryJson,
    summaryMarkdown: renderSummaryMarkdown({ exercises, libraries }),
    byLibraryMarkdown: renderByLibraryMarkdown(exercises),
    searchIndexMarkdown: renderSearchIndexMarkdown(exercises),
    keywordGroupsMarkdown: renderKeywordGroupsMarkdown(keywordGroups),
  };
}
