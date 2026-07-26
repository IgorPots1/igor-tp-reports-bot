#!/usr/bin/env node
/**
 * Выгружает применённые миграции physio_* из базы в supabase/migrations/.
 *
 * Нужен, потому что миграции движка физиологии применялись напрямую через
 * Supabase MCP и в репозитории файлов для них не было. Supabase CLI для этого
 * не требуется — данные берутся через RPC physio_export_migrations()
 * под service_role.
 *
 * Запуск из корня репозитория:
 *   node tools/trainingpeaks-export/scripts/dump-physio-migrations.mjs
 *
 * Ничего в базе не меняет. Существующие файлы не перезаписывает, если их
 * содержимое совпадает; отличающиеся — только с флагом --force.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const ENV_FILES = [".env.local", ".env"];

function loadEnv() {
  for (const file of ENV_FILES) {
    const path = join(REPO_ROOT, file);
    if (!existsSync(path)) {
      continue;
    }
    for (const rawLine of readFileSync(path, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separator = line.indexOf("=");
      if (separator === -1) {
        continue;
      }
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

async function main() {
  loadEnv();

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local");
  }

  const force = process.argv.includes("--force");

  const response = await fetch(`${url}/rest/v1/rpc/physio_export_migrations`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: "{}",
  });

  if (!response.ok) {
    throw new Error(
      `RPC physio_export_migrations вернул ${response.status}: ${await response.text()}`
    );
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log("Миграций physio_* в базе не найдено.");
    return;
  }

  if (!existsSync(MIGRATIONS_DIR)) {
    mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }

  let written = 0;
  let skipped = 0;
  let conflicts = 0;

  for (const row of rows) {
    const fileName = `${row.version}_${row.name}.sql`;
    const filePath = join(MIGRATIONS_DIR, fileName);
    const body = `${row.sql.trimEnd()}\n`;

    if (existsSync(filePath)) {
      const current = readFileSync(filePath, "utf8");
      if (current === body) {
        skipped += 1;
        continue;
      }
      if (!force) {
        console.warn(`РАСХОЖДЕНИЕ: ${fileName} отличается от базы (перезапись только с --force)`);
        conflicts += 1;
        continue;
      }
    }

    writeFileSync(filePath, body, "utf8");
    written += 1;
    console.log(`записан ${fileName}`);
  }

  console.log(
    `\nГотово: записано ${written}, совпало ${skipped}, расхождений ${conflicts}, всего в базе ${rows.length}.`
  );
  console.log("Применять ничего не нужно — на проде эти миграции уже стоят.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
