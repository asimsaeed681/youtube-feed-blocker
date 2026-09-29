/**
 * Home-feed replacement and peeking.
 *
 * When hideHomeFeed is on, hides the real recommendation grid on the home page
 * and injects #yfb-panel in its place, rendered according to feedMode:
 *   - blank   : a calm empty state
 *   - widgets : the productivity widget set (feed-widgets.js)
 *   - ai      : instruction box + stubbed "curating" state (no network yet)
 *
 * Unless peekLevel is "none", the panel ends with a "Show my feed anyway" link.
 * It starts a countdown (after a typed reason for "reason"); when the countdown
 * ends the real feed shows until the user leaves the home page.
 *
 * Re-applies on YouTube's SPA navigations and on settings changes, and keeps
 * the real grid hidden via a MutationObserver as YouTube re-renders it.
 */
(function () {
  "use strict";

  const YFB = window.YFB;
  const HOME_CLASS = "yfb-home-replaced";
  const PANEL_ID = "yfb-panel";

  let settings = YFB.DEFAULT_SETTINGS;
  // Set when a peek countdown finishes; cleared when the user leaves Home.
  let peeked = false;
  let countdownTimer = null;

  const isHome = () => location.pathname === "/" || location.pathname === "/index";

  function homeRoot() {
    return (
      document.querySelector('ytd-browse[page-subtype="home"]') ||
      document.querySelector("ytd-browse:not([hidden])")
    );
  }

  // Only these settings change what the panel shows. Re-rendering on any other
  // change (Shorts, watch-page toggles) would reset a running focus timer or
  // peek countdown.
  function renderKey(s) {
    return JSON.stringify([s.feedMode, s.peekLevel, s.aiInstruction, s.widgets]);
  }

  // --- panel rendering --------------------------------------------------
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderPanel(panel) {
    // Tear down any stateful widgets and countdowns before wiping.
    YFB.Widgets && YFB.Widgets.teardown(panel);
    cancelCountdown();
    panel.textContent = "";
    panel.dataset.mode = settings.feedMode;
    panel.dataset.renderKey = renderKey(settings);

    if (settings.feedMode === YFB.FEED_MODES.BLANK) {
      renderBlank(panel);
    } else if (settings.feedMode === YFB.FEED_MODES.WIDGETS) {
      YFB.Widgets.render(panel, settings);
    } else if (settings.feedMode === YFB.FEED_MODES.AI) {
      renderAiStub(panel);
    }

    if (settings.peekLevel !== YFB.PEEK_LEVELS.NONE) {
      const box = el("div", "yfb-peek");
      panel.appendChild(box);
      showPeekLink(box);
    }
  }

  function renderBlank(panel) {
    const wrap = el("div", "yfb-blank");
    wrap.appendChild(el("p", "yfb-blank__msg", "Your home feed is turned off."));
    wrap.appendChild(
      el("p", "yfb-blank__sub", "Search or go to your Subscriptions when you want something specific.")
    );
    panel.appendChild(wrap);
  }

  function renderAiStub(panel) {
    const wrap = el("div", "yfb-ai");
    wrap.appendChild(el("h2", "yfb-ai__title", "AI-curated feed"));
    wrap.appendChild(
      el(
        "p",
        "yfb-ai__sub",
        "Describe the feed you want. Filtering isn't built yet, so this is a preview of the control."
      )
    );

    const form = el("form", "yfb-ai__form");
    const ta = el("textarea", "yfb-ai__input");
    ta.placeholder = 'e.g. "Only in-depth coding tutorials and talks. No clickbait, no reaction videos, no news."';
    ta.value = settings.aiInstruction || "";
    ta.rows = 3;
    ta.maxLength = 500;
    form.appendChild(ta);

    const save = el("button", "yfb-btn", "Save instruction");
    save.type = "submit";
    form.appendChild(save);

    const status = el("p", "yfb-ai__status");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const value = ta.value.trim();
      settings = await YFB.setSettings({ aiInstruction: value });
      status.textContent = value
        ? "Saved. Once filtering is built, your home feed will be matched to this."
        : "Cleared.";
      // aiInstruction is part of renderKey, so the storage.onChanged echo of
      // this same write would otherwise see a stale renderKey and re-render
      // the panel, wiping the status line just set above.
      panel.dataset.renderKey = renderKey(settings);
    });

    wrap.appendChild(form);
    wrap.appendChild(status);

    // Mocked "what would happen" note. TODO(phase-1.5): replace with real
    // classification results from the backend proxy.
    const mock = el("div", "yfb-ai__mock");
    mock.appendChild(el("h3", "yfb-ai__mock-title", "Preview (mocked)"));
    mock.appendChild(
      el(
        "p",
        "yfb-ai__mock-body",
        settings.aiInstruction
          ? 'Would keep videos matching: "' + settings.aiInstruction + '". Everything else hidden.'
          : "No instruction set yet, so nothing would be filtered."
      )
    );
    wrap.appendChild(mock);

    panel.appendChild(wrap);
  }

  // --- peeking ------------------------------------------------------------
  function cancelCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function neverMindButton(box) {
    const b = el("button", "yfb-peek__cancel", "Never mind");
    b.type = "button";
    b.addEventListener("click", () => showPeekLink(box));
    return b;
  }

  function showPeekLink(box) {
    cancelCountdown();
    box.textContent = "";
    const link = el("button", "yfb-peek__link", "Show my feed anyway");
    link.type = "button";
    link.addEventListener("click", () => {
      if (settings.peekLevel === YFB.PEEK_LEVELS.REASON) showReasonForm(box);
      else startCountdown(box, "");
    });
    box.appendChild(link);
  }

  function showReasonForm(box) {
    box.textContent = "";
    const form = el("form", "yfb-peek__form");

    const label = el("label", "yfb-peek__label", "What did you come for?");
    const input = el("input", "yfb-peek__input");
    input.type = "text";
    input.id = "yfb-peek-reason";
    input.maxLength = 120;
    input.autocomplete = "off";
    label.htmlFor = input.id;

    const go = el("button", "yfb-btn", "Continue");
    go.type = "submit";

    const error = el("p", "yfb-peek__error");
    error.setAttribute("role", "alert");

    form.append(label, input, go, neverMindButton(box), error);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!YFB.isValidReason(input.value)) {
        error.textContent = "Write a few words about what you came for.";
        input.focus();
        return;
      }
      startCountdown(box, input.value.trim());
    });

    box.appendChild(form);
    input.focus();
  }

  function startCountdown(box, reason) {
    cancelCountdown();
    box.textContent = "";
    const msg = el("p", "yfb-peek__count");
    msg.setAttribute("aria-live", "polite");
    box.append(msg, neverMindButton(box));

    let remaining = YFB.PEEK_SECONDS;
    const paint = () => {
      msg.textContent = "Your feed opens in " + remaining + (remaining === 1 ? " second" : " seconds");
    };
    paint();

    countdownTimer = setInterval(() => {
      // Only count while the tab is visible, so the wait can't pass unseen.
      if (document.hidden) return;
      remaining -= 1;
      if (remaining > 0) {
        paint();
        return;
      }
      cancelCountdown();
      if (reason) YFB.setReason(reason);
      peeked = true;
      sync();
    }, 1000);
  }

  // --- mounting / unmounting ------------------------------------------
  function mount() {
    const rootEl = homeRoot();
    if (!rootEl) return false;

    document.documentElement.classList.add(HOME_CLASS);

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = el("div", null);
      panel.id = PANEL_ID;
    }
    if (panel.parentElement !== rootEl) {
      rootEl.appendChild(panel);
    }
    if (panel.dataset.renderKey !== renderKey(settings)) {
      renderPanel(panel);
    }
    return true;
  }

  function unmount() {
    cancelCountdown();
    document.documentElement.classList.remove(HOME_CLASS);
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      YFB.Widgets && YFB.Widgets.teardown(panel);
      panel.remove();
    }
  }

  function sync() {
    if (!isHome()) {
      peeked = false;
      unmount();
      return;
    }
    if (!settings.hideHomeFeed || peeked) {
      unmount();
      return;
    }
    if (!mount()) {
      // Home DOM not ready yet, retry shortly.
      requestAnimationFrame(sync);
    }
  }

  // --- lifecycle ----------------------------------------------------
  YFB.getSettings().then((s) => {
    settings = s;
    sync();
  });

  // mount() re-renders only when renderKey changes, so unrelated settings
  // changes leave the panel (and any running countdown) alone.
  YFB.onSettingsChanged((s) => {
    settings = s;
    sync();
  });

  document.addEventListener("yt-navigate-finish", sync, true);

  // Backstop: keep the real grid suppressed and the panel present as YouTube
  // streams content in after navigation.
  let scheduled = false;
  function startObserver() {
    if (!document.body) {
      requestAnimationFrame(startObserver);
      return;
    }
    const obs = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        sync();
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
    sync();
  }
  startObserver();
})();
