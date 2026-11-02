/** Toolbar badge: the only feedback channel on pages where the content script can't run. */
export type BadgeState = "idle" | "running" | "ok" | "error";

const STYLE: Record<Exclude<BadgeState, "idle">, { text: string; color: string }> = {
  running: { text: "…", color: "#4f46e5" },
  ok: { text: "✓", color: "#15803d" },
  error: { text: "!", color: "#b42318" },
};

const timers = new Map<number, ReturnType<typeof setTimeout>>();

export async function setBadge(tabId: number, state: BadgeState, title?: string): Promise<void> {
  clearTimeout(timers.get(tabId));
  try {
    if (state === "idle") {
      await chrome.action.setBadgeText({ tabId, text: "" });
      await chrome.action.setTitle({ tabId, title: "Enhance prompt (Alt+Shift+E)" });
      return;
    }
    const s = STYLE[state];
    await chrome.action.setBadgeBackgroundColor({ tabId, color: s.color });
    await chrome.action.setBadgeText({ tabId, text: s.text });
    await chrome.action.setTitle({ tabId, title: `Prompt Enhancer: ${title ?? state}` });
    if (state !== "running") timers.set(tabId, setTimeout(() => void setBadge(tabId, "idle"), state === "ok" ? 3000 : 8000));
  } catch {
    // Tab may have closed; badge is best-effort.
  }
}
