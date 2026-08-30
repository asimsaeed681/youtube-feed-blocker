/**
 * Popup controller. Reads settings, reflects them into the form, and writes
 * every change straight back to chrome.storage.sync (content scripts pick up
 * the change live via chrome.storage.onChanged).
 */
(function () {
  "use strict";

  const YFB = window.YFB;

  const els = {
    shortsBlocking: document.getElementById("shortsBlocking"),
    feedMode: Array.from(document.querySelectorAll('input[name="feedMode"]')),
    widgetOptions: document.getElementById("widgetOptions"),
    aiOptions: document.getElementById("aiOptions"),
    w_todo: document.getElementById("w_todo"),
    w_timer: document.getElementById("w_timer"),
    w_quote: document.getElementById("w_quote"),
    aiInstruction: document.getElementById("aiInstruction"),
    version: document.getElementById("version"),
  };

  function reflectConditionalSections(mode) {
    els.widgetOptions.hidden = mode !== YFB.FEED_MODES.WIDGETS;
    els.aiOptions.hidden = mode !== YFB.FEED_MODES.AI;
  }

  function reflect(settings) {
    els.shortsBlocking.checked = settings.shortsBlocking;
    els.feedMode.forEach((r) => (r.checked = r.value === settings.feedMode));
    els.w_todo.checked = settings.widgets.todo;
    els.w_timer.checked = settings.widgets.timer;
    els.w_quote.checked = settings.widgets.quote;
    els.aiInstruction.value = settings.aiInstruction;
    reflectConditionalSections(settings.feedMode);
  }

  async function init() {
    try {
      els.version.textContent = "v" + chrome.runtime.getManifest().version;
    } catch (e) {
      /* ignore */
    }

    const settings = await YFB.getSettings();
    reflect(settings);

    els.shortsBlocking.addEventListener("change", () => {
      YFB.setSettings({ shortsBlocking: els.shortsBlocking.checked });
    });

    els.feedMode.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        reflectConditionalSections(radio.value);
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
    YFB.onSettingsChanged(reflect);
  }

  init();
})();
