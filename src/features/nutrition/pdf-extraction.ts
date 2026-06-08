type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

export type PdfTextExtractionErrorCode =
  | "invalid_pdf"
  | "password_protected"
  | "parse_failed"
  | "no_text_content";

export type PdfTextExtractionResult = {
  ok: boolean;
  text: string;
  pageCount: number | null;
  warnings: string[];
  errorCode: PdfTextExtractionErrorCode | null;
  extractionMethod: "pdfjs_text";
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function getPdfJsModule(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfJsModulePromise;
}

function mapPdfExtractionError(error: unknown): PdfTextExtractionErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("password")) {
    return "password_protected";
  }
  if (message.includes("invalid pdf") || message.includes("malformed")) {
    return "invalid_pdf";
  }
  return "parse_failed";
}

function compactPdfText(value: string): string {
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

type PdfTextItem = {
  str?: unknown;
  transform?: unknown;
};

type PositionedText = {
  text: string;
  x: number;
  y: number;
};

function toPositionedText(item: PdfTextItem): PositionedText | null {
  const text = typeof item.str === "string" ? item.str.trim() : "";
  if (!text) {
    return null;
  }
  const transform = Array.isArray(item.transform) ? item.transform : null;
  const x = typeof transform?.[4] === "number" ? transform[4] : Number.NaN;
  const y = typeof transform?.[5] === "number" ? transform[5] : Number.NaN;
  return {
    text,
    x,
    y,
  };
}

function appendPageText(items: unknown[]): string {
  const positioned: PositionedText[] = [];
  const fallbackChunks: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (!("str" in item)) {
      continue;
    }
    const positionedText = toPositionedText(item as PdfTextItem);
    if (!positionedText) {
      continue;
    }
    if (Number.isFinite(positionedText.x) && Number.isFinite(positionedText.y)) {
      positioned.push(positionedText);
    } else {
      fallbackChunks.push(positionedText.text);
    }
  }
  if (positioned.length === 0) {
    return fallbackChunks.join(" ");
  }

  const sorted = [...positioned].sort((a, b) => {
    const yDelta = b.y - a.y;
    if (Math.abs(yDelta) > 2) {
      return yDelta;
    }
    return a.x - b.x;
  });

  const rows: Array<{ y: number; chunks: PositionedText[] }> = [];
  for (const token of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate.y - token.y) <= 2);
    if (row) {
      row.chunks.push(token);
      continue;
    }
    rows.push({ y: token.y, chunks: [token] });
  }

  const pageLines = rows
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      row.chunks
        .sort((a, b) => a.x - b.x)
        .map((chunk) => chunk.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);

  if (pageLines.length === 0) {
    return fallbackChunks.join(" ");
  }
  return pageLines.join("\n");
}

export async function extractPdfTextFromBuffer(bytes: Uint8Array): Promise<PdfTextExtractionResult> {
  try {
    const pdfjs = await getPdfJsModule();
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      useSystemFonts: false,
    });
    const pdfDocument = await loadingTask.promise;
    const pageCount = pdfDocument.numPages;
    const pageTexts: string[] = [];

    for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
      const page = await pdfDocument.getPage(pageIndex);
      const content = await page.getTextContent();
      const pageText = appendPageText(content.items as unknown[]);
      if (pageText) {
        pageTexts.push(pageText);
      }
    }

    await loadingTask.destroy();
    const text = compactPdfText(pageTexts.join("\n"));
    if (!text) {
      return {
        ok: false,
        text: "",
        pageCount,
        warnings: ["pdf_text_empty", "unsupported_pdf_image_only"],
        errorCode: "no_text_content",
        extractionMethod: "pdfjs_text",
      };
    }

    return {
      ok: true,
      text,
      pageCount,
      warnings: [],
      errorCode: null,
      extractionMethod: "pdfjs_text",
    };
  } catch (error) {
    return {
      ok: false,
      text: "",
      pageCount: null,
      warnings: ["pdf_text_empty"],
      errorCode: mapPdfExtractionError(error),
      extractionMethod: "pdfjs_text",
    };
  }
}
