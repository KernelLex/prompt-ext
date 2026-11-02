import type { Mode, TaskType } from "../types";
import type { Technique } from "./types";

/**
 * Returns the catalog offered to the model for this mode, most relevant first.
 * Selection is deterministic and testable; the model chooses from this list (or uses none).
 */
export function selectCatalog(
  registry: ReadonlyMap<string, Technique>,
  mode: Mode,
  hint: TaskType,
): Technique[] {
  const allowed = [...registry.values()].filter((t) => t.modes.includes(mode));
  const score = (t: Technique): number => {
    if (t.selectWhen.length === 0) return 1; // general-purpose
    return t.selectWhen.includes(hint) ? 2 : 0;
  };
  return allowed
    .map((t, index) => ({ t, index, s: score(t) }))
    .sort((a, b) => b.s - a.s || a.index - b.index)
    .map((x) => x.t);
}

/** Renders the catalog compactly for the system prompt. */
export function renderCatalog(catalog: Technique[], hint: TaskType): string {
  return catalog
    .map((t) => {
      const fit = t.selectWhen.length === 0 || t.selectWhen.includes(hint) ? "" : " (less likely to fit this task)";
      const parts = t.components ? ` [${t.components.join(", ")}]` : "";
      return `- ${t.id} — ${t.name}${parts}: ${t.instruction} Avoid when: ${t.avoidWhen}.${fit}`;
    })
    .join("\n");
}
