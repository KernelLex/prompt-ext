import { normalizeForCompare } from "../shared/text";
import type { EnhancementContract, Mode } from "./types";

/**
 * Local, deterministic checks on a parsed result (plan §11.6, decision D3).
 * - blocking:    never insertable (structurally invalid or unsafe to treat as a rewrite). Copy only.
 * - overridable: not auto-inserted; "Insert anyway" may be offered if the user enabled it.
 * - warning:     informational; does not block insertion.
 * These catch mechanical violations only. They cannot prove intent was preserved.
 */
export type Severity = "blocking" | "overridable" | "warning";

export interface ValidationIssue {
  code:
    | "empty"
    | "too_long"
    | "leaked_markers"
    | "answered_instead"
    | "missing_preserved_items"
    | "unexpected_code_block"
    | "language_mismatch"
    | "length_ratio";
  severity: Severity;
  detail: string;
  items?: string[];
}

export type OutputCheck =
  | { status: "pass" | "warn"; unchanged: boolean; issues: ValidationIssue[] }
  | { status: "fail"; overridable: boolean; issues: ValidationIssue[] };

const LENGTH_RATIO_WARN: Record<Mode, number> = { light: 1.5, balanced: 3, deep: 6 };
const ANSWER_OPENERS =
  /^(sure|certainly|of course|absolutely|great question|here(?:'s| is| are)\b|i(?:'d| would) be (?:happy|glad)|as an ai\b|below is\b)/i;

