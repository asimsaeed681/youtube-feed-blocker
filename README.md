# YouTube Feed Blocker

A Manifest V3 Chrome extension that:

1. **Kills Shorts** — hides the Shorts tab, shelves, and sidebar link across
   `youtube.com`, and redirects any `/shorts/<id>` URL to the normal
   `/watch?v=<id>` player. Works with YouTube's single-page navigation via a
   `MutationObserver`.
2. **Replaces the home feed** with one of three modes, chosen in the popup:
   - **Blank** — a calm, empty home page.
   - **Productivity widgets** — to-do list, focus timer, and a daily quote.
   - **AI-curated** — type an instruction for the feed you want.
     *Preview only in this build — the classifier backend is not wired up yet.*
3. Persists all settings via `chrome.storage.sync`.

This is a **sideload / load-unpacked build**. It is not on the Chrome Web Store
and should not be published there yet.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder
   (`youtube-feed-blocker/`, the one containing `manifest.json`).
4. Open YouTube. Click the extension icon to choose a feed mode.

To update after code changes: return to `chrome://extensions` and click the
reload icon on the extension card, then refresh YouTube.

## File layout

```
manifest.json
src/
  background.js          MV3 service worker: seeds default settings on install
  lib/defaults.js        shared constants + default settings
  lib/storage.js         chrome.storage.sync wrapper
  content/
    hide-shorts.css      static Shorts-hiding rules (pre-paint)
    overlay.css          styles for the injected home-feed panel
    shorts-blocker.js    Shorts UI removal + /shorts redirect + observer
    feed-widgets.js      to-do / timer / quote widgets
    feed-replacer.js     hides the real home grid, injects the panel
  popup/                 popup UI (mode toggle, widget toggles, AI instruction)
icons/                   placeholder icons
```

## Settings shape (`chrome.storage.sync`, key `settings`)

```js
{
  shortsBlocking: true,
  feedMode: "blank" | "widgets" | "ai",
  aiInstruction: "",
  widgets: { todo: true, timer: true, quote: true }
}
```

## Testing

**Signed-out smoke test** — `node test/e2e.mjs` loads the extension unpacked into
Playwright's Chromium and checks Shorts removal, the `/shorts` redirect, all
three feed modes, SPA re-mount, and live settings propagation (10 assertions).
Reuses the Playwright build the Playwright MCP already installed; screenshots to
`test/screenshots/`.

**Real logged-in QA** — Chrome stable disables unpacked extensions under
automation, so this route has you drive:

1. Run `C:\Users\aasim\yfb-chrome-test-profile\launch-for-qa.bat` (starts Chrome
   with a debug port on an isolated, non-synced profile).
2. In it: `chrome://extensions` → Developer mode → Load unpacked → this folder;
   sign into YouTube.
3. `node test/live-qa-cdp.mjs` — attaches over CDP, checks feed replacement on a
   real populated feed, Shorts removal in the sidebar and search results, the
   redirect, and blocking on/off. `test/live-qa-cdp-followup.mjs` adds
   dark-mode screenshots and reloads the extension first.

The isolated profile keeps its own copy of your session — it is deliberately
outside OneDrive and must never be committed.

## Not in this build

- AI feed classification (needs a backend proxy that holds the API key — no key
  ever ships in the client).
- Filtering feeds other than the home feed.
- Any Chrome Web Store listing.
