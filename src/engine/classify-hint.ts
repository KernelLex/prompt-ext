import type { TaskType } from "./types";

/**
 * Cheap, deterministic task-type hint. Advisory only: it orders the technique catalog and is
 * passed to the model, which may override it. Being wrong here must never be harmful.
 */
const RULES: Array<{ type: TaskType; patterns: RegExp[] }> = [
  {
    type: "coding",
    patterns: [
      /```/, /\b(code|script|function|class|method|bug|debug|refactor|compile|stack ?trace|regex|sql|api|endpoint|unit tests?)\b/i,
      /\b(python|javascript|typescript|java|c\+\+|c#|golang|rust|ruby|php|kotlin|swift|bash|react|node(\.js)?|django|css|html)\b/i,
    ],
  },
  { type: "research", patterns: [/\b(research|sources?|citations?|literature|studies|evidence|compare .* (papers|studies)|state of the art)\b/i] },
  {
    type: "analysis",
    patterns: [/\b(analy[sz]e|analysis|evaluate|assess|pros and cons|trade-?offs?|root cause|compare|critique|review)\b/i],
  },
  { type: "planning", patterns: [/\b(plan|roadmap|schedule|itinerary|strategy|steps to|checklist|timeline|milestones?)\b/i] },
  {
    type: "creative",
    patterns: [/\b(story|poem|lyrics|song|fiction|character|plot|joke|haiku|screenplay|creative|brainstorm (names|ideas))\b/i],
  },
  {
    type: "writing",
    patterns: [/\b(write|draft|rewrite|email|letter|essay|blog|post|cover letter|summary|summari[sz]e|proofread|edit|tone)\b/i],
  },
  {
    type: "factual",
    patterns: [/^(what|who|when|where|which|how (many|much|far|long|old)|is|are|does|do|can)\b[^.!]*\?\s*$/i],
  },
];

export function hintTaskType(text: string): TaskType {
  const sample = text.slice(0, 4000);
  let best: { type: TaskType; score: number } = { type: "other", score: 0 };
  for (const rule of RULES) {
    const score = rule.patterns.reduce((n, re) => n + (re.test(sample) ? 1 : 0), 0);
    if (score > best.score) best = { type: rule.type, score };
  }
  return best.type;
}
