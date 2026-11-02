#!/usr/bin/env python3
"""Builds project_report.pdf with ReportLab Platypus.

Sources of truth: report/source/user-prompts/*.txt (verbatim user messages, key redacted),
report/assets/test-results/*.txt (captured command output), report/assets/screenshots/*.png
(genuine captures of the running extension), report/diagrams/*.png, plan.md, README.md.

Usage: python3 report/build_report.py
"""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, CondPageBreak, Frame, Image, KeepTogether, NextPageTemplate, PageBreak, PageTemplate,
    Paragraph, Spacer, Table, TableStyle, XPreformatted,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / "report"
SHOTS = REPORT / "assets" / "screenshots"
RESULTS = REPORT / "assets" / "test-results"
PROMPTS = REPORT / "source" / "user-prompts"
OUT = ROOT / "project_report.pdf"
TODAY = dt.date.today().isoformat()

# ---------- fonts & styles ----------
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
pdfmetrics.registerFont(TTFont("Sans", str(FONT_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Sans-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))
# DejaVu Sans Oblique is not installed here; italic maps to the regular face (keeps full glyph coverage: ①, →, ≤).
pdfmetrics.registerFont(TTFont("Sans-Oblique", str(FONT_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Sans-BoldOblique", str(FONT_DIR / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Mono", str(FONT_DIR / "DejaVuSansMono.ttf")))
pdfmetrics.registerFontFamily("Sans", normal="Sans", bold="Sans-Bold", italic="Sans-Oblique", boldItalic="Sans-BoldOblique")

INK = colors.HexColor("#1d2330")
MUTED = colors.HexColor("#5d6677")
ACCENT = colors.HexColor("#4f46e5")
RULE = colors.HexColor("#dfe3ea")
SOFT = colors.HexColor("#f4f5fb")
WARN_BG = colors.HexColor("#fdf5e1")

S = {
    "body": ParagraphStyle("body", fontName="Sans", fontSize=9.6, leading=13.6, textColor=INK, spaceAfter=5),
    "small": ParagraphStyle("small", fontName="Sans", fontSize=8.2, leading=11, textColor=MUTED),
    "bullet": ParagraphStyle("bullet", fontName="Sans", fontSize=9.6, leading=13.4, textColor=INK, leftIndent=12, bulletIndent=2, spaceAfter=2),
    "h1": ParagraphStyle("h1", fontName="Sans-Bold", fontSize=16, leading=20, textColor=ACCENT, spaceBefore=4, spaceAfter=10),
    "h2": ParagraphStyle("h2", fontName="Sans-Bold", fontSize=12, leading=15.5, textColor=INK, spaceBefore=10, spaceAfter=5),
    "h3": ParagraphStyle("h3", fontName="Sans-Bold", fontSize=10.2, leading=13.5, textColor=INK, spaceBefore=7, spaceAfter=3),
    "caption": ParagraphStyle("caption", fontName="Sans-Oblique", fontSize=8.2, leading=11, textColor=MUTED, alignment=TA_CENTER, spaceBefore=3, spaceAfter=10),
    "quote": ParagraphStyle("quote", fontName="Sans", fontSize=8.8, leading=12.2, textColor=INK, leftIndent=10, rightIndent=4,
                            backColor=SOFT, borderPadding=(5, 6, 5, 6), spaceBefore=4, spaceAfter=8),
    "verbatim": ParagraphStyle("verbatim", fontName="Sans", fontSize=7.9, leading=10.6, textColor=INK, leftIndent=8, rightIndent=4,
                               backColor=SOFT, borderPadding=(3, 5, 3, 5), spaceAfter=0),
    "code": ParagraphStyle("code", fontName="Mono", fontSize=7.6, leading=10, textColor=colors.HexColor("#111827"),
                           backColor=colors.HexColor("#f3f4f6"), borderPadding=(5, 6, 5, 6), leftIndent=6, spaceBefore=3, spaceAfter=8),
    "cell": ParagraphStyle("cell", fontName="Sans", fontSize=8.1, leading=10.6, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="Sans-Bold", fontSize=8.1, leading=10.6, textColor=INK),
    "label": ParagraphStyle("label", fontName="Sans-Bold", fontSize=8.4, leading=11, textColor=colors.white, backColor=colors.HexColor("#b42318"),
                            borderPadding=(3, 5, 3, 5), alignment=TA_CENTER, spaceBefore=4, spaceAfter=6),
    "toc1": ParagraphStyle("toc1", fontName="Sans-Bold", fontSize=10, leading=15, leftIndent=0),
    "toc2": ParagraphStyle("toc2", fontName="Sans", fontSize=9, leading=12.5, leftIndent=16, textColor=MUTED),
}


def md(text: str) -> str:
    """Escapes text and applies tiny inline markdown: **bold**, `code`, *italic*."""
    t = escape(text)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"`([^`]+)`", r'<font name="Mono" size="8.4">\1</font>', t)
    t = re.sub(r"(?<![*\w])\*(?!\s)([^*]+?)\*(?!\w)", r"<i>\1</i>", t)
    return t


def P(text: str, style: str = "body") -> Paragraph:
    return Paragraph(md(text), S[style])


def bullets(items: list[str]) -> list[Paragraph]:
    return [Paragraph(md(i), S["bullet"], bulletText="•") for i in items]


def code(text: str) -> XPreformatted:
    return XPreformatted(escape(text.strip("\n")), S["code"])


def table(rows: list[list[str]], widths: list[float], header: bool = True) -> Table:
    data = [[Paragraph(md(c), S["cellb" if (header and r == 0) else "cell"]) for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eaf6")))
    t.setStyle(TableStyle(style))
    return t


FIG = [0]


def figure(path: Path, caption: str, max_w: float = 160 * mm, max_h: float = 98 * mm, mockup: bool = False) -> KeepTogether:
    """Image scaled to fit (aspect ratio preserved, never stretched) + numbered caption."""
    FIG[0] += 1
    iw, ih = ImageReader(str(path)).getSize()
    scale = min(max_w / iw, max_h / ih)
    img = Image(str(path), width=iw * scale, height=ih * scale)
    img.hAlign = "CENTER"
    parts = []
    if mockup:
        parts.append(Paragraph("CONCEPTUAL MOCKUP — static design prototype, NOT the working extension", S["label"]))
    parts += [img, Paragraph(f"Figure {FIG[0]}. {md(caption)}", S["caption"])]
    return KeepTogether(parts)


# ---------- document with TOC + numbered headings ----------
class ReportDoc(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(filename, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=20 * mm, bottomMargin=18 * mm,
                         title="AI-Powered Prompt Enhancement Chrome Extension — Project Report",
                         author="Prepared with Claude Code", subject="Project report")
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="f")
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[frame], onPage=self._cover_page),
            PageTemplate(id="main", frames=[frame], onPage=self._main_page),
        ])

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and getattr(flowable, "_toc_level", None) is not None:
            text = flowable.getPlainText()
            key = f"h{id(flowable)}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=flowable._toc_level, closed=False)
            self.notify("TOCEntry", (flowable._toc_level, text, self.page, key))

    @staticmethod
    def _cover_page(canv, doc):
        canv.saveState()
        canv.setFillColor(ACCENT)
        canv.rect(0, A4[1] - 18 * mm, A4[0], 18 * mm, fill=1, stroke=0)
        canv.restoreState()

    @staticmethod
    def _main_page(canv, doc):
        canv.saveState()
        canv.setFont("Sans", 7.5)
        canv.setFillColor(MUTED)
        canv.drawString(20 * mm, A4[1] - 12 * mm, "AI-Powered Prompt Enhancement Chrome Extension — Project Report")
        canv.drawRightString(A4[0] - 20 * mm, A4[1] - 12 * mm, f"v0.1.0 · {TODAY}")
        canv.setStrokeColor(RULE)
        canv.line(20 * mm, A4[1] - 14 * mm, A4[0] - 20 * mm, A4[1] - 14 * mm)
        canv.drawCentredString(A4[0] / 2, 10 * mm, f"Page {doc.page}")
        canv.restoreState()


