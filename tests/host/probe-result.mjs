import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function probePassed(report) {
  return report.reopened === true && Array.isArray(report.result?.steps) && report.result.steps.length > 0
    && Array.isArray(report.result?.errors) && report.result.errors.length === 0
    && Array.isArray(report.cleanupErrors) && report.cleanupErrors.length === 0;
}

export async function saveProbeReport(path, report) {
  const value = { ...report, passed: probePassed(report) };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  return value;
}
