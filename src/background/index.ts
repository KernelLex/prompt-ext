import { isToBackground } from "../shared/messages";
import { cancelEnhancement, runEnhancement, runRestore } from "./orchestrator";

/**
 * Service worker entry. Every enhancement starts from an intentional user action:
 * the toolbar button or the keyboard command. Nothing runs on page load or on typing.
 */

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void runEnhancement(tab.id);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id === undefined) return;
  if (command === "enhance-prompt") void runEnhancement(tab.id);
  else if (command === "restore-original") void runRestore(tab.id);
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  // Only our own content script (isolated world) may talk to us; pages cannot.
  if (sender.id !== chrome.runtime.id || !isToBackground(msg)) return false;
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case "pe/cancel":
      if (tabId !== undefined) cancelEnhancement(tabId);
      break;
    case "pe/open-options":
      void chrome.runtime.openOptionsPage();
      break;
    case "pe/retry":
      if (tabId !== undefined) void runEnhancement(tabId, { force: msg.force });
      break;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => cancelEnhancement(tabId));

// Test builds only: lets Playwright start the same workflow the toolbar button starts, because
// automated browsers cannot click the extension toolbar. Compiled out of production builds.
if (__TEST__) {
  (globalThis as unknown as { __peTest: unknown }).__peTest = { runEnhancement, runRestore };
}