SEC = [1, 0]  # the cover page is section 1 in the user's required outline


def h1(title: str) -> list:
    SEC[0] += 1
    SEC[1] = 0
    p = Paragraph(f"{SEC[0]}. {escape(title)}", S["h1"])
    p._toc_level = 0
    return [PageBreak(), p]


def h2(title: str) -> list:
    SEC[1] += 1
    p = Paragraph(f"{SEC[0]}.{SEC[1]} {escape(title)}", S["h2"])
    p._toc_level = 1
    return [CondPageBreak(30 * mm), p]


def h3(title: str) -> Paragraph:
    return Paragraph(escape(title), S["h3"])


def verbatim_block(text: str) -> list:
    """Renders a long verbatim message as wrap-safe paragraph blocks (splits across pages)."""
    out = []
    for block in re.split(r"\n\s*\n", text.strip("\n")):
        lines = [escape(line) for line in block.split("\n")]
        out.append(Paragraph("<br/>".join(lines), S["verbatim"]))
        out.append(Spacer(1, 3))
    return out


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ---------- content ----------
def cover() -> list:
    return [
        Spacer(1, 40 * mm),
        Paragraph("AI-Powered Prompt Enhancement Chrome Extension", ParagraphStyle("t", fontName="Sans-Bold", fontSize=24, leading=30, textColor=INK)),
        Spacer(1, 6 * mm),
        Paragraph("Project report", ParagraphStyle("st", fontName="Sans", fontSize=14, leading=18, textColor=ACCENT)),
        Spacer(1, 10 * mm),
        P("A Manifest V3 Chrome extension that rewrites the prompt in the focused text box into a clearer, better-specified prompt "
          "using the user's own Groq API key. It applies task-dependent prompt-engineering techniques, validates every result locally, "
          "replaces the text in place with full undo, and never submits anything on the user's behalf."),
        Spacer(1, 12 * mm),
        table([
            ["Item", "Value"],
            ["Report generated", TODAY],
            ["Project version / milestone", "v0.1.0 — Groq MVP (milestones M0–M4 complete; M6/M7 partial; M5 Gemini deferred)"],
            ["Repository / branch", "KernelLex/prompt-ext · claude/eloquent-darwin-i4nfne"],
            ["Prepared by", "Claude Code (AI coding assistant), from the project conversation and repository artifacts"],
            ["Evidence policy", "Screenshots are genuine captures of the running extension unless labelled CONCEPTUAL MOCKUP. "
                                "Provider responses in screenshots come from a local mock server; the live Groq API was unreachable from the build environment."],
        ], [45 * mm, 125 * mm]),
        NextPageTemplate("main"),
        PageBreak(),
        Paragraph("Contents", S["h1"]),
    ]


def exec_summary() -> list:
    out = h1("Executive summary")
    out += [
        h3("Problem"),
        P("People write prompts quickly and vaguely. Under-specified prompts produce generic or wrong answers, while generic 'prompt improvers' "
          "often bloat short questions into long templates, invent requirements, or require copy-pasting into a separate tool."),
        h3("Solution"),
        P("An in-place enhancer: the user presses **Alt+Shift+E** (or the toolbar icon) inside any supported text box. The extension reads only "
          "that box, makes **one** request to Groq with a strict rewriting specification, validates the result locally (preserved numbers, quotes, "
          "code and URLs; no answering instead of rewriting; no language switch), and replaces the text in the same box. Undo is one click or "
          "**Alt+Shift+Z**. The user always decides whether to send."),
        h3("Implemented features (v0.1.0)"),
    ]
    out += bullets([
        "Enhancement engine: input validation, task-type hint, framework registry (CO-STAR, RISEN, RTF, CREATE, APE + 12 techniques), Light/Balanced/Deep modes, single-call request builder, shared response contract, deterministic output validator.",
        "Groq provider adapter behind a provider-neutral interface, with error taxonomy, ≤ 1 bounded retry, quota circuit breaker and key redaction.",
        "Editor integration: textarea, text input, React-controlled textarea, contenteditable, open shadow roots, ProseMirror; verified insertion with rollback; field-changed protection; undo/restore; cancel.",
        "Options page: key save/test/remove, model choice, mode, explicit data-use consent, session-only key option, opt-in 'Insert anyway'.",
        "Minimal permissions: activeTab, scripting, storage + optional api.groq.com host permission. No telemetry.",
        "149 automated tests executed and passing (113 unit, 36 browser tests with the real unpacked extension in Chromium).",
    ])
    out += [
        h3("Technologies and providers"),
        P("TypeScript (strict), Chrome Manifest V3, vanilla DOM UI, esbuild, Vitest, Playwright, ESLint. AI provider: **Groq** (OpenAI-compatible "
          "chat completions API; default model `openai/gpt-oss-120b`). **Google Gemini was deferred** by the user's decision D2 and is not implemented."),
        h3("Honest status"),
        P("All automated tests pass against a **local mock** of Groq's API. **No request was sent to the real Groq API**: the build environment's "
          "network policy blocks `api.groq.com` (HTTP 403 at the proxy). Real-site testing on ChatGPT/Claude.ai and human quality scoring were not "
          "performed. These gaps are listed in Sections 9, 10 and 12."),
    ]
    return out


