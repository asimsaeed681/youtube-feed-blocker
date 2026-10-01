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

  const isDateKey = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  function validPending(p) {
    return p && YFB.BUDGET_CHOICES.includes(p.minutes) && isDateKey(p.requestedOn)
      ? { minutes: p.minutes, requestedOn: p.requestedOn }
      : null;
  }

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
        quote: bool(s.widgets?.quote, d.widgets.quote),
      },
      dailyBudgetMinutes: YFB.BUDGET_CHOICES.includes(s.dailyBudgetMinutes)
        ? s.dailyBudgetMinutes
        : d.dailyBudgetMinutes,
      pendingBudget: validPending(s.pendingBudget),
    };
  }
  YFB.mergeWithDefaults = mergeWithDefaults;

  // Rejects on a storage error instead of papering over it, so a caller that
  // needs the real current settings (writePatch) can't merge onto guessed
  // defaults. getSettings() below is the reader-facing wrapper that turns a
  // rejection back into the default-settings fallback.
  function readSettingsOrThrow() {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.sync.get(KEY, (res) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          resolve(mergeWithDefaults(res && res[KEY]));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  YFB.getSettings = function getSettings() {
    return readSettingsOrThrow().catch(() => mergeWithDefaults(null));
  };

  async function writePatch(patch) {
    // A failed read must not fall through to defaults here: merging a patch
    // onto defaults would write over the user's real (unread) settings.
    const current = await readSettingsOrThrow();
    const next = mergeWithDefaults({
      ...current,
      ...patch,
      widgets: { ...current.widgets, ...(patch && patch.widgets) },
    });
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set({ [KEY]: next }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(next);
      });
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
