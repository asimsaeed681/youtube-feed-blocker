# Timed Peek and Daily Feed Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the peek into a timed session shared by all YouTube tabs (5/10/15/30 minutes), drawn from a daily feed time budget that is easy to lower and needs a next-day confirmation to raise, with a closing countdown and a "Time's up" pause on videos.

**Architecture:** Plain MV3 extension, no build step, one global namespace (`window.YFB` / `globalThis.YFB`). Pure budget and session helpers live in two new `src/lib/` files so Node unit tests can load them. The started peek lives in `chrome.storage.session` (shared across tabs, private from YouTube's page scripts, cleared when the browser closes); settings and daily usage live in `chrome.storage.sync`. Content scripts react to storage change events, so every tab updates live.

**Tech Stack:** Vanilla JS (ES2020), CSS, Chrome MV3 (`chrome.storage.sync`, `chrome.storage.session`). Tests: `node test/unit.mjs` (Node, in-memory storage stub) and `node test/e2e.mjs` (headful Playwright Chromium, live youtube.com). No npm install, no package.json.

**Spec:** `docs/superpowers/specs/2026-10-01-timed-peek-design.md` (builds on `docs/superpowers/specs/2026-09-29-v0.2-hide-and-peek-design.md`)

## Global Constraints

- No network requests. Permissions stay `["storage"]`; host match stays `https://www.youtube.com/*`.
- No em dashes (U+2014) in any user-facing copy (panel, chip, card, banner, popup, store copy blocks, privacy policy text).
- Buttons have 8px corners, never pill shaped. Toggle switches are the only fully rounded controls.
- User-typed text is inserted with `textContent`, never `innerHTML`.
- Constants (defaults.js): `YFB.PEEK_DURATIONS = [5, 10, 15, 30]`, `YFB.PEEK_WARN_MINUTES = 5`, `YFB.BUDGET_CHOICES = [0, 15, 30, 45, 60, 90]`, `YFB.PEEK_SESSION_KEY = "peekSession"`, `YFB.USAGE_KEY = "feedTimeUsage"`. Default `dailyBudgetMinutes: 30`, `pendingBudget: null`.
- Session object: `{ endsAt: <ms epoch>, reason: <string>, bannerClosed: <bool> }` in `chrome.storage.session` under `peekSession`.
- Usage object: `{ date: "YYYY-MM-DD" (local), usedMinutes: <int> }` in `chrome.storage.sync` under `feedTimeUsage`.
- Starting a peek spends its full length; lowering the budget applies now; raising (including to Off) is saved as `pendingBudget: { minutes, requestedOn }` and only applies after a next-day confirmation.
- Exact copy: "How long?"; "N min" and "N min (rest of today)"; "N minutes of feed time left today" ("1 minute" when 1); "You've used today's feed time. It resets at midnight."; "Feed closes in M:SS"; "Time's up"; "Your feed time is over."; "Keep watching this video"; "Back to Home"; popup "Daily feed time", "Off", "15 min" ... "90 min".
- Match surrounding style: IIFE per file, `"use strict"`, 2-space indent, double quotes, short why-comments.
- Every commit message: subject, blank line, then the trailer on its own line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

- A peek started in one tab must end in every tab when time is up, including a tab whose own timer is throttled in the background: the tab that sees the session removed near its `endsAt` must treat it as expiry (pause + card on a watch page). Pinned in Task 3 e2e (expiry on a page whose timer did not fire first is covered by the removal-handling path; the watch-page expiry check exercises it).
- Budget changes racing a peek: if remaining time shrinks between drawing the duration buttons and the 10 second pause ending, starting must be refused and the panel redrawn, never overspending. Pinned in Task 1 unit (`start` rejects a length above remaining).
- Midnight and stale data: usage from a previous date counts as zero, and a pending raise from today never shows the card today. Pinned in Task 1 unit.
- A user who closes the "You came for" banner must not see it reappear in another tab or after navigating during the same peek. Pinned in Task 2 e2e (close then navigate).
- Expired sessions left in storage (browser kept open, no YouTube tab at expiry) must not open the feed on the next visit. Pinned in Task 3 e2e (session with `endsAt` in the past keeps the panel).

---

### Task 1: Budget and session libraries

**Files:**
- Modify: `src/lib/defaults.js`, `src/lib/storage.js`, `src/background.js`
- Create: `src/lib/feed-budget.js`, `src/lib/peek-session.js`
- Modify: `test/unit.mjs`, `test/e2e.mjs` (settings helper only)

**Interfaces:**
- Produces:
  - Constants listed in Global Constraints.
  - Settings keys `dailyBudgetMinutes` (one of `BUDGET_CHOICES`, 0 = Off) and `pendingBudget` (`null | { minutes, requestedOn }`), validated in `mergeWithDefaults`.
  - `YFB.todayKey(date?) -> "YYYY-MM-DD"` (local time)
  - `YFB.budgetRemaining(settings, usage, today) -> number` (Infinity when Off)
  - `YFB.durationChoices(remaining) -> Array<{ minutes, label, disabled }>` sorted by minutes
  - `YFB.isValidPeekLength(minutes, remaining) -> boolean`
  - `YFB.applyBudgetChange(settings, newMinutes, today) -> settings patch`
  - `YFB.pendingBudgetDue(settings, today) -> boolean`
  - `YFB.FeedBudget.getUsage() -> Promise<usage|null>`, `.spend(minutes) -> Promise<usage>`, `.onUsageChanged(cb) -> unsubscribe`
  - `YFB.peekRemainingMs(session, now) -> number` (0 when none or expired)
  - `YFB.PeekSession.get() -> Promise<session|null>`, `.start(minutes, reason, remaining) -> Promise<session>` (rejects invalid length), `.closeBanner() -> Promise`, `.clear() -> Promise`, `.onChange(cb) -> unsubscribe` (cb gets new value or null, plus old value as 2nd arg)

- [ ] **Step 1: Write the failing unit tests**

In `test/unit.mjs`:

a) Extend the stub. Add a `remove` method to the `sync` area and add a `session` area. Replace the `globalThis.chrome = { ... };` object with:

```js
// Session-area store (chrome.storage.session), kept separate like Chrome does.
const sessionStore = {};

function makeArea(target, opts) {
  return {
    get(key, cb) {
      setTimeout(() => {
        if (opts && opts.failGet && opts.failGet()) {
          chrome.runtime.lastError = { message: "simulated get failure" };
          try {
            cb({});
          } finally {
            delete chrome.runtime.lastError;
          }
          return;
        }
        cb({ [key]: clone(target[key]) });
      }, 5);
    },
    set(obj, cb) {
      setTimeout(() => {
        if (opts && opts.failSet && opts.failSet()) {
          chrome.runtime.lastError = { message: "simulated set failure" };
          try {
            if (cb) cb();
          } finally {
            delete chrome.runtime.lastError;
          }
          return;
        }
        Object.assign(target, clone(obj));
        if (cb) cb();
      }, 5);
    },
    remove(key, cb) {
      setTimeout(() => {
        delete target[key];
        if (cb) cb();
      }, 5);
    },
  };
}

globalThis.chrome = {
  runtime: {},
  storage: {
    sync: makeArea(store, {
      failGet: () => (failNextGet ? ((failNextGet = false), true) : false),
      failSet: () => (failNextSet ? ((failNextSet = false), true) : false),
    }),
    session: makeArea(sessionStore),
    onChanged: { addListener() {}, removeListener() {} },
  },
};
```

b) Load the new libraries. Change the loader list to:

```js
for (const f of ["src/lib/defaults.js", "src/lib/storage.js", "src/lib/feed-budget.js", "src/lib/peek-session.js"]) {
```

c) Directly before the final `console.log(\`\n${total - failed}/${total} passed\`);`, append:

