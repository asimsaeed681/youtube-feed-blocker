/**
 * Daily feed time budget.
 *
 * Pure helpers (no chrome.* calls) for what's left today, which peek lengths
 * to offer, and how a budget change applies, plus a small wrapper over the
 * synced usage record. Usage lives in chrome.storage.sync so the budget is per
 * person across their Chrome installs; it is written once per peek.
 */
(function () {
  "use strict";

  const YFB = (globalThis.YFB = globalThis.YFB || {});

  // Local calendar date, so the budget resets at the user's own midnight.
  YFB.todayKey = function todayKey(date) {
    const d = date || new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  };

  // Minutes of feed time left today. Infinity when the budget is Off.
  YFB.budgetRemaining = function budgetRemaining(settings, usage, today) {
    if (!settings.dailyBudgetMinutes) return Infinity;
    const used = usage && usage.date === today ? usage.usedMinutes : 0;
    return Math.max(0, settings.dailyBudgetMinutes - used);
  };

  // Peek length buttons. Presets longer than what's left are disabled, and a
  // short leftover that isn't a preset gets its own "rest of today" button.
  YFB.durationChoices = function durationChoices(remaining) {
    const presets = YFB.PEEK_DURATIONS;
    const choices = presets.map((m) => ({ minutes: m, label: m + " min", disabled: m > remaining }));
    const longest = presets[presets.length - 1];
    if (remaining > 0 && remaining < longest && !presets.includes(remaining)) {
      choices.push({ minutes: remaining, label: remaining + " min (rest of today)", disabled: false });
    }
    return choices.sort((a, b) => a.minutes - b.minutes);
  };

  YFB.isValidPeekLength = function isValidPeekLength(minutes, remaining) {
    if (YFB.PEEK_DURATIONS.includes(minutes)) return minutes <= remaining;
    return Number.isFinite(remaining) && remaining > 0 && minutes === remaining;
  };

  // Getting stricter is instant; getting looser waits for a next-day yes.
  // Returns a settings patch.
  YFB.applyBudgetChange = function applyBudgetChange(settings, newMinutes, today) {
    const current = settings.dailyBudgetMinutes;
    if (newMinutes === current) return { pendingBudget: null };
    const isLower = newMinutes !== 0 && (current === 0 || newMinutes < current);
    if (isLower) return { dailyBudgetMinutes: newMinutes, pendingBudget: null };
    return { pendingBudget: { minutes: newMinutes, requestedOn: today } };
  };

  // A pending raise is asked about once a later day has started.
  YFB.pendingBudgetDue = function pendingBudgetDue(settings, today) {
    return !!settings.pendingBudget && settings.pendingBudget.requestedOn < today;
  };

  const KEY = YFB.USAGE_KEY;

  YFB.FeedBudget = {
    getUsage() {
      return new Promise((resolve) => {
        try {
          chrome.storage.sync.get(KEY, (res) => {
            resolve(chrome.runtime.lastError ? null : (res && res[KEY]) || null);
          });
        } catch (e) {
          resolve(null);
        }
      });
    },

    async spend(minutes) {
      const today = YFB.todayKey();
      const usage = await YFB.FeedBudget.getUsage();
      const used = usage && usage.date === today ? usage.usedMinutes : 0;
      const next = { date: today, usedMinutes: used + minutes };
      return new Promise((resolve, reject) => {
        chrome.storage.sync.set({ [KEY]: next }, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(next);
        });
      });
    },

    onUsageChanged(callback) {
      const listener = (changes, area) => {
        if (area === "sync" && changes[KEY]) callback(changes[KEY].newValue || null);
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
})();
