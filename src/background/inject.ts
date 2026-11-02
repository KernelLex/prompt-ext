/**
 * Injects the content script into the active tab's main frame. Requires a user gesture (activeTab).
 * Idempotent: the content script guards against double initialization.
 */
export async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content.js"] });
    return true;
  } catch {
    // chrome:// pages, the Web Store, PDF viewer, or pages without an activeTab grant.
    return false;
  }
}

export async function sendToTab<T>(tabId: number, message: unknown): Promise<T | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message, { frameId: 0 })) as T;
  } catch {
    return undefined;
  }
}
