/**
 * End-to-end smoke test for the YouTube Feed Blocker extension.
 *
 * The Playwright MCP server can't load an unpacked extension, so this drives
 * Chromium directly with --load-extension. It reuses the Playwright package and
 * Chromium build that `npx @playwright/mcp` already put on disk — nothing new is
 * installed.
 *
 * Run:  node test/e2e.mjs
 * Requires: Playwright present somewhere resolvable (see resolvePlaywright).
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, "$1"), "..");

function resolvePlaywright() {
  // 1. normal resolution (installed locally or globally)
  try {
    return require("playwright");
  } catch {}
  // 2. npx cache left behind by `npx @playwright/mcp`
  const npxCache = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "npm-cache",
    "_npx"
  );
  if (fs.existsSync(npxCache)) {
    for (const dir of fs.readdirSync(npxCache)) {
      const p = path.join(npxCache, dir, "node_modules", "playwright", "index.js");
      if (fs.existsSync(p)) return require(p);
    }
  }
  throw new Error("Could not find Playwright. Run `npx playwright@latest install chromium` or `npm i -D playwright`.");
}

const { chromium } = resolvePlaywright();

/** Find an already-downloaded Chromium (installed by any Playwright/MCP run). */
function resolveChromiumExecutable() {
  const base = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "ms-playwright"
  );
  if (!fs.existsSync(base)) return undefined;
  const builds = fs
    .readdirSync(base)
    .filter((d) => d.startsWith("chromium-") && !d.includes("headless"))
    .sort();
  for (const b of builds) {
    for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
      const p = path.join(base, b, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

const executablePath = resolveChromiumExecutable();

const results = [];
const log = (name, pass, detail) => {
  results.push({ pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "yfb-e2e-"));
const shotDir = path.join(EXT, "test", "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  ...(executablePath ? { executablePath } : {}),
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

async function setSettings(extId, patch) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await p.evaluate(
    (s) => new Promise((res) => chrome.storage.sync.set({ settings: s }, res)),
    {
      shortsBlocking: true,
      hideHomeFeed: true,
      hideUpNext: true,
      blockAutoplay: true,
      hideComments: false,
      peekLevel: "reason",
      feedMode: "widgets",
      aiInstruction: "",
      widgets: { todo: true, timer: true, quote: true },
      ...patch,
    }
  );
  await p.close();
}

try {
  const ext = await ctx.newPage();
  await ext.goto("chrome://extensions");
  await ext.waitForTimeout(500);
  const extId = await ext.evaluate(() => {
    const found = [];
    const walk = (root) =>
      root.querySelectorAll("*").forEach((el) => {
        if (el.tagName === "EXTENSIONS-ITEM" && el.id) found.push(el.id);
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    walk(document);
    return found[0] || null;
  });
  log("extension loads unpacked + id resolved", !!extId, extId || "not found");
  if (!extId) throw new Error("no extension id");

  // The service worker seeds defaults on install. Read them before any test
  // overwrites settings, to prove background.js loads lib/defaults.js.
  const seedPage = await ctx.newPage();
  await seedPage.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  const seeded = await seedPage.evaluate(
    () => new Promise((r) => chrome.storage.sync.get("settings", (x) => r(x.settings || null)))
  );
  await seedPage.close();
  log(
    "install seeds full v0.2 defaults",
    !!seeded && seeded.hideUpNext === true && seeded.peekLevel === "reason",
    JSON.stringify(seeded)
  );

  const yt = await ctx.newPage();
  await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  // First load in a cold profile can be slow (YouTube SPA + the extension's
  // service worker registering). Wait for the panel rather than a fixed delay.
  await yt
    .waitForFunction(() => !!document.querySelector("#yfb-panel .yfb-widget"), null, { timeout: 20000 })
    .catch(() => {});
  await yt.waitForTimeout(1500);

  const home = await yt.evaluate(() => ({
    htmlClasses: document.documentElement.className,
    panelMode: document.getElementById("yfb-panel")?.dataset.mode || null,
    widgetCount: document.querySelectorAll("#yfb-panel .yfb-widget").length,
    gridDisplay: (() => {
      const g = document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer');
      return g ? getComputedStyle(g).display : "no-grid";
    })(),
    miniShorts: (() => {
      const m = document
        .querySelector('ytd-mini-guide-entry-renderer a[href^="/shorts"]')
        ?.closest("ytd-mini-guide-entry-renderer");
      return m ? getComputedStyle(m).display : "no-entry";
    })(),
  }));
  log("home feed replaced (html.yfb-home-replaced)", home.htmlClasses.includes("yfb-home-replaced"));
  log("#yfb-panel injected in widgets mode", home.panelMode === "widgets", "mode=" + home.panelMode);
  log("all 3 widgets render", home.widgetCount === 3, "count=" + home.widgetCount);
  log("real recommendation grid hidden", home.gridDisplay === "none" || home.gridDisplay === "no-grid", home.gridDisplay);
  log("Shorts hidden from sidebar", home.miniShorts === "none" || home.miniShorts === "no-entry", home.miniShorts);

  const sp = await ctx.newPage();
  await sp.goto("https://www.youtube.com/shorts/dQw4w9WgXcQ", { waitUntil: "domcontentloaded" }).catch(() => {});
  await sp.waitForTimeout(3500);
  log("/shorts/<id> -> /watch?v=<id>", /\/watch\?v=dQw4w9WgXcQ/.test(sp.url()), sp.url());
  await sp.close();

  // SPA navigation: watch page -> home via the masthead logo (no full reload)
  await setSettings(extId, { feedMode: "widgets" });
  await yt.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await yt.waitForTimeout(3000);
  await yt.evaluate(() => {
    const logo = document.querySelector("a#logo, ytd-topbar-logo-renderer a, a[title='YouTube Home']");
    if (logo) logo.click();
    else location.assign("/");
  });
  await yt.waitForTimeout(4000);
  const spa = await yt.evaluate(() => ({
    path: location.pathname,
    panelMode: document.getElementById("yfb-panel")?.dataset.mode || null,
    widgetCount: document.querySelectorAll("#yfb-panel .yfb-widget").length,
  }));
  log(
    "panel re-mounts after SPA nav back to home",
    spa.path === "/" && spa.panelMode === "widgets" && spa.widgetCount === 3,
    `path=${spa.path} mode=${spa.panelMode} widgets=${spa.widgetCount}`
  );

  // live settings propagation
  await setSettings(extId, { feedMode: "blank", shortsBlocking: false });
  await yt.waitForTimeout(1500);
  const live = await yt.evaluate(() => ({
    htmlClasses: document.documentElement.className,
    panelMode: document.getElementById("yfb-panel")?.dataset.mode || null,
    blank: !!document.querySelector("#yfb-panel .yfb-blank"),
  }));
  log("feedMode change applies live, no reload", live.panelMode === "blank" && live.blank, "mode=" + live.panelMode);
  log("shortsBlocking off applies live", live.htmlClasses.includes("yfb-shorts-allowed"));

  // per-mode screenshots
  for (const mode of ["widgets", "ai", "blank"]) {
    await setSettings(extId, {
      feedMode: mode,
      aiInstruction: mode === "ai" ? "Only in-depth coding tutorials. No clickbait." : "",
    });
    await yt.reload({ waitUntil: "domcontentloaded" });
    await yt.waitForTimeout(4500);
    await yt.screenshot({ path: path.join(shotDir, `home-${mode}.png`) });
  }
  console.log(`\nscreenshots -> ${shotDir}`);
} finally {
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await ctx.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
