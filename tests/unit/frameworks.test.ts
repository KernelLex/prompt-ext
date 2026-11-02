import { describe, expect, it } from "vitest";
import { FRAMEWORKS } from "../../src/engine/frameworks/definitions/frameworks";
import { TECHNIQUES } from "../../src/engine/frameworks/definitions/techniques";
import { createRegistry, REGISTRY } from "../../src/engine/frameworks/registry";
import { renderCatalog, selectCatalog } from "../../src/engine/frameworks/select";
import type { Technique } from "../../src/engine/frameworks/types";
import { estimateTokens } from "../../src/engine/request-builder";
import { MODES } from "../../src/engine/types";

describe("framework registry", () => {
  it("contains every required framework and technique", () => {
    for (const id of ["co_star", "risen", "rtf", "create", "ape", "role_perspective", "explicit_instructions", "step_sequencing",
      "task_decomposition", "context_enrichment", "output_format", "few_shot", "success_criteria", "scope_boundaries",
      "ambiguity_reduction", "source_delimitation", "untrusted_input_handling"]) {
      expect(REGISTRY.has(id), id).toBe(true);
    }
  });

  it("every definition is complete and documents provenance", () => {
    for (const t of [...FRAMEWORKS, ...TECHNIQUES]) {
      expect(t.name && t.intendedUse && t.instruction && t.limitations && t.provenance && t.avoidWhen, t.id).toBeTruthy();
      expect(t.modes.length, t.id).toBeGreaterThan(0);
    }
    expect(REGISTRY.get("co_star")?.components).toEqual(["Context", "Objective", "Style", "Tone", "Audience", "Response"]);
    expect(REGISTRY.get("risen")?.components).toEqual(["Role", "Instructions", "Steps", "End goal", "Narrowing"]);
    expect(REGISTRY.get("ape")?.provenance).toMatch(/Automatic Prompt Engineer/);
    expect(REGISTRY.get("create")?.provenance).toMatch(/Conflicting expansions/);
  });

  it("rejects duplicate or malformed ids", () => {
    const t = TECHNIQUES[0]!;
    expect(() => createRegistry([t, t])).toThrow(/Duplicate/);
    expect(() => createRegistry([{ ...t, id: "Bad Id" }])).toThrow(/Invalid/);
    expect(() => createRegistry([{ ...t, id: "x", modes: [] }])).toThrow(/no modes/);
  });

  it("a new technique is added with a definition only — no engine change", () => {
    const extra: Technique = {
      id: "test_only_checklist", name: "Checklist", kind: "technique", intendedUse: "test", selectWhen: ["planning"],
      avoidWhen: "n/a", modes: ["deep"], instruction: "Turn requirements into a checklist.", limitations: "n/a", provenance: "test",
    };
    const reg = createRegistry([...TECHNIQUES, ...FRAMEWORKS, extra]);
    const catalog = selectCatalog(reg, "deep", "planning");
    expect(catalog.map((c) => c.id)).toContain("test_only_checklist");
    expect(selectCatalog(reg, "light", "planning").map((c) => c.id)).not.toContain("test_only_checklist");
  });
});

describe("selectCatalog", () => {
  it("light mode offers only minimal-edit techniques — never structure", () => {
    const ids = selectCatalog(REGISTRY, "light", "coding").map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["ambiguity_reduction", "explicit_instructions"]));
    for (const banned of ["co_star", "risen", "task_decomposition", "output_format", "success_criteria", "few_shot"]) expect(ids).not.toContain(banned);
  });

  it("deep mode offers decomposition; balanced does not", () => {
    expect(selectCatalog(REGISTRY, "deep", "analysis").map((t) => t.id)).toContain("task_decomposition");
    expect(selectCatalog(REGISTRY, "balanced", "analysis").map((t) => t.id)).not.toContain("task_decomposition");
  });

  it("orders task-relevant techniques before irrelevant ones", () => {
    const writing = selectCatalog(REGISTRY, "balanced", "writing").map((t) => t.id);
    expect(writing.indexOf("co_star")).toBeLessThan(writing.indexOf("success_criteria"));
    const coding = selectCatalog(REGISTRY, "balanced", "coding").map((t) => t.id);
    expect(coding.indexOf("success_criteria")).toBeLessThan(coding.indexOf("co_star"));
  });

  it("keeps the catalog within a token budget for every mode", () => {
    for (const mode of MODES) {
      const text = renderCatalog(selectCatalog(REGISTRY, mode, "other"), "other");
      expect(estimateTokens(text), mode).toBeLessThanOrEqual(1400);
    }
  });
});