def requirements() -> list:
    out = h1("Original user requirements")
    out += [
        P("The four user messages below are reproduced **verbatim**, in chronological order, from the project conversation (the complete "
          "conversation history was available in the session). Only one change was made: the API key in message 4 is replaced by a redaction "
          "notice. Message 3 is reproduced as received, including its truncated final line. Message 4 arrived while message 3 was being "
          "implemented."),
    ]
    entries = [
        ("01-initial-requirements.txt", "Message 1 — Initial extension concept, plan.md-first workflow, Groq and Gemini requirements"),
        ("02-prototype-screenshots.txt", "Message 2 — Request for prototype screenshots (after the Phase 1 plan)"),
        ("03-decisions-and-implementation.txt", "Message 3 — Decisions resolving the open questions; approval to implement"),
        ("04-api-key-and-report.txt", "Message 4 — API key (redacted) and the requirements for this report"),
    ]
    for fname, title in entries:
        out += h2(title)
        out += verbatim_block(read(PROMPTS / fname))
    return out


def excerpts() -> list:
    out = h1("AI response excerpts")
    out += [P("Quotations in shaded boxes are **verbatim** excerpts from the assistant's replies in this conversation (markdown emphasis markers "
              "removed). Text outside the boxes is a **summary** written for this report.")]

    def q(text: str):
        return Paragraph(md(text), S["quote"])

    out += h2("Response to message 1 — Phase 1 discovery and plan.md")
    out += [
        P("Summary: the repository was inspected (empty, no commits), provider documentation was researched, `plan.md` (24 sections) was written "
          "and pushed, and work stopped for approval as instructed. Direct access to official documentation sites was blocked, so facts were tagged."),
        q("Repo is empty (no commits). Direct fetches to `console.groq.com`, `ai.google.dev`, and `developer.chrome.com` are blocked by this session's network policy, so I'm relying on search-engine snapshots of those official pages and marking every changing fact as unverified."),
        q("One AI call per enhancement. Classifying the task, choosing techniques and rewriting all happen in one call that returns structured JSON. Checks on the input and the output run locally, with no AI involved."),
        q("Privacy, the deciding reason. On Gemini's free tier, Google may use your prompts to improve its products, and human reviewers may read them. Groq keeps logs for at most 30 days, and you can turn on zero data retention in your Groq console."),
        q("Against it: Gemini may produce more reliable structured output. The evaluation milestone decides which provider and model you use day to day; \"first\" doesn't mean \"best\"."),
        q("I'm waiting for your approval before writing any code."),
    ]
    out += h2("Response to message 2 — prototype screenshots")
    out += [
        P("Summary: static HTML mockups of 11 UI states were rendered to PNG (`docs/prototype/`). Reviewing them exposed a design flaw, which changed the plan."),
        q("Two problems: the caption covers the text box, and the toast hides the end of the prompt. Hiding the user's text is a real UX flaw, not just a mockup issue, so I'll anchor the toast just above the field, and the plan will be updated to match."),
        q("They're static mockups for reviewing the plan, not extension code. The host site is an unbranded stand-in chat page."),
    ]
    out += h2("Response to message 3 — decisions and implementation")
    out += [
        P("Summary: decisions D1–D7 were recorded in `plan.md`, then milestones M0–M4 and the offline part of M6 were implemented and tested. "
          "Two defects were found by tests and fixed (Section 10)."),
        q("The message cut off at \"Run availa…\". I'll assume it meant \"run the available tests and report results\", which matches the Phase 2 workflow."),
        q("I have no Groq key, and the proxy blocks `api.groq.com` (403). Live provider tests will be optional and skipped here, and everything else runs against mocks."),
        q("This is a real finding. ProseMirror handles the synthetic paste, but it appended the text instead of replacing it. ProseMirror syncs the selection from a `selectionchange` event that hasn't fired yet when the paste arrives. The E2E test only passed because the fallback chain recovered. I'll fix the cause and make tests assert which strategy succeeded, so a silent fallback can't hide a failure again."),
        q("A genuine gap: Spanish→English translation isn't caught, because both use the Latin script. I'll add lightweight stopword-based language detection for common Latin-script languages to the validator."),
    ]
    out += h2("Response to message 4 — API key and report")
    out += [
        P("Summary: the key was treated as a secret, never written to disk or used (no request could reach Groq), and this report was produced last, after implementation and testing."),
        q("Noted, and a security point first: that key is now stored in this conversation's transcript. I won't write it to any file, commit, log, build, or report, and I'll redact it wherever your messages are quoted. Rotate it in the Groq console once the project is done."),
        q("Live Groq test: the proxy rejected the connection to `api.groq.com` before any request was sent, so sending your key would accomplish nothing, and I won't try to get around the network policy (D7)."),
    ]
    return out


