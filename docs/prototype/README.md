# UI prototype (for plan review)

These are static mockups of the planned UX. **They are not extension code.** The host page is a generic, unbranded chat UI that stands in for any supported site. Model names, latency, and dates in the mockups are illustrative.

| # | Screen | Plan reference |
|---|---|---|
| 01 | [Before: rough prompt in the field](screenshots/01-before.png) | US1 |
| 02 | [Enhancing: progress, Cancel, badge `…`](screenshots/02-enhancing.png) | §13.2, FR19–20 |
| 03 | [Enhanced in place, not sent, Undo](screenshots/03-enhanced.png) | US1–2, FR23 |
| 04 | [Already clear: no changes](screenshots/04-already-clear.png) | US3 |
| 05 | [Invalid key error, original untouched](screenshots/05-error-auth.png) | US5, FR22 |
| 06 | [Quota reached: circuit breaker](screenshots/06-error-quota.png) | FR18 |
| 07 | [User edited during the request](screenshots/07-field-changed.png) | US6, FR12 |
| 08 | [Result failed local validation](screenshots/08-validation-failed.png) | §11.6, Q3 |
| 09 | [Unsupported editor](screenshots/09-unsupported.png) | US7, §14 |
| 10 | [Settings page](screenshots/10-options.png) | §13.3 |
| 11 | [First run and consent](screenshots/11-first-run.png) | §13.4–13.5 |

Regenerate the screenshots (needs Playwright with Chromium):

```bash
node docs/prototype/render.mjs
```

To view a single state, open `mockup.html#<state-id>` in a browser, e.g. `mockup.html#03-enhanced`.
