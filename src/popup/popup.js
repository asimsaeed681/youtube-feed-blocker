/**
 * Popup controller. Reads settings, reflects them into the form, and writes
 * every change straight back to chrome.storage.sync (content scripts pick up
 * the change live via chrome.storage.onChanged).
 */
(function () {
  "use strict";

  const YFB = window.YFB;

  const els = {
    toggles: Array.from(document.querySelectorAll("input[data-setting]")),
    peekLevel: Array.from(document.querySelectorAll('input[name="peekLevel"]')),
    feedMode: Array.from(document.querySelectorAll('input[name="feedMode"]')),
    feedSections: document.getElementById("feedSections"),
    widgetOptions: document.getElementById("widgetOptions"),
    aiOptions: document.getElementById("aiOptions"),
    w_todo: document.getElementById("w_todo"),
    w_timer: document.getElementById("w_timer"),
    w_quote: document.getElementById("w_quote"),
    aiInstruction: document.getElementById("aiInstruction"),
    version: document.getElementById("version"),
  };

  function reflectConditionalSections(settings) {
    // Peek and feed-mode choices only matter while the home feed is hidden.
    els.feedSections.hidden = !settings.hideHomeFeed;
    els.widgetOptions.hidden = settings.feedMode !== YFB.FEED_MODES.WIDGETS;
    els.aiOptions.hidden = settings.feedMode !== YFB.FEED_MODES.AI;
  }

  function reflect(settings) {
    els.toggles.forEach((t) => (t.checked = settings[t.dataset.setting]));
    els.peekLevel.forEach((r) => (r.checked = r.value === settings.peekLevel));
    els.feedMode.forEach((r) => (r.checked = r.value === settings.feedMode));
    els.w_todo.checked = settings.widgets.todo;
    els.w_timer.checked = settings.widgets.timer;
    els.w_quote.checked = settings.widgets.quote;
    // Don't overwrite the textarea while the user is typing in it.
    if (document.activeElement !== els.aiInstruction) {
      els.aiInstruction.value = settings.aiInstruction;
    }
    reflectConditionalSections(settings);
  }

  async function init() {
    try {
      els.version.textContent = "v" + chrome.runtime.getManifest().version;
    } catch (e) {
      /* ignore */
    }

    let current = await YFB.getSettings();
    reflect(current);

    els.toggles.forEach((toggle) => {
      toggle.addEventListener("change", () => {
        const key = toggle.dataset.setting;
        current = { ...current, [key]: toggle.checked };
        reflectConditionalSections(current);
        YFB.setSettings({ [key]: toggle.checked });
      });
    });

    els.peekLevel.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        YFB.setSettings({ peekLevel: radio.value });
      });
    });

    els.feedMode.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        current = { ...current, feedMode: radio.value };
        reflectConditionalSections(current);
        YFB.setSettings({ feedMode: radio.value });
      });
    });

    [["w_todo", "todo"], ["w_timer", "timer"], ["w_quote", "quote"]].forEach(
      ([id, key]) => {
        els[id].addEventListener("change", () => {
          YFB.setSettings({ widgets: { [key]: els[id].checked } });
        });
      }
    );

    let aiSaveTimer = null;
    els.aiInstruction.addEventListener("input", () => {
      clearTimeout(aiSaveTimer);
      aiSaveTimer = setTimeout(() => {
        YFB.setSettings({ aiInstruction: els.aiInstruction.value.trim() });
      }, 400);
    });

    // Keep the popup in sync if another surface changes settings while open.
    YFB.onSettingsChanged((s) => {
      current = s;
      reflect(s);
    });
  }

  init();
})();