def planning() -> list:
    out = h1("Planning and architecture")
    out += h2("Summary of plan.md")
    out += [P("`plan.md` (24 required sections plus a decision log and implementation notes) defines scope, architecture, provider research, "
              "security model, test strategy and acceptance checklist. Facts are tagged [V] verified, [S] search-snapshot of official docs, or [A] assumption. "
              "The user's decisions are recorded as binding entries D1–D7:")]
    out.append(table([
        ["ID", "Decision (user, message 3)", "Effect"],
        ["D1", "Groq first, best free-tier model, modular interface", "Groq adapter; default `openai/gpt-oss-120b`"],
        ["D2", "Gemini deferred; verify terms first; disabled until configured", "Gemini shown as 'not available yet'; milestone M5"],
        ["D3", "Never auto-replace on validation failure; Copy fallback; Insert anyway only if requested and safe", "Blocking vs overridable failure classes; opt-in setting, off by default"],
        ["D4", "No invented facts or placeholders; clarifying questions when useful", "System rules 4–5; placeholder checks in eval"],
        ["D5", "Start with textarea/input/contenteditable; real chat UI best-effort", "Fixture-based E2E; real sites documented as untested"],
        ["D6", "Personal use; Web Store-ready; no backend", "BYOK direct calls; publication checklist in README"],
        ["D7", "Minimum permissions; no bypassing restrictions; mocks by default; optional live tests via env", "Mock provider; `npm run eval:live` skipped without key"],
    ], [12 * mm, 80 * mm, 78 * mm]))
    out += h2("System architecture")
    out.append(figure(REPORT / "diagrams" / "architecture.png",
                      "System architecture and data flow. ① user gesture → service worker injects the content script and captures the focused field; "
                      "② read text; ③ only the prompt text reaches the engine; ④ one HTTPS request to Groq; ⑤ JSON result parsed and validated; "
                      "⑥ content script inserts, verifies by reading back, and keeps Undo.", max_h=125 * mm))
    out += h2("Components")
    out.append(table([
        ["Component", "Responsibility", "Explicitly not responsible for"],
        ["Service worker", "Triggers, in-flight lock, cancel, setup/consent gate, engine + provider calls, retry, circuit breaker, badge", "DOM access"],
        ["Content script (on demand)", "Locate field, capture, insert via strategy chain, read-back verify, rollback, undo, toast", "Network calls, API keys, submitting"],
        ["Engine (pure TS)", "Validation, hint, catalog selection, request building, parsing, output validation", "Chrome APIs, fetch (injected)"],
        ["Provider adapters", "Wire format, model list, error mapping to shared taxonomy", "Prompt content decisions"],
        ["Options page", "Key, model, mode, consent, test connection, permission request", "Running enhancements"],
    ], [38 * mm, 82 * mm, 50 * mm]))
    out += h2("Enhancement pipeline")
    out.append(figure(REPORT / "diagrams" / "pipeline.png", "Enhancement pipeline: six local, deterministic stages around a single provider call.", max_h=50 * mm))
    out += [P("Intent analysis, classification, quality analysis, framework choice and rewriting are combined into **one** model call to halve "
              "latency and quota use and to limit the number of times the user's text passes through a model. Each stage remains a separate "
              "field in the JSON response, so it can be inspected and tested. The response contract is identical for all providers:")]
    out.append(code('{"enhanced_prompt": "…", "changed": true, "task_type": "coding",\n "techniques": ["explicit_instructions", "output_format"],\n "missing_info": ["which columns contain dates"], "notes": "…"}'))
    out += h2("Provider interface")
    out.append(code("""interface ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly hostPermission: string;   // requested only when a key is saved
  readonly models: readonly ModelInfo[];
  readonly defaultModel: string;
  // Returns raw model text; throws ProviderError only.
  complete(request: ProviderRequest, ctx: ProviderCallContext): Promise<string>;
  listModels(ctx: { apiKey: string; signal: AbortSignal }): Promise<string[]>;
}"""))
    out += [P("A second (mock) adapter in the unit tests runs through the same pipeline, demonstrating that the engine has no Groq-specific code. "
              "Adding Gemini means a new folder under `src/providers/`, a registry entry, an optional host permission and consent text.")]
    out += h2("Major design decisions and alternatives")
    out.append(table([
        ["Decision", "Alternatives considered", "Reason"],
        ["On-demand injection (activeTab + scripting)", "Static content scripts on all sites; <all_urls>", "No code runs on any page until the user acts; no broad host access"],
        ["No popup; toolbar click enhances directly", "Popup with mode picker", "A popup intercepts the click and adds a step to the core flow"],
        ["Network calls in the service worker", "Fetch from content script", "Avoids page CSP/CORS and keeps keys out of the page-adjacent world"],
        ["One model call", "Separate classify + rewrite calls; LLM judge", "Latency, quota, fewer passes over private text; judges are not guarantees"],
        ["Vanilla TS + esbuild, zero runtime deps", "React/Preact, Vite+CRXJS, provider SDKs", "Tiny UI surface; no framework conflicts in pages; full control of requests"],
        ["BYOK direct calls", "Backend proxy with hosted key", "No infrastructure or cost for personal use; proxy documented for public release"],
        ["Verified insertion with rollback", "Write value and hope", "Editors silently reject changes; read-back proves success or restores the original"],
    ], [50 * mm, 55 * mm, 65 * mm]))
    return out


