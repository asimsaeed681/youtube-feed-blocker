/**
 * Thin wrapper over chrome.storage.sync.
 * The entire settings object lives under one key (YFB.STORAGE_KEY) so reads and
 * writes are atomic and easy to merge with defaults.
 */
(function () {
  "use strict";

  const YFB = (window.YFB = window.YFB || {});
  const KEY = YFB.STORAGE_KEY;

  function mergeWithDefaults(stored) {
    const d = YFB.DEFAULT_SETTINGS;
    const s = stored || {};
    return {
      shortsBlocking:
        typeof s.shortsBlocking === "boolean" ? s.shortsBlocking : d.shortsBlocking,
      feedMode: Object.values(YFB.FEED_MODES).includes(s.feedMode)
        ? s.feedMode
        : d.feedMode,
      aiInstruction:
        typeof s.aiInstruction === "string" ? s.aiInstruction : d.aiInstruction,
      widgets: {
        todo: typeof s.widgets?.todo === "boolean" ? s.widgets.todo : d.widgets.todo,
        timer:
          typeof s.widgets?.timer === "boolean" ? s.widgets.timer : d.widgets.timer,
        quote:
          typeof s.widgets?.quote === "boolean" ? s.widgets.quote : d.widgets.quote,
      },
    };
  }

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

  YFB.setSettings = async function setSettings(patch) {
    const current = await YFB.getSettings();
    const next = mergeWithDefaults({
      ...current,
      ...patch,
      widgets: { ...current.widgets, ...(patch && patch.widgets) },
    });
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [KEY]: next }, () => resolve(next));
    });
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
