/**
 * tp-athlete — coach CLI for ONE athlete at a time (Cowork calls this on Igor's Mac,
 * where the TP session lives). Three subcommands:
 *
 *   tp-athlete show <name|id>
 *   tp-athlete set-threshold <name|id> [--pace 4:45] [--hr 168]
 *   tp-athlete add-race <name|id> --date <YYYY-MM-DD> --distance <10k|21.1k> [--name ...]
 *
 * SAFETY (see the per-command modules for detail):
 *  - `show` is read-only.
 *  - `set-threshold` and `add-race` are DRY-RUN by default: they print a diff/body and
 *    stop. A real write needs `--apply` + env `TP_ATHLETE_REAL_WRITE=1` + the exact
 *    `--confirm` phrase. No batching — one athlete per invocation, by design.
 *  - Fuzzy name match never auto-picks when ambiguous: it lists the candidates and
 *    exits, so Igor chooses.
 *  - Tokens/cookies are never printed.
 */

import process from "node:process";

import { runAddRace } from "./lib/tp-athlete-add-race.ts";
import { loadLocalEnv, lookupAthlete, type RosterMatch } from "./lib/tp-athlete-helpers.ts";
import { runSetThreshold } from "./lib/tp-athlete-set-threshold.ts";
import { runShow } from "./lib/tp-athlete-show.ts";

function getFlag(args: string[], name: string): string | undefined {
  // supports `--name value` and `--name=value`
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) return args[idx + 1];
  return undefined;
}
function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

/** The positional athlete query = the first non-flag token (may be multiple words if quoted). */
function positionalQuery(args: string[]): string | null {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith("--")) {
      // skip a following value if this flag consumes one
      if (!a.includes("=") && i + 1 < args.length && !args[i + 1].startsWith("--")) i += 1;
      continue;
    }
    positionals.push(a);
  }
  return positionals.length > 0 ? positionals.join(" ") : null;
}

async function resolveOrExit(query: string | null): Promise<RosterMatch | null> {
  if (!query) {
    console.error("Missing athlete (name or id).");
    process.exitCode = 2;
    return null;
  }
  const result = await lookupAthlete(query);
  if (result.kind === "one") return result.match;
  if (result.kind === "none") {
    console.error(`Не нашёл атлета по запросу «${query}». Уточни имя (латиницей, как в TP) или дай athlete_id.`);
    process.exitCode = 2;
    return null;
  }
  console.error(`Нашёл несколько по «${query}» — уточни, кого именно (или дай athlete_id):`);
  for (const m of result.matches) console.error(`  ${m.athleteId}  ${m.displayName}`);
  process.exitCode = 2;
  return null;
}

function usage(): void {
  console.log(
    [
      "tp-athlete — one athlete per command.",
      "",
      "  tp-athlete show <name|id>",
      "  tp-athlete set-threshold <name|id> [--pace 4:45] [--hr 168] [--apply --confirm \"APPLY THRESHOLD <id>\"]",
      "  tp-athlete add-race <name|id> --date YYYY-MM-DD --distance 10k|21.1k [--name \"...\"] [--apply --confirm \"APPLY RACE <id>\"]",
      "",
      "Writes are DRY-RUN unless --apply AND env TP_ATHLETE_REAL_WRITE=1 AND the exact --confirm phrase are all present.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  loadLocalEnv();
  const [, , sub, ...args] = process.argv;

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    usage();
    return;
  }

  const query = positionalQuery(args);

  if (sub === "show") {
    const match = await resolveOrExit(query);
    if (match) await runShow(match);
    return;
  }
  if (sub === "set-threshold") {
    const match = await resolveOrExit(query);
    if (!match) return;
    await runSetThreshold(match, {
      paceInput: getFlag(args, "--pace"),
      hrInput: getFlag(args, "--hr"),
      apply: hasFlag(args, "--apply"),
      confirm: getFlag(args, "--confirm"),
      evidence: getFlag(args, "--evidence"),
      tier: getFlag(args, "--tier"),
    });
    return;
  }
  if (sub === "add-race") {
    const match = await resolveOrExit(query);
    if (!match) return;
    await runAddRace(match, {
      date: getFlag(args, "--date"),
      distance: getFlag(args, "--distance"),
      name: getFlag(args, "--name"),
      apply: hasFlag(args, "--apply"),
      confirm: getFlag(args, "--confirm"),
    });
    return;
  }

  console.error(`Unknown subcommand "${sub}".`);
  usage();
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  // TpApiAuthError etc. surface here; keep the message, never the token.
  console.error("tp-athlete failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