```js
// --- daily feed time: settings ---
const noBudget = YFB.mergeWithDefaults({ peekLevel: "pause" });
check("settings without a budget load with 30 minutes and no pending raise",
  noBudget.dailyBudgetMinutes === 30 && noBudget.pendingBudget === null, JSON.stringify(noBudget));
const badBudget = YFB.mergeWithDefaults({ dailyBudgetMinutes: 20, pendingBudget: { minutes: 7, requestedOn: "x" } });
check("invalid budget and pending raise fall back",
  badBudget.dailyBudgetMinutes === 30 && badBudget.pendingBudget === null, JSON.stringify(badBudget));
const keptPending = YFB.mergeWithDefaults({ dailyBudgetMinutes: 15, pendingBudget: { minutes: 0, requestedOn: "2026-10-01" } });
check("a valid pending raise to Off is kept",
  keptPending.dailyBudgetMinutes === 15 && keptPending.pendingBudget.minutes === 0 && keptPending.pendingBudget.requestedOn === "2026-10-01");

// --- daily feed time: pure helpers ---
check("todayKey uses the local calendar date", YFB.todayKey(new Date(2026, 0, 5, 23, 59)) === "2026-01-05");

const T = "2026-10-01";
const s30 = { dailyBudgetMinutes: 30 };
check("budget Off means unlimited", YFB.budgetRemaining({ dailyBudgetMinutes: 0 }, null, T) === Infinity);
check("fresh day has the full budget", YFB.budgetRemaining(s30, { date: "2026-09-30", usedMinutes: 30 }, T) === 30);
check("partly used budget", YFB.budgetRemaining(s30, { date: T, usedMinutes: 18 }, T) === 12);
check("used up budget", YFB.budgetRemaining(s30, { date: T, usedMinutes: 30 }, T) === 0);
check("budget lowered below what's used gives 0",
  YFB.budgetRemaining({ dailyBudgetMinutes: 15 }, { date: T, usedMinutes: 20 }, T) === 0);

const fmt = (cs) => cs.map((c) => c.minutes + (c.disabled ? "x" : "") + (c.label.includes("rest of today") ? "r" : "")).join(",");
check("choices with 60 left", fmt(YFB.durationChoices(60)) === "5,10,15,30", fmt(YFB.durationChoices(60)));
check("choices with 30 left", fmt(YFB.durationChoices(30)) === "5,10,15,30", fmt(YFB.durationChoices(30)));
check("choices with 12 left", fmt(YFB.durationChoices(12)) === "5,10,12r,15x,30x", fmt(YFB.durationChoices(12)));
check("choices with 5 left", fmt(YFB.durationChoices(5)) === "5,10x,15x,30x", fmt(YFB.durationChoices(5)));
check("choices with 3 left", fmt(YFB.durationChoices(3)) === "3r,5x,10x,15x,30x", fmt(YFB.durationChoices(3)));
check("choices with 0 left", fmt(YFB.durationChoices(0)) === "5x,10x,15x,30x", fmt(YFB.durationChoices(0)));
check("choices with no budget", fmt(YFB.durationChoices(Infinity)) === "5,10,15,30", fmt(YFB.durationChoices(Infinity)));
check("rest-of-today label", YFB.durationChoices(12).find((c) => c.minutes === 12).label === "12 min (rest of today)");

const lower = YFB.applyBudgetChange({ dailyBudgetMinutes: 30, pendingBudget: { minutes: 60, requestedOn: T } }, 15, T);
check("lowering applies now and cancels a pending raise",
  lower.dailyBudgetMinutes === 15 && lower.pendingBudget === null, JSON.stringify(lower));
const raise = YFB.applyBudgetChange({ dailyBudgetMinutes: 30, pendingBudget: null }, 45, T);
check("raising becomes a pending request",
  raise.dailyBudgetMinutes === undefined && raise.pendingBudget.minutes === 45 && raise.pendingBudget.requestedOn === T,
  JSON.stringify(raise));
const toOff = YFB.applyBudgetChange({ dailyBudgetMinutes: 30, pendingBudget: null }, 0, T);
check("turning the limit off is a raise", toOff.dailyBudgetMinutes === undefined && toOff.pendingBudget.minutes === 0);
const fromOff = YFB.applyBudgetChange({ dailyBudgetMinutes: 0, pendingBudget: null }, 15, T);
check("Off to a number applies now", fromOff.dailyBudgetMinutes === 15 && fromOff.pendingBudget === null);
const same = YFB.applyBudgetChange({ dailyBudgetMinutes: 30, pendingBudget: { minutes: 45, requestedOn: T } }, 30, T);
check("choosing the current value cancels a pending raise", same.pendingBudget === null && same.dailyBudgetMinutes === undefined);
const second = YFB.applyBudgetChange({ dailyBudgetMinutes: 30, pendingBudget: { minutes: 45, requestedOn: "2026-09-30" } }, 60, T);
check("a second raise replaces the first", second.pendingBudget.minutes === 60 && second.pendingBudget.requestedOn === T);

check("a pending raise from today is not due today",
  YFB.pendingBudgetDue({ pendingBudget: { minutes: 45, requestedOn: T } }, T) === false);
check("a pending raise from an earlier day is due",
  YFB.pendingBudgetDue({ pendingBudget: { minutes: 45, requestedOn: "2026-09-30" } }, T) === true);
check("no pending raise is never due", YFB.pendingBudgetDue({ pendingBudget: null }, T) === false);

// --- daily feed time: usage storage ---
delete store.feedTimeUsage;
await YFB.FeedBudget.spend(5);
await YFB.FeedBudget.spend(10);
const usageNow = await YFB.FeedBudget.getUsage();
check("spending twice on the same day adds up",
  usageNow.date === YFB.todayKey() && usageNow.usedMinutes === 15, JSON.stringify(usageNow));
store.feedTimeUsage = { date: "2000-01-01", usedMinutes: 25 };
const usageNewDay = await YFB.FeedBudget.spend(5);
check("spending on a new day starts from zero", usageNewDay.usedMinutes === 5, JSON.stringify(usageNewDay));

// --- peek session ---
check("no session has no time left", YFB.peekRemainingMs(null, 1000) === 0);
check("active session has time left", YFB.peekRemainingMs({ endsAt: 61000 }, 1000) === 60000);
check("expired session has no time left", YFB.peekRemainingMs({ endsAt: 500 }, 1000) === 0);

let rejected7 = false;
try {
  await YFB.PeekSession.start(7, "", 30);
} catch {
  rejected7 = true;
}
check("a length that is not a preset is refused", rejected7);
let rejected30 = false;
try {
  await YFB.PeekSession.start(30, "", 12);
} catch {
  rejected30 = true;
}
check("a length above the remaining budget is refused", rejected30);
const restOfDay = await YFB.PeekSession.start(12, "", 12);
check("the rest-of-today length is accepted", restOfDay.endsAt > Date.now() + 11 * 60000);
const before = Date.now();
const started = await YFB.PeekSession.start(5, "  css grid  ", Infinity);
const fetched = await YFB.PeekSession.get();
check("start stores the end time, trimmed reason and an open banner",
  fetched.endsAt >= before + 5 * 60000 && fetched.endsAt <= Date.now() + 5 * 60000 &&
  fetched.reason === "css grid" && fetched.bannerClosed === false && started.endsAt === fetched.endsAt,
  JSON.stringify(fetched));
await YFB.PeekSession.closeBanner();
check("closeBanner keeps the session and marks the banner closed",
  (await YFB.PeekSession.get()).bannerClosed === true);
await YFB.PeekSession.clear();
check("clear removes the session", (await YFB.PeekSession.get()) === null);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test/unit.mjs`
Expected: a thrown error loading `src/lib/feed-budget.js` (ENOENT), since the file doesn't exist yet.

- [ ] **Step 3: Add constants and defaults to `src/lib/defaults.js`**

After the line `YFB.MIN_REASON_LENGTH = 3;` insert:

```js

  // Timed peeks and the daily feed time budget (all in minutes).
  YFB.PEEK_DURATIONS = Object.freeze([5, 10, 15, 30]);
  YFB.PEEK_WARN_MINUTES = 5;
  YFB.BUDGET_CHOICES = Object.freeze([0, 15, 30, 45, 60, 90]);

  // chrome.storage.session key for the running peek (shared by all tabs) and
  // chrome.storage.sync key for today's used feed minutes.
  YFB.PEEK_SESSION_KEY = "peekSession";
  YFB.USAGE_KEY = "feedTimeUsage";
```

In `YFB.DEFAULT_SETTINGS`, after `widgets: Object.freeze({ todo: true, quote: true }),` add:

```js
    dailyBudgetMinutes: 30,
    pendingBudget: null,
```

- [ ] **Step 4: Validate the new settings in `src/lib/storage.js`**

After the `oneOf` helper, add:

```js
  const isDateKey = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  function validPending(p) {
    return p && YFB.BUDGET_CHOICES.includes(p.minutes) && isDateKey(p.requestedOn)
      ? { minutes: p.minutes, requestedOn: p.requestedOn }
      : null;
  }
```

In `mergeWithDefaults`, after the `widgets: { ... },` entry add:

