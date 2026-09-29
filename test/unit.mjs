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

globalThis.chrome = {
  runtime: {},
  storage: {
    sync: {
      get(key, cb) {
        setTimeout(() => {
          if (failNextGet) {
            failNextGet = false;
            chrome.runtime.lastError = { message: "simulated get failure" };
            try {
              cb({});
            } finally {
              delete chrome.runtime.lastError;
            }
            return;
          }
          cb({ [key]: clone(store[key]) });
        }, 5);
      },
      set(obj, cb) {
        setTimeout(() => {
          if (failNextSet) {
            failNextSet = false;
            chrome.runtime.lastError = { message: "simulated set failure" };
            try {
              if (cb) cb();
            } finally {
              delete chrome.runtime.lastError;
            }
            return;
          }
          Object.assign(store, clone(obj));
          if (cb) cb();
        }, 5);
      },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
};

for (const f of ["src/lib/defaults.js", "src/lib/storage.js"]) {
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

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
