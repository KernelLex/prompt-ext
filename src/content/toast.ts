import type { ToastAction } from "../shared/messages";

/**
 * Minimal in-page status UI. Lives in a CLOSED shadow root so the page cannot read or restyle it,
 * is built with DOM APIs only (never innerHTML), never takes focus on its own, and is positioned
 * just above the active field so it does not cover the user's text.
 */
export type Tone = "progress" | "ok" | "info" | "warn" | "error";

export interface ToastState {
  tone: Tone;
  title: string;
  detail?: string;
  items?: string[];
  chips?: string[];
  actions?: ToastAction[];
  hint?: string;
  autoHideMs?: number;
}

const CSS = `
:host { all: initial; }
.toast { position: fixed; width: 360px; max-width: calc(100vw - 24px); box-sizing: border-box;
  background: #111827; color: #f9fafb; border: 1px solid #2b3445; border-radius: 12px; padding: 12px 14px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  z-index: 2147483647; }
.head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.close { margin-left: auto; background: none; border: 0; color: #c3c8d2; font: inherit; cursor: pointer; padding: 0 2px; }
.close:focus-visible, button:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 2px; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.ok .dot { background: #22c55e; } .info .dot { background: #93a3b8; } .warn .dot { background: #fbbf24; } .error .dot { background: #f87171; }
.spinner { width: 12px; height: 12px; border: 2px solid #4b5568; border-top-color: #a5b4fc; border-radius: 50%; animation: spin .8s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
p { margin: 6px 0 0; color: #c3c8d2; }
ul { margin: 6px 0 0; padding-left: 18px; color: #e5e7eb; }
li { word-break: break-word; }
.chips { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font-size: 11px; padding: 1px 7px; border-radius: 10px; background: #263045; color: #d6dbe6; }
.actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
button.btn { border: 1px solid #3a455c; background: transparent; color: #f9fafb; border-radius: 7px; padding: 5px 10px; font: inherit; font-size: 12px; cursor: pointer; }
button.btn.primary { background: #6366f1; border-color: #6366f1; }
.hint { font-size: 11px; color: #c3c8d2; margin-left: auto; }
`;

export class Toast {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private anchor: HTMLElement | null = null;
  private readonly onReposition = () => this.position();

  setAnchor(el: HTMLElement | null): void {
    this.anchor = el;
  }

  show(state: ToastState, onAction: (id: ToastAction["id"]) => void): void {
    this.ensureHost();
    const root = this.root!;
    clearTimeout(this.hideTimer);
    root.querySelector(".toast")?.remove();

    const box = document.createElement("div");
    box.className = `toast ${state.tone}`;
    box.setAttribute("role", state.tone === "error" || state.tone === "warn" ? "alert" : "status");
    box.setAttribute("aria-live", state.tone === "error" || state.tone === "warn" ? "assertive" : "polite");
    box.dataset.tone = state.tone;

    const head = document.createElement("div");
    head.className = "head";
    const icon = document.createElement("span");
    icon.className = state.tone === "progress" ? "spinner" : "dot";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = state.title;
    const close = document.createElement("button");
    close.className = "close";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "✕";
    close.addEventListener("click", () => (state.tone === "progress" ? onAction("cancel") : this.hide()));
    head.append(icon, title, close);
    box.append(head);

    if (state.detail) {
      const p = document.createElement("p");
      p.className = "detail";
      p.textContent = state.detail;
      box.append(p);
    }
    if (state.items?.length) {
      const ul = document.createElement("ul");
      for (const item of state.items) {
        const li = document.createElement("li");
        li.textContent = item.length > 80 ? `${item.slice(0, 77)}…` : item;
        ul.append(li);
      }
      box.append(ul);
    }
    if (state.chips?.length) {
      const chips = document.createElement("div");
      chips.className = "chips";
      for (const c of state.chips) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = c;
        chips.append(chip);
      }
      box.append(chips);
    }
    if (state.actions?.length || state.hint) {
      const actions = document.createElement("div");
      actions.className = "actions";
      for (const a of state.actions ?? []) {
        const b = document.createElement("button");
        b.className = a.primary ? "btn primary" : "btn";
        b.dataset.action = a.id;
        b.textContent = a.label;
        b.addEventListener("click", () => onAction(a.id));
        actions.append(b);
      }
      if (state.hint) {
        const hint = document.createElement("span");
        hint.className = "hint";
        hint.textContent = state.hint;
        actions.append(hint);
      }
      box.append(actions);
    }
    root.append(box);
    this.position();
    if (state.autoHideMs) this.hideTimer = setTimeout(() => this.hide(), state.autoHideMs);
  }

  hide(): void {
    clearTimeout(this.hideTimer);
    this.root?.querySelector(".toast")?.remove();
  }

  /** Test/diagnostic accessor is deliberately absent: the shadow root is closed. */
  private ensureHost(): void {
    if (this.host?.isConnected) return;
    this.host = document.createElement("prompt-enhancer-toast");
    // Closed in production so the page cannot read or alter it; open in test builds so E2E can assert on it.
    this.root = this.host.attachShadow({ mode: __TEST__ ? "open" : "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    this.root.append(style);
    document.documentElement.append(this.host);
    window.addEventListener("resize", this.onReposition, { passive: true });
    window.addEventListener("scroll", this.onReposition, { passive: true, capture: true });
  }

  private position(): void {
    const box = this.root?.querySelector<HTMLElement>(".toast");
    if (!box) return;
    const margin = 10;
    const rect = this.anchor?.isConnected ? this.anchor.getBoundingClientRect() : null;
    const height = box.offsetHeight || 140;
    if (rect && rect.top - height - margin > 8 && rect.width > 0) {
      box.style.top = `${Math.round(rect.top - height - margin)}px`;
      box.style.left = `${Math.round(Math.max(8, Math.min(rect.right - box.offsetWidth, window.innerWidth - box.offsetWidth - 8)))}px`;
      box.style.right = "";
      box.style.bottom = "";
    } else {
      box.style.top = "";
      box.style.left = "";
      box.style.right = "20px";
      box.style.bottom = "20px";
    }
  }
}