```js
      dailyBudgetMinutes: YFB.BUDGET_CHOICES.includes(s.dailyBudgetMinutes)
        ? s.dailyBudgetMinutes
        : d.dailyBudgetMinutes,
      pendingBudget: validPending(s.pendingBudget),
```

- [ ] **Step 5: Create `src/lib/feed-budget.js`**

```js
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
```

- [ ] **Step 6: Create `src/lib/peek-session.js`**

```js
/**
 * The running peek, shared by every YouTube tab.
 *
 * Stored in chrome.storage.session: all tabs see it, it survives reloads, the
 * browser clears it on close, and YouTube's page scripts cannot read it (the
 * reason typed when peeking is the user's private note).
 */
(function () {
  "use strict";

  const YFB = (globalThis.YFB = globalThis.YFB || {});
  const KEY = YFB.PEEK_SESSION_KEY;

  YFB.peekRemainingMs = function peekRemainingMs(session, now) {
    if (!session || typeof session.endsAt !== "number") return 0;
    return Math.max(0, session.endsAt - now);
  };

  function write(session) {
    return new Promise((resolve, reject) => {
      chrome.storage.session.set({ [KEY]: session }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(session);
      });
    });
  }

  YFB.PeekSession = {
    get() {
      return new Promise((resolve) => {
        try {
          chrome.storage.session.get(KEY, (res) => {
            resolve(chrome.runtime.lastError ? null : (res && res[KEY]) || null);
          });
        } catch (e) {
          resolve(null);
        }
      });
    },

    // remaining: today's budget left, checked here as well as when the
    // buttons were drawn, since another tab may have spent time meanwhile.
    start(minutes, reason, remaining) {
      if (!YFB.isValidPeekLength(minutes, remaining)) {
        return Promise.reject(new Error("peek length not allowed: " + minutes));
      }
      return write({
        endsAt: Date.now() + minutes * 60000,
        reason: typeof reason === "string" ? reason.trim() : "",
        bannerClosed: false,
      });
    },

    async closeBanner() {
      const session = await YFB.PeekSession.get();
      if (session) await write({ ...session, bannerClosed: true });
    },

    clear() {
      return new Promise((resolve) => {
        try {
          chrome.storage.session.remove(KEY, () => resolve());
        } catch (e) {
          resolve();
        }
      });
    },

    onChange(callback) {
      const listener = (changes, area) => {
        if (area === "session" && changes[KEY]) {
          callback(changes[KEY].newValue || null, changes[KEY].oldValue || null);
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
})();
```

- [ ] **Step 7: Run the unit tests**

Run: `node test/unit.mjs`
Expected: all pass. The new checks add 37 to the existing 14, so expect `51/51 passed`; if your count differs, make sure every check above is present and report the real total.

- [ ] **Step 8: Let content scripts use session storage (`src/background.js`)**

Replace the file with:

```js
/**
 * Minimal service worker.
 *
 * There is no backend and no background logic to run. This worker (a) seeds
 * default settings on first install so the content scripts and popup always
 * read a complete object, and (b) lets content scripts use
 * chrome.storage.session, where the running peek lives. Defaults come from
 * lib/defaults.js so they cannot drift.
 */
importScripts("lib/defaults.js");

// Content scripts can't touch chrome.storage.session by default. The access
// level does not persist across browser restarts, so set it every time the
// worker starts; the onStartup listener makes Chrome start the worker at
// browser launch.
function openSessionStorage() {
  chrome.storage.session
    .setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
    .catch(() => {});
}
openSessionStorage();
chrome.runtime.onStartup.addListener(openSessionStorage);

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  openSessionStorage();
  if (reason !== "install") return;
  const key = self.YFB.STORAGE_KEY;
  const existing = await chrome.storage.sync.get(key);
  if (!existing || !existing[key]) {
    await chrome.storage.sync.set({ [key]: self.YFB.DEFAULT_SETTINGS });
  }
});
```

- [ ] **Step 9: Update the e2e settings helper**

In `test/e2e.mjs`, in the `setSettings` helper's default object, after `widgets: { todo: true, quote: true },` add:

```js
      dailyBudgetMinutes: 30,
      pendingBudget: null,
```

Run: `node test/e2e.mjs`
Expected: `36/36 passed` (behaviour is unchanged until Task 2; the new libraries are not loaded by the extension yet).

- [ ] **Step 10: Commit**

```bash
git add src/lib/defaults.js src/lib/storage.js src/lib/feed-budget.js src/lib/peek-session.js src/background.js test/unit.mjs test/e2e.mjs
git commit -F - <<'EOF'
Add daily feed time and peek session libraries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Timed peek on the home page, shared across tabs

**Files:**
- Modify: `src/content/feed-replacer.js` (peeking section, sync, lifecycle, renderKey, renderPanel)
- Modify: `src/content/reason-banner.js` (whole file)
- Modify: `src/content/watch-page.js` (Up next during a peek)
- Modify: `src/content/overlay.css` (append)
- Modify: `manifest.json` (`js` array)
- Modify: `test/e2e.mjs` (peek block)

**Interfaces:**
- Consumes (Task 1): everything in Task 1's Produces list.
- Produces DOM used by tests and Task 3:
  - `#yfb-panel .yfb-peek__link`, `.yfb-peek__left`, `.yfb-peek__used`, `.yfb-peek__label`, `.yfb-peek__durations`, `.yfb-peek__duration[data-minutes]`, `.yfb-peek__cancel`, `.yfb-peek__form`, `#yfb-peek-reason`, `.yfb-peek__error`, `.yfb-peek__count`
  - `#yfb-panel .yfb-confirm`, `.yfb-confirm__text`, `.yfb-confirm__yes`, `.yfb-confirm__no`
  - `#yfb-reason-banner`, `.yfb-reason__text`, `.yfb-reason__close`
  - `YFB.setReason` / `YFB.getReason` are REMOVED (nothing else uses them).

- [ ] **Step 1: Rewrite the e2e peek block (failing)**

In `test/e2e.mjs`:

a) Directly after the `setSettings` helper function, add:

```js
// Peek sessions live in chrome.storage.session and feed-time usage in sync.
// Both are shared by every tab, so tests reset them between scenarios.
async function extEval(extId, fn, arg) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  const out = await p.evaluate(fn, arg);
  await p.close();
  return out;
}
const resetPeek = (extId) =>
  extEval(extId, () =>
    Promise.all([
      new Promise((r) => chrome.storage.session.remove("peekSession", r)),
      new Promise((r) => chrome.storage.sync.remove("feedTimeUsage", r)),
    ])
  );
// Mark `used` minutes as spent today (local date, computed in the browser).
const setUsedToday = (extId, used) =>
  extEval(
    extId,
    (u) => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const date = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      return new Promise((r) => chrome.storage.sync.set({ feedTimeUsage: { date, usedMinutes: u } }, r));
    },
    used
  );
const readSync = (extId, key) =>
  extEval(extId, (k) => new Promise((r) => chrome.storage.sync.get(k, (x) => r(x[k] ?? null))), key);
```

b) Replace everything from the line `  // ---------- v0.2: home feed toggle and peeking ----------` up to (not including) the line `  // ---------- v0.2: popup ----------` with:

