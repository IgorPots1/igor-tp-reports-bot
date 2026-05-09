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

export const TRAININGPEAKS_STUDENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

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

export function validateTrainingPeaksStudentId(value: string): string | null {
  if (!value) {
    return "Укажи технический код ученика.";
  }

  if (!TRAININGPEAKS_STUDENT_ID_PATTERN.test(value)) {
    return "Технический код должен начинаться с буквы или цифры и содержать только a-z, 0-9, '.', '_' или '-'.";
  }

  return null;
}
