// Mirrors src/lib/trainingpeaks-student-id.ts for local CLI scripts (keep in sync).

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function transliterateStudentIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split("")
    .map((character) => CYRILLIC_TO_LATIN_MAP[character] ?? character)
    .join("");
}

export function normalizeTrainingPeaksStudentId(value: string): string {
  return transliterateStudentIdPart(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`"]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "");
}
