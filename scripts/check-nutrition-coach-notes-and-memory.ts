import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  emptyNutritionStudentMemory,
  sanitizeNutritionStudentMemory,
} from "@/features/nutrition/repository";

// Task 8: coach notes at upload (one-time + persistent) feed the review as
// tone/accent context (not numbers); fasted-morning shifts fueling to the night
// before / after. Memory stays compact (fed into every prompt).

const root = process.cwd();
const repoSrc = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");
const draftSrc = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
const contextSrc = readFileSync(join(root, "src/features/nutrition/context.ts"), "utf8");
const adminSrc = readFileSync(join(root, "src/features/nutrition/admin.ts"), "utf8");
const uploadSrc = readFileSync(join(root, "src/app/admin/coach-os/nutrition/NutritionFileUploadPanel.tsx"), "utf8");
const actionsSrc = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

// --- 1. Memory sanitizer keeps memory compact + defensive ---------------------
const empty = emptyNutritionStudentMemory();
assert.deepEqual(empty, { approved_patterns: [], persistent_notes: [], last_focus: null, key_trends: [] });
assert.deepEqual(sanitizeNutritionStudentMemory(null), empty, "garbage memory must normalize to empty");
assert.deepEqual(sanitizeNutritionStudentMemory("nonsense"), empty, "non-object memory must normalize to empty");

const capped = sanitizeNutritionStudentMemory({
  persistent_notes: Array.from({ length: 12 }, (_, i) => `note ${i}`),
  approved_patterns: Array.from({ length: 9 }, (_, i) => ({ text: `p${i}`, since_week: "2026-06-01" })),
  key_trends: ["a", "b", "c", "d", "e"],
  last_focus: "  держим углеводы вокруг ключевых работ  ",
});
assert.ok(capped.persistent_notes.length <= 6, "persistent_notes capped (compact prompt)");
assert.ok(capped.approved_patterns.length <= 4, "approved_patterns capped");
assert.ok(capped.key_trends.length <= 3, "key_trends capped");
assert.equal(capped.last_focus, "держим углеводы вокруг ключевых работ", "last_focus trimmed");
// since_week only kept when a valid ISO date.
const badWeek = sanitizeNutritionStudentMemory({ approved_patterns: [{ text: "x", since_week: "week-1" }] });
assert.equal(badWeek.approved_patterns[0]?.since_week, null, "invalid since_week dropped to null");
// Empty-text patterns dropped.
const emptyText = sanitizeNutritionStudentMemory({ approved_patterns: [{ text: "  ", since_week: "2026-06-01" }] });
assert.equal(emptyText.approved_patterns.length, 0, "empty-text pattern dropped");

// --- 2. Storage wiring (report one-time note + profile memory) ----------------
assert.match(repoSrc, /coach_notes_ru: string \| null/, "report row type must carry coach_notes_ru");
assert.match(repoSrc, /coachNotesRu: compactText\(row\.coach_notes_ru\)/, "report mapping must expose coachNotesRu");
assert.match(repoSrc, /coach_notes_ru: compactText\(input\.coachNotesRu\)/, "createNutritionReport must persist coach_notes_ru");
assert.match(repoSrc, /nutrition_memory:\s*\n?\s*input\.nutritionMemory === undefined \? undefined : sanitizeNutritionStudentMemory/, "profile upsert must persist sanitized nutrition_memory");
assert.match(repoSrc, /export async function appendNutritionPersistentNote/, "must expose appendNutritionPersistentNote");
assert.match(repoSrc, /item\.toLowerCase\(\) === note\.toLowerCase\(\)/, "appendNutritionPersistentNote must dedup");

// --- 3. Context threads one-time note + memory --------------------------------
assert.match(contextSrc, /coachReportNoteRu: compactText\(input\.coachReportNoteRu\)/, "context must thread the one-time coach note");
assert.match(contextSrc, /studentMemory: essentials\.profile\?\.nutritionMemory \?\? emptyNutritionStudentMemory\(\)/, "context must load student memory");
assert.match(adminSrc, /coachReportNoteRu: reportWithMacros\.report\.coachNotesRu/, "review must pass the report's coach note into context");
assert.match(adminSrc, /appendNutritionPersistentNote/, "remember flag must persist the note");
assert.match(adminSrc, /rememberCoachNote && input\.coachNotesRu/, "persist only when remember is checked and a note exists");

// --- 4. Prompt: notes as context (not numbers) + fasted-morning rule ----------
assert.match(draftSrc, /coach_report_note: input\.context\.coachReportNoteRu/, "facts payload must include the one-time note");
assert.match(draftSrc, /coach_persistent_notes: input\.context\.studentMemory\?\.persistent_notes/, "facts payload must include persistent notes");
assert.match(draftSrc, /Заметки тренера[\s\S]*КОНТЕКСТ для тона[\s\S]*НЕ числа/i, "prompt must treat coach notes as tone context, not numbers");
assert.match(draftSrc, /[Нн]атощак[\s\S]*УЖИНЕ НАКАНУНЕ[\s\S]*ЗАВТРАКЕ\/восстановлении ПОСЛЕ/, "prompt must encode fasted-morning fueling shift");
// Strict: the model retells coach notes/history but must NOT invent circumstances
// the coach did not give (e.g. "поели не сразу"). Forward advice is allowed.
assert.match(draftSrc, /пересказывай ТОЛЬКО то, что прямо дано[\s\S]*НЕ предполагай[\s\S]*поели не сразу/, "prompt must ban fabricating un-given student circumstances from notes/history");
// Bug A: must not invent states/events (illness etc.) absent from notes/history.
assert.match(draftSrc, /НЕ выдумывай состояния\/события: болезнь[\s\S]*после болезни/i, "prompt must explicitly ban inventing illness/events not in notes (Bug A)");
// Bug A: the ban must also cover coach_summary_text, and inventing illness signals.
assert.match(draftSrc, /относится КО ВСЕМ полям, включая coach_summary_text/i, "anti-fabrication must cover coach_summary_text, not just athlete text (Bug A)");
assert.match(draftSrc, /НЕ выдумывай сигналы болезни\/цикла\/травмы и не пиши «зафиксировано в истории»/i, "must forbid inventing illness signals / false 'recorded in history' (Bug A)");

// --- 5. Upload UI exposes coach notes + remember ------------------------------
assert.match(uploadSrc, /name="coachNotesRu"/, "upload save form must expose a coach-notes field");
assert.match(uploadSrc, /name="rememberCoachNote"/, "upload save form must expose the remember checkbox");
assert.match(uploadSrc, /Заметки тренера/, "coach-notes field must be labeled");
assert.match(actionsSrc, /getOptionalFormValue\(formData, "coachNotesRu"\)/, "save action must read coachNotesRu");
assert.match(actionsSrc, /rememberCoachNote/, "save action must read rememberCoachNote");
// Athlete diary text stays separate from coach notes.
assert.match(uploadSrc, /name="studentNotes"/, "athlete comment field must remain (separate from coach notes)");

// --- 6. Migration present -----------------------------------------------------
const migration = readFileSync(
  join(root, "supabase/migrations/20260615120000_add_nutrition_coach_notes_and_memory.sql"),
  "utf8"
);
assert.match(migration, /nutrition_reports[\s\S]*add column if not exists coach_notes_ru text/, "migration adds report coach_notes_ru");
assert.match(migration, /nutrition_student_profiles[\s\S]*add column if not exists nutrition_memory jsonb/, "migration adds profile nutrition_memory");
assert.match(packageJson, /check:nutrition-coach-notes-and-memory/, "package.json must register this check");

console.log("PASS check-nutrition-coach-notes-and-memory");
