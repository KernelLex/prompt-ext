/** Copies text from a user-initiated click. Falls back to execCommand('copy') if the async API is unavailable. */
export async function copyText(text: string, refocus?: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    document.documentElement.append(ta);
    ta.select();
    let ok: boolean;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    refocus?.focus({ preventScroll: true });
    return ok;
  }
}