def methodology() -> list:
    out = h1("Prompt engineering methodology")
    out += h2("Frameworks as checklists, not templates")
    out += [P("Each framework and technique is a registry entry with intended use, task types it fits, when to avoid it, allowed modes, a one-line "
              "instruction, limitations and provenance. The model receives a compact catalog and is told: *\"Frameworks below are checklists for your "
              "thinking, not templates. Do not add framework labels such as 'Context:' or 'Objective:' unless headings genuinely help a long, multi-part task.\"* "
              "Acronym expansions are documented as conventions, with known conflicts recorded.")]
    out.append(table([
        ["Framework", "Expansion used", "Selected for", "Modes", "Provenance / caveat"],
        ["CO-STAR", "Context, Objective, Style, Tone, Audience, Response", "writing, creative", "Balanced, Deep", "Popularised 2023 (GovTech Singapore write-up); informal"],
        ["RISEN", "Role, Instructions, Steps, End goal, Narrowing", "planning, analysis, coding", "Deep", "'N' also expanded as 'Novelty' elsewhere"],
        ["RTF", "Role, Task, Format", "short tasks needing a format", "Balanced, Deep", "Community convention"],
        ["CREATE", "Context, Role, Explicit, Action, Target audience, Exclusions", "content creation", "Deep", "Conflicting expansions exist; user's list used"],
        ["APE", "Action, Purpose, Expectation", "short goal-oriented requests", "all", "Name collides with 'Automatic Prompt Engineer' (2022)"],
    ], [21 * mm, 41 * mm, 33 * mm, 22 * mm, 53 * mm]))
    out += [Spacer(1, 4), P("Twelve further techniques: ambiguity reduction, explicit instructions, output format, success criteria, scope boundaries, "
                            "role/perspective, step sequencing, task decomposition, context surfacing (ask, never invent), few-shot (only user-supplied "
                            "examples), source-material delimitation, and untrusted-input handling.")]
    out += h2("How selection depends on task type and mode")
    out += bullets([
        "A deterministic, regex-based **task hint** (coding, research, writing, analysis, factual, planning, creative, other) orders the catalog; it is advisory and the model may override it.",
        "The **mode filters** what may be offered: Light offers only ambiguity reduction, explicit instructions, APE and untrusted-input handling (no structure); Balanced adds format, constraints, success criteria and light frameworks; Deep adds decomposition, RISEN, CREATE and few-shot.",
        "The model returns the IDs it applied; unknown IDs are discarded by the parser. Unit tests verify, e.g., that Light never offers CO-STAR or decomposition and that writing tasks rank CO-STAR above success criteria.",
    ])
    out += h2("Before-and-after examples")
    out += [P("**Important:** no real Groq output exists for this report (the API was unreachable). The examples below are labelled by origin: "
              "(a) is the canned response of the local mock server used in the screenshots; (b)–(e) are hand-written synthetic candidates from the "
              "offline regression suite, showing what the validator accepts and rejects. None is presented as model output.")]
    ex = [
        ["Example", "Before (user prompt)", "After / candidate", "Outcome"],
        ["(a) mock demo — coding", "write a python script that cleans up my csv file, remove duplicates and fix the dates, it has like 50k rows",
         "Write a Python script that cleans a CSV file with about 50k rows. Requirements: 1. Remove duplicate rows. 2. Fix the dates … Before writing the code, ask me concise clarifying questions about anything critical you can't infer … Return the complete script …",
         "Inserted (Figure 'Prompt enhanced')"],
        ["(b) synthetic — factual, good", "What is the boiling point of water at sea level in Fahrenheit?", "(unchanged)", "Accepted: 'Already clear — no changes'"],
        ["(c) synthetic — factual, bad", "What is the boiling point of water at sea level in Fahrenheit?",
         "Context: You are an expert physicist. Objective: … Style: academic. Tone: formal. Audience: students. Response: a detailed paragraph with citations …",
         "Rejected: length ratio and inappropriate technique (co_star)"],
        ["(d) synthetic — insufficient info, bad", "fix the bug", "Fix the bug in [insert your code here] which throws [describe error].", "Rejected: placeholder (D4)"],
        ["(e) synthetic — language, bad", "Escribe un correo breve a mi equipo para recordarles la reunión del viernes a las 10:00.",
         "Write a short email to my team reminding them about Friday's meeting at 10:00.", "Rejected: language switch (overridable)"],
    ]
    out.append(table(ex, [30 * mm, 42 * mm, 66 * mm, 32 * mm]))
    out += h2("How quality is evaluated")
    out += bullets([
        "**Runtime gate (every request):** output validator — preservation of numbers, quotes, code, URLs, emails, paths, @mentions; answer-instead-of-rewrite detection; leaked delimiters/instructions; language/script switch; oversize; length-ratio warning per mode.",
        "**Dataset:** `eval/dataset.json`, 30 synthetic prompts across 17 categories (factual, underspecified coding, research, writing, creative, complex analysis, explicit constraints, already-good, insufficient info, adversarial quoted text, non-English, token preservation, planning, modes).",
        "**Deterministic checks per item:** mustContain / mustNotContain / placeholder regexes, max length ratio (conciseness), acceptable task types, techniques that should not be used, same language.",
        "**Human rubric** (`eval/rubric.md`): intent preservation, clarity, specificity, relevance of structure, output-format clarity (1–5) and invented requirements (yes/no). Thresholds: intent ≥ 4.5, clarity ≥ 4, no invented requirements on ≥ 90% of items. Scores describe one dataset and model version — not a guarantee.",
        "**Status:** the offline regression (14 good/bad synthetic cases) runs in CI and passes. The live run and human scoring have **not been executed** (no API access).",
    ])
    return out