```js
  // ---------- v0.2: home feed toggle and timed peeking ----------
  // setSettings opens and closes a helper tab, which can leave the YouTube tab
  // in the background, and the 10 second pause (correctly) stops in background
  // tabs.
  const goHome = async () => {
    await yt.bringToFront();
    await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
    await yt.waitForSelector("#yfb-panel", { timeout: 20000 }).catch(() => {});
    await yt.waitForTimeout(1500);
  };
  const feedRevealed = (page = yt) =>
    page.evaluate(
      () => !document.documentElement.classList.contains("yfb-home-replaced") && !document.getElementById("yfb-panel")
    );
  // Client-side (SPA) navigations.
  const spaToSearch = async () => {
    await yt.fill('input[name="search_query"]', "css grid");
    await yt.press('input[name="search_query"]', "Enter");
    await yt.waitForURL(/\/results/, { timeout: 15000 }).catch(() => {});
    await yt.waitForTimeout(2000);
  };
  const spaToHome = async () => {
    await yt.evaluate(() => document.querySelector("a#logo, ytd-topbar-logo-renderer a")?.click());
    await yt.waitForTimeout(3000);
  };
  const durationButtons = () =>
    yt.$$eval("#yfb-panel .yfb-peek__duration", (bs) =>
      bs.map((b) => b.dataset.minutes + (b.disabled ? "x" : ""))
    );
  const pickDuration = (minutes) => yt.click(`#yfb-panel .yfb-peek__duration[data-minutes="${minutes}"]`);

  // Playwright keeps every page visible and focused, so the "tab hidden"
  // check drives document.hidden directly, via CDP, inside the content
  // script's isolated world. Contexts are only reported after Runtime.enable,
  // so this runs before the goHome() navigation below.
  const cdp = await ctx.newCDPSession(yt);
  await cdp.send("Runtime.enable");
  let isolatedContext = null;
  cdp.on("Runtime.executionContextCreated", (e) => {
    const c = e.context;
    if (c.auxData && c.auxData.type === "isolated" && c.name === "YouTube Feed Blocker") {
      isolatedContext = c;
    }
  });

  // Pause level, 5 minutes: duration step, pause, reveal, spend.
  await resetPeek(extId);
  await setSettings(extId, { peekLevel: "pause" });
  await goHome();
  await yt.click("#yfb-panel .yfb-peek__link");
  const offered = await durationButtons();
  log("duration step offers 5, 10, 15 and 30 minutes", offered.join(",") === "5,10,15,30", offered.join(","));
  await pickDuration(5);
  const countText = await yt.textContent("#yfb-panel .yfb-peek__count").catch(() => null);
  log("pause: countdown starts at 10 seconds", /10 seconds/.test(countText || ""), countText);

  // An unrelated setting change must not reset a running countdown.
  await setSettings(extId, { peekLevel: "pause", hideComments: true });
  await yt.bringToFront();
  await yt.waitForTimeout(1000);
  log("unrelated setting change keeps the countdown running", !!(await yt.$("#yfb-panel .yfb-peek__count")));

  await yt.waitForTimeout(10500);
  log("pause: real feed shows after the countdown", await feedRevealed());
  const usage5 = await readSync(extId, "feedTimeUsage");
  log("starting a 5 minute peek spends 5 minutes", !!usage5 && usage5.usedMinutes === 5, JSON.stringify(usage5));

  // The peek lasts across navigation, reloads and tabs.
  await yt.bringToFront();
  await spaToSearch();
  await spaToHome();
  log("peek lasts across navigation", await feedRevealed());
  await yt.reload({ waitUntil: "domcontentloaded" });
  await yt.waitForTimeout(3000);
  log("peek survives a reload", await feedRevealed());
  const yt2 = await ctx.newPage();
  await yt2.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  await yt2.waitForTimeout(4000);
  log("peek applies in a second YouTube tab", await feedRevealed(yt2));
  await yt2.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await yt2.waitForSelector("ytd-watch-flexy #related", { state: "attached", timeout: 20000 }).catch(() => {});
  await yt2.waitForTimeout(2000);
  const relatedDuringPeek = await display(yt2, "ytd-watch-flexy #related");
  log("Up next shows during a peek", !["none", "missing"].includes(relatedDuringPeek), relatedDuringPeek);
  await yt2.close();

  // Hidden tab: the 10 second pause stops while document.hidden is true.
  await resetPeek(extId);
  await goHome();
  await yt.click("#yfb-panel .yfb-peek__link");
  await pickDuration(5);
  if (!isolatedContext) {
    throw new Error("could not find the extension's isolated execution context via CDP");
  }
  await cdp.send("Runtime.evaluate", {
    contextId: isolatedContext.id,
    expression: 'Object.defineProperty(document, "hidden", { configurable: true, get: () => true })',
  });
  await yt.waitForTimeout(12000);
  log("countdown pauses while the tab is hidden", !(await feedRevealed()));
  await cdp.send("Runtime.evaluate", { contextId: isolatedContext.id, expression: "delete document.hidden" });
  await yt.waitForTimeout(11000);
  log("countdown resumes when the tab is visible again", await feedRevealed());
  await cdp.detach();

  // Reason level: never mind, validation, banner, HTML stays text, close.
  await resetPeek(extId);
  await setSettings(extId, { peekLevel: "reason" });
  await goHome();
  await yt.click("#yfb-panel .yfb-peek__link");
  await yt.click("#yfb-panel .yfb-peek__cancel");
  log("never mind returns to the link", !!(await yt.$("#yfb-panel .yfb-peek__link")));

  await yt.click("#yfb-panel .yfb-peek__link");
  await pickDuration(5);
  await yt.fill("#yfb-peek-reason", "  a ");
  await yt.click('#yfb-panel .yfb-peek__form button[type="submit"]');
  const reasonError = await yt.textContent("#yfb-panel .yfb-peek__error");
  log("reason: too-short reason is rejected", !!reasonError && !(await yt.$("#yfb-panel .yfb-peek__count")), reasonError);

  await yt.fill("#yfb-peek-reason", "<b>css</b> grid layouts");
  await yt.click('#yfb-panel .yfb-peek__form button[type="submit"]');
  await yt.waitForTimeout(11500);
  log("reason: real feed shows after the countdown", await feedRevealed());

  await spaToSearch();
  const banner = await yt.evaluate(() => {
    const b = document.getElementById("yfb-reason-banner");
    return b ? { text: b.querySelector(".yfb-reason__text").textContent, injected: !!b.querySelector(".yfb-reason__text b") } : null;
  });
  log("banner shows the reason on the next page", !!banner && banner.text === "You came for: <b>css</b> grid layouts", banner && banner.text);
  log("reason is shown as text, not HTML", !!banner && !banner.injected);
  await yt.click("#yfb-reason-banner .yfb-reason__close");
  await yt.waitForTimeout(500);
  await spaToHome();
  log("a closed banner stays closed for the rest of the peek", !(await yt.$("#yfb-reason-banner")));

  // Budget: capped choices, remaining text, used up.
  await resetPeek(extId);
  await setSettings(extId, { peekLevel: "pause" });
  await setUsedToday(extId, 18);
  await goHome();
  const leftText = await yt.textContent("#yfb-panel .yfb-peek__left").catch(() => null);
  log("remaining feed time is shown", leftText === "12 minutes of feed time left today", leftText);
  await yt.click("#yfb-panel .yfb-peek__link");
  const capped = await durationButtons();
  log("choices are capped by what's left", capped.join(",") === "5,10,12,15x,30x", capped.join(","));
  await setUsedToday(extId, 30);
  await goHome();
  const usedUp = await yt.textContent("#yfb-panel .yfb-peek__used").catch(() => null);
  log(
    "used-up message replaces the link",
    usedUp === "You've used today's feed time. It resets at midnight." && !(await yt.$("#yfb-panel .yfb-peek__link")),
    usedUp
  );

  // Next-day confirmation of a pending raise.
  await resetPeek(extId);
  await setSettings(extId, { dailyBudgetMinutes: 30, pendingBudget: { minutes: 45, requestedOn: "2000-01-01" } });
  await goHome();
  const confirmText = await yt.textContent("#yfb-panel .yfb-confirm__text").catch(() => null);
  await yt.click("#yfb-panel .yfb-confirm__yes");
  await yt.waitForTimeout(800);
  const afterYes = await readSync(extId, "settings");
  log(
    "confirming a raise applies it",
    /from 30 to 45 minutes/.test(confirmText || "") && afterYes.dailyBudgetMinutes === 45 && afterYes.pendingBudget === null &&
      !(await yt.$("#yfb-panel .yfb-confirm")),
    confirmText
  );
  await setSettings(extId, { dailyBudgetMinutes: 45, pendingBudget: { minutes: 90, requestedOn: "2000-01-01" } });
  await goHome();
  await yt.click("#yfb-panel .yfb-confirm__no");
  await yt.waitForTimeout(800);
  const afterNo = await readSync(extId, "settings");
  log("keeping the old budget clears the request", afterNo.dailyBudgetMinutes === 45 && afterNo.pendingBudget === null, JSON.stringify(afterNo));

  // No peeking: no link at all.
  await resetPeek(extId);
  await setSettings(extId, { peekLevel: "none" });
  await goHome();
  log("no peeking: panel without a peek link", !!(await yt.$("#yfb-panel")) && !(await yt.$("#yfb-panel .yfb-peek__link")));

  // Home feed toggle off shows the real feed live.
  await setSettings(extId, { hideHomeFeed: false });
  await yt.waitForTimeout(1500);
  log("home feed toggle off shows the real feed, no reload", await feedRevealed());
  await resetPeek(extId);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test/e2e.mjs`
Expected: the run stops at `pickDuration(5)` (no `.yfb-peek__duration` yet) with a timeout; the thrown error is caught and reported as a failure, and the process exits 1.

- [ ] **Step 3: Load the new libraries in content scripts (`manifest.json`)**

Make `content_scripts[0].js`:

```json
      "js": [
        "src/lib/defaults.js",
        "src/lib/storage.js",
        "src/lib/feed-budget.js",
        "src/lib/peek-session.js",
        "src/content/shorts-blocker.js",
        "src/content/watch-page.js",
        "src/content/reason-banner.js",
        "src/content/feed-widgets.js",
        "src/content/feed-replacer.js"
      ]
