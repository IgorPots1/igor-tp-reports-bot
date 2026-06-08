import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const fileIntakePath = join(root, "src/features/nutrition/file-intake.ts");
const fileIntakeBody = readFileSync(fileIntakePath, "utf8");
const limitsBody = readFileSync(join(root, "src/features/nutrition/file-upload-limits.ts"), "utf8");

assert.match(limitsBody, /MAX_NUTRITION_FILE_COUNT\s*=\s*10/, "file intake must enforce max 10 files");
assert.match(
  limitsBody,
  /MAX_NUTRITION_FILE_SIZE_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/,
  "file intake must enforce 10MB size"
);
assert.match(
  limitsBody,
  /MAX_NUTRITION_TOTAL_UPLOAD_BYTES\s*=\s*15\s*\*\s*1024\s*\*\s*1024/,
  "file intake must enforce 15MB total upload size"
);
assert.match(fileIntakeBody, /assertNutritionUploadFilesValid\(/, "file intake must validate upload limits");
assert.match(fileIntakeBody, /\.from\(bucket\)\.upload\(/, "file upload must go through Supabase storage");
assert.doesNotMatch(fileIntakeBody, /getPublicUrl\s*\(/, "must not generate public urls");
assert.doesNotMatch(fileIntakeBody, /base64/i, "must not persist base64 patterns");

const repositoryBody = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");
assert.match(repositoryBody, /file_refs:\s*input\.fileRefs\s*\?\?\s*null/, "report should store file refs metadata only");

console.log("PASS check-nutrition-file-safety");
