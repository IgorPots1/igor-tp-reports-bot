import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const scriptsRoot = path.resolve(__dirname, "..");
export const toolRoot = path.resolve(scriptsRoot, "..");
export const configRoot = path.join(toolRoot, "config");
export const exportsRoot = path.join(toolRoot, "exports");
export const parsedRoot = path.join(toolRoot, "parsed");
export const reportsRoot = path.join(toolRoot, "reports");
export const profileDir = path.join(toolRoot, ".playwright-profile", "trainingpeaks");
export const studentsConfigPath = path.join(configRoot, "students.json");
export const studentsExamplePath = path.join(configRoot, "students.example.json");
