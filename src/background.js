/**
 * Minimal service worker.
 *
 * Phase 1 has no backend and no background logic to run — this worker exists
 * only to (a) seed default settings on first install so the content scripts and
 * popup always read a complete object, and (b) give tooling a stable handle on
 * the extension. If Phase 1.5 needs to cache classifications or talk to the
 * proxy, that code goes here.
 */
const STORAGE_KEY = "settings";

const DEFAULT_SETTINGS = {
  shortsBlocking: true,
  feedMode: "widgets",
  aiInstruction: "",
  widgets: { todo: true, timer: true, quote: true },
};

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  const existing = await chrome.storage.sync.get(STORAGE_KEY);
  if (!existing || !existing[STORAGE_KEY]) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
  }
});
