# Human evaluation rubric

The deterministic checks (`eval/checks.ts`, the output validator) catch mechanical failures only.
After a live run (`npm run eval:live`), a human scores each row of the generated report:

| Dimension | Score | Guide |
|---|---|---|
| Intent preservation | 1–5 | 5 = the same request; 1 = a different task |
| Clarity | 1–5 | Is it unambiguous what the target AI should do? |
| Specificity | 1–5 | Are the user's details and constraints explicit? |
| Relevance of structure | 1–5 | Is any added structure useful for *this* task? Unneeded structure lowers the score |
| Output-format clarity | 1–5 or n/a | Only when a format is implied |
| Invented requirements | yes/no | Any fact, constraint, audience, or example the user didn't imply = yes |

Acceptance thresholds (plan §20.3): intent ≥ 4.5 mean, clarity ≥ 4 mean, invented requirements = "no" on ≥ 90% of items.
These scores describe one dataset, model version, and instruction version. They are not a guarantee of future behavior.
Record scores in `eval/reports/human-<date>.md` together with the live report's file name.
