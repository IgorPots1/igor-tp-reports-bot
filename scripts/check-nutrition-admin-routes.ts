import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "src/app/admin/coach-os/nutrition/page.tsx",
  "src/app/admin/coach-os/nutrition/[studentId]/page.tsx",
  "src/app/admin/coach-os/nutrition/actions.ts",
];

for (const rel of requiredFiles) {
  assert.equal(existsSync(join(root, rel)), true, `Missing expected route file: ${rel}`);
}

const studentDetail = readFileSync(join(root, "src/app/admin/students/[studentId]/page.tsx"), "utf8");
assert.match(
  studentDetail,
  /\/admin\/coach-os\/nutrition\/\$\{student\.id\}/,
  "Student detail page must link to nutrition card"
);

console.log("PASS check-nutrition-admin-routes");
