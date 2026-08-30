/**
 * Shorts blocker.
 *
 * Three jobs:
 *   1. Toggle the html.yfb-shorts-allowed class that enables/disables the static
 *      CSS in hide-shorts.css, based on the shortsBlocking setting.
 *   2. Redirect /shorts/<id> to the normal /watch?v=<id> player, including on
 *      YouTube's client-side (SPA) navigations.
 *   3. Run a MutationObserver as a backstop to strip Shorts nodes that the
 *      static CSS can't structurally target as YouTube re-renders.
 */
(function () {
  "use strict";

  const YFB = window.YFB;
  const ALLOW_CLASS = "yfb-shorts-allowed";
  let blocking = true; // assume on until settings load (matches default)

  const root = document.documentElement;

  function applyBlockingClass() {
    root.classList.toggle(ALLOW_CLASS, !blocking);
  }

  // --- 1. settings ---------------------------------------------------------
  // Apply the default immediately so there is no flash before storage returns.
  applyBlockingClass();

  YFB.getSettings().then((s) => {
    blocking = s.shortsBlocking;
    applyBlockingClass();
    maybeRedirectShorts();
  });

  YFB.onSettingsChanged((s) => {
    blocking = s.shortsBlocking;
    applyBlockingClass();
    if (blocking) maybeRedirectShorts();
  });

  // --- 2. /shorts/<id> -> /watch?v=<id> -----------------------------------
  function shortsIdFromPath(pathname) {
    const m = pathname.match(/^\/shorts\/([\w-]{6,})/);
    return m ? m[1] : null;
  }

  function maybeRedirectShorts() {
    if (!blocking) return;
    const id = shortsIdFromPath(location.pathname);
    if (!id) return;
    const target = location.origin + "/watch?v=" + encodeURIComponent(id);
    // replace() so the Shorts URL doesn't stay in history / back-button loop.
    location.replace(target);
  }

  // Run once now (covers a direct load of a /shorts/ URL at document_start).
  maybeRedirectShorts();

  // YouTube fires this on every client-side navigation.
  document.addEventListener("yt-navigate-finish", maybeRedirectShorts, true);

  // Fallback: watch for URL changes that don't emit the event.
  let lastPath = location.pathname;
  function checkPathChange() {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      maybeRedirectShorts();
    }
  }

  // --- 3. MutationObserver backstop --------------------------------------
  // Container tag names that represent a single Shorts entry or shelf.
  const SHORTS_CONTAINERS = [
    "YTD-VIDEO-RENDERER",
    "YTD-GRID-VIDEO-RENDERER",
    "YTD-RICH-ITEM-RENDERER",
    "YTD-COMPACT-VIDEO-RENDERER",
    "YTD-REEL-SHELF-RENDERER",
    "YTD-RICH-SECTION-RENDERER",
  ];

  function stripShorts() {
    if (!blocking) return;
    // Any anchor that points at a Short — hide its closest known container.
    const anchors = document.querySelectorAll('a[href^="/shorts"]');
    for (const a of anchors) {
      let el = a;
      while (el && el !== document.body) {
        if (SHORTS_CONTAINERS.includes(el.tagName)) {
          el.style.setProperty("display", "none", "important");
          break;
        }
        el = el.parentElement;
      }
    }
    // is-shorts rich shelves (attribute selector, in case :has support lags).
    document
      .querySelectorAll("ytd-rich-shelf-renderer[is-shorts]")
      .forEach((el) => {
        const section = el.closest("ytd-rich-section-renderer") || el;
        section.style.setProperty("display", "none", "important");
      });
  }

  let scheduled = false;
  function schedule() {
    checkPathChange();
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      stripShorts();
    });
  }

  function startObserver() {
    if (!document.body) {
      requestAnimationFrame(startObserver);
      return;
    }
    stripShorts();
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
  }
  startObserver();
})();
