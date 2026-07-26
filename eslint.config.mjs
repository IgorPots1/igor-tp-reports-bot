import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname
});

const eslintConfig = [
  {
    ignores: [".next/**", "next-env.d.ts"]
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Ban Supabase `.limit(N>1000)`: the server cap db-max-rows=1000 is HARD, so a
    // literal limit above it does NOT raise the cap — it silently truncates to 1000.
    // Paginate via fetchAllRows/fetchAllInChunks (@/features/supabase/paginate).
    // Scoped to prod code (src/**), which is clean; diagnostic scripts are tracked in
    // docs/pagination-window-report.md (BLOCK 3) and converted separately.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='limit'] > Literal[value>1000]",
          message:
            "Supabase .limit(N>1000) не поднимает серверный порог (db-max-rows=1000) — вернётся 1000 строк, тихое усечение. Листай через fetchAllRows/fetchAllInChunks из @/features/supabase/paginate."
        }
      ]
    }
  }
];

export default eslintConfig;
