/**
 * Shared constants + default settings.
 * Loaded first in the content-script list and also via <script> in the popup,
 * so everything hangs off a single global namespace (window.YFB).
 */
(function () {
  "use strict";

  const YFB = (window.YFB = window.YFB || {});

  YFB.FEED_MODES = Object.freeze({
    BLANK: "blank",
    WIDGETS: "widgets",
    AI: "ai",
  });

  YFB.DEFAULT_SETTINGS = Object.freeze({
    shortsBlocking: true,
    feedMode: YFB.FEED_MODES.WIDGETS,
    aiInstruction: "",
    widgets: Object.freeze({ todo: true, timer: true, quote: true }),
  });

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
