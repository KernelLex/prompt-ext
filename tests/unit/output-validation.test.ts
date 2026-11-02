import { describe, expect, it } from "vitest";
import { dominantScript, extractPreservedItems, guessLatinLanguage, validateOutput } from "../../src/engine/output-validation";
import type { EnhancementContract } from "../../src/engine/types";

const r = (enhanced: string, changed = true): EnhancementContract => ({
  enhanced_prompt: enhanced, changed, task_type: "other", techniques: [], missing_info: [], notes: "",
});

describe("extractPreservedItems", () => {
  it("finds numbers, quotes, urls, code, emails, paths, mentions", () => {
    const items = extractPreservedItems(
      'Summarize "Q3 results" in under 120 words, cite https://example.com/a?b=1, run `npm test`, email ana@example.org, edit src/app/main.py, ping @dev_team, budget $4.2M (up 18%)\n```py\nprint(1)\n```',
    );
    expect(items).toEqual(expect.arrayContaining(["Q3 results", "120", "https://example.com/a?b=1", "npm test", "ana@example.org", "src/app/main.py", "@dev_team", "$4.2M", "18%", "print(1)"]));
  });
});

describe("validateOutput", () => {
  const original = 'Summarize this in under 120 words for a board update: "Q3 revenue was $4.2M, up 18%"';

  it("passes a faithful rewrite", () => {
    const out = 'Write a summary of the text below in under 120 words for a board update.\n\nText: "Q3 revenue was $4.2M, up 18%"';
    expect(validateOutput(original, r(out), "balanced")).toMatchObject({ status: "pass", unchanged: false });
  });

  it("detects an unchanged prompt (whitespace-insensitive)", () => {
    expect(validateOutput("What is 2+2?", r("What is  2+2? "), "balanced")).toMatchObject({ status: "pass", unchanged: true });
  });

  it("blocks empty output (blocking)", () => {
    expect(validateOutput(original, r("  "), "balanced")).toMatchObject({ status: "fail", overridable: false });
  });

  it("flags dropped numbers/quotes as overridable", () => {
    const res = validateOutput(original, r("Summarize the quarterly results briefly for the board."), "balanced");
    expect(res.status).toBe("fail");
    if (res.status === "fail") {
      expect(res.overridable).toBe(true);
      expect(res.issues[0]?.items).toEqual(expect.arrayContaining(["120"]));
    }
  });

  it("tolerates thousands separators in numbers", () => {
    const res = validateOutput("clean a csv with 50000 rows", r("Write a script that cleans a CSV file with 50,000 rows."), "balanced");
    expect(res.status).not.toBe("fail");
  });

  it("blocks answer-instead-of-rewrite (not overridable)", () => {
    const res = validateOutput("what is the capital of france", r("Sure! The capital of France is Paris."), "balanced");
    expect(res).toMatchObject({ status: "fail", overridable: false });
  });

  it("blocks leaked markers and system text", () => {
    expect(validateOutput("tell me a joke", r("<<<PROMPT-abc>>> tell me a joke"), "light")).toMatchObject({ status: "fail", overridable: false });
    expect(validateOutput("tell me a joke", r("ABSOLUTE RULES: ..."), "light")).toMatchObject({ status: "fail", overridable: false });
  });

  it("blocks absurdly long output", () => {
    expect(validateOutput("short ask here", r("word ".repeat(1000)), "deep")).toMatchObject({ status: "fail", overridable: false });
  });

  it("flags a new code block as overridable", () => {
    const res = validateOutput("write a function that adds two numbers", r("Write a function:\n```js\nfunction add(a,b){return a+b}\n```"), "balanced");
    expect(res).toMatchObject({ status: "fail", overridable: true });
  });

  it("flags a language switch as overridable", () => {
    const res = validateOutput("Напиши короткое письмо коллеге о встрече в пятницу", r("Write a short email to a colleague about the Friday meeting."), "balanced");
    expect(res).toMatchObject({ status: "fail", overridable: true });
  });

  it("warns (but passes) on large expansion", () => {
    const res = validateOutput("Explain recursion", r("Explain recursion to a beginner. ".repeat(12)), "light");
    expect(res.status).toBe("warn");
  });

  it("guesses common Latin-script languages and abstains when unsure", () => {
    expect(guessLatinLanguage("Escribe un correo breve a mi equipo para recordarles la reunión del viernes")).toBe("es");
    expect(guessLatinLanguage("Write a short email to my team to remind them about the meeting on Friday")).toBe("en");
    expect(guessLatinLanguage("Schreibe eine kurze E-Mail an mein Team, dass die Besprechung nicht stattfindet")).toBe("de");
    expect(guessLatinLanguage("fix bug pls")).toBeNull();
  });

  it("flags Spanish → English translation as overridable", () => {
    const res = validateOutput("Escribe un correo breve a mi equipo para recordarles la reunión del viernes a las 10:00.", r("Write a short email to my team to remind them about the meeting on Friday at 10:00."), "balanced");
    expect(res).toMatchObject({ status: "fail", overridable: true });
  });

  it("dominantScript ignores short/mixed text", () => {
    expect(dominantScript("hi")).toBeNull();
    expect(dominantScript("hello world friends")).toBe("latin");
  });
});
