import type { Technique } from "./frameworks/types";
import { TASK_TYPES, type EnhancementContract, type TaskType } from "./types";

export type ParseResult = { ok: true; value: EnhancementContract } | { ok: false; detail: string };

/** Parses the model's raw text into the shared contract. Identical for every provider. */
export function parseEnhancement(raw: string, registry: ReadonlyMap<string, Technique>): ParseResult {
  let text = raw.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, detail: "Response was not valid JSON." };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, detail: "Response was not a JSON object." };
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.enhanced_prompt !== "string") {
    return { ok: false, detail: "Response had no enhanced_prompt string." };
  }

  const taskType: TaskType = TASK_TYPES.includes(obj.task_type as TaskType) ? (obj.task_type as TaskType) : "other";
  const techniques = Array.isArray(obj.techniques)
    ? [...new Set(obj.techniques.filter((t): t is string => typeof t === "string" && registry.has(t)))]
    : [];
  const missingInfo = Array.isArray(obj.missing_info)
    ? obj.missing_info.filter((m): m is string => typeof m === "string").slice(0, 5).map((m) => m.slice(0, 120))
    : [];
  const notes = typeof obj.notes === "string" ? obj.notes.slice(0, 200) : "";

  return {
    ok: true,
    value: {
      enhanced_prompt: obj.enhanced_prompt,
      changed: typeof obj.changed === "boolean" ? obj.changed : true,
      task_type: taskType,
      techniques,
      missing_info: missingInfo,
      notes,
    },
  };
}
