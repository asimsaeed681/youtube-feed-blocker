/**
 * Follow-up CDP QA:
 *  1. reload the extension (pick up the overlay.css dark-mode fix)
 *  2. dark-mode screenshots of all 3 feed modes (emulate prefers-color-scheme)
 *  3. search-results Shorts test (this account has no subs feed to use):
 *     count reel shelves / Shorts tiles / Shorts anchors visible with blocking
 *     ON vs OFF, and grab a real /shorts/<id> link to test the redirect.
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PROFILE = "C:\\Users\\aasim\\yfb-chrome-test-profile";
const CDP = "http://localhost:9222";
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, "$1"), "live-qa");
const STATUS = path.join(PROFILE, "qa-status2.json");
fs.mkdirSync(OUT, { recursive: true });
const status = (p) => fs.writeFileSync(STATUS, JSON.stringify({ ...(fs.existsSync(STATUS) ? JSON.parse(fs.readFileSync(STATUS, "utf8")) : {}), ...p, ts: new Date().toISOString() }, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function resolvePlaywright() {
  try { return require("playwright"); } catch {}
  const npx = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "npm-cache", "_npx");
  for (const d of fs.readdirSync(npx)) {
    const p = path.join(npx, d, "node_modules", "playwright", "index.js");
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("no playwright");
}
const { chromium } = resolvePlaywright();

status({ phase: "connecting" });
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const opened = [];
const np = async () => { const p = await ctx.newPage(); opened.push(p); return p; };
async function done(code) {
  for (const p of opened) await p.close().catch(() => {});
  try { await browser.close(); } catch {}
  process.exit(code);
}

const swHost = () => {
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
  return sw ? new URL(sw.url()).host : null;
};
let ID = swHost();
if (!ID) {
  const p = await np();
  await p.goto("chrome://extensions");
  await p.waitForTimeout(800);
  ID = await p.evaluate(() => {
    const f = []; const walk = (r) => r.querySelectorAll("*").forEach((el) => { if (el.tagName === "EXTENSIONS-ITEM" && el.id) f.push(el.id); if (el.shadowRoot) walk(el.shadowRoot); });
    walk(document); return f[0] || null;
  });
}
if (!ID) { status({ phase: "ERROR-no-ext" }); await done(2); }
status({ phase: "reloading-extension", extensionId: ID });

// reload the extension so the new overlay.css is used
try {
  const rp = await np();
  await rp.goto(`chrome-extension://${ID}/src/popup/popup.html`);
  await rp.evaluate(() => chrome.runtime.reload());
  await rp.close().catch(() => {});
  opened.pop();
} catch {}
await sleep(4000);
// id is stable for unpacked, but re-resolve just in case
ID = swHost() || ID;

async function setSettings(patch) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${ID}/src/popup/popup.html`);
  await p.evaluate((s) => new Promise((r) => chrome.storage.sync.set({ settings: s }, r)), {
    shortsBlocking: true, feedMode: "widgets", aiInstruction: "", widgets: { todo: true, timer: true, quote: true }, ...patch,
  });
  await p.close();
  await sleep(400);
}

const R = { extensionId: ID };
try {
  // ---------- 2. dark-mode screenshots ----------
  const dk = await np();
  await dk.emulateMedia({ colorScheme: "dark" });
  for (const mode of ["widgets", "blank", "ai"]) {
    await setSettings({ feedMode: mode, shortsBlocking: true, aiInstruction: mode === "ai" ? "Only in-depth programming tutorials and conference talks." : "" });
    await dk.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
    await dk.waitForTimeout(5000);
    R[`dark_${mode}`] = await dk.evaluate(() => {
      const panel = document.getElementById("yfb-panel");
      const cs = panel ? getComputedStyle(panel) : null;
      const title = document.querySelector("#yfb-panel .yfb-widget__title, #yfb-panel .yfb-blank__msg, #yfb-panel .yfb-ai__title");
      return {
        htmlDark: document.documentElement.hasAttribute("dark"),
        panelColor: cs?.color,
        firstHeadingColor: title ? getComputedStyle(title).color : null,
        cardBg: (() => { const w = document.querySelector("#yfb-panel .yfb-widget"); return w ? getComputedStyle(w).backgroundColor : null; })(),
      };
    });
    await dk.screenshot({ path: path.join(OUT, `dark-${mode}.png`) });
  }

  // ---------- 3. search-results Shorts test ----------
  function countIn(scopeSel) {
    return dk.evaluate((sel) => {
      const root = sel === "document" ? document : document.querySelector(sel);
      if (!root) return { error: "no scope " + sel };
      const visible = (el) => !!(el && el.offsetParent !== null && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden");
      const g = {
        reelShelves: "ytd-reel-shelf-renderer",
        richShortsShelves: "ytd-rich-shelf-renderer[is-shorts]",
        shortsAnchors: 'a[href^="/shorts/"]',
        shortsLockups: "ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2",
        videoRenderersWithShorts: "ytd-video-renderer:has(a[href^='/shorts/'])",
      };
      const out = {};
      for (const [k, s] of Object.entries(g)) {
        let all = [];
        try { all = Array.from(root.querySelectorAll(s)); } catch { all = []; }
        out[k] = { total: all.length, visible: all.filter(visible).length };
      }
      return out;
    }, scopeSel);
  }

  await setSettings({ feedMode: "widgets", shortsBlocking: true });
  await dk.goto("https://www.youtube.com/results?search_query=mrbeast", { waitUntil: "domcontentloaded" });
  await dk.waitForTimeout(5000);
  await dk.evaluate(() => window.scrollTo(0, 2500)); await dk.waitForTimeout(3000);
  R.search_blockingON = await countIn("document");
  await dk.screenshot({ path: path.join(OUT, "search-blockingON.png") });

  await setSettings({ feedMode: "widgets", shortsBlocking: false });
  await dk.goto("https://www.youtube.com/results?search_query=mrbeast", { waitUntil: "domcontentloaded" });
  await dk.waitForTimeout(5000);
  await dk.evaluate(() => window.scrollTo(0, 2500)); await dk.waitForTimeout(3000);
  R.search_blockingOFF = await countIn("document");
  await dk.screenshot({ path: path.join(OUT, "search-blockingOFF.png") });
  const shortId = await dk.evaluate(() => {
    const a = document.querySelector('a[href^="/shorts/"]');
    const m = (a?.getAttribute("href") || "").match(/\/shorts\/([\w-]{6,})/);
    return m ? m[1] : null;
  });

  // ---------- redirect test ----------
  await setSettings({ feedMode: "widgets", shortsBlocking: true });
  if (shortId) {
    await dk.goto(`https://www.youtube.com/shorts/${shortId}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await dk.waitForTimeout(4500);
    R.shortsRedirect = { from: `/shorts/${shortId}`, landedOn: dk.url(), redirected: new RegExp(`/watch\\?v=${shortId}`).test(dk.url()) };
  } else R.shortsRedirect = { error: "no /shorts/<id> link even with blocking off" };

  await setSettings({ feedMode: "widgets", shortsBlocking: true });
  fs.writeFileSync(path.join(OUT, "results2.json"), JSON.stringify(R, null, 2));
  status({ phase: "DONE" });
} catch (e) {
  fs.writeFileSync(path.join(OUT, "results2.json"), JSON.stringify({ ...R, ERROR: String(e && e.stack || e) }, null, 2));
  status({ phase: "ERROR", error: String(e && e.message || e) });
}
await done(0);