def implementation() -> list:
    out = h1("Implementation summary")
    out += h2("Implemented features")
    out += bullets([
        "**Triggers:** toolbar click, `Alt+Shift+E` (enhance), `Alt+Shift+Z` (restore); rebindable at chrome://extensions/shortcuts.",
        "**Capture:** focused element, followed into open shadow roots; refuses password/email/tel/number/credit-card, read-only and disabled fields; main frame only.",
        "**Insertion:** strategy chain — `execCommand('insertText')` (fires real input events, keeps native undo), prototype value setter + input event (React-safe), synthetic `text/plain` paste (ProseMirror/Lexical first). Every attempt is verified by reading the field back; failures restore the original and offer Copy.",
        "**Protection:** per-tab in-flight lock; Cancel/Esc via AbortController; 20 s timeout; field-changed guard (asks before overwriting new typing); secret-pattern confirmation; consent gate.",
        "**Undo:** toast Undo (10 s), restore command any time on the page, native Ctrl+Z in textareas; asks before restoring over later edits.",
        "**Errors:** auth, forbidden, missing permission, quota exhausted (circuit breaker until reset, 'Try anyway' override), rate limited, invalid request, model unavailable, server, timeout, network, cancelled, malformed response — each with a plain message that confirms the text was not changed.",
        "**Settings:** Groq key (masked, save/remove, test connection that checks the model allowlist against `/models`), model, mode, remember-key toggle, Insert-anyway opt-in, consent with versioned disclosure.",
    ])
    out += h2("Technologies, dependencies and structure")
    out.append(table([
        ["Area", "Choice"],
        ["Language / platform", "TypeScript 6 (strict), Chrome Manifest V3, minimum Chrome 116"],
        ["Build", "esbuild via `scripts/build.mjs` (production `dist/`, test `dist-test/`)"],
        ["Tests", "Vitest 5 (unit), Playwright 1.63 (browser, real unpacked extension), ESLint 10 + typescript-eslint"],
        ["Runtime dependencies", "None — the shipped bundle contains only project code"],
        ["Test-only dependencies", "React 19 and ProseMirror (editor fixtures only)"],
    ], [45 * mm, 125 * mm]))
    out.append(code("""src/background/   service worker: index, orchestrator, inject, badge
src/content/      field-locator, insertion, toast, clipboard, index
src/engine/       pipeline, input-validation, classify-hint, request-builder,
                  response-parser, output-validation, instructions/, frameworks/
src/providers/    types, errors, retry, circuit, registry, groq/{adapter,config}
src/settings/     schema, store, credentials
src/options/      options.html/.ts/.css
tests/unit/ tests/e2e/ tests/fixtures/   eval/   scripts/   report/"""))
    out += h2("Groq integration (and Gemini status)")
    out += bullets([
        "`POST https://api.groq.com/openai/v1/chat/completions`, key only in the `Authorization: Bearer` header, `response_format: json_object`, temperature 0.2, `max_completion_tokens` scaled to input (512–4096) plus 1024 reasoning headroom for reasoning models.",
        "Models (allowlist, switchable): `openai/gpt-oss-120b` (default, `reasoning_effort: low`), `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`. **Model IDs and limits are unverified against live docs** and are checked at runtime via `/models`.",
        "429 responses are classified as daily quota vs transient rate limit from the message text; `retry-after` / `x-ratelimit-reset-*` headers are parsed.",
        "**Gemini: not implemented** (decision D2). It appears in settings as 'not available yet'.",
    ])
    out += h2("API keys, permissions and data")
    out += bullets([
        "Permissions: `activeTab`, `scripting`, `storage`; optional host `https://api.groq.com/*` requested when the key is saved. Enforced by `scripts/check-dist.mjs` and a production-load test.",
        "Keys stored under a separate storage key, never in settings, never in URLs/logs; errors redacted; content script never receives the key. Session-only storage option.",
        "Sent to Groq: instructions, mode, task hint, and the field's text inside per-request nonce delimiters. Never sent: page URL/title, page content, history, identifiers.",
        "Documented limitation: chrome.storage is not encrypted at rest; anyone with access to the profile can read a saved key.",
    ])
    out += h2("Planned but not implemented")
    out.append(table([
        ["Item", "Status / reason"],
        ["Gemini adapter, provider switching, 'Try with other provider'", "Deferred by D2 until terms/data-use/region rules are re-verified"],
        ["Live Groq evaluation, latency measurement, human scoring", "Harness ready (`npm run eval:live`); API unreachable from build environment"],
        ["Real-site testing (ChatGPT, Claude.ai, Gemini web, Perplexity, GitHub)", "Needs a logged-in browser; not available"],
        ["Lexical, Slate, Quill, CodeMirror fixtures", "Deferred (D5 scope); covered only by the generic verified strategy chain"],
        ["Diff view, history, presets UI, custom frameworks, selection-only enhancement", "Post-MVP by design"],
    ], [80 * mm, 90 * mm]))
    return out


def screenshots() -> list:
    out = h1("Prototype screenshots and visual evidence")
    out += [P("**Provenance.** Figures in 8.1–8.3 are **genuine screenshots** captured automatically by Playwright from the actual extension build "
              "loaded into Chromium (`npm run screenshots`). The demo page is a local, unbranded test fixture. Because `api.groq.com` was unreachable, "
              "the extension was pointed at a **local mock Groq-compatible server** (test build only); the enhanced text shown is that server's canned "
              "response, not real model output. Headless capture shows page content only, so the browser toolbar and badge are not visible. "
              "The only API key ever shown is a fake test value (`test-key-not-a-real-credential`, masked)."),
            ]
    out += h2("Core journey: before, enhancing, after, undo")
    out.append(figure(SHOTS / "01-before.png", "Before: a rough prompt typed into a chat-style text box (local demo fixture)."))
    out.append(figure(SHOTS / "02-enhancing.png", "Enhancing: progress toast anchored above the field with Cancel/Esc; the text is unchanged until the result is validated."))
    out.append(figure(SHOTS / "03-enhanced.png", "After: the enhanced prompt (mock response) replaces the text in the same field; 'not sent'; task/technique chips; Undo."))
    out.append(figure(SHOTS / "04-undo-restored.png", "Undo: the original prompt is restored exactly."))
    out += h2("Safety and error states")
    out.append(figure(SHOTS / "05-already-clear.png", "Already-clear prompt: left unchanged ('effectiveness, not length')."))
    out.append(figure(SHOTS / "06-error-invalid-key.png", "Invalid API key (mock 401): clear message, Open settings, original untouched."))
    out.append(figure(SHOTS / "07-error-quota.png", "Daily quota reached (mock 429 RPD): circuit breaker engaged; explicit 'Try anyway' override."))
    out.append(figure(SHOTS / "08-validation-blocked.png", "Validation failure: the rewrite dropped quoted text and numbers, so nothing is inserted; Copy offered (Insert anyway is off by default)."))
    out.append(figure(SHOTS / "09-field-changed.png", "User typed during the request: the enhancement is not inserted; Replace anyway / Copy enhanced."))
    out.append(figure(SHOTS / "10-unsupported-password.png", "Password field: refused; nothing is sent."))
    out += h2("Settings and installation in Chromium")
    out.append(figure(SHOTS / "11-options-first-run.png", "Options page on first run: get-started steps, data disclosure, consent required.", max_h=200 * mm))
    out.append(figure(SHOTS / "12-options-configured.png", "Options page configured: masked key, model, connection test (mock), mode, Insert-anyway opt-in, consent.", max_h=200 * mm))
    out.append(figure(SHOTS / "20-chrome-extensions-loaded.png", "Production build (`dist/`) loaded as an unpacked extension in Chromium (chrome://extensions)."))
    out.append(figure(SHOTS / "21-chrome-extension-details.png", "Extension details page for the production build in Chromium."))
    out += h2("Conceptual mockups from the planning phase")
    out += [P("These images were produced in response to message 2, **before any extension code existed**. They are design prototypes only and do not demonstrate tested functionality. "
              "Comparing the first mockup below with the genuine 'After' screenshot in Section 8.1 shows the design change they prompted: the toast now sits above the field instead of covering it.")]
    out.append(figure(ROOT / "docs/prototype/screenshots/03-enhanced.png", "Conceptual mockup: planned 'enhanced' state (static HTML).", mockup=True))
    out.append(figure(ROOT / "docs/prototype/screenshots/10-options.png", "Conceptual mockup: planned settings page (static HTML).", mockup=True))
    return out


