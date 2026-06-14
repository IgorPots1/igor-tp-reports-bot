import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { toolRoot } from "./lib/paths.ts";

// Обёртка одного шага онбординга: выгрузка ростера из TrainingPeaks (discovery)
// + импорт новых учеников в Supabase (import). Оба шага — это уже существующие
// скрипты tp-discover-athletes и tp-import-athletes; здесь только оркестрация.

const DISCOVERY_ROOT = path.join(toolRoot, "debug", "athletes-api-discovery");
const ROSTER_BASENAME = "athletes.users-v3.normalized.json";

type CliArgs = {
  apply: boolean;
  skipDiscovery: boolean;
};

function printHelp(): void {
  console.log(`Usage: npm run tp-onboard-athletes -- [options]

Один заход: выгрузка ростера из TrainingPeaks + импорт новых учеников.

Шаг 1 (discovery): откроется браузер с твоим TP-профилем — открой список
спортсменов (Athletes/Clients), скрипт соберёт ростер из /users/v3/user.
Шаг 2 (import): сравнит ростер с базой и (по умолчанию) покажет dry-run.

Options:
  --apply            Импортировать новых учеников (без флага — только dry-run)
  --skip-discovery   Пропустить шаг 1 и взять последний выгруженный ростер
  --help             Показать эту справку

Безопасно: добавляет только новых; существующих и Telegram не трогает;
weekly_report_enabled=false. TrainingPeaks не мутируется.
`);
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  return {
    apply: argv.includes("--apply"),
    skipDiscovery: argv.includes("--skip-discovery"),
  };
}

function runStep(label: string, npmArgs: string[]): void {
  console.log(`\n[tp-onboard-athletes] ${label}`);
  const result = spawnSync("npm", ["run", ...npmArgs], {
    cwd: toolRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Шаг завершился с ошибкой (exit ${result.status ?? "null"}).`);
  }
}

function findLatestRoster(): string | null {
  if (!existsSync(DISCOVERY_ROOT)) {
    return null;
  }
  const candidates = readdirSync(DISCOVERY_ROOT)
    .map((name) => path.join(DISCOVERY_ROOT, name, ROSTER_BASENAME))
    .filter((file) => existsSync(file))
    .map((file) => ({ file, mtimeMs: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates.length > 0 ? candidates[0].file : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.skipDiscovery) {
    runStep(
      "Шаг 1/2: выгрузка ростера из TrainingPeaks — в открывшемся браузере открой список спортсменов.",
      ["tp-discover-athletes"],
    );
  } else {
    console.log("[tp-onboard-athletes] --skip-discovery: использую последний выгруженный ростер.");
  }

  const roster = findLatestRoster();
  if (!roster) {
    throw new Error(
      `Не найден ${ROSTER_BASENAME} в ${DISCOVERY_ROOT}. Запусти без --skip-discovery, чтобы сначала выгрузить ростер.`,
    );
  }
  console.log(`[tp-onboard-athletes] Использую ростер: ${roster}`);

  const importArgs = ["tp-import-athletes", "--", `--from-discovery=${roster}`];
  if (args.apply) {
    importArgs.push("--apply");
  }
  runStep(`Шаг 2/2: импорт (${args.apply ? "apply — запись в базу" : "dry-run, без записи"}).`, importArgs);

  if (!args.apply) {
    console.log(
      "\n[tp-onboard-athletes] Это был dry-run. Если в would_insert всё верно — запусти снова с --apply.",
    );
  } else {
    console.log("\n[tp-onboard-athletes] Готово. Новые ученики добавлены — привяжи им Telegram/биллинг в админке.");
  }
}

main().catch((error: unknown) => {
  console.error("[tp-onboard-athletes] FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
