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
      widgets: { todo: true, quote: true },
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
  log("both widgets render", home.widgetCount === 2, "count=" + home.widgetCount);
  log("real recommendation grid hidden", home.gridDisplay === "none" || home.gridDisplay === "no-grid", home.gridDisplay);
  // A signed-in home page always has a chip bar, which grows YouTube's
  // #frosted-glass backdrop down over the panel. Force that state and check
  // the backdrop stops above the first widget.
  const glass = await yt.evaluate(() => {
    const fg = document.getElementById("frosted-glass");
    if (!fg) return null;
    const before = fg.className;
    fg.className = "with-chipbar style-scope ytd-app";
    const out = {
      backdropBottom: Math.round(fg.getBoundingClientRect().bottom),
      widgetTop: Math.round(document.querySelector("#yfb-panel .yfb-widget").getBoundingClientRect().top),
    };
    fg.className = before;
    return out;
  });
  log(
    "chip-bar backdrop doesn't cover the panel",
    !!glass && glass.backdropBottom <= glass.widgetTop,
    JSON.stringify(glass)
  );
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
    spa.path === "/" && spa.panelMode === "widgets" && spa.widgetCount === 2,
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

  // ---------- v0.2: watch page ----------
  const display = (page, sel) =>
    page.evaluate((s) => {
      const n = document.querySelector(s);
      return n ? getComputedStyle(n).display : "missing";
    }, sel);

  await setSettings(extId, {});
  await yt.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await yt.waitForSelector("ytd-watch-flexy #related", { state: "attached", timeout: 20000 }).catch(() => {});
  await yt.waitForTimeout(3000);
  const relatedHidden = await display(yt, "ytd-watch-flexy #related");
  log("Up next sidebar hidden", relatedHidden === "none", relatedHidden);

  const autoplay = await yt
    .waitForFunction(
      () => document.querySelector(".ytp-autonav-toggle-button")?.getAttribute("aria-checked") === "false",
      null,
      { timeout: 12000 }
    )
    .then(() => "false")
    .catch(() =>
      yt.evaluate(() => document.querySelector(".ytp-autonav-toggle-button")?.getAttribute("aria-checked") ?? "no-toggle")
    );
  log("autoplay toggle ends up off", autoplay === "false", autoplay);

  await yt.evaluate(() => window.scrollBy(0, 800));
  await setSettings(extId, { hideComments: true });
  await yt.waitForTimeout(800);
  const commentsHidden = await display(yt, "ytd-comments#comments");
  log("comments hidden when on", commentsHidden === "none", commentsHidden);

  await setSettings(extId, { hideComments: false, hideUpNext: false });
  await yt.waitForTimeout(800);
  const commentsBack = await display(yt, "ytd-comments#comments");
  const relatedBack = await display(yt, "ytd-watch-flexy #related");
  log(
    "comments and Up next come back live, no reload",
    !["none", "missing"].includes(commentsBack) && !["none", "missing"].includes(relatedBack),
    `comments=${commentsBack} related=${relatedBack}`
  );

  // A Mix is a playlist every video has, so this URL always shows a playlist panel.
  await setSettings(extId, {});
  await yt.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ", { waitUntil: "domcontentloaded" });
  await yt.waitForSelector("ytd-playlist-panel-renderer#playlist", { state: "attached", timeout: 20000 }).catch(() => {});
  await yt.waitForTimeout(3000);
  const playlist = await yt.evaluate(() => {
    const p = document.querySelector("ytd-playlist-panel-renderer#playlist");
    return p ? { display: getComputedStyle(p).display, height: Math.round(p.getBoundingClientRect().height) } : null;
  });
  log(
    "playlist panel stays visible with Up next hidden",
    !!playlist && playlist.display !== "none" && playlist.height > 0,
    JSON.stringify(playlist)
  );

  // ---------- v0.2: home feed toggle and peeking ----------
  // setSettings opens and closes a helper tab, which can leave the YouTube tab
  // in the background, and the countdown (correctly) pauses in background tabs.
  const goHome = async () => {
    await yt.bringToFront();
    await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
    await yt.waitForSelector("#yfb-panel", { timeout: 20000 }).catch(() => {});
    await yt.waitForTimeout(1500);
  };
  const feedRevealed = () =>
    yt.evaluate(
      () => !document.documentElement.classList.contains("yfb-home-replaced") && !document.getElementById("yfb-panel")
    );
  // Client-side (SPA) navigations, so the content script keeps its state.
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

  // Pause level: countdown, reveal, and the pause returns after leaving Home.
  // Playwright keeps every page in this session visible and focused -
  // bringToFront() never toggles document.hidden here - so the "tab hidden"
  // check below drives document.hidden directly, via CDP, inside the content
  // script's own isolated world instead of relying on a real tab switch.
  // Execution contexts are only reported for ones created after Runtime.enable,
  // so this must run before the goHome() navigation right below.
  const cdp = await ctx.newCDPSession(yt);
  await cdp.send("Runtime.enable");
  let isolatedContext = null;
  cdp.on("Runtime.executionContextCreated", (e) => {
    const c = e.context;
    if (c.auxData && c.auxData.type === "isolated" && c.name === "YouTube Feed Blocker") {
      isolatedContext = c;
    }
  });

  await setSettings(extId, { peekLevel: "pause" });
  await goHome();
  await yt.click("#yfb-panel .yfb-peek__link");
  const countText = await yt.textContent("#yfb-panel .yfb-peek__count").catch(() => null);
  log("pause: countdown starts at 10 seconds", /10 seconds/.test(countText || ""), countText);

  // An unrelated setting change must not reset a running countdown.
  await setSettings(extId, { peekLevel: "pause", hideComments: true });
  await yt.bringToFront();
  await yt.waitForTimeout(1000);
  const stillCounting = await yt.$("#yfb-panel .yfb-peek__count");
  log("unrelated setting change keeps the countdown running", !!stillCounting);

  await yt.waitForTimeout(10500);
  log("pause: real feed shows after the countdown", await feedRevealed());

  await spaToSearch();
  await spaToHome();
  const pauseBack = await yt.evaluate(
    () => location.pathname === "/" && !!document.querySelector("#yfb-panel .yfb-peek__link")
  );
  log("leaving Home and coming back brings the pause back", pauseBack);

  // Hiding the tab pauses the countdown. feed-replacer.js's countdown tick
  // reads document.hidden from the extension's own isolated world, so we
  // override it there directly - isolated-world wrappers are separate from
  // the page's, so this can't leak into the page itself.
  await yt.click("#yfb-panel .yfb-peek__link");
  if (!isolatedContext) {
    throw new Error("could not find the extension's isolated execution context via CDP");
  }
  await cdp.send("Runtime.evaluate", {
    contextId: isolatedContext.id,
    expression: 'Object.defineProperty(document, "hidden", { configurable: true, get: () => true })',
  });
  await yt.waitForTimeout(12000);
  log("countdown pauses while the tab is hidden", !(await feedRevealed()));

  await cdp.send("Runtime.evaluate", {
    contextId: isolatedContext.id,
    expression: "delete document.hidden",
  });
  await yt.waitForTimeout(11000);
  log("countdown resumes when the tab is visible again", await feedRevealed());
  await cdp.detach();

  // Reason level: validation, never mind, banner, HTML stays text, close.
  await setSettings(extId, { peekLevel: "reason" });
  await goHome();
  await yt.click("#yfb-panel .yfb-peek__link");
  await yt.click("#yfb-panel .yfb-peek__cancel");
  log("never mind returns to the link", !!(await yt.$("#yfb-panel .yfb-peek__link")));

  await yt.click("#yfb-panel .yfb-peek__link");
  await yt.fill("#yfb-peek-reason", "  a ");
  await yt.click('#yfb-panel .yfb-peek__form button[type="submit"]');
  const reasonError = await yt.textContent("#yfb-panel .yfb-peek__error");
  const countingEarly = await yt.$("#yfb-panel .yfb-peek__count");
  log("reason: too-short reason is rejected", !!reasonError && !countingEarly, reasonError);

  await yt.fill("#yfb-peek-reason", "<b>css</b> grid layouts");
  await yt.click('#yfb-panel .yfb-peek__form button[type="submit"]');
  await yt.waitForTimeout(11500);
  log("reason: real feed shows after the countdown", await feedRevealed());

  await spaToSearch();
  const banner = await yt.evaluate(() => {
    const b = document.getElementById("yfb-reason-banner");
    return b ? { text: b.querySelector(".yfb-reason__text").textContent, injected: !!b.querySelector(".yfb-reason__text b") } : null;
  });
  log(
    "banner shows the reason on the next page",
    !!banner && banner.text === "You came for: <b>css</b> grid layouts",
    banner && banner.text
  );
  log("reason is shown as text, not HTML", !!banner && !banner.injected);
  await yt.click("#yfb-reason-banner .yfb-reason__close");
  log("closing the banner removes it", !(await yt.$("#yfb-reason-banner")));

  // No peeking: no link at all.
  await setSettings(extId, { peekLevel: "none" });
  await goHome();
  log(
    "no peeking: panel without a peek link",
    !!(await yt.$("#yfb-panel")) && !(await yt.$("#yfb-panel .yfb-peek__link"))
  );

  // Home feed toggle off shows the real feed live.
  await setSettings(extId, { hideHomeFeed: false });
  await yt.waitForTimeout(1500);
  log("home feed toggle off shows the real feed, no reload", await feedRevealed());

  // ---------- v0.2: popup ----------
  await setSettings(extId, {});
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 340, height: 900 });
  await pop.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await pop.waitForTimeout(500);
  const popInitial = await pop.evaluate(() => ({
    home: document.querySelector('input[data-setting="hideHomeFeed"]')?.checked,
    comments: document.querySelector('input[data-setting="hideComments"]')?.checked,
    peek: document.querySelector('input[name="peekLevel"]:checked')?.value,
  }));
  log(
    "popup reflects the defaults",
    popInitial.home === true && popInitial.comments === false && popInitial.peek === "reason",
    JSON.stringify(popInitial)
  );

  // AI instruction autosave across typing.
  await pop.click('label:has(input[name="feedMode"][value="ai"])');
  await pop.waitForTimeout(300);
  await pop.click("#aiInstruction");
  await pop.keyboard.type("hello ");
  await pop.waitForTimeout(700);
  await pop.keyboard.type("world");
  await pop.waitForTimeout(700);
  const aiValue = await pop.evaluate(() => document.getElementById("aiInstruction").value);
  const aiStored = await pop.evaluate(
    () => new Promise((r) => chrome.storage.sync.get("settings", (x) => r(x.settings?.aiInstruction || "")))
  );
  log(
    "AI instruction box keeps typing across autosave",
    aiValue === "hello world" && aiStored === "hello world",
    `textarea="${aiValue}" stored="${aiStored}"`
  );
  await pop.click('label:has(input[name="feedMode"][value="widgets"])');
  await pop.waitForTimeout(300);

  // Three quick clicks: all three changes must be saved.
  await pop.click('label:has(input[name="peekLevel"][value="none"])');
  await pop.click('label:has(input[data-setting="hideComments"])');
  await pop.click('label:has(input[data-setting="hideHomeFeed"])');
  await pop.waitForTimeout(500);
  const popStored = await pop.evaluate(
    () => new Promise((r) => chrome.storage.sync.get("settings", (x) => r(x.settings)))
  );
  log(
    "popup saves quick successive changes",
    popStored.peekLevel === "none" && popStored.hideComments === true && popStored.hideHomeFeed === false,
    JSON.stringify(popStored)
  );
  log(
    "peek and feed sections hide while the home feed is shown",
    await pop.evaluate(() => document.getElementById("feedSections").hidden === true)
  );
  const popupDashes = await pop.evaluate(() => document.body.textContent.includes("—"));
  log("popup copy has no em dashes", !popupDashes);

  await pop.click('label:has(input[data-setting="hideHomeFeed"])');
  await pop.waitForTimeout(300);
  await pop.screenshot({ path: path.join(shotDir, "popup.png"), fullPage: true });
  await pop.close();

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
} catch (e) {
  console.error(e);
  results.push({ pass: false });
} finally {
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await ctx.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