```

- [ ] **Step 4: Replace `src/content/reason-banner.js`**

```js
/**
 * "You came for" reminder.
 *
 * Shown on every YouTube page in every tab while a peek with a reason is
 * running, until the user closes it. The reason comes from the shared peek
 * session (chrome.storage.session), which YouTube's page scripts cannot read.
 * The banner itself is in YouTube's page, so the reason is visible on screen
 * there; it is never saved or sent anywhere by the extension.
 */
(function () {
  "use strict";

  const YFB = window.YFB;
  const BANNER_ID = "yfb-reason-banner";
  let session = null;

  function shouldShow() {
    return (
      YFB.peekRemainingMs(session, Date.now()) > 0 &&
      !!session.reason &&
      !session.bannerClosed
    );
  }

  function render() {
    let bar = document.getElementById(BANNER_ID);
    if (!shouldShow()) {
      if (bar) bar.remove();
      return;
    }
    if (!document.body) {
      requestAnimationFrame(render);
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = BANNER_ID;
      bar.setAttribute("role", "status");

      const text = document.createElement("span");
      text.className = "yfb-reason__text";

      const close = document.createElement("button");
      close.type = "button";
      close.className = "yfb-reason__close";
      close.setAttribute("aria-label", "Close reminder");
      close.textContent = "×";
      close.addEventListener("click", () => {
        bar.remove();
        YFB.PeekSession.closeBanner();
      });

      bar.append(text, close);
      document.body.appendChild(bar);
    }
    // textContent, never innerHTML: the reason is user-typed text.
    bar.querySelector(".yfb-reason__text").textContent = "You came for: " + session.reason;
  }

  YFB.PeekSession.get().then((s) => {
    session = s;
    render();
  });
  YFB.PeekSession.onChange((s) => {
    session = s;
    render();
  });
})();
```

- [ ] **Step 5: Show Up next during a peek (`src/content/watch-page.js`)**

a) After `let settings = YFB.DEFAULT_SETTINGS;` add:

```js
  // While a peek is running, Up next is part of the feed the user asked for.
  let peekActive = false;
```

b) Replace `applyClasses` with:

```js
  function applyClasses() {
    for (const [key, cls] of Object.entries(CLASSES)) {
      const on = key === "hideUpNext" ? settings.hideUpNext && !peekActive : !!settings[key];
      root.classList.toggle(cls, on);
    }
  }
```

c) After the `YFB.onSettingsChanged(...)` block add:

```js
  function setPeek(session) {
    peekActive = YFB.peekRemainingMs(session, Date.now()) > 0;
    applyClasses();
  }
  YFB.PeekSession.get().then(setPeek);
  YFB.PeekSession.onChange(setPeek);
```

d) In the file header comment, change "Mirror the hideUpNext, hideComments and blockAutoplay settings onto classes on <html>" to "Mirror the hideUpNext (off while a peek runs), hideComments and blockAutoplay settings onto classes on <html>".

- [ ] **Step 6: Timed peek in `src/content/feed-replacer.js`**

a) Header comment: replace the paragraph starting "Unless peekLevel is "none"" with:

```
 * Unless peekLevel is "none", the panel ends with a "Show my feed anyway" link.
 * It asks how long (capped by today's feed time), then a reason for "reason",
 * then a 10 second pause; then a peek session starts for every YouTube tab
 * (see lib/peek-session.js) and the real feed shows until it ends. A raise of
 * the daily feed time asked for on an earlier day is confirmed here.
```

b) Replace the state block

```js
  let settings = YFB.DEFAULT_SETTINGS;
  // Set when a peek countdown finishes; cleared when the user leaves Home.
  let peeked = false;
  let countdownTimer = null;
```

with:

```js
  let settings = YFB.DEFAULT_SETTINGS;
  let usage = null;
  // True while the shared peek session (any tab started it) has time left.
  let peekActive = false;
  let countdownTimer = null;

  const remainingToday = () => YFB.budgetRemaining(settings, usage, YFB.todayKey());
```

c) Replace `renderKey` with:

```js
  // Only these change what the panel shows. Re-rendering on any other change
  // (Shorts, watch-page toggles) would reset a running peek countdown or wipe
  // a half-typed to-do.
  function renderKey(s) {
    const today = YFB.todayKey();
    return JSON.stringify([
      s.feedMode, s.peekLevel, s.aiInstruction, s.widgets,
      s.dailyBudgetMinutes, s.pendingBudget,
      YFB.budgetRemaining(s, usage, today), YFB.pendingBudgetDue(s, today),
    ]);
  }
```

d) In `renderPanel`, directly after the `if (settings.feedMode === ...) { ... } else if ... }` mode block and before the `if (settings.peekLevel !== YFB.PEEK_LEVELS.NONE)` block, add:

```js

    // After the mode content: YFB.Widgets.render() starts by clearing the
    // panel, so the card is prepended once that has happened.
    if (YFB.pendingBudgetDue(settings, YFB.todayKey())) renderBudgetConfirm(panel);
```

e) After the `renderBlank` function add:

```js
  // The next-day question for a raise of the daily feed time.
  function renderBudgetConfirm(panel) {
    const pending = settings.pendingBudget;
    const current = settings.dailyBudgetMinutes;
    const yesterday = YFB.todayKey(new Date(Date.now() - 86400000));
    const when = pending.requestedOn === yesterday ? "Yesterday" : "Earlier";

    const card = el("div", "yfb-confirm");
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", "Daily feed time");
    const text = pending.minutes === 0
      ? when + " you asked to turn off your daily feed time limit. Turn it off?"
      : when + " you asked to raise your daily feed time from " + current + " to " + pending.minutes + " minutes. Raise it?";
    card.appendChild(el("p", "yfb-confirm__text", text));

    const actions = el("div", "yfb-confirm__actions");
    const yes = el("button", "yfb-btn yfb-confirm__yes", pending.minutes === 0 ? "Turn off the limit" : "Raise to " + pending.minutes);
    yes.type = "button";
    yes.addEventListener("click", () => {
      YFB.setSettings({ dailyBudgetMinutes: pending.minutes, pendingBudget: null });
    });
    const no = el("button", "yfb-btn yfb-btn--ghost yfb-confirm__no", "Keep " + current);
    no.type = "button";
    no.addEventListener("click", () => {
      YFB.setSettings({ pendingBudget: null });
    });
    actions.append(yes, no);
    card.appendChild(actions);
    panel.prepend(card);
  }
```

f) Replace everything from `  function showPeekLink(box) {` through the end of `function startCountdown(box, reason) { ... }` (the whole `startCountdown` function) with:

```js
  function minutesText(n) {
    return n + (n === 1 ? " minute" : " minutes");
  }

  function showPeekLink(box) {
    cancelCountdown();
    box.textContent = "";
    const remaining = remainingToday();
    if (remaining <= 0) {
      box.appendChild(el("p", "yfb-peek__used", "You've used today's feed time. It resets at midnight."));
      return;
    }
    const link = el("button", "yfb-peek__link", "Show my feed anyway");
    link.type = "button";
    link.addEventListener("click", () => showDurations(box));
    box.appendChild(link);
    if (Number.isFinite(remaining)) {
      box.appendChild(el("p", "yfb-peek__left", minutesText(remaining) + " of feed time left today"));
    }
  }

  function showDurations(box) {
    box.textContent = "";
    box.appendChild(el("p", "yfb-peek__label", "How long?"));
    const group = el("div", "yfb-peek__durations");
    for (const choice of YFB.durationChoices(remainingToday())) {
      const b = el("button", "yfb-peek__duration", choice.label);
      b.type = "button";
      b.dataset.minutes = String(choice.minutes);
      b.disabled = choice.disabled;
      b.addEventListener("click", () => {
        if (settings.peekLevel === YFB.PEEK_LEVELS.REASON) showReasonForm(box, choice.minutes);
        else startCountdown(box, choice.minutes, "");
      });
      group.appendChild(b);
    }
    box.append(group, neverMindButton(box));
    const first = group.querySelector("button:not(:disabled)");
    if (first) first.focus();
  }

  function showReasonForm(box, minutes) {
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
      startCountdown(box, minutes, input.value.trim());
    });

    box.appendChild(form);
    input.focus();
  }

  function startCountdown(box, minutes, reason) {
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
      beginPeek(minutes, reason);
    }, 1000);
  }

  // Start the shared session, then spend the minutes. If the budget changed
  // since the buttons were drawn (another tab peeked, or it was lowered),
  // start refuses and the panel is redrawn with fresh numbers.
  async function beginPeek(minutes, reason) {
    try {
      await YFB.PeekSession.start(minutes, reason, remainingToday());
    } catch (e) {
      const panel = document.getElementById(PANEL_ID);
      if (panel) delete panel.dataset.renderKey;
      sync();
      return;
    }
    YFB.FeedBudget.spend(minutes).catch(() => {});
  }
