# Prompt Enhancer (Chrome extension, MV3)

Rewrites the prompt in the text box you're typing in into a clearer, better-specified prompt, using **your own Groq API key**. The original is kept so you can undo. **The extension never sends or submits your message.** You review the result and send it yourself.

> **Status: MVP (v0.1.0), personal use.**
> - All automated tests pass against a **local mock** of Groq's API: 113 unit and 36 browser tests.
> - The extension has **not yet been run against the live Groq API.** The development environment's network policy blocks `api.groq.com`. See [Verification status](#verification-status).
> - Gemini support is deferred (plan decision D2).

## Contents
- [How it works](#how-it-works)
- [Install (developer mode)](#install-developer-mode)
- [Configure your Groq key](#configure-your-groq-key)
- [Use it](#use-it)
- [Permissions and data](#permissions-and-data)
- [Security limits of client-side API keys](#security-limits-of-client-side-api-keys)
- [Supported editors](#supported-editors)
- [Troubleshooting](#troubleshooting)
- [Development and testing](#development-and-testing)
- [Extending: providers and techniques](#extending-providers-and-techniques)
- [Verification status](#verification-status)
- [Before any public (Web Store) release](#before-any-public-web-store-release)

## How it works

1. Click into a prompt box and press **Alt+Shift+E**, or click the toolbar icon.
2. The extension injects a small script into that tab only (`activeTab`). The script reads the **focused** text box.
3. It sends that text, plus rewriting instructions, to Groq in **one** request.
4. It checks the result locally before inserting it:
   - Numbers, quotes, code, URLs, and paths from your prompt must survive.
   - The result must not be an answer instead of a rewrite.
   - It must not have switched language.
5. If the checks pass and you haven't edited the text in the meantime, the box's text is replaced. A toast offers **Undo**.

The rewriter follows a task-dependent technique catalog drawn from CO-STAR, RISEN, RTF, CREATE, APE, output-format specification, scope boundaries, and others. A **framework is a checklist, not a template**: short, clear prompts stay short. Modes:

| Mode | What it does |
|---|---|
| Light | Fixes wording and ambiguity. Adds no structure. |
| **Balanced** (default) | Adds format, constraints, or a clarifying-question request only when they help. |
| Deep | Decomposes the task and adds steps and success criteria when the task justifies it. |

## Install (developer mode)

Requirements: Node.js ≥ 20 and Chrome ≥ 116.

```bash
npm install
```

```bash
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. The settings page opens automatically on first install.

To get a zip instead, run `npm run package`. It creates `prompt-enhancer-0.1.0.zip`.

## Configure your Groq key

1. Create a key at console.groq.com → API Keys.
2. In the extension settings, paste it and click **Save key**. Chrome asks for permission to contact `api.groq.com`. This is the only site permission the extension requests.
3. Read the **Data & privacy** notice and tick the consent box. Enhancement is disabled until you do.
4. Optionally click **Test connection**. It checks the key and shows which supported models your key can use.
5. Optionally pick a model:
   - `openai/gpt-oss-120b` (default; reasoning effort "low").
   - `llama-3.3-70b-versatile` (non-reasoning, often faster).
   - `llama-3.1-8b-instant` (fastest, weaker).

Never put your key in source files, `.env` files, or the repo. Anything bundled into an extension is readable by anyone who installs it.

## Use it

| Action | How |
|---|---|
| Enhance | **Alt+Shift+E**, or click the toolbar icon |
| Undo | **Undo** in the toast (10 s), **Alt+Shift+Z** any time on that page, or native **Ctrl+Z** in plain text boxes |
| Cancel | **Cancel** in the toast, or **Esc** while enhancing |
| Change shortcuts | `chrome://extensions/shortcuts` |

What happens in other situations:
- **You type while it's enhancing.** Nothing is overwritten. You're offered *Replace anyway* or *Copy*.
- **A result fails a check.** Nothing is inserted. You can **Copy** it. If you enabled *Offer "Insert anyway"* in settings, overridable failures can also be inserted by an explicit click. Malformed results, and results that answer your prompt instead of rewriting it, can only be copied.
- **The text looks like it contains a secret.** For example, an API key or private key. You're asked before anything is sent.

## Permissions and data

| Permission | Why |
|---|---|
| `activeTab` | Temporary access to the current tab, granted only when you click the icon or press the shortcut |
| `scripting` | Injects the content script on demand. No script runs on any page until you trigger it. |
| `storage` | Settings, your key, and the circuit-breaker state |
| optional `https://api.groq.com/*` | Requested when you save a key, so the service worker can call Groq |

There are no `<all_urls>`, `tabs`, `webRequest`, or analytics permissions, and no always-on content scripts.

**What is sent, and only to Groq:** the extension's rewriting instructions, the mode, a task-type hint, and the text of the focused box. **Never sent:** page URL or title, other page content, conversation history, or any identifier.

**What is stored:**
- **Settings and your key** live in `chrome.storage.local`. If you untick *Remember my key*, the key is kept in memory-only session storage instead.
- **The original prompt**, kept for undo, lives only in the page's memory and is gone on navigation.
- **No prompt history** is kept.

Groq's handling of your requests is governed by your Groq account terms. Groq documents that logs may be kept up to 30 days, and that Zero Data Retention can be enabled in the console's data controls. Re-check the current terms; see [Verification status](#verification-status).

## Security limits of client-side API keys

- `chrome.storage` is **not encrypted at rest** beyond OS profile protections. Anyone with access to your Chrome profile or computer, or malware on it, can read a saved key. Other extensions cannot read this extension's storage directly, but a compromised browser can.
- The key never enters web pages or the content script. It is used only in the service worker and sent only in the `Authorization` header. It is never put in URLs or logs, and error messages are redacted.
- Prompt-injection text inside the prompt you're rewriting cannot be fully neutralized by instructions. The safety boundary is structural:
  - the output is plain text;
  - it is inserted only into the same box;
  - it is never executed;
  - it is never submitted.
- For shared machines, untick *Remember my key*.

## Supported editors

Tested automatically on local fixture pages in Chromium (Playwright, 2026-11-02):

| Editor | Status | Insertion method (first attempt) |
|---|---|---|
| `<textarea>` | ✅ Tested | `execCommand('insertText')`; native Ctrl+Z works |
| `<input type=text/search>` | ✅ Tested | Same as textarea. Newlines are collapsed to spaces. |
| React-controlled textarea | ✅ Tested (React state verified) | `execCommand('insertText')` |
| Plain `contenteditable` | ✅ Tested | `execCommand('insertText')` |
| Textarea in an **open** shadow root | ✅ Tested | `execCommand('insertText')` |
| ProseMirror (the editor family behind several AI chat UIs) | ✅ Tested (editor model verified) | Synthetic `text/plain` paste |
| Password, email, tel, number, and credit-card fields | 🚫 Refused by design | — |
| Closed shadow roots | 🚫 Unreachable | — |
| Editors inside cross-origin iframes | 🚫 Not supported (`activeTab` covers the main frame only) | — |
| Google Docs and other canvas editors, Monaco | 🚫 Not supported | — |
| chrome:// pages, Chrome Web Store, PDF viewer | 🚫 Chrome forbids injection | The badge shows "!" |
| Lexical, Slate, Quill, CodeMirror 6 | ⚠️ Untested | They should go through the same strategy chain. Every insert is read back; on mismatch the original is restored and **Copy** is offered. |
| Real sites (ChatGPT, Claude.ai, Gemini, and others) | ⚠️ **Not yet tested** | Needs a logged-in browser, which the development environment doesn't have |

## Troubleshooting

| Message | Fix |
|---|---|
| Settings open when you press the shortcut | Add a key and tick the consent box |
| "Groq rejected your API key" | Re-create the key in the Groq console and save it again |
| "Permission needed for Groq" | Save the key again and accept Chrome's permission prompt |
| "Groq quota reached" | Your free-tier limit is used up. The extension pauses requests until the reset time; **Try anyway** overrides this. |
| "Model not available" | Choose another model; use **Test connection** to see which work |
| "This field isn't supported" / "No text box selected" | Click into a regular text box. See [Supported editors](#supported-editors). |
| "Couldn't update this editor safely" | The editor rejected the change. Your text is unchanged; use **Copy enhanced** and paste. |
| Nothing happens and the badge shows "!" | The page doesn't allow extensions (chrome://, Web Store, PDF viewer) |

## Development and testing

| Command | What |
|---|---|
| `npm run build` / `npm run dev` | Production build to `dist/` / watch mode |
| `npm run check` | Typecheck, lint, unit tests, build, and dist safety check |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Builds `dist/` and `dist-test/`, then runs the Playwright browser tests: the real unpacked extension in Chromium against local fixture pages and a mock Groq-compatible server |
| `npm run screenshots` | Captures report screenshots of the running test build |
| `GROQ_API_KEY=… npm run eval:live` | **Opt-in** live evaluation on `eval/dataset.json`; skipped when no key is set. The key is read from the environment only. |

What the **test build** (`dist-test/`) adds:
- A host permission for `http://127.0.0.1/*`;
- a service-worker hook that starts the same workflow as the toolbar button, because automated browsers can't click the toolbar;
- an open shadow root for the toast, so tests can read it.

`scripts/check-dist.mjs` verifies none of these reach `dist/`.

Results as of 2026-11-02:
- 113/113 unit tests.
- 36/36 browser tests.
- Lint and typecheck clean.
- Dist safety check passed.
- **Live Groq calls not executed** (network policy).

## Extending: providers and techniques

- **New technique or framework:** add a `Technique` object to `src/engine/frameworks/definitions/` and a test. The engine needs no other change.
- **New provider** (e.g. Gemini, planned in M5):
  1. Implement `ProviderAdapter` (`src/providers/types.ts`) in `src/providers/<id>/`, mapping errors to `ProviderError`.
  2. Register it in `src/providers/registry.ts`.
  3. Add its host to `optional_host_permissions`.
  4. Update the consent text.

  The engine, parser, and validator are shared.

## Verification status

The live provider documentation could not be loaded from the development environment, which blocks `console.groq.com`, `ai.google.dev`, and `developer.chrome.com`. These items come from search snapshots of official pages and **should be re-checked**:
- Groq model IDs and free-tier limits (`src/providers/groq/config.ts`). The options page checks the model allowlist against `GET /models` for your key.
- Groq data-retention wording in the consent text.
- Groq error formats (429 message wording for daily vs per-minute limits).

## Before any public (Web Store) release

- Privacy policy, a data-use disclosure in the listing, and a justification for each permission.
- Decide between BYOK (no infrastructure) and a backend proxy. A proxy would need auth, per-user quotas, abuse prevention, hosting, and a logging policy. Free tiers are not meant to serve a public user base.
- If Gemini ships: Google's terms require paid services for API clients offered to users in the EEA, Switzerland, or the UK. The free tier also allows Google to use prompts for product improvement, including human review.
- Live tests on the real API and on target sites.
- Re-check the minimum Chrome version (116, for `AbortSignal.any`) and re-run `npm audit`. As of 2026-11-02 there are moderate advisories in dev-only ESLint dependencies; none ship.