def testing() -> list:
    out = h1("Testing and validation")
    out += h2("Executed — results")
    out.append(table([
        ["Check", "Command", "Result (executed " + TODAY + ")"],
        ["Type checking", "`npm run typecheck`", "PASS — 0 errors"],
        ["Lint", "`npm run lint`", "PASS — 0 problems"],
        ["Unit tests (Vitest)", "`npm test`", "PASS — 113 / 113 in 8 files"],
        ["Browser tests (Playwright, real unpacked extension in Chromium)", "`npm run test:e2e`", "PASS — 36 / 36 (3 screenshot-only specs skipped by design)"],
        ["Production build + dist safety check", "`npm run build` + `check-dist.mjs`", "PASS — exact permissions, no test hooks, no local endpoints, no credential-like strings"],
        ["Production build loads in Chromium", "`production-load.spec.ts`", "PASS — manifest, permissions, shortcuts, welcome page"],
        ["Package", "`npm run package`", "PASS — prompt-enhancer-0.1.0.zip"],
        ["Live Groq evaluation", "`npm run eval:live`", "NOT RUN — skipped (no key in env); api.groq.com blocked (proxy 403)"],
    ], [52 * mm, 45 * mm, 73 * mm]))
    out += h2("Unit test coverage by area")
    out.append(table([
        ["File", "Tests", "Covers"],
        ["providers.test.ts", "33", "Groq request shape, key only in header, error mapping (401/403/404/400/413/429×2/5xx/network/truncated/empty/non-JSON), timeout vs cancel, redaction, retry hints, bounded retry, circuit breaker, user messages"],
        ["output-validation.test.ts", "15", "Preserved-item extraction, unchanged detection, blocking vs overridable failures, number separators, language switch"],
        ["eval-regression.test.ts", "14", "Dataset coverage + 12 labelled synthetic good/bad rewrites"],
        ["request-parse.test.ts", "13", "Nonce delimiting, system rules, no page data, budgets, parser tolerance and rejection"],
        ["input-and-hint.test.ts", "12", "Input validation, size cap, secret detection, task hints"],
        ["settings.test.ts", "11", "Defaults (Insert anyway off), repair, consent versioning, key storage locations, redaction, masking"],
        ["frameworks.test.ts", "8", "Registry completeness and provenance, add-a-technique without engine change, mode filtering, catalog token budget"],
        ["pipeline.test.ts", "7", "End-to-end engine with a second (mock) adapter: enhanced, unchanged, blocked, malformed, provider error, no call on invalid input"],
    ], [42 * mm, 13 * mm, 115 * mm]))
    out += h2("Browser tests (36)")
    out += bullets([
        "**Editors (each: enhance → verify text → Undo → exact original → no submit → one request):** textarea, input, React-controlled textarea (React state verified), contenteditable, open shadow root, ProseMirror (editor model verified). The first-attempt insertion strategy is asserted per editor.",
        "**Undo paths:** native Ctrl+Z, restore command, confirmation before overwriting later edits; multi-line vs single-line handling.",
        "**Refusals (no request sent):** password field, no focused field, closed shadow root, cross-origin iframe.",
        "**Provider failures (original intact):** 401, daily quota with circuit breaker and override, transient 429 (exactly one retry), 503 (one retry), malformed body, answer-instead-of-rewrite (Insert anyway never offered), dropped details (Copy only by default; opt-in Insert anyway then Undo), unchanged.",
        "**Request control:** double trigger → one request; Cancel and Esc; typing during request; secret confirmation; missing key / consent opens settings; request body contains no key, page URL or title.",
        "**Options page:** Groq active, Gemini disabled, masked key, test connection, mode persistence, save/remove key.",
    ])
    out += h2("Test validity check")
    out += [P("To confirm the browser tests detect real failures, the textarea insertion strategies were deliberately disabled: the textarea and React "
              "tests failed while ProseMirror (a different code path) passed; the change was then reverted.")]
    out += h2("Planned but not executed")
    out += bullets([
        "Live Groq requests (correctness of real responses, JSON-mode reliability per model, latency targets p50 ≤ 3 s / p95 ≤ 8 s).",
        "Human rubric scoring of live outputs; Groq vs Gemini comparison (Gemini not implemented).",
        "Manual real-site tests (ChatGPT, Claude.ai, Gemini web, Perplexity, GitHub) and Chrome stable (tests used Playwright's Chromium).",
        "Toolbar click and keyboard shortcut gestures: automated tests call the same workflow through a test-build hook because automation cannot click the browser toolbar; the shortcut registration itself is verified on the production build.",
    ])
    return out


def challenges() -> list:
    out = h1("Challenges and decisions")
    out += h2("Technical challenges and solutions")
    out.append(table([
        ["Challenge", "Solution"],
        ["Official docs (Groq, Google, Chrome) and the Groq API unreachable from the build environment", "Facts tagged [S]/[A]; runtime model verification; mock provider; optional live harness; honest reporting. No restriction bypassed (D7)."],
        ["ProseMirror appended pasted text instead of replacing it (stale selection)", "Synchronous `selectionchange` after selecting the field; tests now assert the first-attempt strategy so fallbacks cannot hide defects."],
        ["Spanish→English translation passed validation (same script)", "Stopword-based language guess for en/es/fr/de/pt/it added to the validator."],
        ["Prototype toast covered the user's text", "Toast anchored above the field, with viewport fallback."],
        ["Automation cannot click the toolbar or grant activeTab", "Test build adds a hook and localhost host permission; dist check proves neither ships."],
        ["Invisible Unicode characters written into source by tooling", "Detected by ESLint (no-irregular-whitespace); replaced with explicit escapes."],
    ], [62 * mm, 108 * mm]))
    out += h2("Trade-offs")
    out += bullets([
        "**Provider:** Groq first for privacy (no free-tier training use documented; ZDR available) and latency; Gemini may follow schemas better — to be measured, not assumed.",
        "**Free tiers:** limits are not hard-coded; quota errors trip a local circuit breaker to avoid repeated failing requests; one request per enhancement.",
        "**Permissions vs convenience:** no always-on scripts means no in-page button; the user triggers via toolbar/shortcut.",
        "**Privacy vs convenience:** consent required before first use; session-only key option; no history.",
        "**Cost:** BYOK, no backend — zero infrastructure cost; a proxy is only justified for a hosted-key product.",
        "**Compatibility:** generic verified strategies instead of site-specific hacks; unsupported editors fail safely with Copy.",
    ])
    out += h2("Unresolved risks and known limitations")
    out += bullets([
        "Real-model behavior (answering instead of rewriting, inventing requirements, JSON reliability) is unmeasured.",
        "Groq model IDs, limits and error wording are unverified against live documentation.",
        "Real websites were not tested; site editors change over time.",
        "API keys in chrome.storage are readable by anyone with access to the browser profile.",
        "Prompt injection inside the text being rewritten cannot be eliminated by instructions; the structural boundary is plain-text insertion, no execution, no submission, user review.",
        "`execCommand` is deprecated (still the most compatible path); non-execCommand fallbacks exist.",
        "The user's Groq key appeared in the conversation transcript and should be rotated.",
    ])
    return out