```

g) Replace `sync` with:

```js
  function sync() {
    if (!isHome() || !settings.hideHomeFeed || peekActive) {
      unmount();
      return;
    }
    if (!mount()) {
      // Home DOM not ready yet, retry shortly.
      requestAnimationFrame(sync);
    }
  }
```

h) In the lifecycle section, after the `YFB.onSettingsChanged(...)` block add:

```js
  function setPeek(session) {
    peekActive = YFB.peekRemainingMs(session, Date.now()) > 0;
    sync();
  }
  YFB.PeekSession.get().then(setPeek);
  YFB.PeekSession.onChange(setPeek);

  YFB.FeedBudget.getUsage().then((u) => {
    usage = u;
    sync();
  });
  YFB.FeedBudget.onUsageChanged((u) => {
    usage = u;
    sync();
  });
```

- [ ] **Step 7: Styles (`src/content/overlay.css`)**

Append at the end:

```css
/* --- timed peek: remaining time, duration step, used-up --- */
#yfb-panel .yfb-peek__left,
#yfb-panel .yfb-peek__used {
  margin: 8px 0 0;
  color: var(--yfb-subtext);
  font-size: 13px;
}
#yfb-panel .yfb-peek__used {
  font-size: 14px;
}
#yfb-panel .yfb-peek__durations {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin: 8px 0;
}
#yfb-panel .yfb-peek__duration {
  padding: 6px 12px;
  border: 1px solid var(--yfb-border);
  border-radius: 8px;
  background: var(--yfb-card);
  color: var(--yfb-text);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
#yfb-panel .yfb-peek__duration:hover:not(:disabled) {
  border-color: #d9362b;
}
#yfb-panel .yfb-peek__duration:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
#yfb-panel .yfb-peek__duration:focus-visible {
  outline: 2px solid #d9362b;
  outline-offset: 2px;
}

/* --- next-day confirmation of a daily feed time raise --- */
#yfb-panel .yfb-confirm {
  margin: 0 0 16px;
  padding: 14px 16px;
  border-left: 3px solid #d9362b;
  border-radius: 12px;
  background: var(--yfb-card);
}
#yfb-panel .yfb-confirm__text {
  margin: 0 0 10px;
  font-size: 14px;
}
#yfb-panel .yfb-confirm__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

- [ ] **Step 8: Run the tests**

Run: `node test/unit.mjs && node test/e2e.mjs`
Expected: unit all pass; e2e `46/46 passed` (36 before, minus the removed "leaving Home brings the pause back", plus 11 new). If the total differs, count the `log(` calls in the new block and report the real number.

- [ ] **Step 9: Commit**

```bash
git add manifest.json src/content/feed-replacer.js src/content/reason-banner.js src/content/watch-page.js src/content/overlay.css test/e2e.mjs
git commit -F - <<'EOF'
Timed peek: pick a length, share the peek across tabs, daily feed time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Closing countdown and "Time's up"

**Files:**
- Create: `src/content/peek-timer.js`
- Modify: `src/content/overlay.css` (append)
- Modify: `manifest.json` (`js` array)
- Modify: `test/e2e.mjs` (new block after the Task 2 peek block)

**Interfaces:**
- Consumes: `YFB.PeekSession`, `YFB.peekRemainingMs`, `YFB.PEEK_WARN_MINUTES` (Task 1).
- Produces DOM: `#yfb-peek-chip`; `#yfb-timeup` containing `.yfb-timeup__card`, `#yfb-timeup-title`, `.yfb-timeup__keep`, `.yfb-timeup__home`.

- [ ] **Step 1: Write the failing e2e checks**

In `test/e2e.mjs`, directly before `  // ---------- v0.2: popup ----------`, insert:

```js
  // ---------- v0.2: closing countdown and time's up ----------
  // Sessions are written straight into chrome.storage.session from an
  // extension page, so expiry can be tested in seconds, not minutes.
  const setSessionEndingIn = (ms) =>
    extEval(
      extId,
      (m) => new Promise((r) => chrome.storage.session.set({ peekSession: { endsAt: Date.now() + m, reason: "", bannerClosed: false } }, r)),
      ms
    );

  await resetPeek(extId);
  await setSettings(extId, {});
  await setSessionEndingIn(4 * 60000);
  await yt.bringToFront();
  await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  await yt.waitForTimeout(3000);
  const chip = await yt.textContent("#yfb-peek-chip").catch(() => null);
  log("countdown chip shows in the last 5 minutes", /^Feed closes in [34]:[0-5]\d$/.test(chip || ""), chip);

  // Expiry on a watch page: pause + card; keep watching resumes.
  await resetPeek(extId);
  await setSessionEndingIn(20000);
  await yt.bringToFront();
  await yt.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await yt.waitForSelector("video", { timeout: 20000 }).catch(() => {});
  await yt.waitForSelector("#yfb-timeup", { timeout: 30000 }).catch(() => {});
  const atExpiry = await yt.evaluate(() => ({
    card: !!document.getElementById("yfb-timeup"),
    title: document.getElementById("yfb-timeup-title")?.textContent || null,
    paused: document.querySelector("video")?.paused ?? null,
  }));
  log("time's up on a video: card shown and video paused",
    atExpiry.card && atExpiry.title === "Time's up" && atExpiry.paused === true, JSON.stringify(atExpiry));
  await yt.click("#yfb-timeup .yfb-timeup__keep");
  await yt.waitForTimeout(1500);
  const afterKeep = await yt.evaluate(() => ({
    card: !!document.getElementById("yfb-timeup"),
    paused: document.querySelector("video")?.paused ?? null,
  }));
  log("keep watching closes the card and resumes", !afterKeep.card && afterKeep.paused === false, JSON.stringify(afterKeep));
  const relatedAfter = await display(yt, "ytd-watch-flexy #related");
  log("Up next hides again when the peek ends", relatedAfter === "none", relatedAfter);
  await yt.evaluate(() => document.querySelector("video")?.pause());

  // Expiry on the home page: the panel returns, no card.
  await resetPeek(extId);
  await setSessionEndingIn(8000);
  await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  await yt.waitForTimeout(2000);
  const openBefore = await feedRevealed();
  await yt.waitForSelector("#yfb-panel", { timeout: 20000 }).catch(() => {});
  log("time's up on Home: feed hides again, no card",
    openBefore && !!(await yt.$("#yfb-panel")) && !(await yt.$("#yfb-timeup")), "open before expiry: " + openBefore);

  // A session that ended while no YouTube tab was open must not open the feed.
  await extEval(extId, () => new Promise((r) => chrome.storage.session.set({ peekSession: { endsAt: Date.now() - 60000, reason: "", bannerClosed: false } }, r)));
  await goHome();
  log("an expired session does not open the feed", !!(await yt.$("#yfb-panel")) && !(await yt.$("#yfb-timeup")));
  await resetPeek(extId);
```

Run: `node test/e2e.mjs`
Expected: "countdown chip shows in the last 5 minutes" FAILS (`null`), the two watch-page expiry checks FAIL (no card). "Up next hides again when the peek ends" and the Home expiry check may already pass, since Task 2 already re-checks the session on change; that is fine.

- [ ] **Step 2: Create `src/content/peek-timer.js`**

```js
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
  // YouTube selector for the main player's video element.
  const VIDEO = "video.html5-main-video, #movie_player video, video";

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
      document.body.appendChild(chip);
    }
    chip.textContent = "Feed closes in " + format(ms);
  }

  // --- time's up card ---------------------------------------------------
  function closeCard() {
    const card = document.getElementById(CARD_ID);
    if (card) card.remove();
  }

  function showTimeUp() {
    const video = document.querySelector(VIDEO);
    if (video) video.pause();
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
      const v = document.querySelector(VIDEO);
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
```

- [ ] **Step 3: Register it in `manifest.json`**

