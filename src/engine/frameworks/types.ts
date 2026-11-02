import type { Mode, TaskType } from "../types";

export interface Technique {
  /** Stable identifier; the model must return these IDs. */
  id: string;
  name: string;
  kind: "framework" | "technique";
  /** The expansion this project uses. Acronyms are conventions, not standards. */
  components?: string[];
  intendedUse: string;
  /** Task types the technique typically fits. Empty = any. */
  selectWhen: TaskType[];
  avoidWhen: string;
  modes: Mode[];
  /** One-line instruction shown to the model in the catalog. */
  instruction: string;
  limitations: string;
  provenance: string;
}
