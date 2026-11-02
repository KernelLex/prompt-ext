import { FRAMEWORKS } from "./definitions/frameworks";
import { TECHNIQUES } from "./definitions/techniques";
import type { Technique } from "./types";

/**
 * The framework/technique registry. To add a technique: add a definition to a file in
 * `definitions/` (or a new file), include it below, and add a test. The engine needs no other change.
 */
export function createRegistry(defs: Technique[]): ReadonlyMap<string, Technique> {
  const map = new Map<string, Technique>();
  for (const def of defs) {
    if (map.has(def.id)) throw new Error(`Duplicate technique id: ${def.id}`);
    if (!/^[a-z][a-z0-9_]*$/.test(def.id)) throw new Error(`Invalid technique id: ${def.id}`);
    if (def.modes.length === 0) throw new Error(`Technique ${def.id} has no modes`);
    map.set(def.id, def);
  }
  return map;
}

export const REGISTRY: ReadonlyMap<string, Technique> = createRegistry([...TECHNIQUES, ...FRAMEWORKS]);
