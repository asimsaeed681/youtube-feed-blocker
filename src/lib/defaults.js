/**
 * Shared constants + default settings.
 * Loaded first in the content-script list, via <script> in the popup, and via
 * importScripts() in the service worker, so everything hangs off globalThis.YFB
 * (which is window.YFB in pages and content scripts).
 */
(function () {
  "use strict";

  const YFB = (globalThis.YFB = globalThis.YFB || {});

  YFB.FEED_MODES = Object.freeze({
    BLANK: "blank",
    WIDGETS: "widgets",
    AI: "ai",
  });

  // How much friction stands between the user and the real home feed.
  YFB.PEEK_LEVELS = Object.freeze({
    PAUSE: "pause",
    REASON: "reason",
    NONE: "none",
  });

  YFB.PEEK_SECONDS = 10;
  YFB.MIN_REASON_LENGTH = 3;

  YFB.DEFAULT_SETTINGS = Object.freeze({
    shortsBlocking: true,
    hideHomeFeed: true,
    hideUpNext: true,
    blockAutoplay: true,
    hideComments: false,
    peekLevel: YFB.PEEK_LEVELS.REASON,
    feedMode: YFB.FEED_MODES.WIDGETS,
    aiInstruction: "",
    widgets: Object.freeze({ todo: true, timer: true, quote: true }),
  });

  YFB.isValidReason = function isValidReason(value) {
    return typeof value === "string" && value.trim().length >= YFB.MIN_REASON_LENGTH;
  };

  // A small, tasteful default rotation. Kept short on purpose.
  YFB.QUOTES = Object.freeze([
    { text: "The way to get started is to quit talking and begin doing.", by: "Walt Disney" },
    { text: "It is not that we have a short time to live, but that we waste a lot of it.", by: "Seneca" },
    { text: "You will never find time for anything. If you want time you must make it.", by: "Charles Buxton" },
    { text: "Amateurs sit and wait for inspiration, the rest of us just get up and go to work.", by: "Stephen King" },
    { text: "What gets measured gets managed.", by: "Peter Drucker" },
    { text: "Simplicity is the ultimate sophistication.", by: "Leonardo da Vinci" },
  ]);

  // chrome.storage.sync key under which the whole settings object is stored.
  YFB.STORAGE_KEY = "settings";
})();
