/**
 * Minimal service worker.
 *
 * There is no backend and no background logic to run. This worker exists only
 * to (a) seed default settings on first install so the content scripts and
 * popup always read a complete object, and (b) give tooling a stable handle on
 * the extension. Defaults come from lib/defaults.js so they cannot drift.
 */
importScripts("lib/defaults.js");

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  const key = self.YFB.STORAGE_KEY;
  const existing = await chrome.storage.sync.get(key);
  if (!existing || !existing[key]) {
    await chrome.storage.sync.set({ [key]: self.YFB.DEFAULT_SETTINGS });
  }
});
