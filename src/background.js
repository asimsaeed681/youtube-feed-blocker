/**
 * Minimal service worker.
 *
 * There is no backend and no background logic to run. This worker (a) seeds
 * default settings on first install so the content scripts and popup always
 * read a complete object, and (b) lets content scripts use
 * chrome.storage.session, where the running peek lives. Defaults come from
 * lib/defaults.js so they cannot drift.
 */
importScripts("lib/defaults.js");

// Content scripts can't touch chrome.storage.session by default. The access
// level does not persist across browser restarts, so set it every time the
// worker starts; the onStartup listener makes Chrome start the worker at
// browser launch.
function openSessionStorage() {
  chrome.storage.session
    .setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
    .catch(() => {});
}
openSessionStorage();
chrome.runtime.onStartup.addListener(openSessionStorage);

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  openSessionStorage();
  if (reason !== "install") return;
  const key = self.YFB.STORAGE_KEY;
  const existing = await chrome.storage.sync.get(key);
  if (!existing || !existing[key]) {
    await chrome.storage.sync.set({ [key]: self.YFB.DEFAULT_SETTINGS });
  }
});
