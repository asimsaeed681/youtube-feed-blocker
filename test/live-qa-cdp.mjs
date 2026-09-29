/**
 * Real logged-in YouTube QA via CDP attach.
 *
 * The user launches real Chrome themselves (launch-for-qa.bat) with
 * --remote-debugging-port=9222 and the isolated profile. Because that Chrome is
 * NOT automation-launched, the unpacked extension loads normally. This script
 * only ATTACHES over CDP and drives a read-only inspection, then disconnects
 * without closing the user's browser.
 *
 * Status -> <profile>/qa-status.json     Output -> <scratchpad>/live-qa/
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PROFILE = "C:\\Users\\aasim\\yfb-chrome-test-profile";
const CDP = "http://localhost:9222";
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, "$1"), "live-qa");
const STATUS = path.join(PROFILE, "qa-status.json");
const STORAGE_STATE = path.join(PROFILE, "storage-state.json");
fs.mkdirSync(OUT, { recursive: true });

const status = (patch) => {
  const cur = fs.existsSync(STATUS) ? JSON.parse(fs.readFileSync(STATUS, "utf8")) : {};
  fs.writeFileSync(STATUS, JSON.stringify({ ...cur, ...patch, ts: new Date().toISOString() }, null, 2));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function resolvePlaywright() {
  try { return require("playwright"); } catch {}
  const npx = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "npm-cache", "_npx");
  if (fs.existsSync(npx)) for (const d of fs.readdirSync(npx)) {
    const p = path.join(npx, d, "node_modules", "playwright", "index.js");
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("Playwright not found");
}
const { chromium } = resolvePlaywright();

status({ phase: "connecting", cdp: CDP });
let browser;
try {
  browser = await chromium.connectOverCDP(CDP);
} catch (e) {
  status({ phase: "ERROR-connect", error: String(e.message || e), hint: "is launch-for-qa.bat running? port 9222 open?" });
  process.exit(1);
}
const ctx = browser.contexts()[0];
const myPages = [];
const newPage = async () => { const p = await ctx.newPage(); myPages.push(p); return p; };

async function cleanup(code) {
  try { for (const p of myPages) await p.close().catch(() => {}); } catch {}
  try { await browser.close(); } catch {} // for CDP this only disconnects
  process.exit(code);
}

// ---- resolve extension id ----
async function scrapeExtId(p) {
  await p.goto("chrome://extensions");
  await p.waitForTimeout(800);
  return p.evaluate(() => {
    const f = [];
    const walk = (r) => r.querySelectorAll("*").forEach((el) => {
      if (el.tagName === "EXTENSIONS-ITEM" && el.id) f.push(el.id);
      if (el.shadowRoot) walk(el.shadowRoot);
    });
    walk(document);
    return f[0] || null;
  });
}
const swHost = () => {
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
  return sw ? new URL(sw.url()).host : null;
};

const ep = await newPage();
let ID = swHost() || (await scrapeExtId(ep));
if (!ID) {
  status({ phase: "ERROR-no-extension", note: "connected fine, but no unpacked extension found. Load it via chrome://extensions in the launched Chrome, then re-run." });
  await cleanup(2);
}

const yt = await newPage();
await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await yt.waitForTimeout(3000);
const signedIn = await yt.evaluate(() => !!document.querySelector("#avatar-btn, button#avatar-btn, ytd-topbar-menu-button-renderer #avatar-btn"));
status({ phase: "attached", extensionId: ID, signedIn });
if (!signedIn) {
  status({ phase: "ERROR-not-signed-in", extensionId: ID, note: "sign into YouTube in the launched Chrome, then re-run" });
  await cleanup(3);
}

status({ phase: "running-inspection", extensionId: ID, signedIn: true });
await ctx.storageState({ path: STORAGE_STATE });

// ---------- helpers ----------
async function setSettings(patch) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${ID}/src/popup/popup.html`);
  await p.evaluate((s) => new Promise((r) => chrome.storage.sync.set({ settings: s }, r)), {
    shortsBlocking: true, feedMode: "widgets", aiInstruction: "", widgets: { todo: true, timer: true, quote: true }, ...patch,
  });
  await p.close();
  await sleep(400);
}
async function loadHome() {
  await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  await yt.waitForTimeout(5000);
  await yt.evaluate(() => window.scrollTo(0, 3000)); await yt.waitForTimeout(2500);
  await yt.evaluate(() => window.scrollTo(0, 0)); await yt.waitForTimeout(800);
}
function countShorts(scope = "document") {
  return yt.evaluate((scopeSel) => {
    const root = scopeSel === "document" ? document : document.querySelector(scopeSel);
    if (!root) return { error: "scope not found: " + scopeSel };
    const visible = (el) => !!(el && el.offsetParent !== null && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden");
    const groups = {
      shortsAnchors: 'a[href^="/shorts"]',
      reelShelves: "ytd-reel-shelf-renderer",
      richShortsShelves: "ytd-rich-shelf-renderer[is-shorts]",
      shortsLockups: "ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2",
      guideShortsLinks: 'ytd-guide-entry-renderer a[href^="/shorts"], ytd-mini-guide-entry-renderer a[href^="/shorts"]',
    };
    const out = {};
    for (const [k, s] of Object.entries(groups)) {
      const all = Array.from(root.querySelectorAll(s));
      out[k] = { total: all.length, visible: all.filter(visible).length };
    }
    return out;
  }, scope);
}
async function expandGuide() {
  await yt.evaluate(() => {
    const b = document.querySelector("#guide-button button") || document.querySelector("button#guide") || document.querySelector("#guide-button");
    if (b) b.click();
  });
  await yt.waitForTimeout(1600);
}
function guideShorts() {
  return yt.evaluate(() => {
    const entries = Array.from(document.querySelectorAll("ytd-guide-entry-renderer"));
    const visible = (el) => !!(el && el.offsetParent !== null && getComputedStyle(el).display !== "none");
    const shorts = entries.filter((e) => e.querySelector('a[href^="/shorts"]'));
    return {
      totalGuideEntries: entries.length,
      shortsEntries_total: shorts.length,
      shortsEntries_visible: shorts.filter(visible).length,
      firstTitles: entries.slice(0, 14).map((e) => (e.querySelector("a")?.getAttribute("title") || e.innerText.trim().split("\n")[0] || "").slice(0, 22)),
    };
  });
}

const R = {};
try {
  for (const mode of ["widgets", "blank", "ai"]) {
    await setSettings({ feedMode: mode, shortsBlocking: true, aiInstruction: mode === "ai" ? "Only in-depth programming tutorials and conference talks. No clickbait or vlogs." : "" });
    await loadHome();
    R[`home_${mode}`] = await yt.evaluate(() => {
      const grid = document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer');
      const panel = document.getElementById("yfb-panel");
      return {
        realGridItems: grid ? grid.querySelectorAll("ytd-rich-item-renderer").length : 0,
        realGridDisplay: grid ? getComputedStyle(grid).display : "no-grid",
        panelPresent: !!panel, panelMode: panel?.dataset.mode || null,
        panelVisible: panel ? getComputedStyle(panel).display !== "none" && panel.offsetHeight > 0 : false,
        widgetCount: document.querySelectorAll("#yfb-panel .yfb-widget").length,
      };
    });
    await yt.screenshot({ path: path.join(OUT, `home-${mode}.png`) });
  }

  await setSettings({ feedMode: "widgets", shortsBlocking: true });
  await loadHome();
  await expandGuide();
  R.sidebar_blockingON = await guideShorts();
  await yt.screenshot({ path: path.join(OUT, "sidebar-blockingON.png") });

  await yt.goto("https://www.youtube.com/feed/subscriptions", { waitUntil: "domcontentloaded" });
  await yt.waitForTimeout(5000);
  await yt.evaluate(() => window.scrollTo(0, 3000)); await yt.waitForTimeout(2500);
  R.subscriptions_blockingON = await countShorts("document");
  await yt.screenshot({ path: path.join(OUT, "subscriptions-blockingON.png") });
  const vidId = await yt.evaluate(() => {
    const a = document.querySelector('ytd-rich-item-renderer a#video-title-link, a#video-title-link, ytd-video-renderer a#video-title');
    const m = (a?.getAttribute("href") || "").match(/[?&]v=([\w-]{6,})/);
    return m ? m[1] : null;
  });

  if (vidId) {
    await yt.goto(`https://www.youtube.com/watch?v=${vidId}`, { waitUntil: "domcontentloaded" });
    await yt.waitForTimeout(6000);
    await yt.evaluate(() => window.scrollTo(0, 1500)); await yt.waitForTimeout(3000);
    R.related_blockingON = await countShorts("ytd-watch-next-secondary-results-renderer");
    await yt.screenshot({ path: path.join(OUT, "watch-related-blockingON.png") });
  } else R.related_blockingON = { error: "no video id from subscriptions" };

  await setSettings({ feedMode: "widgets", shortsBlocking: false });
  await loadHome();
  await expandGuide();
  R.sidebar_blockingOFF = await guideShorts();
  await yt.screenshot({ path: path.join(OUT, "sidebar-blockingOFF.png") });

  await yt.goto("https://www.youtube.com/feed/subscriptions", { waitUntil: "domcontentloaded" });
  await yt.waitForTimeout(5000);
  await yt.evaluate(() => window.scrollTo(0, 3000)); await yt.waitForTimeout(2500);
  R.subscriptions_blockingOFF = await countShorts("document");
  await yt.screenshot({ path: path.join(OUT, "subscriptions-blockingOFF.png") });
  const shortId = await yt.evaluate(() => {
    const a = document.querySelector('a[href^="/shorts/"]');
    const m = (a?.getAttribute("href") || "").match(/\/shorts\/([\w-]{6,})/);
    return m ? m[1] : null;
  });
  if (vidId) {
    await yt.goto(`https://www.youtube.com/watch?v=${vidId}`, { waitUntil: "domcontentloaded" });
    await yt.waitForTimeout(6000);
    await yt.evaluate(() => window.scrollTo(0, 1500)); await yt.waitForTimeout(3000);
    R.related_blockingOFF = await countShorts("ytd-watch-next-secondary-results-renderer");
    await yt.screenshot({ path: path.join(OUT, "watch-related-blockingOFF.png") });
  }

  await setSettings({ feedMode: "widgets", shortsBlocking: true });
  if (shortId) {
    await yt.goto(`https://www.youtube.com/shorts/${shortId}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await yt.waitForTimeout(4000);
    R.shortsRedirect = { from: `/shorts/${shortId}`, landedOn: yt.url(), redirected: new RegExp(`/watch\\?v=${shortId}`).test(yt.url()) };
  } else R.shortsRedirect = { error: "no /shorts/<id> link found while blocking was off" };

  // ---------- v0.2: watch page and peek, signed in ----------
  await setSettings({ feedMode: "widgets", hideUpNext: true, hideComments: true, blockAutoplay: true, peekLevel: "pause" });
  if (vidId) {
    await yt.goto(`https://www.youtube.com/watch?v=${vidId}`, { waitUntil: "domcontentloaded" });
    await yt.waitForTimeout(6000);
    await yt.evaluate(() => window.scrollTo(0, 1500)); await yt.waitForTimeout(3000);
    R.v02_watch = await yt.evaluate(() => {
      const d = (s) => { const n = document.querySelector(s); return n ? getComputedStyle(n).display : "missing"; };
      return {
        related: d("ytd-watch-flexy #related"),
        comments: d("ytd-comments#comments"),
        autoplay: document.querySelector(".ytp-autonav-toggle-button")?.getAttribute("aria-checked") ?? "no-toggle",
      };
    });
    await yt.screenshot({ path: path.join(OUT, "watch-v02-hidden.png") });
  } else R.v02_watch = { error: "no video id from subscriptions" };

  await loadHome();
  await yt.click("#yfb-panel .yfb-peek__link").catch(() => {});
  await sleep(11500);
  R.v02_peek = await yt.evaluate(() => ({
    revealed: !document.documentElement.classList.contains("yfb-home-replaced") && !document.getElementById("yfb-panel"),
    gridItems: document.querySelectorAll('ytd-browse[page-subtype="home"] ytd-rich-item-renderer').length,
  }));
  await yt.screenshot({ path: path.join(OUT, "home-v02-after-peek.png") });

  // restore a sane default for the user's continued manual poking
  await setSettings({ feedMode: "widgets", shortsBlocking: true });

  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(R, null, 2));
  status({ phase: "DONE", resultsFile: path.join(OUT, "results.json") });
} catch (e) {
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ...R, ERROR: String(e && e.stack || e) }, null, 2));
  status({ phase: "ERROR", error: String(e && e.message || e) });
}
await cleanup(0);