/** Extracts items that must survive a rewrite verbatim. */
export function extractPreservedItems(text: string): string[] {
  const items = new Set<string>();
  const add = (s: string | undefined) => {
    const v = s?.trim();
    if (v && v.length > 0) items.add(v);
  };
  let rest = text;
  // Fenced code blocks: keep their content; remove from further scanning.
  rest = rest.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, body: string) => {
    add(body);
    return " ";
  });
  rest = rest.replace(/`([^`\n]+)`/g, (_m, body: string) => {
    add(body);
    return " ";
  });
  for (const m of rest.matchAll(/\bhttps?:\/\/[^\s<>"'`)\]]+/g)) add(m[0].replace(/[.,;:!?]+$/, ""));
  rest = rest.replace(/\bhttps?:\/\/[^\s<>"'`)\]]+/g, " ");
  for (const m of rest.matchAll(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g)) add(m[0]);
  rest = rest.replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, " ");
  for (const m of rest.matchAll(/"([^"\n]{2,200})"|“([^”\n]{2,200})”/g)) add(m[1] ?? m[2]);
  for (const m of rest.matchAll(/(?:^|\s)(@[A-Za-z0-9_][\w.-]*)/g)) add(m[1]);
  for (const m of rest.matchAll(/(?:^|[\s(])((?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})\b/g)) add(m[1]);
  for (const m of rest.matchAll(/[$€£¥]?\d+(?:[.,]\d+)*(?:\s?%|[kKmMbB]\b|\s?(?:ms|s|px|kb|mb|gb|tb|km|kg|cm|mm)\b)?/g)) add(m[0]);
  return [...items];
}

function containsPreserved(output: string, item: string): boolean {
  const norm = (s: string) => normalizeForCompare(s).replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const out = norm(output);
  if (out.includes(norm(item))) return true;
  // Numbers: tolerate thousands separators ("50000" vs "50,000").
  if (/^[$€£¥]?\d/.test(item)) return out.replace(/(\d),(\d)/g, "$1$2").includes(norm(item).replace(/(\d),(\d)/g, "$1$2"));
  return false;
}

type Script = "latin" | "cyrillic" | "greek" | "arabic" | "hebrew" | "devanagari" | "cjk" | "hangul" | "thai";
const SCRIPTS: Array<[Script, RegExp]> = [
  ["latin", /\p{Script=Latin}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["greek", /\p{Script=Greek}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["cjk", /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["hangul", /\p{Script=Hangul}/u],
  ["thai", /\p{Script=Thai}/u],
];

export function dominantScript(text: string): Script | null {
  const counts = new Map<Script, number>();
  let total = 0;
  for (const ch of text) {
    for (const [name, re] of SCRIPTS) {
      if (re.test(ch)) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        total++;
        break;
      }
    }
  }
  if (total < 10) return null;
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return best && n / total >= 0.6 ? best : null;
}

const STOPWORDS: Record<string, string[]> = {
  en: ["the", "and", "is", "to", "of", "for", "with", "my", "your", "that", "this", "it", "a", "on", "in", "about", "me", "what", "how"],
  es: ["el", "la", "los", "las", "y", "es", "de", "del", "para", "con", "mi", "que", "un", "una", "por", "en", "al", "su", "como"],
  fr: ["le", "la", "les", "et", "est", "de", "des", "pour", "avec", "mon", "que", "un", "une", "du", "en", "sur", "au", "ce", "vous"],
  de: ["der", "die", "das", "und", "ist", "zu", "von", "für", "mit", "mein", "dass", "ein", "eine", "den", "im", "auf", "nicht", "sie"],
  pt: ["o", "os", "as", "e", "é", "de", "do", "da", "para", "com", "meu", "que", "um", "uma", "em", "no", "na", "por"],
  it: ["il", "lo", "gli", "e", "è", "di", "del", "della", "per", "con", "mio", "che", "un", "una", "in", "nel", "sul", "non"],
};

/** Rough language guess for Latin-script text via stopword counts; null when unsure. */
export function guessLatinLanguage(text: string): string | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 6) return null;
  const scores = Object.entries(STOPWORDS).map(([lang, list]) => {
    const set = new Set(list);
    return [lang, words.filter((w) => set.has(w)).length] as const;
  });
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (!best || best[1] < 3 || (second && best[1] < second[1] * 1.5)) return null;
  return best[0];
}

/** Script, refined by a language guess for Latin script. */
export function languageSignature(text: string): string | null {
  const script = dominantScript(text);
  if (script !== "latin") return script;
  const lang = guessLatinLanguage(text);
  return lang ? `latin:${lang}` : null;
}

export function validateOutput(original: string, result: EnhancementContract, mode: Mode): OutputCheck {
  const out = result.enhanced_prompt;
  const issues: ValidationIssue[] = [];

  if (out.trim().length === 0) {
    return { status: "fail", overridable: false, issues: [{ code: "empty", severity: "blocking", detail: "The provider returned an empty prompt." }] };
  }

  if (normalizeForCompare(out) === normalizeForCompare(original)) {
    return { status: "pass", unchanged: true, issues: [] };
  }

  if (out.length > Math.max(4 * original.length, original.length + 3000)) {
    issues.push({ code: "too_long", severity: "blocking", detail: "The rewrite is far longer than the original." });
  }
  if (/<<<(?:END-)?PROMPT-/.test(out) || /TECHNIQUE CATALOG|ABSOLUTE RULES/.test(out)) {
    issues.push({ code: "leaked_markers", severity: "blocking", detail: "The rewrite contains internal instructions or markers." });
  }
  if (ANSWER_OPENERS.test(out.trim()) && !ANSWER_OPENERS.test(original.trim())) {
    issues.push({ code: "answered_instead", severity: "blocking", detail: "The provider answered the prompt instead of rewriting it." });
  }

  const missing = extractPreservedItems(original).filter((item) => !containsPreserved(out, item));
  if (missing.length > 0) {
    issues.push({
      code: "missing_preserved_items",
      severity: "overridable",
      detail: "The rewrite dropped or changed details from your prompt.",
      items: missing.slice(0, 5),
    });
  }
  if (/```/.test(out) && !/```/.test(original)) {
    issues.push({ code: "unexpected_code_block", severity: "overridable", detail: "The rewrite added a code block, which may be an answer rather than a prompt." });
  }
  const langIn = languageSignature(original);
  const langOut = languageSignature(out);
  if (langIn && langOut && langIn !== langOut) {
    issues.push({ code: "language_mismatch", severity: "overridable", detail: "The rewrite appears to be in a different language." });
  }
  const shortFloor = 120; // very short prompts may legitimately grow more
  const ratio = out.length / Math.max(original.length, shortFloor);
  if (ratio > LENGTH_RATIO_WARN[mode]) {
    issues.push({ code: "length_ratio", severity: "warning", detail: `The rewrite is ${ratio.toFixed(1)}× longer than expected for ${mode} mode.` });
  }

  const failing = issues.filter((i) => i.severity !== "warning");
  if (failing.length > 0) {
    return { status: "fail", overridable: failing.every((i) => i.severity === "overridable"), issues };
  }
  return { status: issues.length > 0 ? "warn" : "pass", unchanged: false, issues };
}
