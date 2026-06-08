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

function appendPageText(items: unknown[]): string {
  const chunks: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (!("str" in item)) {
      continue;
    }
    const text = typeof item.str === "string" ? item.str.trim() : "";
    if (!text) {
      continue;
    }
    chunks.push(text);
  }
  return chunks.join(" ");
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
        warnings: ["PDF не удалось прочитать как текст."],
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
      warnings: ["PDF не удалось прочитать как текст."],
      errorCode: mapPdfExtractionError(error),
      extractionMethod: "pdfjs_text",
    };
  }
}
