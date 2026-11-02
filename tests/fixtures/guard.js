// Shared by all fixtures: records any submission attempt so tests can assert the extension never submits.
window.__submitted = 0;
window.__enterPressed = 0;
window.__sendClicked = 0;
document.addEventListener("submit", (e) => { e.preventDefault(); window.__submitted++; }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) window.__enterPressed++; }, true);
document.addEventListener("click", (e) => { if (e.target && e.target.closest && e.target.closest("[data-send]")) window.__sendClicked++; }, true);