In `content_scripts[0].js`, insert `"src/content/peek-timer.js",` directly after `"src/content/reason-banner.js",`.

- [ ] **Step 4: Styles (`src/content/overlay.css`)**

Append at the end:

```css
/* --- closing countdown chip (peek-timer.js). Fixed colours like the reason
   banner, since it shows on every page in both YouTube themes. --- */
#yfb-peek-chip {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2100;
  padding: 6px 12px;
  border-left: 3px solid #d9362b;
  border-radius: 8px;
  background: #1f1d1b;
  color: #f3f1ee;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  font: 13px/1.35 "Roboto", "Segoe UI", system-ui, -apple-system, sans-serif;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

/* --- time's up card --- */
#yfb-timeup {
  position: fixed;
  inset: 0;
  z-index: 2200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
#yfb-timeup .yfb-timeup__card {
  width: min(380px, calc(100vw - 32px));
  padding: 20px;
  border-radius: 12px;
  background: #1f1d1b;
  color: #f3f1ee;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  font: 14px/1.4 "Roboto", "Segoe UI", system-ui, -apple-system, sans-serif;
}
#yfb-timeup .yfb-timeup__title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
}
#yfb-timeup .yfb-timeup__body {
  margin: 0 0 16px;
  color: #a8a29c;
}
#yfb-timeup .yfb-timeup__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
#yfb-timeup .yfb-timeup__keep,
#yfb-timeup .yfb-timeup__home {
  padding: 8px 14px;
  border-radius: 8px;
  font: inherit;
  cursor: pointer;
}
#yfb-timeup .yfb-timeup__keep {
  border: 0;
  background: #d9362b;
  color: #ffffff;
}
#yfb-timeup .yfb-timeup__home {
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent;
  color: #f3f1ee;
}
#yfb-timeup .yfb-timeup__keep:focus-visible,
#yfb-timeup .yfb-timeup__home:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}
```

- [ ] **Step 5: Run the tests**

Run: `node test/unit.mjs && node test/e2e.mjs`
Expected: e2e `52/52 passed` (46 plus 6 new). Report the real total if your count differs.

- [ ] **Step 6: Commit**

```bash
git add src/content/peek-timer.js src/content/overlay.css manifest.json test/e2e.mjs
git commit -F - <<'EOF'
Add the closing countdown and the time's up pause

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Daily feed time in the popup

**Files:**
- Modify: `src/popup/popup.html`, `src/popup/popup.css`, `src/popup/popup.js`
- Modify: `test/e2e.mjs` (popup block)

**Interfaces:**
- Consumes: `YFB.applyBudgetChange`, `YFB.todayKey`, `YFB.BUDGET_CHOICES`, settings keys (Task 1).
- Produces DOM: `#budgetSection`, `input[name="dailyBudget"]` (values "0", "15", ... "90"), `#budgetPending`.

- [ ] **Step 1: Write the failing e2e checks**

In `test/e2e.mjs`'s popup block, directly after the "popup reflects the defaults" `log(...)` call, insert:

```js
  // Daily feed time: default, lower applies now, raise is parked.
  const budgetChecked = await pop.evaluate(() => document.querySelector('input[name="dailyBudget"]:checked')?.value);
  log("popup shows the 30 minute daily feed time by default", budgetChecked === "30", budgetChecked);
  await pop.click('label:has(input[name="dailyBudget"][value="15"])');
  await pop.waitForTimeout(500);
  const afterLower = await pop.evaluate(() => new Promise((r) => chrome.storage.sync.get("settings", (x) => r(x.settings))));
  log("lowering the daily feed time applies now", afterLower.dailyBudgetMinutes === 15 && afterLower.pendingBudget === null, JSON.stringify(afterLower));
  await pop.click('label:has(input[name="dailyBudget"][value="45"])');
  await pop.waitForTimeout(500);
  const afterRaise = await pop.evaluate(() => ({
    stored: null,
    checked: document.querySelector('input[name="dailyBudget"]:checked')?.value,
    note: document.getElementById("budgetPending").hidden ? null : document.getElementById("budgetPending").textContent,
  }));
  afterRaise.stored = await pop.evaluate(() => new Promise((r) => chrome.storage.sync.get("settings", (x) => r(x.settings))));
  log(
    "raising the daily feed time waits for confirmation",
    afterRaise.stored.dailyBudgetMinutes === 15 && afterRaise.stored.pendingBudget?.minutes === 45 &&
      afterRaise.checked === "15" && afterRaise.note === "You asked for 45 minutes. You'll be asked to confirm tomorrow.",
    JSON.stringify({ checked: afterRaise.checked, note: afterRaise.note, pending: afterRaise.stored.pendingBudget })
  );
  await pop.click('label:has(input[name="peekLevel"][value="none"])');
  await pop.waitForTimeout(300);
  log("daily feed time hides when peeking is off", await pop.evaluate(() => document.getElementById("budgetSection").hidden === true));
  await pop.click('label:has(input[name="peekLevel"][value="reason"])');
  await pop.waitForTimeout(300);
```

Run: `node test/e2e.mjs`
Expected: the first new check FAILS (`undefined`), then a click times out (no budget inputs yet).

- [ ] **Step 2: Popup markup (`src/popup/popup.html`)**

Directly after the closing `</section>` of the "How hard should it be to peek?" section (before the "Instead of the feed" section), insert:

```html
        <section class="pop-section" id="budgetSection" aria-labelledby="budgetTitle">
          <h2 id="budgetTitle" class="pop-title">Daily feed time</h2>
          <div class="pop-chips" role="radiogroup" aria-labelledby="budgetTitle">
            <label class="pop-chip"><input type="radio" name="dailyBudget" value="0" /><span>Off</span></label>
            <label class="pop-chip"><input type="radio" name="dailyBudget" value="15" /><span>15 min</span></label>
            <label class="pop-chip"><input type="radio" name="dailyBudget" value="30" /><span>30 min</span></label>
            <label class="pop-chip"><input type="radio" name="dailyBudget" value="45" /><span>45 min</span></label>
            <label class="pop-chip"><input type="radio" name="dailyBudget" value="60" /><span>60 min</span></label>
            <label class="pop-chip"><input type="radio" name="dailyBudget" value="90" /><span>90 min</span></label>
          </div>
          <p class="pop-hint" id="budgetPending" hidden></p>
        </section>
```

And load the budget helpers: change the script tags at the bottom to:

```html
    <script src="../lib/defaults.js"></script>
    <script src="../lib/storage.js"></script>
    <script src="../lib/feed-budget.js"></script>
    <script src="popup.js"></script>
```

- [ ] **Step 3: Popup styles (`src/popup/popup.css`)**

Before the `.pop-switch:focus-visible,` focus block, add:

```css
/* --- daily feed time choices --- */
.pop-chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.pop-chip {
  position: relative;
  cursor: pointer;
}
.pop-chip input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.pop-chip span {
  display: block;
  padding: 8px 0;
  border: 1.5px solid transparent;
  border-radius: 8px;
  background: var(--card);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}
.pop-chip:has(input:checked) span {
  border-color: var(--accent);
}
.pop-chip:has(input:focus-visible) span {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Popup behaviour (`src/popup/popup.js`)**

a) In `els`, add:

```js
    budget: Array.from(document.querySelectorAll('input[name="dailyBudget"]')),
    budgetSection: document.getElementById("budgetSection"),
    budgetPending: document.getElementById("budgetPending"),
```

b) In `reflectConditionalSections`, add at the end:

```js
    // A daily budget only matters when peeking is possible.
    els.budgetSection.hidden = settings.peekLevel === YFB.PEEK_LEVELS.NONE;
```

c) In `reflect`, before `reflectConditionalSections(settings);` add:

```js
    // The checked choice is the budget in force; a raise waiting for
    // tomorrow's confirmation is described underneath instead.
    els.budget.forEach((r) => (r.checked = Number(r.value) === settings.dailyBudgetMinutes));
    const pending = settings.pendingBudget;
    els.budgetPending.hidden = !pending;
    els.budgetPending.textContent = !pending
      ? ""
      : pending.minutes === 0
        ? "You asked to turn the limit off. You'll be asked to confirm tomorrow."
        : "You asked for " + pending.minutes + " minutes. You'll be asked to confirm tomorrow.";
```

d) Replace the `els.peekLevel.forEach(...)` block with:

```js
    els.peekLevel.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        current = { ...current, peekLevel: radio.value };
        reflectConditionalSections(current);
        YFB.setSettings({ peekLevel: radio.value });
      });
    });

    els.budget.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        const patch = YFB.applyBudgetChange(current, Number(radio.value), YFB.todayKey());
        current = { ...current, ...patch };
        reflect(current);
        YFB.setSettings(patch);
      });
    });
