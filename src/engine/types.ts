export type Mode = "light" | "balanced" | "deep";
export const MODES: readonly Mode[] = ["light", "balanced", "deep"];

export type TaskType = "coding" | "research" | "writing" | "analysis" | "factual" | "planning" | "creative" | "other";
export const TASK_TYPES: readonly TaskType[] = [
  "coding", "research", "writing", "analysis", "factual", "planning", "creative", "other",
];

/** Provider-neutral request. Adapters map this onto their wire format; nothing else is sent. */
export interface ProviderRequest {
  system: string;
  user: string;
  /** Upper bound for visible output tokens. Adapters may add model-specific headroom (e.g. reasoning). */
  maxOutputTokens: number;
  temperature: number;
}

/** The response contract every provider must satisfy (plan §11.4). */
export interface EnhancementContract {
  enhanced_prompt: string;
  changed: boolean;
  task_type: TaskType;
  techniques: string[];
  missing_info: string[];
  notes: string;
}
