import { readFile } from "node:fs/promises";
import path from "node:path";

import { extractNutritionRowsFromFatSecretPdfText } from "@/features/nutrition/file-intake";
import { extractPdfTextFromBuffer } from "@/features/nutrition/pdf-extraction";

type ParsedArgs = {
  filePath: string | null;
  dumpText: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  let filePath: string | null = null;
  let dumpText = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token === "--dump-text") {
      dumpText = true;
      continue;
    }
    if (token === "--file") {
      filePath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
  }
  return { filePath, dumpText, help };
}

function printHelp(): void {
  console.log("Usage: npm run nutrition:inspect-pdf -- --file \"/absolute/path/to/file.pdf\" [--dump-text]");
  console.log("Safe diagnostics only; no output files are created.");
  console.log("Use --dump-text only locally. Do not commit output.");
}

function printFirstLines(text: string, maxLines = 40): void {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
  if (lines.length === 0) {
    console.log("first_lines: <none>");
    return;
  }
  console.log("first_lines:");
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.filePath) {
    printHelp();
    return;
  }

  const resolved = path.resolve(args.filePath);
  const bytes = new Uint8Array(await readFile(resolved));
  const pdf = await extractPdfTextFromBuffer(bytes);
  const parsed = pdf.ok
    ? extractNutritionRowsFromFatSecretPdfText({ text: pdf.text, sourceFileName: path.basename(resolved) })
    : null;

  const diagnostics = {
    fileName: path.basename(resolved),
    mime: "application/pdf",
    sizeBytes: bytes.byteLength,
    pageCount: pdf.pageCount,
    extractedTextLength: pdf.text.length,
    normalizedTextLength: pdf.text.replace(/\s+/g, " ").trim().length,
    keywords: parsed
      ? {
          kcal: parsed.diagnostics.hasKcalKeyword,
          protein: parsed.diagnostics.hasProteinKeyword,
          fat: parsed.diagnostics.hasFatKeyword,
          carbs: parsed.diagnostics.hasCarbsKeyword,
          dates: parsed.diagnostics.dateMatches,
        }
      : null,
    parsedRowsCount: parsed?.extractedRows.length ?? 0,
    warnings: [...pdf.warnings, ...(parsed?.warnings ?? [])],
    errorCode: pdf.errorCode,
  };

  console.log(JSON.stringify(diagnostics, null, 2));
  if (pdf.text) {
    printFirstLines(pdf.text, 30);
  }
  if (args.dumpText) {
    console.warn("WARNING: do not commit extracted text output.");
    console.log(pdf.text);
  }
}

void run();