```

- [ ] **Step 5: Run the tests**

Run: `node test/unit.mjs && node test/e2e.mjs`
Expected: e2e `56/56 passed` (52 plus 4). Then open `test/screenshots/popup.png` with the Read tool and check the "Daily feed time" row: six choices in two rows of three, 30 outlined in red, nothing clipped.

- [ ] **Step 6: Commit**

```bash
git add src/popup/popup.html src/popup/popup.css src/popup/popup.js test/e2e.mjs
git commit -F - <<'EOF'
Popup: daily feed time setting (lower now, raise needs confirming)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Docs, store copy, privacy, live QA, package

**Files:**
- Modify: `README.md`, `store-listing.md`, `PRIVACY.md`, `privacy.html`, `test/live-qa-cdp.mjs`, `docs/superpowers/specs/2026-09-29-v0.2-hide-and-peek-design.md`

**Interfaces:**
- Consumes: everything above. Produces the rebuilt `youtube-feed-blocker-v0.2.0.zip` (gitignored).

- [ ] **Step 1: README.md**

a) Replace feature item 2 (starting `2. **Peeking with friction**`) with:

```markdown
2. **Timed peeking with friction**: "Show my feed anyway" asks how long
   (5, 10, 15 or 30 minutes), optionally what you came for, then pauses 10
   seconds. The feed and Up next open in every YouTube tab for that long, a
   small countdown appears in the last 5 minutes, and when time is up the video
   pauses with "Time's up" (keep watching this one video, or back to Home).
   Peeks draw from a **daily feed time** budget (default 30 minutes): lowering
   it applies at once, raising it needs a confirmation the next day.
```

b) In the file layout block, under `lib/storage.js`, add:

```
  lib/feed-budget.js     daily feed time: remaining, peek lengths, budget changes
  lib/peek-session.js    the running peek, shared by all tabs (storage.session)
```

and under `reason-banner.js` add:

```
    peek-timer.js        closing countdown chip and the time's up card
```

c) In the settings shape block, after `widgets: { todo: true, quote: true }` add:

```js
  dailyBudgetMinutes: 0 | 15 | 30 | 45 | 60 | 90,   // 0 = Off
  pendingBudget: null | { minutes, requestedOn: "YYYY-MM-DD" }
```

and below the block add:

```markdown
Also stored: `feedTimeUsage` in `chrome.storage.sync` (`{ date, usedMinutes }`)
and the running peek in `chrome.storage.session` (`peekSession`:
`{ endsAt, reason, bannerClosed }`).
```

d) Update the e2e assertion count in the Testing section to the real total from Task 4 (expected 56), and the unit description to "(settings, upgrade, daily feed time, peek session, storage errors)".

- [ ] **Step 2: store-listing.md**

a) Replace the "PEEK, BUT ON PURPOSE" block (the heading line through the line before the blank line preceding "INSTEAD OF THE FEED") with:

```
PEEK, BUT ON PURPOSE
Choose how hard it is to see the real home feed:
- Pause: pick how long (5 to 30 minutes), then wait 10 seconds
- Pause and say why: also type what you came for. A small reminder of your
  reason stays on screen while you browse
- No peeking: the feed stays hidden. Search and subscriptions still work
A peek works in every YouTube tab. A small countdown appears in the last 5
minutes, and when time is up the video pauses so you choose: keep watching
this one video, or go back to Home.

DAILY FEED TIME
Peeks come out of a daily budget (30 minutes by default). Lowering it applies
right away; raising it waits until the next day, when you are asked to
confirm.
```

b) In the `storage` permission justification block, change the stored-items list to include the daily feed time and usage, ending with:

```
  widget preferences, the daily feed time setting and today's used feed
  minutes (chrome.storage.sync), the running peek (chrome.storage.session,
  cleared when the browser closes), and to-do items (chrome.storage.local).
  No data is transmitted.
```

c) In the detailed description's PRIVACY paragraph, replace the sentence about the reason with: "The reason you type when peeking is only kept until the peek ends or the browser closes. The extension never saves it or sends it anywhere."

d) Verify: `node -e "const t=require('fs').readFileSync('store-listing.md','utf8');const b=t.match(/\`\`\`[\s\S]*?\`\`\`/g)||[];console.log(b.some(x=>x.includes('—')))"` prints `false`.

- [ ] **Step 3: PRIVACY.md and privacy.html (keep both in sync)**

- Add the daily feed time setting and any pending raise to the `chrome.storage.sync` settings row.
- Add a row: "Today's used feed minutes (date and a number)" | `chrome.storage.sync` | "Only you (as above)."
- Replace the line about the reason with: "The reason you type when peeking, and the end time of the current peek, are kept in the browser's session storage (`chrome.storage.session`) until the peek ends or the browser closes. They are never sent anywhere."
- Bump "Last updated" to today's date.
- No em dashes; `grep -c` for U+2014 in both files must print 0.

- [ ] **Step 4: Older spec note**

In `docs/superpowers/specs/2026-09-29-v0.2-hide-and-peek-design.md`, at the top under the Status line, add: "Note: the peek rules here (lasts until leaving Home, reason in tab memory) are superseded by `2026-10-01-timed-peek-design.md`."

- [ ] **Step 5: Signed-in QA (`test/live-qa-cdp.mjs`)**

a) In its `setSettings` default object, add `dailyBudgetMinutes: 30, pendingBudget: null`.

b) Replace the `// ---------- v0.2: watch page and peek, signed in ----------` peek part (from `await loadHome();` through the `home-v02-after-peek.png` screenshot line) with:

```js
  await extEvalLive(() => new Promise((r) => chrome.storage.session.remove("peekSession", r)));
  await loadHome();
  await yt.click("#yfb-panel .yfb-peek__link").catch(() => {});
  await yt.click('#yfb-panel .yfb-peek__duration[data-minutes="5"]').catch(() => {});
  await sleep(11500);
  R.v02_peek = await yt.evaluate(() => ({
    revealed: !document.documentElement.classList.contains("yfb-home-replaced") && !document.getElementById("yfb-panel"),
    gridItems: document.querySelectorAll('ytd-browse[page-subtype="home"] ytd-rich-item-renderer').length,
    chip: document.getElementById("yfb-peek-chip")?.textContent || null,
  }));
  await yt.screenshot({ path: path.join(OUT, "home-v02-after-peek.png") });
  if (vidId) {
    await extEvalLive(() => new Promise((r) => chrome.storage.session.set({ peekSession: { endsAt: Date.now() + 15000, reason: "", bannerClosed: false } }, r)));
    await yt.goto(`https://www.youtube.com/watch?v=${vidId}`, { waitUntil: "domcontentloaded" });
    await yt.waitForSelector("#yfb-timeup", { timeout: 40000 }).catch(() => {});
    R.v02_timeup = await yt.evaluate(() => ({
      card: !!document.getElementById("yfb-timeup"),
      paused: document.querySelector("video")?.paused ?? null,
    }));
    await yt.screenshot({ path: path.join(OUT, "watch-v02-timeup.png") });
  }
  await extEvalLive(() => Promise.all([
    new Promise((r) => chrome.storage.session.remove("peekSession", r)),
    new Promise((r) => chrome.storage.sync.remove("feedTimeUsage", r)),
  ]));
```

and add this helper next to its `setSettings` helper:

```js
async function extEvalLive(fn) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${ID}/src/popup/popup.html`);
  const out = await p.evaluate(fn);
  await p.close();
  return out;
}
```

Do not run this script; the user runs it signed in.

- [ ] **Step 6: Final check, commit, package**

Run: `node test/unit.mjs && node test/e2e.mjs` (expect all pass).

```bash
git add README.md store-listing.md PRIVACY.md privacy.html test/live-qa-cdp.mjs docs/superpowers/specs/2026-09-29-v0.2-hide-and-peek-design.md
git commit -F - <<'EOF'
Docs, store copy and privacy policy for timed peeks and daily feed time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git archive --format=zip -o youtube-feed-blocker-v0.2.0.zip HEAD manifest.json icons src PRIVACY.md README.md
```

List the zip (`python -m zipfile -l youtube-feed-blocker-v0.2.0.zip`) and confirm it contains `src/lib/feed-budget.js`, `src/lib/peek-session.js` and `src/content/peek-timer.js`, and no `test/` or `docs/`. Do not push.
