/**
 * Unit tests for the settings layer (defaults.js + storage.js), run in plain
 * Node with an in-memory chrome.storage stub. No browser needed.
 *
 * Run:  node test/unit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// In-memory chrome.storage.sync. Callbacks fire asynchronously like the real
// API, which is what exposes read-then-write races.
const store = {};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
globalThis.window = globalThis;

// One-shot failure switches for the next get/set call. Chrome reports a
// failed storage call by setting chrome.runtime.lastError during the
// callback, then clearing it - mirror that exactly here.
let failNextGet = false;
let failNextSet = false;

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

for (const f of ["src/lib/defaults.js", "src/lib/storage.js", "src/lib/feed-budget.js", "src/lib/peek-session.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f });
}
const YFB = globalThis.YFB;

let failed = 0;
let total = 0;
function check(name, pass, detail) {
  total += 1;
  if (!pass) failed += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

// --- upgrade from a v0.1 stored object ---
const v01 = {
  shortsBlocking: false,
  feedMode: "blank",
  aiInstruction: "coding talks",
  widgets: { todo: false, timer: true, quote: true },
};
const up = YFB.mergeWithDefaults(v01);
check("v0.1 values survive the upgrade",
  up.shortsBlocking === false && up.feedMode === "blank" && up.aiInstruction === "coding talks" && up.widgets.todo === false);
check("new keys get their defaults",
  up.hideHomeFeed === true && up.hideUpNext === true && up.blockAutoplay === true &&
  up.hideComments === false && up.peekLevel === "reason",
  JSON.stringify(up));

// --- bad values fall back to defaults ---
const bad = YFB.mergeWithDefaults({ peekLevel: "sometimes", hideComments: "yes", feedMode: 3 });
check("unknown peekLevel falls back", bad.peekLevel === "reason", bad.peekLevel);
check("non-boolean toggle falls back", bad.hideComments === false, String(bad.hideComments));
check("unknown feedMode falls back", bad.feedMode === "widgets", String(bad.feedMode));
check("null stored object gives full defaults",
  JSON.stringify(YFB.mergeWithDefaults(null)) === JSON.stringify(YFB.mergeWithDefaults({})));

// --- reason validation ---
check("empty reason rejected", YFB.isValidReason("") === false);
check("whitespace-padded short reason rejected", YFB.isValidReason("  ab  ") === false);
check("3-character reason accepted", YFB.isValidReason("css") === true);
check("non-string reason rejected", YFB.isValidReason(null) === false);

// --- concurrent writes both persist ---
await Promise.all([
  YFB.setSettings({ hideComments: true }),
  YFB.setSettings({ peekLevel: "none" }),
  YFB.setSettings({ widgets: { quote: false } }),
]);
const after = await YFB.getSettings();
check("three concurrent setSettings calls all persist",
  after.hideComments === true && after.peekLevel === "none" && after.widgets.quote === false,
  JSON.stringify(after));

// --- F5: storage error handling ---
failNextSet = true;
let write1Rejected = false;
try {
  await YFB.setSettings({ peekLevel: "pause" });
} catch {
  write1Rejected = true;
}
check("a failed write rejects instead of resolving", write1Rejected === true);

failNextGet = true;
let write2Rejected = false;
try {
  await YFB.setSettings({ peekLevel: "none" });
} catch {
  write2Rejected = true;
}
const afterFailedRead = await YFB.getSettings();
check(
  "a failed read does not overwrite settings with defaults",
  write2Rejected === true && afterFailedRead.hideComments === true,
  JSON.stringify(afterFailedRead)
);

await YFB.setSettings({ hideComments: false });
const afterQueueRecovery = await YFB.getSettings();
check(
  "the write queue keeps working after a failed write",
  afterQueueRecovery.hideComments === false,
  JSON.stringify(afterQueueRecovery)
);

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

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
