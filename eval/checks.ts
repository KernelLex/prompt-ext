import { languageSignature } from "../src/engine/output-validation";
import type { EnhancementContract } from "../src/engine/types";

export interface DatasetItem {
  id: string;
  category: string;
  mode: "light" | "balanced" | "deep";
  input: string;
  expect: {
    mustContain?: string[];
    mustNotContain?: string[];
    mustNotContainRegex?: string[];
    maxLengthRatio?: number;
    acceptableTaskTypes?: string[];
    techniquesShouldNot?: string[];
    sameScript?: boolean;
  };
}

export interface CheckResult {
  id: string;
  passed: boolean;
  failures: string[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

/** Deterministic, item-specific checks (plan §20.2). Human rubric scoring is separate. */
export function checkItem(item: DatasetItem, result: EnhancementContract): CheckResult {
  const out = result.enhanced_prompt;
  const failures: string[] = [];
  const e = item.expect;
  for (const s of e.mustContain ?? []) if (!norm(out).includes(norm(s))) failures.push(`missing "${s}"`);
  for (const s of e.mustNotContain ?? []) if (norm(out).includes(norm(s))) failures.push(`contains forbidden "${s}"`);
  for (const re of e.mustNotContainRegex ?? []) if (new RegExp(re, "i").test(out)) failures.push(`matches forbidden /${re}/`);
  const ratio = out.length / Math.max(item.input.length, 1);
  if (e.maxLengthRatio && ratio > e.maxLengthRatio) failures.push(`length ratio ${ratio.toFixed(1)} > ${e.maxLengthRatio}`);
  if (e.acceptableTaskTypes && !e.acceptableTaskTypes.includes(result.task_type)) failures.push(`task_type ${result.task_type} not in ${e.acceptableTaskTypes.join("/")}`);
  for (const t of e.techniquesShouldNot ?? []) if (result.techniques.includes(t)) failures.push(`used inappropriate technique ${t}`);
  if (e.sameScript && languageSignature(item.input) !== languageSignature(out)) failures.push("changed language/script");
  return { id: item.id, passed: failures.length === 0, failures };
}
