/**
 * The running peek, shared by every YouTube tab.
 *
 * Stored in chrome.storage.session: all tabs see it, it survives reloads, the
 * browser clears it on close, and YouTube's page scripts cannot read it (the
 * reason typed when peeking is the user's private note).
 */
(function () {
  "use strict";

  const YFB = (globalThis.YFB = globalThis.YFB || {});
  const KEY = YFB.PEEK_SESSION_KEY;

  YFB.peekRemainingMs = function peekRemainingMs(session, now) {
    if (!session || typeof session.endsAt !== "number") return 0;
    return Math.max(0, session.endsAt - now);
  };

  function write(session) {
    return new Promise((resolve, reject) => {
      chrome.storage.session.set({ [KEY]: session }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(session);
      });
    });
  }

  YFB.PeekSession = {
    get() {
      return new Promise((resolve) => {
        try {
          chrome.storage.session.get(KEY, (res) => {
            resolve(chrome.runtime.lastError ? null : (res && res[KEY]) || null);
          });
        } catch (e) {
          resolve(null);
        }
      });
    },

    // remaining: today's budget left, checked here as well as when the
    // buttons were drawn, since another tab may have spent time meanwhile.
    start(minutes, reason, remaining) {
      if (!YFB.isValidPeekLength(minutes, remaining)) {
        return Promise.reject(new Error("peek length not allowed: " + minutes));
      }
      return write({
        endsAt: Date.now() + minutes * 60000,
        reason: typeof reason === "string" ? reason.trim() : "",
        bannerClosed: false,
      });
    },

    async closeBanner() {
      const session = await YFB.PeekSession.get();
      if (session) await write({ ...session, bannerClosed: true });
    },

    clear() {
      return new Promise((resolve) => {
        try {
          chrome.storage.session.remove(KEY, () => resolve());
        } catch (e) {
          resolve();
        }
      });
    },

    onChange(callback) {
      const listener = (changes, area) => {
        if (area === "session" && changes[KEY]) {
          callback(changes[KEY].newValue || null, changes[KEY].oldValue || null);
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
})();
