/**
 * Home-feed replacement.
 *
 * On the YouTube home page, hides the real recommendation grid and injects
 * #yfb-panel in its place, rendered according to the feedMode setting:
 *   - blank   : a calm empty state
 *   - widgets : the productivity widget set (feed-widgets.js)
 *   - ai      : instruction box + stubbed "curating" state (no network yet)
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

  const isHome = () => location.pathname === "/" || location.pathname === "/index";

  function homeRoot() {
    return (
      document.querySelector('ytd-browse[page-subtype="home"]') ||
      document.querySelector("ytd-browse:not([hidden])")
    );
  }

  // --- panel rendering --------------------------------------------------
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderPanel(panel) {
    // Tear down any stateful widgets before wiping.
    YFB.Widgets && YFB.Widgets.teardown(panel);
    panel.textContent = "";
    panel.dataset.mode = settings.feedMode;

    if (settings.feedMode === YFB.FEED_MODES.BLANK) {
      const wrap = el("div", "yfb-blank");
      wrap.appendChild(el("p", "yfb-blank__msg", "Your home feed is turned off."));
      wrap.appendChild(
        el("p", "yfb-blank__sub", "Search or go to your Subscriptions when you want something specific.")
      );
      panel.appendChild(wrap);
      return;
    }

    if (settings.feedMode === YFB.FEED_MODES.WIDGETS) {
      YFB.Widgets.render(panel, settings);
      return;
    }

    if (settings.feedMode === YFB.FEED_MODES.AI) {
      renderAiStub(panel);
      return;
    }
  }

  function renderAiStub(panel) {
    const wrap = el("div", "yfb-ai");
    wrap.appendChild(el("h2", "yfb-ai__title", "AI-curated feed"));
    wrap.appendChild(
      el(
        "p",
        "yfb-ai__sub",
        "Describe the feed you want. Classification isn't wired up yet — this is a preview of the control."
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
        ? "Saved. Once the classifier backend is live, your home feed will be filtered to match this."
        : "Cleared.";
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
    if (panel.dataset.mode !== settings.feedMode || !panel.dataset.rendered) {
      renderPanel(panel);
      panel.dataset.rendered = "1";
    }
    return true;
  }

  function unmount() {
    document.documentElement.classList.remove(HOME_CLASS);
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      YFB.Widgets && YFB.Widgets.teardown(panel);
      panel.remove();
    }
  }

  function sync() {
    if (isHome()) {
      if (!mount()) {
        // Home DOM not ready yet — retry shortly.
        requestAnimationFrame(sync);
      }
    } else {
      unmount();
    }
  }

  function forceRerender() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) delete panel.dataset.rendered;
    sync();
  }

  // --- lifecycle ----------------------------------------------------
  YFB.getSettings().then((s) => {
    settings = s;
    sync();
  });

  YFB.onSettingsChanged((s) => {
    settings = s;
    forceRerender();
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
