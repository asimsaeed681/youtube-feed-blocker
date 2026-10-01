/**
 * Peek timer: one per tab.
 *
 * While a peek session runs it ticks once a second against the session's end
 * time (wall clock, shared by all tabs). In the last PEEK_WARN_MINUTES it shows
 * a small countdown chip. When time is up it clears the session, so every tab
 * hides the feed again, and on a watch page it pauses the video and asks:
 * keep watching this video, or go back to Home.
 *
 * Background tabs may tick late (Chrome throttles their timers), so a tab
 * that sees the session removed at or near its end time treats that as its
 * own expiry too.
 */
(function () {
  "use strict";

  const YFB = window.YFB;
  const CHIP_ID = "yfb-peek-chip";
  const CARD_ID = "yfb-timeup";
  const TICK_MS = 1000;
  // A removal this close to endsAt is another tab's expiry, not a cancel.
  const EXPIRY_SLACK_MS = 2000;
  // YouTube selectors for the main player's video element, checked in order
  // so a hover-preview video earlier in the DOM can't win a combined-selector
  // document-order match.
  const MAIN_VIDEO = "video.html5-main-video";
  const PLAYER_VIDEO = "#movie_player video";

  function mainVideo() {
    return document.querySelector(MAIN_VIDEO) || document.querySelector(PLAYER_VIDEO);
  }

  let session = null;
  let ticker = null;

  const isWatch = () => location.pathname === "/watch";

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function format(ms) {
    const total = Math.ceil(ms / 1000);
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
  }

  // --- countdown chip ---------------------------------------------------
  function removeChip() {
    const chip = document.getElementById(CHIP_ID);
    if (chip) chip.remove();
  }

  function paintChip(ms) {
    if (!document.body) return;
    let chip = document.getElementById(CHIP_ID);
    if (!chip) {
      chip = el("div");
      chip.id = CHIP_ID;
      chip.setAttribute("role", "timer");
      (document.fullscreenElement || document.body).appendChild(chip);
    }
    chip.textContent = "Feed closes in " + format(ms);
  }

  // Fullscreen only renders document.fullscreenElement's subtree, so a chip
  // left under document.body would vanish; move it into whichever is current.
  document.addEventListener("fullscreenchange", () => {
    const chip = document.getElementById(CHIP_ID);
    if (chip) (document.fullscreenElement || document.body).appendChild(chip);
  });

  // --- time's up card ---------------------------------------------------
  function closeCard() {
    const card = document.getElementById(CARD_ID);
    if (card) card.remove();
  }

  function showTimeUp() {
    const video = mainVideo();
    if (video) video.pause();
    // Fullscreen only renders document.fullscreenElement's subtree, so the
    // card would be invisible behind it; drop out of fullscreen first.
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (document.getElementById(CARD_ID) || !document.body) return;

    const overlay = el("div");
    overlay.id = CARD_ID;
    const card = el("div", "yfb-timeup__card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "yfb-timeup-title");
    const title = el("h2", "yfb-timeup__title", "Time's up");
    title.id = "yfb-timeup-title";
    const body = el("p", "yfb-timeup__body", "Your feed time is over.");

    const actions = el("div", "yfb-timeup__actions");
    const keep = el("button", "yfb-timeup__keep", "Keep watching this video");
    keep.type = "button";
    const home = el("button", "yfb-timeup__home", "Back to Home");
    home.type = "button";

    const keepWatching = () => {
      closeCard();
      const v = mainVideo();
      if (v) v.play().catch(() => {});
    };
    keep.addEventListener("click", keepWatching);
    home.addEventListener("click", () => {
      closeCard();
      location.assign("/");
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        keepWatching();
        return;
      }
      // Trap Tab/Shift+Tab between the two buttons: this is a modal over
      // YouTube's own page, which has its own focusable elements the
      // overlay should not leak focus into (the Escape handler above is
      // bound to the overlay, so focus leaving it stops Escape from
      // reaching this listener at all).
      if (e.key === "Tab") {
        if (e.shiftKey && document.activeElement === keep) {
          e.preventDefault();
          home.focus();
        } else if (!e.shiftKey && document.activeElement === home) {
          e.preventDefault();
          keep.focus();
        }
        return;
      }
      // Stop every other key (not Enter/Space, which must still activate our
      // buttons) from reaching YouTube's player shortcuts (k, j, l, f) behind
      // the dialog.
      e.stopPropagation();
    });
    // Keep focus inside the dialog: a mousedown on the backdrop itself (not
    // the card) would otherwise blur the focused button with nothing to
    // replace it.
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) {
        e.preventDefault();
        keep.focus();
      }
    });

    actions.append(keep, home);
    card.append(title, body, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    keep.focus();
  }

  // --- session tracking -------------------------------------------------
  function stopTicking() {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    removeChip();
  }

  function expire() {
    stopTicking();
    session = null;
    YFB.PeekSession.clear();
    if (isWatch()) showTimeUp();
  }

  function tick() {
    const left = YFB.peekRemainingMs(session, Date.now());
    if (left <= 0) {
      expire();
      return;
    }
    if (left <= YFB.PEEK_WARN_MINUTES * 60000) paintChip(left);
    else removeChip();
  }

  function track(next) {
    session = next;
    if (YFB.peekRemainingMs(session, Date.now()) > 0) {
      if (!ticker) ticker = setInterval(tick, TICK_MS);
      tick();
      return;
    }
    stopTicking();
    // A session that ended while no YouTube tab was open: just tidy it away.
    if (session) {
      session = null;
      YFB.PeekSession.clear();
    }
  }

  YFB.PeekSession.get().then(track);
  YFB.PeekSession.onChange((next, prev) => {
    const endedByAnotherTab =
      !next && prev && session && prev.endsAt - Date.now() <= EXPIRY_SLACK_MS;
    if (endedByAnotherTab) {
      stopTicking();
      session = null;
      if (isWatch()) showTimeUp();
      return;
    }
    track(next);
  });

  // The card belongs to the video it paused.
  document.addEventListener("yt-navigate-finish", closeCard, true);
})();
