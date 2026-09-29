/**
 * Watch-page hiding.
 *
 * Two jobs:
 *   1. Mirror the hideUpNext, hideComments and blockAutoplay settings onto
 *      classes on <html>, which watch-page.css keys off.
 *   2. When blockAutoplay is on, switch YouTube's own autoplay toggle off once
 *      per video page. Turning the setting off again does not switch YouTube's
 *      autoplay back on: from then on that toggle is the user's.
 */
(function () {
  "use strict";

  const YFB = window.YFB;

  const CLASSES = Object.freeze({
    hideUpNext: "yfb-hide-upnext",
    hideComments: "yfb-hide-comments",
    blockAutoplay: "yfb-block-autoplay",
  });

  // YouTube selector for the player's autoplay switch; aria-checked lives on
  // this inner div. Its click handler is a no-op though: the real listener
  // is bound to the ancestor <button>, so a plain .click() on the div fires
  // a bare "click" event that its tap/gesture recognizer ignores (verified:
  // it never flips aria-checked). Clicking the button ancestor does flip it.
  const AUTOPLAY_TOGGLE = ".ytp-autonav-toggle-button";
  // The player builds its controls after navigation; poll briefly for them.
  const AUTOPLAY_POLL_MS = 500;
  // Don't click on every poll tick: give YouTube's own re-render a moment to
  // settle before checking again.
  const AUTOPLAY_CLICK_SETTLE_MS = 1500;
  // Bounded budget for the whole poll-and-click loop.
  const AUTOPLAY_BUDGET_MS = 15000;

  const root = document.documentElement;
  let settings = YFB.DEFAULT_SETTINGS;

  function applyClasses() {
    for (const [key, cls] of Object.entries(CLASSES)) {
      root.classList.toggle(cls, !!settings[key]);
    }
  }

  // Each call supersedes the previous one, so a fast navigation doesn't leave
  // an old retry loop clicking on the next page.
  let autoplayRun = 0;
  function switchOffAutoplay() {
    if (!settings.blockAutoplay || location.pathname !== "/watch") return;
    const run = ++autoplayRun;
    const deadline = Date.now() + AUTOPLAY_BUDGET_MS;
    let lastClick = 0;
    (function poll() {
      if (run !== autoplayRun || !settings.blockAutoplay) return;
      const toggle = document.querySelector(AUTOPLAY_TOGGLE);
      const state = toggle && toggle.getAttribute("aria-checked");
      if (state === "false") return;
      if (state === "true" && Date.now() - lastClick >= AUTOPLAY_CLICK_SETTLE_MS) {
        (toggle.closest("button") || toggle).click();
        lastClick = Date.now();
      }
      if (Date.now() < deadline) setTimeout(poll, AUTOPLAY_POLL_MS);
    })();
  }

  // Apply defaults immediately so there is no flash before storage returns.
  applyClasses();

  YFB.getSettings().then((s) => {
    settings = s;
    applyClasses();
    switchOffAutoplay();
  });

  YFB.onSettingsChanged((s) => {
    const wasBlocking = settings.blockAutoplay;
    settings = s;
    applyClasses();
    if (s.blockAutoplay && !wasBlocking) switchOffAutoplay();
  });

  document.addEventListener("yt-navigate-finish", switchOffAutoplay, true);
})();
