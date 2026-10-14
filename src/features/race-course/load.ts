/* Чтение разборов трасс из src/data/race-courses (файлы собирает scripts/race-course/build.ts).
 * Только на сервере: страница igorp.run/races/<id>/trassa строится из этих файлов. */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { CourseData } from "./types";

const DIR = path.join(process.cwd(), "src", "data", "race-courses");

/** id старта → часть адреса: «probeg:81194» → «probeg_81194». */
export function courseSlug(raceId: string): string {
  return raceId.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function listCourses(): CourseData[] {
  let files: string[] = [];
  try {
    files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
  } catch {
    return [];
  }
  return files.map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as CourseData);
}

export function loadCourse(slug: string): CourseData | null {
  return listCourses().find((c) => courseSlug(c.raceId) === slug) ?? null;
}
