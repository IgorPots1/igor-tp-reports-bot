import type { TemplateReview } from "./strength-template-matcher.ts";

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function formatMatchStatus(status: "matched" | "ambiguous" | "missing"): string {
  switch (status) {
    case "matched":
      return "Matched";
    case "ambiguous":
      return "Ambiguous";
    case "missing":
      return "Missing";
  }
}

export function buildTemplateReviewMarkdown(review: TemplateReview): string {
  const lines: string[] = [];

  lines.push(`# ${review.title}`);
  lines.push("");
  lines.push("> **Review only — no TrainingPeaks workout was created.**");
  lines.push("");
  lines.push("## Purpose");
  lines.push(review.purpose);
  lines.push("");
  lines.push("## Estimated duration");
  lines.push(`${review.estimatedDurationMinutes} minutes`);
  lines.push("");

  if (review.safetyNotes && review.safetyNotes.length > 0) {
    lines.push("## Safety notes");
    for (const note of review.safetyNotes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  lines.push("## Match summary");
  lines.push(`- Matched: **${review.summary.matchedCount}**`);
  lines.push(`- Ambiguous: **${review.summary.ambiguousCount}**`);
  lines.push(`- Missing: **${review.summary.missingCount}**`);
  lines.push(`- Total exercises: **${review.summary.totalExercises}**`);
  lines.push("");

  for (const block of review.blocks) {
    lines.push(`## ${block.name}`);
    lines.push("");

    for (const exercise of block.exercises) {
      lines.push(`### ${exercise.targetNames.join(" / ")}`);
      lines.push(`- Sets: ${exercise.sets}`);
      lines.push(`- Reps: ${exercise.reps}`);
      if (exercise.notes) {
        lines.push(`- Notes: ${exercise.notes}`);
      }
      lines.push(`- Match status: **${formatMatchStatus(exercise.match.status)}**`);
      lines.push(`- Confidence: **${formatConfidence(exercise.match.confidence)}**`);

      if (exercise.match.matchedName) {
        lines.push(`- TrainingPeaks item: \`${exercise.match.matchedName}\``);
      }
      if (exercise.match.exerciseLibraryItemId !== undefined) {
        lines.push(`- exerciseLibraryItemId: \`${exercise.match.exerciseLibraryItemId}\``);
      }
      if (exercise.match.exerciseLibraryId !== undefined) {
        lines.push(`- exerciseLibraryId: \`${exercise.match.exerciseLibraryId}\``);
      }

      if (exercise.match.status === "missing") {
        lines.push("- **Missing from cache:** no confident TrainingPeaks library match.");
      }

      if (exercise.match.alternatives.length > 0) {
        lines.push("- Alternatives:");
        for (const alternative of exercise.match.alternatives) {
          lines.push(
            `  - \`${alternative.itemName}\` (id: \`${alternative.exerciseLibraryItemId}\`, confidence: ${formatConfidence(alternative.confidence)})`,
          );
        }
      }

      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("_Generated for coach review. No write action was performed against TrainingPeaks._");

  return lines.join("\n");
}
