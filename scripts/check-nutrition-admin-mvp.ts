import { execSync } from "node:child_process";

const checks = [
  "check-nutrition-student-fk",
  "check-nutrition-communication-profile",
  "check-nutrition-context-builder",
  "check-nutrition-safety-blocks",
  "check-nutrition-no-autosend",
  "check-nutrition-admin-routes",
];

for (const check of checks) {
  execSync(`npx tsx scripts/${check}.ts`, {
    stdio: "inherit",
  });
}

console.log("PASS check-nutrition-admin-mvp");