def install() -> list:
    out = h1("Installation and usage guide")
    out += h2("Build and load")
    out.append(code("npm install\nnpm run build          # → dist/\nnpm run package        # optional → prompt-enhancer-0.1.0.zip"))
    out += bullets([
        "Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select `dist/`.",
        "The settings page opens automatically on first install.",
    ])
    out += h2("Configure a Groq key securely")
    out += bullets([
        "Create a key at console.groq.com → API Keys. Paste it in settings → **Save key** and accept Chrome's permission prompt for api.groq.com.",
        "Read the data notice and tick the consent box. Optionally **Test connection** and choose a model.",
        "On shared machines, untick 'Remember my key' (memory-only storage). Never put keys in source, `.env` files or the repository.",
    ])
    out += h2("Use")
    out.append(table([
        ["Action", "How"],
        ["Enhance", "Click into a text box, then Alt+Shift+E or the toolbar icon"],
        ["Undo / restore", "Undo in the toast (10 s), Alt+Shift+Z any time on the page, or Ctrl+Z in plain text boxes"],
        ["Cancel", "Cancel in the toast or Esc while enhancing"],
        ["Change shortcuts", "chrome://extensions/shortcuts"],
    ], [40 * mm, 130 * mm]))
    out += h2("Troubleshooting")
    out.append(table([
        ["Symptom", "Fix"],
        ["Settings open instead of enhancing", "Add a key and accept the consent"],
        ["'Groq rejected your API key'", "Create a new key and save it again"],
        ["'Permission needed for Groq'", "Save the key again and accept the permission prompt"],
        ["'Groq quota reached'", "Wait for the reset or use 'Try anyway'"],
        ["'Model not available'", "Choose another model; use Test connection"],
        ["'This field isn't supported' / 'No text box selected'", "Use a regular text box (see supported editors)"],
        ["'Couldn't update this editor safely'", "Text unchanged — use Copy enhanced and paste"],
        ["Badge shows '!' and nothing else", "Page forbids extensions (chrome://, Web Store, PDF viewer)"],
    ], [70 * mm, 100 * mm]))
    out += h2("Supported editors")
    out.append(table([
        ["Editor", "Status"],
        ["textarea, text/search input, React-controlled textarea, contenteditable, open shadow root, ProseMirror", "Tested on local fixtures (automated)"],
        ["Password/email/tel/number/credit-card fields, closed shadow roots, cross-origin iframes", "Refused by design (tested)"],
        ["Google Docs and canvas editors, Monaco, chrome:// pages", "Not supported"],
        ["Lexical, Slate, Quill, CodeMirror 6", "Untested; safe fallback (verify, restore, Copy)"],
        ["Real sites (ChatGPT, Claude.ai, Gemini, Perplexity, GitHub)", "Not yet tested"],
    ], [110 * mm, 60 * mm]))
    return out


def conclusion() -> list:
    out = h1("Conclusion and future roadmap")
    out += h2("What was achieved")
    out += [P("A working, minimal-permission Manifest V3 extension that captures the focused prompt, enhances it with a task-aware, "
              "framework-informed specification through Groq, validates the result, replaces it in place with verified insertion and reliable undo, "
              "and never submits. The architecture is provider-neutral, the framework registry is extensible, and 149 automated tests pass. "
              "The plan-first workflow, user decisions and every deviation are documented in `plan.md`.")]
    out += h2("Remaining limitations")
    out += bullets([
        "Not yet exercised against the live Groq API; no measured quality or latency.",
        "Gemini not implemented.",
        "Real websites untested; several rich-editor families untested.",
        "Client-side key storage limits; transcript key exposure requires rotation.",
    ])
    out += h2("Prioritized next steps")
    out.append(table([
        ["#", "Step", "Why"],
        ["1", "Rotate the Groq key; run `GROQ_API_KEY=… npm run eval:live` from a machine with network access", "Confirms real behavior, JSON reliability, latency; gives the first real before/after data"],
        ["2", "Human rubric scoring; tune instructions (bump INSTRUCTIONS_VERSION) and default model", "Quality evidence (plan §20.3 thresholds)"],
        ["3", "Manual tests on ChatGPT, Claude.ai, Gemini web, Perplexity, GitHub", "Real compatibility matrix"],
        ["4", "Verify Gemini terms/data use/region rules, then implement the Gemini adapter (M5)", "Second provider and comparison"],
        ["5", "Fixtures for Lexical, Slate, Quill, CodeMirror 6", "Broader editor coverage"],
        ["6", "Optional UX: diff view, per-use mode picker, opt-in history with retention rules", "Post-MVP features"],
        ["7", "Web Store readiness: privacy policy, listing disclosures, permission justifications, BYOK vs proxy decision", "Possible publication"],
    ], [8 * mm, 92 * mm, 70 * mm]))
    out += h2("Deliverable locations")
    out += bullets([
        "Extension build: `dist/` (load unpacked) and `prompt-enhancer-0.1.0.zip` (both generated; not committed).",
        "Documentation: `README.md`, `plan.md`; this report: `project_report.pdf`.",
        "Report sources: `report/` (generator `build_report.py`, verbatim prompts, test outputs, screenshots, diagrams).",
    ])
    return out


def build() -> None:
    doc = ReportDoc(str(OUT))
    toc = TableOfContents()
    toc.levelStyles = [S["toc1"], S["toc2"]]
    toc.dotsMinLevel = 0
    story = cover() + [toc]
    for part in (exec_summary, requirements, excerpts, planning, methodology, implementation, screenshots, testing, challenges, install, conclusion):
        story += part()
    doc.multiBuild(story)
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    build()
