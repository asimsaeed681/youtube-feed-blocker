/**
 * Thin wrapper over chrome.storage.sync.
 * The entire settings object lives under one key (YFB.STORAGE_KEY) so reads and
 * writes are atomic and easy to merge with defaults.
 */
(function () {
  "use strict";

  const YFB = (window.YFB = window.YFB || {});
  const KEY = YFB.STORAGE_KEY;

  const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);
  const oneOf = (value, allowed, fallback) =>
    Object.values(allowed).includes(value) ? value : fallback;

  function mergeWithDefaults(stored) {
    const d = YFB.DEFAULT_SETTINGS;
    const s = stored || {};
    return {
      shortsBlocking: bool(s.shortsBlocking, d.shortsBlocking),
      hideHomeFeed: bool(s.hideHomeFeed, d.hideHomeFeed),
      hideUpNext: bool(s.hideUpNext, d.hideUpNext),
      blockAutoplay: bool(s.blockAutoplay, d.blockAutoplay),
      hideComments: bool(s.hideComments, d.hideComments),
      peekLevel: oneOf(s.peekLevel, YFB.PEEK_LEVELS, d.peekLevel),
      feedMode: oneOf(s.feedMode, YFB.FEED_MODES, d.feedMode),
      aiInstruction:
        typeof s.aiInstruction === "string" ? s.aiInstruction : d.aiInstruction,
      widgets: {
        todo: bool(s.widgets?.todo, d.widgets.todo),
        timer: bool(s.widgets?.timer, d.widgets.timer),
        quote: bool(s.widgets?.quote, d.widgets.quote),
      },
    };
  }
  YFB.mergeWithDefaults = mergeWithDefaults;

  YFB.getSettings = function getSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(KEY, (res) => {
          if (chrome.runtime.lastError) {
            resolve(mergeWithDefaults(null));
            return;
          }
          resolve(mergeWithDefaults(res && res[KEY]));
        });
      } catch (e) {
        resolve(mergeWithDefaults(null));
      }
    });
  };

  async function writePatch(patch) {
    const current = await YFB.getSettings();
    const next = mergeWithDefaults({
      ...current,
      ...patch,
      widgets: { ...current.widgets, ...(patch && patch.widgets) },
    });
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [KEY]: next }, () => resolve(next));
    });
  }

  // setSettings is read-modify-write, so two quick popup clicks could each read
  // the old object and the second write would drop the first change. Chaining
  // every write onto the previous one makes them apply in order.
  let writeQueue = Promise.resolve();
  YFB.setSettings = function setSettings(patch) {
    const run = writeQueue.then(() => writePatch(patch));
    writeQueue = run.catch(() => {});
    return run;
  };

  /**
   * Subscribe to settings changes. Callback receives the merged new settings.
   * Returns an unsubscribe function.
   */
  YFB.onSettingsChanged = function onSettingsChanged(callback) {
    const listener = (changes, area) => {
      if (area !== "sync" || !changes[KEY]) return;
      callback(mergeWithDefaults(changes[KEY].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  };
})();
